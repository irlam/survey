/**
 * File: analyze_survey_code.js
 * Description: Automated code analysis tool for the Survey application.
 * Scans JavaScript, PHP, HTML, and CSS files to identify areas for improvement,
 * code quality issues, security concerns, and modernization opportunities.
 * 
 * Usage: node analyze_survey_code.js <path-to-survey-directory>
 * Output: Generates detailed_analysis_report.json and analysis_summary.txt
 */

const fs = require('fs');
const path = require('path');

// Configuration
const config = {
    targetExtensions: ['.js', '.php', '.html', '.css'],
    excludeDirs: ['node_modules', 'vendor', '.git', 'storage', 'tests'],
    maxFileSize: 1024 * 1024 * 5 // 5MB limit for individual files
};

// Analysis results structure
const analysis = {
    overview: {
        totalFiles: 0,
        totalLines: 0,
        filesByType: {},
        analysisDate: new Date().toISOString()
    },
    issues: {
        critical: [],
        high: [],
        medium: [],
        low: []
    },
    codeQuality: {
        missingComments: [],
        longFunctions: [],
        duplicateCode: [],
        complexFunctions: []
    },
    modernization: {
        oldSyntax: [],
        deprecatedAPIs: [],
        improvementOpportunities: []
    },
    security: {
        potentialVulnerabilities: [],
        inputValidation: [],
        sanitization: []
    },
    performance: {
        largeFiles: [],
        inefficientPatterns: [],
        optimizationOpportunities: []
    },
    accessibility: {
        missingAria: [],
        missingAltText: [],
        colorContrast: []
    },
    recommendations: []
};

/**
 * Recursively scan directory for relevant files
 */
function scanDirectory(dirPath, fileList = []) {
    const files = fs.readdirSync(dirPath);
    
    files.forEach(file => {
        const filePath = path.join(dirPath, file);
        const stat = fs.statSync(filePath);
        
        if (stat.isDirectory()) {
            // Skip excluded directories
            if (!config.excludeDirs.includes(file)) {
                scanDirectory(filePath, fileList);
            }
        } else {
            const ext = path.extname(file);
            if (config.targetExtensions.includes(ext) && stat.size < config.maxFileSize) {
                fileList.push(filePath);
            }
        }
    });
    
    return fileList;
}

/**
 * Analyze JavaScript file
 */
