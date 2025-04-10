// Script for Python Code Review Tool

// Global variable to store the CodeMirror instance
let codeMirrorEditor;

// Initialize code editor and line numbers when the page loads
document.addEventListener('DOMContentLoaded', function() {
    // Initialize CodeMirror (replacing highlight.js)
    const codeEditorElement = document.getElementById('code-editor');
    if (codeEditorElement) {
        codeMirrorEditor = CodeMirror.fromTextArea(codeEditorElement, {
            mode: "python",
            theme: "monokai",
            lineNumbers: true,
            matchBrackets: true,
            indentUnit: 4,
            indentWithTabs: false,
            tabSize: 4,
            autofocus: true,
            lineWrapping: false
        });
        
        // Set initial size to make it visible
        codeMirrorEditor.setSize("100%", "100%");
    }

    // Handle Black formatting application
    document.getElementById('apply-black').addEventListener('click', function() {
        applyBlackFormatting();
    });
});

// Function to add highlight class to a specific line
function addHighlightToLine(lineNumber) {
    if (!codeMirrorEditor) return;

    const line = lineNumber - 1; // CodeMirror lines are 0-indexed
    if (line >= 0 && line < codeMirrorEditor.lineCount()) {
        try {
            codeMirrorEditor.addLineClass(line, 'background', 'highlighted-line');
        } catch (e) {
             console.error(`Error adding highlight class to line ${lineNumber}:`, e);
        }
    }
}

// Function to clear all line highlights
function clearLineHighlights() {
    if (!codeMirrorEditor) return;
    
    // Remove highlight from all lines
    for (let i = 0; i < codeMirrorEditor.lineCount(); i++) {
        codeMirrorEditor.removeLineClass(i, 'background', 'highlighted-line');
    }
}

// Function to update the displayed filename when a file is selected
function loadFile(type) {
    const fileInput = document.getElementById(type + '-file');
    const filenameDisplay = document.getElementById('filename-display');
    
    if (fileInput.files && fileInput.files.length > 0) {
        const selectedFile = fileInput.files[0];
        filenameDisplay.textContent = selectedFile.name;
        
        const reader = new FileReader();
        reader.onload = function(e) {
            // For notebook files, we'll need to extract code cells server-side
            if (type === 'ipynb') {
                codeMirrorEditor.setValue("Loading Jupyter notebook...");
                // Submit for server-side conversion
                submitFileForConversion(selectedFile);
            } else {
                // For .py files, we can display directly
                codeMirrorEditor.setValue(e.target.result);
            }
        };
        reader.readAsText(selectedFile);
    }
}

// Function to extract code from Jupyter notebook via server
function submitFileForConversion(file) {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('inputType', 'ipynb');
    
    fetch('/check?conversion_only=true', {
        method: 'POST',
        body: formData,
    })
    .then(response => response.json())
    .then(data => {
        if (data.code) {
            // Use CodeMirror's setValue method instead of modifying textContent
            codeMirrorEditor.setValue(data.code);
        } else {
            showError(data.error || 'Failed to extract code from notebook');
        }
    })
    .catch(error => {
        console.error('Error converting notebook:', error);
        showError('Failed to process notebook: ' + error.message);
    });
}

// Function to handle code submission
async function submitCode() {
    // Get all required elements
    const loadingIndicator = document.getElementById('loading-indicator');
    const errorMessage = document.getElementById('error-message');
    const resultsContent = document.getElementById('results-content');
    const resultsFilename = document.getElementById('results-filename');
    const filenameDisplay = document.getElementById('filename-display');
    
    // Show loading indicator, hide other content
    loadingIndicator.style.display = 'flex';
    errorMessage.style.display = 'none';
    resultsContent.style.display = 'none';
    errorMessage.textContent = '';
    
    // Hide all detail sections
    document.getElementById('black-details').style.display = 'none';
    document.getElementById('pylint-details').style.display = 'none';
    document.getElementById('secrets-details').style.display = 'none';
    
    // Prepare form data
    const formData = new FormData();
    formData.append('inputType', 'paste'); // Always use 'paste' input type as we're sending from the editor
    
    // Get the code from CodeMirror
    const code = codeMirrorEditor.getValue();
    if (!code.trim()) {
        showError('Please add some code to analyze.');
        return;
    }
    
    // Make sure line breaks are properly preserved when sending to the server
    formData.append('code', code);
    
    // Get filename from display or use default
    const fileName = filenameDisplay.textContent !== 'No file loaded' ? 
                    filenameDisplay.textContent : 'code_review.py';
    resultsFilename.textContent = fileName;
    
    try {
        // Submit form data
        const response = await fetch('/check', {
            method: 'POST',
            body: formData,
        });
        
        const results = await response.json();
        
        if (!response.ok) {
            throw new Error(results.error || `Server error: ${response.status}`);
        }
        
        // Display results
        showResults(results);
        
    } catch (error) {
        console.error('Error submitting code:', error);
        showError(`${error.message}`);
    } finally {
        loadingIndicator.style.display = 'none';
    }
}

