<?php
/**
 * build-release.php — Release packager for Survey PDF Editor
 *
 * Run from the repository root:
 *   php build-release.php
 *   php build-release.php --zip        # also creates survey-release.zip
 *   php build-release.php --version=1.2.0
 *
 * What it does:
 *   - Deletes and recreates /release/
 *   - Copies only runtime-required files
 *   - Creates required empty storage subdirectories with .gitkeep placeholders
 *   - Copies install/ wizard and sql/database.sql
 *   - Writes VERSION.txt
 *   - Optionally creates survey-release.zip
 *
 * Safe to re-run: /release/ is always wiped and rebuilt.
 *
 * Requirements: PHP 7.4+, ZipArchive extension (for --zip)
 */

declare(strict_types=1);

// ─────────────────────────────────────────────────────────────────────────────
// CLI argument parsing
// ─────────────────────────────────────────────────────────────────────────────

$createZip = false;
$version   = null;

foreach (array_slice($argv ?? [], 1) as $arg) {
    if ($arg === '--zip') {
        $createZip = true;
    } elseif (strpos($arg, '--version=') === 0) {
        $version = substr($arg, strlen('--version='));
    } elseif ($arg === '--help' || $arg === '-h') {
        echo "Usage: php build-release.php [--zip] [--version=X.Y.Z]\n";
        exit(0);
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Paths
// ─────────────────────────────────────────────────────────────────────────────

$root    = __DIR__;
$release = $root . '/release';
$zipFile = $root . '/survey-release.zip';

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function log_msg(string $msg): void {
    echo $msg . "\n";
}

function log_ok(string $msg): void {
    echo "  ✔ " . $msg . "\n";
}

function log_skip(string $msg): void {
    echo "  – " . $msg . "\n";
}

function abort(string $msg): void {
    echo "\n  ✖ ERROR: " . $msg . "\n\n";
    exit(1);
}

/**
 * Delete a directory recursively.
 */
function rrmdir(string $dir): void {
    if (!is_dir($dir)) return;
    $it = new RecursiveIteratorIterator(
        new RecursiveDirectoryIterator($dir, FilesystemIterator::SKIP_DOTS),
        RecursiveIteratorIterator::CHILD_FIRST
    );
    foreach ($it as $item) {
        $item->isDir() ? rmdir($item->getPathname()) : unlink($item->getPathname());
    }
    rmdir($dir);
}

/**
 * Copy a file, creating parent directories as needed.
 */
function copy_file(string $src, string $dst): void {
    $dir = dirname($dst);
    if (!is_dir($dir) && !@mkdir($dir, 0775, true)) {
        abort("Cannot create directory: {$dir}");
    }
    if (!copy($src, $dst)) {
        abort("Cannot copy {$src} → {$dst}");
    }
}

/**
 * Recursively copy a directory, with optional exclude patterns.
 * $excludeNames: base names to skip (files or directories)
 */
function copy_dir(string $src, string $dst, array $excludeNames = []): int {
    if (!is_dir($src)) {
        abort("Source directory not found: {$src}");
    }
    $count = 0;
    $it = new RecursiveIteratorIterator(
        new RecursiveDirectoryIterator($src, FilesystemIterator::SKIP_DOTS),
        RecursiveIteratorIterator::SELF_FIRST
    );
    foreach ($it as $item) {
        // Check each path component against excludes
        $rel = substr($item->getPathname(), strlen($src) + 1);
        $parts = explode(DIRECTORY_SEPARATOR, $rel);
        $skip = false;
        foreach ($parts as $part) {
            if (in_array($part, $excludeNames, true)) {
                $skip = true;
                break;
            }
        }
        if ($skip) continue;

        $target = $dst . '/' . $rel;
        if ($item->isDir()) {
            if (!is_dir($target) && !@mkdir($target, 0775, true)) {
                abort("Cannot create: {$target}");
            }
        } else {
            copy_file($item->getPathname(), $target);
            $count++;
        }
    }
    return $count;
}

/**
 * Add a directory recursively to a ZipArchive.
 */
function zip_dir(ZipArchive $zip, string $dir, string $prefix): void {
    $it = new RecursiveIteratorIterator(
        new RecursiveDirectoryIterator($dir, FilesystemIterator::SKIP_DOTS),
        RecursiveIteratorIterator::SELF_FIRST
    );
    foreach ($it as $item) {
        $rel = substr($item->getPathname(), strlen($dir) + 1);
        if ($item->isDir()) {
            $zip->addEmptyDir($prefix . '/' . $rel);
        } else {
            $zip->addFile($item->getPathname(), $prefix . '/' . $rel);
        }
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Version
// ─────────────────────────────────────────────────────────────────────────────

if ($version === null) {
    $vf = $root . '/VERSION.txt';
    $version = file_exists($vf) ? trim((string)file_get_contents($vf)) : '1.0.0';
}
$version = preg_replace('/[^0-9a-zA-Z.\-]/', '', $version);

// ─────────────────────────────────────────────────────────────────────────────
// Sanity checks
// ─────────────────────────────────────────────────────────────────────────────

if (!file_exists($root . '/sql/database.sql')) {
    abort("sql/database.sql not found. Cannot build release.");
}
if (!file_exists($root . '/install/index.php')) {
    abort("install/index.php not found. Cannot build release.");
}
if (!is_dir($root . '/api')) {
    abort("api/ directory not found.");
}
if (!is_dir($root . '/vendor')) {
    abort("vendor/ directory not found. Run 'composer install' first.");
}

// ─────────────────────────────────────────────────────────────────────────────
// Step 1: Wipe and recreate /release
// ─────────────────────────────────────────────────────────────────────────────

log_msg("\n=== Survey PDF Editor — Release Builder v{$version} ===\n");
log_msg("Step 1: Cleaning /release ...");

if (is_dir($release)) {
    rrmdir($release);
    log_ok("Removed old /release directory");
}
if (!@mkdir($release, 0775, true)) {
    abort("Cannot create /release directory");
}
log_ok("Created fresh /release directory");

// ─────────────────────────────────────────────────────────────────────────────
// Step 2: Copy runtime files and directories
// ─────────────────────────────────────────────────────────────────────────────

log_msg("\nStep 2: Copying runtime files ...");

// ── Directories to copy wholesale (with exclusions) ───────────────────────────

$dirsToCopy = [
    // [source-rel, dest-rel, excludeNames]
    ['api',    'api',    ['config.php']],   // exclude local config — installer writes it
    ['app',    'app',    []],
    ['assets', 'assets', []],
    ['icons',  'icons',  []],
    ['install','install',['install.lock']], // exclude any existing lock file
    ['sql',    'sql',    []],
    ['vendor', 'vendor', []],
    // tools/ is linked from the main navigation (index.html, general-viewer.html,
    // exports.html) and pre-cached by service-worker.js — it must ship in the release.
    // Dev-only artefacts (debug scripts, test data, playwright helpers, backup dirs)
    // are excluded to keep the package clean.
    ['tools',  'tools',  [
        // backup snapshot
        'backup-21-01-2026-1812',
        // analysis / debug JS
        'analyze_survey_code.js',
        'analyze_viewer.js',
        'run_smoke_http.js',
        'show_lines.js',
        // playwright / capture scripts (tools/ and tools/dwgviewer/)
        'capture-issues-playwright.js',
        'capture-console-playwright.js',
        'capture-console.js',
        'capture-with-dwg.js',
        'check-fab-playwright.js',
        'check-viewer-playwright.js',
        // Python helpers
        'capture_issue_modal.py',
        'generate_pin.py',
        // debug / test PHP
        'check_braces.php',
        'dump_lines.php',
        'generate_pin_sample_pdf.php',
        'itest_export_pin.php',
        'show_pin_preview.php',
        'simulate_export.php',
        'test_pdf_embed.php',
        'test_render_pin.php',
        'test_render_plan.php',
        'trace_braces.php',
        // debug HTML
        'export_raw_response.html',
        // test data: JSON response snapshots
        'export_response.json',
        'export_response2.json',
        'export_response_after_fix.json',
        'export_response_after_fix2.json',
        'export_response_after_fix3.json',
        'export_response_pin_smaller.json',
        'export_response_pin_smaller2.json',
        'export_response_size_change.json',
        'export_response_thumb_doubled.json',
        'export_response_thumb_doubled_again.json',
        'export_response_thumb_restored.json',
        'export_response_thumb_smaller.json',
        'render_debug.json',
        'render_debug_after_fix2.json',
        // test data: PDFs and images
        'latest_export_after_fix.pdf',
        'latest_export_after_fix_small.pdf',
        'latest_export_thumb_smaller.pdf',
        'plan_eec6.pdf',
        'before.png',
        // sample DWG used only for local testing
        'arc_2000.dwg',
    ]],
];

foreach ($dirsToCopy as [$srcRel, $dstRel, $excludes]) {
    $src = $root . '/' . $srcRel;
    $dst = $release . '/' . $dstRel;
    if (!is_dir($src)) {
        log_skip("Skipping {$srcRel}/ (not found)");
        continue;
    }
    $n = copy_dir($src, $dst, $excludes);
    $note = $excludes ? ' (excluding: ' . implode(', ', $excludes) . ')' : '';
    log_ok("Copied {$srcRel}/{$note} — {$n} files");
}

// ── Root-level files ──────────────────────────────────────────────────────────

$rootFiles = [
    'index.html',
    'manifest.json',
    'service-worker.js',
    'offline.html',
    'general-viewer.html',
    'exports.html',
    'favicon.ico',
    'favicon.svg',
    'favicon-16.png',
    'favicon-32.png',
    'apple-touch-icon.png',
    'safari-pinned-tab.svg',
    'browserconfig.xml',
];

foreach ($rootFiles as $f) {
    $src = $root . '/' . $f;
    if (file_exists($src)) {
        copy_file($src, $release . '/' . $f);
        log_ok("Copied {$f}");
    } else {
        log_skip("Skipping {$f} (not found)");
    }
}

// ── Root .htaccess (if it exists) ─────────────────────────────────────────────

if (file_exists($root . '/.htaccess')) {
    copy_file($root . '/.htaccess', $release . '/.htaccess');
    log_ok("Copied .htaccess");
}

// ─────────────────────────────────────────────────────────────────────────────
// Step 3: Create storage directory structure
// ─────────────────────────────────────────────────────────────────────────────

log_msg("\nStep 3: Creating storage directory structure ...");

$storageDirs = ['plans', 'photos', 'files', 'exports', 'tmp', 'trash'];
$storageBase = $release . '/storage';

if (!@mkdir($storageBase, 0775, true)) {
    abort("Cannot create release/storage/");
}

// Copy storage/.htaccess if present
$storageHtaccess = $root . '/storage/.htaccess';
if (file_exists($storageHtaccess)) {
    copy_file($storageHtaccess, $storageBase . '/.htaccess');
    log_ok("Copied storage/.htaccess");
}

foreach ($storageDirs as $sub) {
    $full = $storageBase . '/' . $sub;
    if (!@mkdir($full, 0775, true)) {
        abort("Cannot create release/storage/{$sub}/");
    }
    // Place .gitkeep so the directory is included when zipping
    file_put_contents($full . '/.gitkeep', '');
    log_ok("Created storage/{$sub}/");
}

// ─────────────────────────────────────────────────────────────────────────────
// Step 4: Write VERSION.txt and README-INSTALL.md
// ─────────────────────────────────────────────────────────────────────────────

log_msg("\nStep 4: Writing VERSION.txt and documentation ...");

file_put_contents($release . '/VERSION.txt', $version . "\n");
log_ok("Written VERSION.txt ({$version})");

foreach (['README-INSTALL.md', 'QUICK-START.txt'] as $docFile) {
    $src = $root . '/' . $docFile;
    if (file_exists($src)) {
        copy_file($src, $release . '/' . $docFile);
        log_ok("Copied {$docFile}");
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Step 5: Optionally create survey-release.zip
// ─────────────────────────────────────────────────────────────────────────────

if ($createZip) {
    log_msg("\nStep 5: Creating survey-release.zip ...");

    if (!class_exists('ZipArchive')) {
        log_skip("ZipArchive not available — skipping zip creation");
    } else {
        if (file_exists($zipFile)) {
            unlink($zipFile);
        }

        $zip = new ZipArchive();
        if ($zip->open($zipFile, ZipArchive::CREATE) !== true) {
            abort("Cannot create {$zipFile}");
        }

        zip_dir($zip, $release, 'survey-release');
        $count = $zip->numFiles;
        $zip->close();

        log_ok("Created survey-release.zip ({$count} files)");
    }
} else {
    log_msg("\nStep 5: Skipping zip (run with --zip to create survey-release.zip)");
}

// ─────────────────────────────────────────────────────────────────────────────
// Summary
// ─────────────────────────────────────────────────────────────────────────────

log_msg("\n=== Build complete ===");
log_msg("Release directory: {$release}");
if ($createZip && file_exists($zipFile)) {
    log_msg("Release archive:   {$zipFile}");
}
log_msg("\nNext steps:");
log_msg("  1. Upload the contents of /release to your web root.");
log_msg("  2. Create an empty MySQL database.");
log_msg("  3. Visit https://yoursite.com/install/ and follow the wizard.");
log_msg("");
