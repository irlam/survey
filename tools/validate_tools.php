<?php
// tools/validate_tools.php
// Simple checks to detect stray CSS/html and ISO date outputs in api files.

$root = realpath(__DIR__ . '/..');
$errors = [];

// Check tool HTML files
$files = glob($root . '/tools/*.html');
foreach ($files as $f) {
    $contents = file($f, FILE_IGNORE_NEW_LINES);
    // find first non-empty line
    $first = null; foreach ($contents as $line) { $trim = trim($line); if ($trim !== '') { $first = $trim; break; } }
    if ($first === null) continue;
    // expected starts
    if (!preg_match('/^<!doctype|^<!--|^<html/i', $first)) {
        $errors[] = "Tool file $f: first non-empty line looks odd: " . substr($first,0,120);
    }
    // stray CSS pattern at top
    $head = implode("\n", array_slice($contents,0,8));
    if (preg_match('/^\s*button, input, select \{/m', $head)) {
        $errors[] = "Tool file $f: has a stray global CSS snippet at top header";
    }
}

// Check API files for ISO c output usage (discourage direct use in user-facing outputs)
$apifs = glob($root . '/api/*.php');
foreach ($apifs as $f) {
    $txt = file_get_contents($f);
    if (preg_match('/date\(\'c\'\)|gmdate\(\'c\'\)/', $txt)) {
        // allow internal logs but warn
        $errors[] = "API file $f: uses date('c') or gmdate('c') — consider formatting for UK display in responses";
    }
}

if (count($errors)) {
    fwrite(STDERR, "Validation failed (" . count($errors) . " issues)\n");
    foreach ($errors as $e) fwrite(STDERR, " - $e\n");
    exit(2);
}

fwrite(STDOUT, "Validation OK\n");
exit(0);