// Function to apply Black formatting to the code
function applyBlackFormatting() {
    const formData = new FormData();
    formData.append('code', codeMirrorEditor.getValue());
    formData.append('format_only', 'true');
    
    // Show loading indicator while formatting
    document.getElementById('loading-indicator').style.display = 'flex';
    
    fetch('/format', {
        method: 'POST',
        body: formData,
    })
    .then(response => response.json())
    .then(data => {
        if (data.formatted_code) {
            // Update CodeMirror with the formatted code
            codeMirrorEditor.setValue(data.formatted_code);
            showSuccess('Code was formatted successfully!');
            // Re-run analysis with the formatted code
            submitCode();
        } else {
            showError(data.error || 'Failed to format code');
        }
    })
    .catch(error => {
        console.error('Error formatting code:', error);
        showError('Failed to format code: ' + error.message);
    })
    .finally(() => {
        document.getElementById('loading-indicator').style.display = 'none';
    });
}

// Function to show error messages
function showError(message) {
    const errorMessage = document.getElementById('error-message');
    const loadingIndicator = document.getElementById('loading-indicator');
    
    errorMessage.innerHTML = `
        <span class="material-symbols-rounded" style="vertical-align: middle; margin-right: 8px;">error</span>
        ${message}
    `;
    errorMessage.style.display = 'block';
    loadingIndicator.style.display = 'none';
}

// Function to show success messages
function showSuccess(message) {
    const errorMessage = document.getElementById('error-message');
    errorMessage.innerHTML = `
        <span class="material-symbols-rounded" style="vertical-align: middle; margin-right: 8px; color: var(--success-color);">check_circle</span>
        <span style="color: var(--success-color);">${message}</span>
    `;
    errorMessage.style.display = 'block';
    setTimeout(() => {
        errorMessage.style.display = 'none';
    }, 3000);
}

// Function to determine status class
function getStatusClass(score, threshold1, threshold2) {
    if (score === 'N/A' || score === 'Error') return '';
    
    const numScore = parseFloat(score);
    if (isNaN(numScore)) return '';
    
    if (numScore >= threshold2) return 'good';
    if (numScore >= threshold1) return 'warning';
    return 'error';
}

// Function to get appropriate icon
function getStatusIcon(status) {
    switch(status) {
        case 'good': return 'check_circle';
        case 'warning': return 'warning';
        case 'error': return 'error';
        default: return 'help';
    }
}

// Function to display results
function showResults(results) {
    const resultsContent = document.getElementById('results-content');
    const errorMessage = document.getElementById('error-message');
    
    // Clear any previous error messages
    errorMessage.style.display = 'none';
    errorMessage.textContent = '';
    
    // Update Pylint Score Card
    updatePylintScoreCard(results.pylint_score);
    
    // Update Black Formatting Card
    updateBlackCard(results.black_issues || []);
    
    // Update Pylint Issues Card
    updatePylintIssuesCard(results.pylint_issues || []);
    
    // Update Secrets Card
    updateSecretsCard(results.secret_issues || []);
    
    // Show the results content area
    resultsContent.style.display = 'block';
}

// Function to update Pylint score card
function updatePylintScoreCard(pylintScore) {
    // The primary score is always the native score now, as enforced by the backend
    pylintScore = pylintScore || 'N/A';
    const pylintScoreEl = document.getElementById('pylint-score');
    const pylintScoreCard = document.getElementById('pylint-score-card');
    const pylintScoreIcon = document.getElementById('pylint-score-icon');
    const nativePylintScoreEl = document.getElementById('native-pylint-score');
    
    // Check if we have a calculated score to display for comparison
    let calculatedScore = null;
    for (const issue of window.currentPylintIssues || []) {
        if (issue.symbol === 'native-pylint-score') {
            calculatedScore = issue.calculated_score;
            break;
        }
    }
    
    // Display the native score as the primary score
    pylintScoreEl.textContent = pylintScore;
    
    // Display the calculated score for comparison if available and different
    if (nativePylintScoreEl) {
        if (calculatedScore && calculatedScore !== pylintScore) {
            nativePylintScoreEl.textContent = `Our calc: ${calculatedScore}/10`;
            nativePylintScoreEl.style.display = 'block';
        } else {
            nativePylintScoreEl.style.display = 'none';
        }
    }
    
    // Determine score class (good: ≥8, warning: ≥5, error: <5)
    const scoreClass = getStatusClass(pylintScore, 5, 8);
    pylintScoreCard.className = 'summary-card ' + scoreClass;
    pylintScoreIcon.textContent = getStatusIcon(scoreClass);
    pylintScoreIcon.style.color = scoreClass === 'good' ? 'var(--success-color)' : 
                               scoreClass === 'warning' ? 'var(--warning-color)' : 
                               scoreClass === 'error' ? 'var(--error-color)' : 'var(--light-text)';
}

