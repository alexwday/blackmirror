import subprocess
import json
import re
import sys
import os

# Helper function to run a command and capture output
def _run_command(command, cwd=None):
    """Runs a shell command in a specific directory and returns stdout, stderr, and return code."""
    try:
        process = subprocess.run(
            command,
            shell=True,
            capture_output=True,
            text=True,
            check=False, # Don't raise exception on non-zero exit code here
            cwd=cwd # Run in the specified directory
        )
        return process.stdout, process.stderr, process.returncode
    except Exception as e:
        print(f"Error running command '{command}': {e}", file=sys.stderr)
        return None, str(e), -1 # Indicate failure

# Function to run Black check
def run_black_check(file_path):
    """Runs black --check and returns issues found."""
    command = f"black --check --quiet \"{file_path}\""
    stdout, stderr, returncode = _run_command(command)

    issues = []
    # Black returns 0 if no changes needed, 1 if changes needed, >1 for errors
    if returncode == 1:
        # Black's output on stderr indicates files that would be reformatted
        if stderr:
             # Extract filename from "would reformat <filename>"
             match = re.search(r"would reformat\s+(.*)", stderr)
             if match:
                 issues.append(f"File requires reformatting by Black.")
             else:
                 issues.append(stderr.strip()) # Fallback
        else:
             issues.append("File requires reformatting by Black (no specific details from stderr).")
    elif returncode > 1:
        issues.append(f"Black encountered an error: {stderr.strip()}")

    return issues

# Helper function to calculate a score from pylint issues
def calculate_score_from_issues(issues):
    """Calculate a pylint score based on issue count and severity."""
    if not issues:
        return "10.00"  # Perfect score if no issues
    
    # Count issues by type
    error_count = sum(1 for issue in issues if issue.get('type_code') in ['E', 'F'])
    warning_count = sum(1 for issue in issues if issue.get('type_code') == 'W')
    convention_count = sum(1 for issue in issues if issue.get('type_code') == 'C')
    refactor_count = sum(1 for issue in issues if issue.get('type_code') == 'R')
    security_count = sum(1 for issue in issues if issue.get('type_code') == 'S')
    
    # Calculate penalty for each type of issue - revised to better match pylint's native scoring
    # These weights more closely match pylint's actual scoring algorithm
    error_penalty = error_count * 2.0
    warning_penalty = warning_count * 0.5  # Reduced from 1.0 to 0.5 to be less harsh on warnings
    convention_penalty = convention_count * 0.25  # Reduced from 0.5 to 0.25
    refactor_penalty = refactor_count * 0.2  # Reduced from 0.3 to 0.2
    security_penalty = security_count * 2.5  # Security issues still weighted heavily
    
    # Calculate total penalty
    total_penalty = error_penalty + warning_penalty + convention_penalty + refactor_penalty + security_penalty
    
    # Softer cap on maximum penalty - pylint's native algorithm is more forgiving
    # for files with many minor issues
    max_penalty = min(10.0, len(issues) * 0.5)  # Reduced from 0.8 to 0.5
    total_penalty = min(total_penalty, max_penalty)
    
    # Calculate score (10 - penalty), ensure it's not negative
    score = max(0, 10.0 - total_penalty)
    
    # Format score to 2 decimal places
    raw_pylint_score = f"{score:.2f}"
    
    # Include both native pylint score and our custom weighted score in the response
    return raw_pylint_score

