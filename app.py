import os
import tempfile
import subprocess
import json
from flask import Flask, request, render_template, jsonify
from nbconvert import PythonExporter
# Import the check running utility
from checker.utils import run_all_checks
# Import black formatter
import black

app = Flask(__name__)

# Configure a temporary directory for uploaded files/code
TEMP_DIR = tempfile.mkdtemp(prefix='code_review_')

@app.route('/')
def index():
    """Renders the main page."""
    return render_template('index.html')

@app.route('/check', methods=['POST'])
def check_code():
    """Handles code submission and runs checks."""
    code_to_check = None
    input_type = request.form.get('inputType') # e.g., 'paste', 'py', 'ipynb'
    original_filename = "pasted_code.py" # Default for pasted code
    conversion_only = request.args.get('conversion_only') == 'true'

    try:
        if input_type == 'paste':
            code_to_check = request.form.get('code')
            if not code_to_check:
                return jsonify({"error": "No code pasted"}), 400
            # Ensure line breaks are properly preserved
            code_to_check = code_to_check.replace('\r\n', '\n').replace('\r', '\n')
        elif input_type == 'py':
            file = request.files.get('file')
            if not file or file.filename == '':
                 return jsonify({"error": "No file selected"}), 400
            if not file.filename.endswith('.py'):
                 return jsonify({"error": "Invalid file type, please upload a .py file"}), 400
            original_filename = file.filename
            code_to_check = file.read().decode('utf-8')
            # Normalize line endings
            code_to_check = code_to_check.replace('\r\n', '\n').replace('\r', '\n')
        elif input_type == 'ipynb':
            file = request.files.get('file')
            if not file or file.filename == '':
                 return jsonify({"error": "No file selected"}), 400
            if not file.filename.endswith('.ipynb'):
                 return jsonify({"error": "Invalid file type, please upload a .ipynb file"}), 400
            original_filename = file.filename
            # Save temporary ipynb file to process with nbconvert
            temp_ipynb_path = os.path.join(TEMP_DIR, original_filename)
            file.save(temp_ipynb_path)
            try:
                exporter = PythonExporter()
                code_to_check, _ = exporter.from_filename(temp_ipynb_path)
                # Normalize line endings
                code_to_check = code_to_check.replace('\r\n', '\n').replace('\r', '\n')
            except Exception as e:
                return jsonify({"error": f"Error converting notebook: {str(e)}"}), 500
            finally:
                if os.path.exists(temp_ipynb_path):
                    os.remove(temp_ipynb_path) # Clean up temp ipynb
        else:
            return jsonify({"error": "Invalid input type specified"}), 400

        if code_to_check is None:
            return jsonify({"error": "Could not extract code to check"}), 500

        # If this is just a conversion request for a notebook, return the code
        if conversion_only:
            return jsonify({"code": code_to_check})

        # Save code to a temporary .py file
        temp_py_file = None
        try:
            fd, temp_py_path = tempfile.mkstemp(suffix='.py', dir=TEMP_DIR, text=True)
            with os.fdopen(fd, 'w', encoding='utf-8', newline='\n') as f:
                # Ensure we're writing with Unix line endings for better tool compatibility
                f.write(code_to_check)
            temp_py_file = temp_py_path # Keep track for cleanup

            # Run all checks on the temporary file
            results = run_all_checks(temp_py_path)
            results["filename"] = original_filename # Add filename for display

        except Exception as e:
            app.logger.error(f"Error during check process for {original_filename}: {str(e)}")
            return jsonify({"error": f"Error running checks: {str(e)}"}), 500
        finally:
            # Clean up the temporary python file
            if temp_py_file and os.path.exists(temp_py_file):
                os.remove(temp_py_file)

        return jsonify(results)

    except Exception as e:
        # General error handler
        app.logger.error(f"An unexpected error occurred: {str(e)}")
        return jsonify({"error": "An internal server error occurred"}), 500

# Basic cleanup of the main temp directory on exit
# A more robust cleanup might be needed for long-running servers
import atexit
import shutil
atexit.register(shutil.rmtree, TEMP_DIR, ignore_errors=True)

@app.route('/format', methods=['POST'])
def format_code():
    """Formats Python code using Black."""
    try:
        code = request.form.get('code')
        if not code:
            return jsonify({"error": "No code provided"}), 400
        
        # Ensure line breaks are properly preserved
        code = code.replace('\r\n', '\n').replace('\r', '\n')
        
        # Format the code using Black
        try:
            formatted_code = black.format_str(code, mode=black.Mode())
            return jsonify({"formatted_code": formatted_code})
        except Exception as e:
            app.logger.error(f"Error formatting code with Black: {str(e)}")
            return jsonify({"error": f"Error formatting code: {str(e)}"}), 500
    
    except Exception as e:
        app.logger.error(f"Unexpected error in format_code: {str(e)}")
        return jsonify({"error": "An internal server error occurred"}), 500

if __name__ == '__main__':
    # Create dummy files if they don't exist so Flask doesn't complain
    app.run(debug=True, port=5678) # Using port 5678 to avoid conflicts