// Function to update Black formatting card
function updateBlackCard(blackIssues) {
    const blackSummary = document.getElementById('black-summary');
    const blackSummaryCard = document.getElementById('black-summary-card');
    const blackIcon = document.getElementById('black-icon');
    const blackDetails = document.getElementById('black-details');
    const blackContent = document.getElementById('black-content');
    const blackCount = document.getElementById('black-count');
    const applyBlackBtn = document.getElementById('apply-black');
    
    if (blackIssues.length > 0) {
        blackSummary.textContent = `${blackIssues.length} formatting issue${blackIssues.length === 1 ? '' : 's'} found`;
        blackSummary.style.color = '#ffffff';
        blackSummaryCard.className = 'summary-card error';
        blackIcon.textContent = 'format_indent_increase';
        blackIcon.style.color = 'var(--error-color)';
        
        blackContent.textContent = blackIssues.join('\n');
        blackDetails.style.display = 'block';
        blackCount.textContent = blackIssues.length;
        applyBlackBtn.style.display = 'inline-flex';
    } else {
        blackSummary.textContent = 'No formatting issues';
        blackSummary.style.color = '#ffffff';
        blackSummaryCard.className = 'summary-card good';
        blackIcon.textContent = 'check_circle';
        blackIcon.style.color = 'var(--success-color)';
        blackDetails.style.display = 'none';
    }
}