# Function to run Pylint check
def run_pylint_check(file_path):
    """Runs pylint and returns the score and issues list."""
    file_dir = os.path.dirname(file_path)
    file_name = os.path.basename(file_path)
    init_py_path = os.path.join(file_dir, "__init__.py")
    created_init = False
    
    # Define base pylint command parts (excluding output format)
    base_command_args = [
        "pylint",
        "--fail-under=0",
        "--disable=import-error,relative-beyond-top-level,no-name-in-module,"
        "wrong-import-position,wrong-import-order,ungrouped-imports,"
        "import-self,cyclic-import,wildcard-import,consider-using-from-import,"
        "reimported,unused-import",
        "--ignore-imports=y",
        "--enable=missing-function-docstring,missing-class-docstring,empty-docstring,"
        "undefined-variable,unused-variable,unused-argument," 
        "redefined-outer-name,redefined-builtin,invalid-name,"
        "line-too-long,too-many-arguments,too-many-branches,too-many-locals,"
        "too-many-nested-blocks,too-many-statements,too-many-instance-attributes,"
        "broad-exception-caught,bare-except,broad-exception-raised,"
        "exec-used,eval-used,using-constant-test," 
        "consider-using-with,consider-using-f-string,use-list-literal,use-dict-literal",
        "--max-line-length=100",
        f"\"{file_name}\"" # Ensure filename is quoted
    ]

    issues = []
    score = "Error"
    native_pylint_score = None

    try:
        # Create temporary __init__.py if needed
        if not os.path.exists(init_py_path):
            with open(init_py_path, 'w') as f:
                f.write('')
            created_init = True

        # --- Run 1: Get JSON issues ---
        json_command = " ".join(base_command_args[:1] + ["--output-format=json"] + base_command_args[1:])
        json_stdout, json_stderr, json_returncode = _run_command(json_command, cwd=file_dir)

        if json_returncode == -1: # Error running the command itself
            issues.append({"type_code": "Fatal", "symbol": "command-error", "message": json_stderr, "line": 0})
            return "0.00", issues

        if json_stderr and "Fatal" in json_stderr:
            issues.append({"type_code": "Fatal", "symbol": "pylint-fatal", "message": json_stderr.strip(), "line": 0})

        if json_stdout:
            try:
                json_start_index = json_stdout.find('[')
                if json_start_index != -1:
                    pylint_data = json.loads(json_stdout[json_start_index:])
                    issues = [
                        {
                            "type_code": item.get('type', '?').upper()[0],
                            "symbol": item.get('symbol', 'unknown'),
                            "message": item.get('message', 'No message'),
                            "line": item.get('line', 0)
                        }
                        for item in pylint_data
                    ]
            except json.JSONDecodeError as e:
                issues.append({"type_code": "Fatal", "symbol": "json-parse-error", "message": f"Could not parse Pylint JSON output: {e}\nOutput was:\n{json_stdout}", "line": 0})
                score = "0.00"
            except Exception as e:
                 issues.append({"type_code": "Fatal", "symbol": "pylint-parse-error", "message": f"Error processing Pylint JSON output: {e}", "line": 0})
                 score = "0.00"
        elif json_stderr and not issues: # If no stdout but stderr exists, record it as a fatal issue if not already done
             issues.append({"type_code": "Fatal", "symbol": "pylint-stderr", "message": json_stderr.strip(), "line": 0})
             score = "0.00"

        # --- Run 2: Get Native Score (Text Output) ---
        # Only run if the first command didn't fail completely
        if json_returncode != -1 and score != "0.00":
            text_command = " ".join(base_command_args) # Default output format
            text_stdout, text_stderr, text_returncode = _run_command(text_command, cwd=file_dir)
            
            combined_text_output = text_stdout + text_stderr
            score_match = re.search(r"Your code has been rated at ([-0-9.]+)/10", combined_text_output)
            
            if score_match:
                native_pylint_score = score_match.group(1)
                score = native_pylint_score # Prioritize native score
            elif not issues and text_returncode == 0: # If no issues found in JSON and text run is clean
                 score = "10.00"
            else:
                 # Fallback to calculated score if native score isn't found
                 score = calculate_score_from_issues(issues)

        # Add metadata about scores if native score was found
        if native_pylint_score:
            calculated_score = calculate_score_from_issues(issues)
            issues.append({
                "type_code": "INFO", 
                "symbol": "native-pylint-score", 
                "message": f"Native pylint score: {native_pylint_score}/10 (Calculated: {calculated_score}/10)",
                "line": 0,
                "native_score": native_pylint_score,
                "calculated_score": calculated_score
            })

    finally:
        # Clean up the temporary __init__.py
        if created_init and os.path.exists(init_py_path):
            try:
                os.remove(init_py_path)
            except OSError as e:
                 print(f"Warning: Could not remove temporary __init__.py {init_py_path}: {e}", file=sys.stderr)

    # Final check for error state
    if score == "Error":
        score = calculate_score_from_issues(issues) if issues else "0.00"

    return score, issues


# Function to run detect-secrets check
def run_detect_secrets_check(file_path):
    """Runs detect-secrets scan and returns found secrets."""
    file_dir = os.path.dirname(file_path)
    file_name = os.path.basename(file_path)

    # Run scan with additional plugins and customized settings
    command = f"""detect-secrets scan --all-files 
                  --custom-plugins "SECRET|API[_-]?KEY|password|token|credential"
                  \"{file_name}\""""
    stdout, stderr, returncode = _run_command(command, cwd=file_dir)

    secrets = []

    if returncode == -1: # Error running command
        secrets.append(f"Detect-secrets command failed: {stderr}")
    # detect-secrets returns non-zero if secrets are found, even if successful
    # So we primarily check stderr for actual errors
    elif stderr and "error" in stderr.lower():
         secrets.append(f"Detect-secrets error: {stderr.strip()}")
    elif stdout:
        try:
            # Parse the JSON output
            scan_results = json.loads(stdout)
            # Use the relative filename as the key
            file_results = scan_results.get("results", {}).get(file_name, [])
            for finding in file_results:
                secrets.append(f"Line {finding['line_number']}: Potential '{finding['type']}' secret detected.")
        except json.JSONDecodeError:
            # If output wasn't JSON, treat it as an error/unexpected message
            secrets.append(f"Detect-secrets non-JSON output/error: {stdout.strip()}")
        except Exception as e:
             secrets.append(f"Error parsing detect-secrets output: {e}")

    return secrets