function analyzeJavaScript(filePath, content) {
    const lines = content.split('\n');
    const fileName = path.basename(filePath);
    
    // Check for file header comment
    if (!content.trim().startsWith('/**') && !content.trim().startsWith('//')) {
        analysis.codeQuality.missingComments.push({
            file: filePath,
            issue: 'Missing file header comment',
            severity: 'medium'
        });
    }
    
    // Check for old syntax - var usage
    const varMatches = content.match(/\bvar\s+\w+/g);
    if (varMatches) {
        analysis.modernization.oldSyntax.push({
            file: filePath,
            issue: `Found ${varMatches.length} instances of 'var' keyword`,
            suggestion: 'Replace with const/let',
            severity: 'low',
            count: varMatches.length
        });
    }
    
    // Check for XMLHttpRequest (old AJAX)
    if (content.includes('XMLHttpRequest')) {
        analysis.modernization.deprecatedAPIs.push({
            file: filePath,
            issue: 'Using XMLHttpRequest',
            suggestion: 'Replace with modern fetch API',
            severity: 'medium'
        });
    }
    
    // Check for callback hell patterns
    const callbackNesting = (content.match(/function\s*\([^)]*\)\s*{[^}]*function\s*\([^)]*\)\s*{/g) || []).length;
    if (callbackNesting > 2) {
        analysis.modernization.improvementOpportunities.push({
            file: filePath,
            issue: 'Deep callback nesting detected',
            suggestion: 'Consider using async/await or Promises',
            severity: 'medium'
        });
    }
    
    // Check for innerHTML usage (XSS risk)
    if (content.match(/\.innerHTML\s*=/)) {
        analysis.security.potentialVulnerabilities.push({
            file: filePath,
            issue: 'Direct innerHTML assignment detected',
            risk: 'XSS vulnerability if user input is involved',
            severity: 'high'
        });
    }
    
    // Check for eval usage
    if (content.includes('eval(')) {
        analysis.security.potentialVulnerabilities.push({
            file: filePath,
            issue: 'eval() usage detected',
            risk: 'Critical security risk',
            severity: 'critical'
        });
    }
    
    // Check for console.log in production code
    const consoleMatches = content.match(/console\.(log|debug|info)/g);
    if (consoleMatches && consoleMatches.length > 5) {
        analysis.codeQuality.missingComments.push({
            file: filePath,
            issue: `Excessive console statements (${consoleMatches.length})`,
            suggestion: 'Consider using a proper logging system',
            severity: 'low'
        });
    }
    
    // Check for large functions
    lines.forEach((line, index) => {
        if (line.match(/function\s+\w+|const\s+\w+\s*=\s*\(/)) {
            let braceCount = 0;
            let functionLength = 0;
            
            for (let i = index; i < lines.length; i++) {
                functionLength++;
                braceCount += (lines[i].match(/{/g) || []).length;
                braceCount -= (lines[i].match(/}/g) || []).length;
                
                if (braceCount === 0 && functionLength > 1) {
                    if (functionLength > 100) {
                        analysis.codeQuality.longFunctions.push({
                            file: filePath,
                            line: index + 1,
                            length: functionLength,
                            suggestion: 'Consider breaking into smaller functions',
                            severity: 'medium'
                        });
                    }
                    break;
                }
            }
        }
    });
    
    // Check for missing error handling
    const asyncFunctions = content.match(/async\s+function|async\s*\(/g) || [];
    const tryCatchBlocks = content.match(/try\s*{/g) || [];
    
    if (asyncFunctions.length > tryCatchBlocks.length + 2) {
        analysis.codeQuality.missingComments.push({
            file: filePath,
            issue: 'Async functions may lack error handling',
            suggestion: 'Add try-catch blocks to async functions',
            severity: 'high'
        });
    }
}

/**
 * Analyze PHP file
 */
function analyzePHP(filePath, content) {
    const fileName = path.basename(filePath);
    
    // Check for SQL injection risks
    if (content.match(/\$_(GET|POST|REQUEST)\[.*?\].*?(mysql_query|mysqli_query|query)/)) {
        analysis.security.potentialVulnerabilities.push({
            file: filePath,
            issue: 'Potential SQL injection vulnerability',
            risk: 'Direct use of user input in queries',
            severity: 'critical',
            suggestion: 'Use prepared statements'
        });
    }
    
    // Check for prepared statements
    const hasPreparedStatements = content.includes('prepare(') || content.includes('->execute(');
    if (!hasPreparedStatements && content.includes('query(')) {
        analysis.security.inputValidation.push({
            file: filePath,
            issue: 'Not using prepared statements',
            severity: 'high',
            suggestion: 'Use prepared statements for all database queries'
        });
    }
    
    // Check for output sanitization
    if (content.includes('echo') || content.includes('print')) {
        if (!content.includes('htmlspecialchars') && !content.includes('htmlentities')) {
            analysis.security.sanitization.push({
                file: filePath,
                issue: 'Output may not be sanitized',
                risk: 'XSS vulnerability',
                severity: 'high',
                suggestion: 'Use htmlspecialchars() for output'
            });
        }
    }
    
    // Check for error display in production
    if (content.includes('error_reporting(E_ALL)') || content.includes('display_errors')) {
        analysis.security.potentialVulnerabilities.push({
            file: filePath,
            issue: 'Error reporting may expose sensitive information',
            severity: 'medium',
            suggestion: 'Disable error display in production'
        });
    }
    
    // Check for file upload handling
    if (content.includes('$_FILES')) {
        if (!content.includes('UPLOAD_ERR_OK') || !content.match(/getimagesize|mime_content_type/)) {
            analysis.security.inputValidation.push({
                file: filePath,
                issue: 'File upload may lack proper validation',
                severity: 'high',
                suggestion: 'Validate file type, size, and content'
            });
        }
    }
}

/**
 * Analyze HTML file
 */
function analyzeHTML(filePath, content) {
    const fileName = path.basename(filePath);
    
    // Check for missing alt attributes on images
    const imgTags = content.match(/<img[^>]*>/g) || [];
    imgTags.forEach(tag => {
        if (!tag.includes('alt=')) {
            analysis.accessibility.missingAltText.push({
                file: filePath,
                issue: 'Image missing alt attribute',
                severity: 'medium',
                suggestion: 'Add descriptive alt text for accessibility'
            });
        }
    });
    
    // Check for ARIA labels on interactive elements
    const buttons = content.match(/<button[^>]*>/g) || [];
    buttons.forEach(tag => {
        if (!tag.includes('aria-label') && !tag.match(/>.+</)) {
            analysis.accessibility.missingAria.push({
                file: filePath,
                issue: 'Button may lack accessible label',
                severity: 'medium',
                suggestion: 'Add aria-label or text content'
            });
        }
    });
    
    // Check for inline styles (maintainability)
    const inlineStyles = content.match(/style="/g) || [];
    if (inlineStyles.length > 10) {
        analysis.codeQuality.missingComments.push({
            file: filePath,
            issue: `Excessive inline styles (${inlineStyles.length})`,
            severity: 'low',
            suggestion: 'Move styles to CSS files'
        });
    }
    
    // Check for missing viewport meta tag
    if (fileName === 'index.html' || fileName.includes('main')) {
        if (!content.includes('viewport')) {
            analysis.issues.high.push({
                file: filePath,
                issue: 'Missing viewport meta tag',
                impact: 'Poor mobile responsiveness',
                suggestion: 'Add <meta name="viewport" content="width=device-width, initial-scale=1.0">'
            });
        }
    }
}

/**
 * Analyze CSS file
 */
function analyzeCSS(filePath, content) {
    // Check for !important usage
    const importantCount = (content.match(/!important/g) || []).length;
    if (importantCount > 5) {
        analysis.codeQuality.missingComments.push({
            file: filePath,
            issue: `Excessive !important usage (${importantCount})`,
            severity: 'low',
            suggestion: 'Review CSS specificity'
        });
    }
    
    // Check for vendor prefixes (might need autoprefixer)
    const vendorPrefixes = (content.match(/-(webkit|moz|ms|o)-/g) || []).length;
    if (vendorPrefixes > 10) {
        analysis.modernization.improvementOpportunities.push({
            file: filePath,
            issue: 'Manual vendor prefixes detected',
            suggestion: 'Consider using autoprefixer',
            severity: 'low'
        });
    }
}

/**
 * Generate recommendations based on analysis
 */
function generateRecommendations() {
    // Security recommendations
    if (analysis.security.potentialVulnerabilities.length > 0) {
        analysis.recommendations.push({
            priority: 'CRITICAL',
            category: 'Security',
            title: 'Address Security Vulnerabilities',
            description: `Found ${analysis.security.potentialVulnerabilities.length} potential security issues that need immediate attention.`,
            action: 'Review and fix all critical and high severity security issues'
        });
    }
    
    // Modernization recommendations
    if (analysis.modernization.oldSyntax.length > 5) {
        analysis.recommendations.push({
            priority: 'HIGH',
            category: 'Modernization',
            title: 'Update to Modern JavaScript Syntax',
            description: 'Significant use of outdated JavaScript patterns detected.',
            action: 'Replace var with const/let, use arrow functions, async/await'
        });
    }
    
    // Code quality recommendations
    if (analysis.codeQuality.longFunctions.length > 0) {
        analysis.recommendations.push({
            priority: 'MEDIUM',
            category: 'Code Quality',
            title: 'Refactor Large Functions',
            description: `${analysis.codeQuality.longFunctions.length} functions exceed 100 lines.`,
            action: 'Break large functions into smaller, reusable components'
        });
    }
    
    // Accessibility recommendations
    if (analysis.accessibility.missingAltText.length > 0 || analysis.accessibility.missingAria.length > 0) {
        analysis.recommendations.push({
            priority: 'MEDIUM',
            category: 'Accessibility',
            title: 'Improve Accessibility',
            description: 'Missing alt text and ARIA labels detected.',
            action: 'Add descriptive alt text and ARIA labels to improve accessibility'
        });
    }
    
    // Performance recommendations
    if (analysis.performance.largeFiles.length > 0) {
        analysis.recommendations.push({
            priority: 'MEDIUM',
            category: 'Performance',
            title: 'Optimize Large Files',
            description: 'Some files are very large and may impact load time.',
            action: 'Consider code splitting and lazy loading'
        });
    }
}

/**
 * Generate summary report
 */
function generateSummary() {
    const criticalCount = analysis.issues.critical.length + 
                          analysis.security.potentialVulnerabilities.filter(v => v.severity === 'critical').length;
    const highCount = analysis.issues.high.length + 
                      analysis.security.potentialVulnerabilities.filter(v => v.severity === 'high').length;
    
    let summary = `
========================================
SURVEY APPLICATION CODE ANALYSIS REPORT
========================================
Analysis Date: ${new Date().toLocaleString('en-GB', { 
    day: '2-digit', 
    month: '2-digit', 
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
})}

OVERVIEW
--------
Total Files Analyzed: ${analysis.overview.totalFiles}
Total Lines of Code: ${analysis.overview.totalLines.toLocaleString()}

FILES BY TYPE:
${Object.entries(analysis.overview.filesByType).map(([ext, count]) => `  ${ext}: ${count} files`).join('\n')}

ISSUE SUMMARY
-------------
🔴 CRITICAL: ${criticalCount} issues
🟠 HIGH: ${highCount} issues
🟡 MEDIUM: ${analysis.issues.medium.length} issues
🟢 LOW: ${analysis.issues.low.length} issues

SECURITY ANALYSIS
-----------------
Potential Vulnerabilities: ${analysis.security.potentialVulnerabilities.length}
Input Validation Issues: ${analysis.security.inputValidation.length}
Sanitization Issues: ${analysis.security.sanitization.length}

CODE QUALITY
------------
Missing Comments: ${analysis.codeQuality.missingComments.length}
Long Functions (>100 lines): ${analysis.codeQuality.longFunctions.length}

MODERNIZATION
-------------
Old Syntax Usage: ${analysis.modernization.oldSyntax.length}
Deprecated APIs: ${analysis.modernization.deprecatedAPIs.length}
Improvement Opportunities: ${analysis.modernization.improvementOpportunities.length}

ACCESSIBILITY
-------------
Missing Alt Text: ${analysis.accessibility.missingAltText.length}
Missing ARIA Labels: ${analysis.accessibility.missingAria.length}

TOP RECOMMENDATIONS
-------------------
`;

    analysis.recommendations.forEach((rec, index) => {
        summary += `${index + 1}. [${rec.priority}] ${rec.title}\n`;
        summary += `   ${rec.description}\n`;
        summary += `   Action: ${rec.action}\n\n`;
    });

    return summary;
}

/**
 * Main analysis function
 */
function analyzeCodebase(targetDir) {
    console.log('🔍 Starting code analysis...\n');
    
    // Scan for files
    const files = scanDirectory(targetDir);
    analysis.overview.totalFiles = files.length;
    
    console.log(`📁 Found ${files.length} files to analyze\n`);
    
    // Analyze each file
    files.forEach((filePath, index) => {
        const ext = path.extname(filePath);
        const content = fs.readFileSync(filePath, 'utf8');
        const lines = content.split('\n').length;
        
        analysis.overview.totalLines += lines;
        analysis.overview.filesByType[ext] = (analysis.overview.filesByType[ext] || 0) + 1;
        
        // Track large files
        if (lines > 500) {
            analysis.performance.largeFiles.push({
                file: filePath,
                lines: lines,
                suggestion: 'Consider splitting into smaller modules'
            });
        }
        
        // Analyze based on file type
        switch (ext) {
            case '.js':
                analyzeJavaScript(filePath, content);
                break;
            case '.php':
                analyzePHP(filePath, content);
                break;
            case '.html':
                analyzeHTML(filePath, content);
                break;
            case '.css':
                analyzeCSS(filePath, content);
                break;
        }
        
        // Progress indicator
        if ((index + 1) % 10 === 0) {
            console.log(`   Analyzed ${index + 1}/${files.length} files...`);
        }
    });
    
    console.log(`\n✅ Analysis complete!\n`);
    
    // Generate recommendations
    generateRecommendations();
    
    // Save detailed JSON report
    fs.writeFileSync(
        path.join(targetDir, 'detailed_analysis_report.json'),
        JSON.stringify(analysis, null, 2)
    );
    
    // Save summary text report
    const summary = generateSummary();
    fs.writeFileSync(
        path.join(targetDir, 'analysis_summary.txt'),
        summary
    );
    
    console.log(summary);
    console.log('\n📊 Reports saved:');
    console.log('   - detailed_analysis_report.json (full details)');
    console.log('   - analysis_summary.txt (summary)');
}

// Run analysis
const targetDir = process.argv[2];

if (!targetDir) {
    console.error('❌ Error: Please provide the path to your survey directory');
    console.log('Usage: node analyze_survey_code.js <path-to-survey-directory>');
    process.exit(1);
}

if (!fs.existsSync(targetDir)) {
    console.error(`❌ Error: Directory not found: ${targetDir}`);
    process.exit(1);
}

analyzeCodebase(targetDir);