// Function to update Pylint issues card
function updatePylintIssuesCard(pylintIssues) {
    // Store pylint issues globally for access by other functions
    window.currentPylintIssues = pylintIssues;
    
    const pylintSummary = document.getElementById('pylint-summary');
    const pylintSummaryCard = document.getElementById('pylint-summary-card');
    const pylintIcon = document.getElementById('pylint-icon');
    const pylintDetails = document.getElementById('pylint-details');
    const pylintItemsContainer = document.getElementById('pylint-items-container');
    const pylintCount = document.getElementById('pylint-count');
    
    // Clear previous highlights before processing new issues
    clearLineHighlights();
    
    if (pylintIssues.length > 0) {
        // Filter out the informational native score entry before counting/displaying
        const actualIssues = pylintIssues.filter(issue => issue.symbol !== 'native-pylint-score');
        
        const errorCount = actualIssues.filter(issue => issue.type_code === 'E' || issue.type_code === 'F').length;
        const warningCount = actualIssues.filter(issue => issue.type_code === 'W').length;
        const conventionCount = actualIssues.filter(issue => issue.type_code === 'C').length;
        const refactorCount = actualIssues.filter(issue => issue.type_code === 'R').length;
        const securityCount = actualIssues.filter(issue => issue.type_code === 'S').length;
        
        // Create detailed summary text
        const summaryDetails = [];
        if (securityCount > 0) summaryDetails.push(`<span style="color:#ff5050">${securityCount} security issue${securityCount === 1 ? '' : 's'}</span>`);
        if (errorCount > 0) summaryDetails.push(`<span style="color:#ffffff">${errorCount} error${errorCount === 1 ? '' : 's'}</span>`);
        if (warningCount > 0) summaryDetails.push(`<span style="color:#ffffff">${warningCount} warning${warningCount === 1 ? '' : 's'}</span>`);
        if (conventionCount > 0) summaryDetails.push(`<span style="color:#ffffff">${conventionCount} convention${conventionCount === 1 ? '' : 's'}</span>`);
        if (refactorCount > 0) summaryDetails.push(`<span style="color:#ffffff">${refactorCount} refactor${refactorCount === 1 ? '' : 's'}</span>`);
        
        // Set summary text with breakdown
        pylintSummary.innerHTML = summaryDetails.join(', ');
        
        // Set card style based on severity (security is highest priority)
        if (securityCount > 0) {
            pylintSummaryCard.className = 'summary-card error';
            pylintSummaryCard.style.borderLeftColor = '#a30000';
            pylintIcon.textContent = 'security';
            pylintIcon.style.color = '#ff5050';
        } else if (errorCount > 0) {
            pylintSummaryCard.className = 'summary-card error';
            pylintIcon.textContent = 'bug_report';
            pylintIcon.style.color = 'var(--error-color)';
        } else if (warningCount > 0) {
            pylintSummaryCard.className = 'summary-card warning';
            pylintIcon.textContent = 'warning';
            pylintIcon.style.color = 'var(--warning-color)';
        } else if (conventionCount > 0 || refactorCount > 0) {
            pylintSummaryCard.className = 'summary-card';
            pylintIcon.textContent = 'info';
            pylintIcon.style.color = 'var(--primary-color)';
        }
        
        // Create elements for each pylint issue
        pylintItemsContainer.innerHTML = ''; // Clear previous items
        
        // Group issues by type for better organization (using actual issues)
        const issuesByType = {
            security: actualIssues.filter(issue => issue.type_code === 'S'),
            error: actualIssues.filter(issue => issue.type_code === 'E' || issue.type_code === 'F'),
            warning: actualIssues.filter(issue => issue.type_code === 'W'),
            convention: actualIssues.filter(issue => issue.type_code === 'C'),
            refactor: actualIssues.filter(issue => issue.type_code === 'R')
        };
        
        // Create section headers if there are issues of each type
        // Display security issues first due to highest importance
        if (issuesByType.security && issuesByType.security.length > 0) {
            createSectionHeader(pylintItemsContainer, 'Security Issues', '#a30000'); // Dark red for security
            issuesByType.security.forEach(issue => createIssueElement(pylintItemsContainer, issue));
        }
        
        if (issuesByType.error.length > 0) {
            createSectionHeader(pylintItemsContainer, 'Errors', 'var(--error-color)');
            issuesByType.error.forEach(issue => createIssueElement(pylintItemsContainer, issue));
        }
        
        if (issuesByType.warning.length > 0) {
            createSectionHeader(pylintItemsContainer, 'Warnings', 'var(--warning-color)');
            issuesByType.warning.forEach(issue => createIssueElement(pylintItemsContainer, issue));
        }
        
        if (issuesByType.convention.length > 0) {
            createSectionHeader(pylintItemsContainer, 'Conventions', 'var(--primary-color)');
            issuesByType.convention.forEach(issue => createIssueElement(pylintItemsContainer, issue));
        }
        
        if (issuesByType.refactor.length > 0) {
            createSectionHeader(pylintItemsContainer, 'Refactoring Suggestions', 'var(--primary-color)');
            issuesByType.refactor.forEach(issue => createIssueElement(pylintItemsContainer, issue));
        }
        
        pylintDetails.style.display = 'block';
        pylintCount.textContent = actualIssues.length; // Count only actual issues
        
        // --- Automatically highlight all lines with issues ---
        actualIssues.forEach(issue => {
            if (issue.line && issue.line > 0) {
                addHighlightToLine(issue.line);
            }
        });
        // --- End automatic highlighting ---
        
    } else {
        pylintSummary.textContent = 'No issues found';
        pylintSummary.style.color = '#ffffff';
        pylintSummaryCard.className = 'summary-card good';
        pylintIcon.textContent = 'check_circle';
        pylintIcon.style.color = 'var(--success-color)';
        pylintDetails.style.display = 'none';
    }
}

// Helper function to create section headers for issue types
function createSectionHeader(container, title, color) {
    const header = document.createElement('div');
    header.style.borderBottom = `1px solid ${color}`;
    header.style.marginBottom = '12px';
    header.style.paddingBottom = '4px';
    header.style.fontWeight = '500';
    header.style.color = color;
    header.style.fontSize = '14px';
    header.textContent = title;
    container.appendChild(header);
}