# Function to perform additional security checks not covered by pylint
def run_additional_security_checks(file_path):
    """Runs additional security checks on the file content."""
    security_issues = []
    
    try:
        with open(file_path, 'r', encoding='utf-8') as file:
            content = file.read()
            
            # Check for insecure hash algorithms (MD5, SHA1)
            if re.search(r'import\s+hashlib.*?md5|hashlib\.md5|from\s+hashlib\s+import\s+md5', content):
                security_issues.append({
                    "type_code": "S", 
                    "symbol": "insecure-hash-algorithm", 
                    "message": "MD5 is a cryptographically insecure hash function. Consider using SHA-256 or better.", 
                    "line": 0
                })
                
            if re.search(r'import\s+hashlib.*?sha1|hashlib\.sha1|from\s+hashlib\s+import\s+sha1', content):
                security_issues.append({
                    "type_code": "S", 
                    "symbol": "insecure-hash-algorithm", 
                    "message": "SHA1 is a cryptographically insecure hash function. Consider using SHA-256 or better.", 
                    "line": 0
                })
                
            # Check for insecure random number generation
            if re.search(r'import\s+random|from\s+random\s+import', content) and re.search(r'password|token|secret|key', content, re.IGNORECASE):
                security_issues.append({
                    "type_code": "S", 
                    "symbol": "insecure-random", 
                    "message": "Using standard 'random' module with security-sensitive data. Use 'secrets' module instead for cryptographic purposes.", 
                    "line": 0
                })
                
            # Check for insecure pickle usage
            if re.search(r'import\s+pickle|from\s+pickle\s+import', content):
                security_issues.append({
                    "type_code": "S", 
                    "symbol": "insecure-deserialization", 
                    "message": "Using 'pickle' module which can lead to arbitrary code execution if deserializing untrusted data.", 
                    "line": 0
                })
                
            # Check for insecure temporary file creation
            if re.search(r'tempfile\.mktemp', content):
                security_issues.append({
                    "type_code": "S", 
                    "symbol": "insecure-temp-file", 
                    "message": "Using 'tempfile.mktemp' which is vulnerable to race conditions. Use 'tempfile.mkstemp' instead.", 
                    "line": 0
                })
                
            # Check for shell=True in subprocess
            if re.search(r'subprocess\.(?:call|run|Popen).*?shell\s*=\s*True', content):
                security_issues.append({
                    "type_code": "S", 
                    "symbol": "subprocess-shell-true", 
                    "message": "Using 'shell=True' with subprocess functions is a security risk if combined with untrusted input.", 
                    "line": 0
                })
                
            # Check for SQL injection potential
            if re.search(r'cursor\.execute\s*\(.*?\%|cursor\.execute\s*\(.*?\+|cursor\.execute\s*\(.*?\.format|cursor\.execute\s*\(.*?f"', content):
                security_issues.append({
                    "type_code": "S", 
                    "symbol": "sql-injection-risk", 
                    "message": "Possible SQL injection risk. Use parameterized queries or an ORM instead of string formatting/concatenation.", 
                    "line": 0
                })
                
    except Exception as e:
        print(f"Error in additional security checks: {e}", file=sys.stderr)
        
    return security_issues

# Main function to orchestrate all checks
def run_all_checks(file_path):
    """Runs all configured checks on the given file path."""
    print(f"Running checks on: {file_path}", file=sys.stderr) # Log which file is checked

    black_issues = run_black_check(file_path)
    pylint_score, pylint_issues = run_pylint_check(file_path)
    secret_issues = run_detect_secrets_check(file_path)
    
    # Add additional security checks
    additional_security_issues = run_additional_security_checks(file_path)
    if additional_security_issues:
        pylint_issues.extend(additional_security_issues)

    results = {
        "pylint_score": pylint_score,
        "black_issues": black_issues,
        "pylint_issues": pylint_issues,
        "secret_issues": secret_issues
    }
    print(f"Checks completed for: {file_path}", file=sys.stderr) # Log completion
    return results