// Helper function to create issue elements
function createIssueElement(container, issue) {
    const issueElement = document.createElement('div');
    issueElement.className = 'pylint-item';
    
    // Add extra styling for security issues
    if (issue.type_code === 'S') {
        issueElement.style.borderLeft = '3px solid #a30000';
        issueElement.style.paddingLeft = '10px';
        issueElement.style.backgroundColor = 'rgba(163, 0, 0, 0.05)';
    }
    
    // Create metadata element (line number and code)
    const metaElement = document.createElement('div');
    metaElement.className = 'pylint-meta';
    
    // Line number badge - no longer clickable for highlighting
    const lineElement = document.createElement('span');
    lineElement.className = 'pylint-line';
    lineElement.textContent = `Line ${issue.line || 'N/A'}`;
    // Optional: Keep click for scrolling? For now, remove onclick.
    // lineElement.onclick = function() { /* Add scrolling logic if needed */ };
    metaElement.appendChild(lineElement);
    
    // Error code badge with icon
    const codeElement = document.createElement('span');
    codeElement.className = 'pylint-code';
    
    // Add appropriate icon based on issue type
    let iconName = '';
    if (issue.type_code === 'S') iconName = 'security';
    else if (issue.type_code === 'E' || issue.type_code === 'F') iconName = 'error';
    else if (issue.type_code === 'W') iconName = 'warning';
    else if (issue.type_code === 'C') iconName = 'check_circle';
    else if (issue.type_code === 'R') iconName = 'build';
    
    if (iconName) {
        const icon = document.createElement('span');
        icon.className = 'material-symbols-rounded';
        icon.textContent = iconName;
        icon.style.fontSize = '14px';
        icon.style.verticalAlign = 'text-bottom';
        icon.style.marginRight = '4px';
        codeElement.appendChild(icon);
    }
    
    const codeText = document.createTextNode(`${issue.type_code || '?'}:${issue.symbol || '?'}`);
    codeElement.appendChild(codeText);
    
    // Style based on issue type
    codeElement.style.backgroundColor = 
        issue.type_code === 'S' ? 'rgba(163, 0, 0, 0.1)' :
        issue.type_code === 'E' || issue.type_code === 'F' ? 'rgba(209, 52, 56, 0.1)' :
        issue.type_code === 'W' ? 'rgba(255, 170, 68, 0.1)' : 
        issue.type_code === 'C' ? 'rgba(0, 120, 212, 0.1)' :
        'rgba(75, 75, 75, 0.1)';
    
    codeElement.style.color = 
        issue.type_code === 'S' ? '#a30000' :
        issue.type_code === 'E' || issue.type_code === 'F' ? 'var(--error-color)' :
        issue.type_code === 'W' ? 'var(--warning-color)' : 
        issue.type_code === 'C' ? 'var(--primary-color)' :
        'var(--light-text)';
    
    metaElement.appendChild(codeElement);
    issueElement.appendChild(metaElement);
    
    // Message element
    const messageElement = document.createElement('div');
    messageElement.className = 'pylint-message';
    messageElement.textContent = issue.message || 'Unknown issue';
    
    // Add a "learn more" link for security issues
    if (issue.type_code === 'S') {
        const helpLink = document.createElement('a');
        helpLink.href = '#';
        helpLink.textContent = 'Learn more';
        helpLink.style.marginLeft = '8px';
        helpLink.style.fontSize = '12px';
        helpLink.style.color = '#a30000';
        helpLink.style.textDecoration = 'underline';
        helpLink.onclick = (e) => {
            e.preventDefault();
            alert('Security issue details: ' + issue.message);
        };
        messageElement.appendChild(helpLink);
    }
    
    issueElement.appendChild(messageElement);
    container.appendChild(issueElement);
}

// Function to update Secrets card
function updateSecretsCard(secretIssues) {
    const secretsSummary = document.getElementById('secrets-summary');
    const secretsSummaryCard = document.getElementById('secrets-summary-card');
    const secretsIcon = document.getElementById('secrets-icon');
    const secretsDetails = document.getElementById('secrets-details');
    const secretsContent = document.getElementById('secrets-content');
    const secretsCount = document.getElementById('secrets-count');
    
    if (secretIssues.length > 0) {
        secretsSummary.textContent = `${secretIssues.length} potential secret${secretIssues.length === 1 ? '' : 's'} found`;
        secretsSummary.style.color = '#ffffff';
        secretsSummaryCard.className = 'summary-card error';
        secretsIcon.textContent = 'key_off';
        secretsIcon.style.color = 'var(--error-color)';
        
        secretsContent.textContent = secretIssues.join('\n');
        secretsDetails.style.display = 'block';
        secretsCount.textContent = secretIssues.length;
    } else {
        secretsSummary.textContent = 'No secrets detected';
        secretsSummary.style.color = '#ffffff';
        secretsSummaryCard.className = 'summary-card good';
        secretsIcon.textContent = 'key';
        secretsIcon.style.color = 'var(--success-color)';
        secretsDetails.style.display = 'none';
    }
}
