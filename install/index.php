<?php
/**
 * install/index.php - Survey PDF Editor Installer
 *
 * Single-file wizard:
 *  Step 1 - Requirements check
 *  Step 2 - Database + app settings form
 *  Step 3 - Perform installation (AJAX from step 2)
 *  Step 4 - Success page
 *
 * Compatible with PHP 7.4+ / MySQL 5.7+ shared hosting (Plesk, cPanel).
 * No framework. No external dependencies.
 */

declare(strict_types=1);
session_start();

// ─────────────────────────────────────────────────────────────────────────────
// Constants / paths
// ─────────────────────────────────────────────────────────────────────────────

define('LOCK_PATH',    __DIR__ . '/install.lock');
define('CONFIG_PATH',  __DIR__ . '/../api/config.php');
define('SQL_PATH',     __DIR__ . '/../sql/database.sql');
define('ROOT_PATH',    __DIR__ . '/..');

$isInstalled = file_exists(LOCK_PATH);

// ─────────────────────────────────────────────────────────────────────────────
// AJAX handlers – must run before any output
// ─────────────────────────────────────────────────────────────────────────────

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $action = trim($_POST['action'] ?? '');

    if ($action === 'test_connection') {
        header('Content-Type: application/json; charset=utf-8');
        if ($isInstalled) {
            echo json_encode(['ok' => false, 'error' => 'Already installed.']);
            exit;
        }
        $r = db_test(
            trim($_POST['db_host'] ?? 'localhost'),
            (int)($_POST['db_port']  ?? 3306),
            trim($_POST['db_name']  ?? ''),
            trim($_POST['db_user']  ?? ''),
            $_POST['db_pass']        ?? ''
        );
        echo json_encode($r['ok']
            ? ['ok' => true,  'version' => $r['version']]
            : ['ok' => false, 'error'   => $r['error']]
        );
        exit;
    }

    if ($action === 'install') {
        header('Content-Type: application/json; charset=utf-8');
        if ($isInstalled) {
            echo json_encode(['ok' => false, 'error' => 'Already installed.']);
            exit;
        }
        $result = do_install($_POST);
        if ($result['ok']) {
            // Store summary for step 4
            $_SESSION['install_summary'] = $result;
        }
        echo json_encode($result);
        exit;
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Helper functions
// ─────────────────────────────────────────────────────────────────────────────

function esc(string $v): string {
    return htmlspecialchars($v, ENT_QUOTES | ENT_HTML5, 'UTF-8');
}

// ── DB helpers ────────────────────────────────────────────────────────────────

function db_test(string $host, int $port, string $dbname, string $user, string $pass): array {
    if ($dbname === '' || $user === '') {
        return ['ok' => false, 'error' => 'Database name and username are required.'];
    }
    try {
        $dsn = "mysql:host={$host};port={$port};dbname={$dbname};charset=utf8mb4";
        $pdo = new PDO($dsn, $user, $pass, [
            PDO::ATTR_ERRMODE  => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_TIMEOUT  => 5,
        ]);
        $row = $pdo->query("SELECT VERSION() AS v")->fetch(PDO::FETCH_ASSOC);
        return ['ok' => true, 'pdo' => $pdo, 'version' => $row['v'] ?? 'unknown'];
    } catch (PDOException $e) {
        return ['ok' => false, 'error' => $e->getMessage()];
    }
}

function db_import(PDO $pdo, string $sqlFile): array {
    if (!file_exists($sqlFile)) {
        return ['ok' => false, 'error' => 'sql/database.sql not found'];
    }
    $sql = file_get_contents($sqlFile);
    if ($sql === false) {
        return ['ok' => false, 'error' => 'Cannot read sql/database.sql'];
    }

    // Parse into individual statements
    $statements = [];
    $current    = '';
    foreach (explode("\n", $sql) as $line) {
        $trimmed = rtrim($line);
        $ltrimmed = ltrim($trimmed);
        // Skip comment-only lines and empty lines
        if ($ltrimmed === '' || substr($ltrimmed, 0, 2) === '--' || substr($ltrimmed, 0, 2) === '/*') {
            continue;
        }
        $current .= $trimmed . "\n";
        if (substr(rtrim($trimmed), -1) === ';') {
            $stmt = trim($current);
            if ($stmt !== '') {
                $statements[] = $stmt;
            }
            $current = '';
        }
    }
    if (trim($current) !== '') {
        $statements[] = trim($current);
    }

    $executed = 0;
    $errors   = [];
    foreach ($statements as $stmt) {
        try {
            $pdo->exec($stmt);
            $executed++;
        } catch (PDOException $e) {
            $code = (string)$e->getCode();
            // 1050 = table already exists — safe to skip on re-install
            if (strpos($e->getMessage(), '1050') !== false || $code === '42S01') {
                $executed++;
                continue;
            }
            $errors[] = substr($e->getMessage(), 0, 200);
        }
    }

    if (!empty($errors)) {
        return ['ok' => false, 'errors' => $errors, 'executed' => $executed];
    }
    return ['ok' => true, 'executed' => $executed];
}

// ── Config writer ─────────────────────────────────────────────────────────────

function write_config(array $d): array {
    $host      = addslashes($d['db_host']);
    $port      = max(1, (int)$d['db_port']);
    $dbname    = addslashes($d['db_name']);
    $user      = addslashes($d['db_user']);
    $pass      = addslashes($d['db_pass']);
    $baseUrl   = addslashes(rtrim($d['base_url'] ?? '', '/'));
    $actor     = addslashes($d['actor_name'] ?? '');
    $maxMb     = max(1, (int)($d['max_upload_mb'] ?? 128));
    $generated = date('Y-m-d H:i:s');

    $content = <<<PHP
<?php
// api/config.php — generated by installer on {$generated}
// To reconfigure, delete this file and re-run install/index.php.
return [
    'base_url' => '{$baseUrl}',

    'db' => [
        'host'    => '{$host}',
        'port'    => {$port},
        'dbname'  => '{$dbname}',
        'user'    => '{$user}',
        'pass'    => '{$pass}',
        'charset' => 'utf8mb4',
    ],

    'storage_path'  => 'storage',
    'max_upload_mb' => {$maxMb},
    'debug'         => false,
    'csrf_enabled'  => true,

    'dwg_converter' => [ 'use_docker' => false, 'docker_image' => '' ],

    'actor_name' => '{$actor}',
];
PHP;

    // Atomic write via temp file
    $tmp = CONFIG_PATH . '.tmp.' . getmypid();
    if (file_put_contents($tmp, $content, LOCK_EX) === false) {
        return ['ok' => false, 'error' => 'Cannot write api/config.php — check directory permissions'];
    }
    if (!rename($tmp, CONFIG_PATH)) {
        @unlink($tmp);
        return ['ok' => false, 'error' => 'Cannot rename temp config into place'];
    }
    return ['ok' => true];
}

// ── Storage directories ───────────────────────────────────────────────────────

function create_storage_dirs(): array {
    $storage = ROOT_PATH . '/storage';
    $subdirs = ['plans', 'photos', 'files', 'exports', 'tmp', 'trash'];
    $created = [];

    if (!is_dir($storage) && !@mkdir($storage, 0775, true)) {
        return ['ok' => false, 'error' => 'Cannot create storage/ directory'];
    }
    foreach ($subdirs as $sub) {
        $full = $storage . '/' . $sub;
        if (!is_dir($full)) {
            if (!@mkdir($full, 0775, true)) {
                return ['ok' => false, 'error' => "Cannot create storage/{$sub}/"];
            }
            $created[] = "storage/{$sub}";
        }
    }
    return ['ok' => true, 'created' => $created];
}

// ── Main install orchestrator ─────────────────────────────────────────────────

function do_install(array $post): array {
    $d = [
        'db_host'       => trim($post['db_host']       ?? 'localhost'),
        'db_port'       => trim($post['db_port']        ?? '3306'),
        'db_name'       => trim($post['db_name']        ?? ''),
        'db_user'       => trim($post['db_user']        ?? ''),
        'db_pass'       => $post['db_pass']              ?? '',
        'base_url'      => trim($post['base_url']        ?? ''),
        'actor_name'    => trim($post['actor_name']      ?? ''),
        'max_upload_mb' => trim($post['max_upload_mb']   ?? '128'),
    ];

    if ($d['db_name'] === '' || $d['db_user'] === '') {
        return ['ok' => false, 'error' => 'Database name and username are required.'];
    }

    // 1. Test DB connection
    $conn = db_test($d['db_host'], (int)$d['db_port'], $d['db_name'], $d['db_user'], $d['db_pass']);
    if (!$conn['ok']) {
        return ['ok' => false, 'error' => 'Database connection failed: ' . $conn['error']];
    }

    // 2. Import SQL schema
    $import = db_import($conn['pdo'], SQL_PATH);
    if (!$import['ok']) {
        $msg = isset($import['errors']) ? implode('; ', $import['errors']) : ($import['error'] ?? 'SQL import failed');
        return ['ok' => false, 'error' => 'SQL import failed: ' . $msg];
    }

    // 3. Create storage directories
    $dirs = create_storage_dirs();
    if (!$dirs['ok']) {
        return ['ok' => false, 'error' => $dirs['error']];
    }

    // 4. Write config
    $cfg = write_config($d);
    if (!$cfg['ok']) {
        return ['ok' => false, 'error' => $cfg['error']];
    }

    // 5. Write lock file
    $lockOk = (file_put_contents(LOCK_PATH, "Installed: " . date('Y-m-d H:i:s') . "\n", LOCK_EX) !== false);

    $result = [
        'ok'             => true,
        'sql_statements' => $import['executed'],
        'dirs_created'   => $dirs['created'] ?? [],
        'db_version'     => $conn['version'],
    ];
    if (!$lockOk) {
        $result['warning'] = 'Install succeeded but could not write install.lock — please create it manually via FTP.';
    }
    return $result;
}

// ── Requirements checks ───────────────────────────────────────────────────────

function run_checks(): array {
    $root = ROOT_PATH;
    return [
        ['label' => 'PHP Version (≥7.4)',         'result' => chk_php()],
        ['label' => 'PDO Extension',              'result' => chk_ext('pdo',       true)],
        ['label' => 'PDO MySQL Driver',           'result' => chk_ext('pdo_mysql', true)],
        ['label' => 'mbstring Extension',         'result' => chk_ext('mbstring',  true)],
        ['label' => 'fileinfo Extension',         'result' => chk_ext('fileinfo',  true)],
        ['label' => 'json Extension',             'result' => chk_ext('json',      true)],
        ['label' => 'openssl Extension',          'result' => chk_ext('openssl',   true)],
        ['label' => 'GD Image Library',           'result' => chk_ext('gd',        false)],
        ['label' => 'Imagick Extension',          'result' => chk_ext('imagick',   false)],
        ['label' => 'upload_max_filesize (≥8M)',  'result' => chk_ini('upload_max_filesize', 8 * 1024 * 1024)],
        ['label' => 'post_max_size (≥8M)',        'result' => chk_ini('post_max_size',       8 * 1024 * 1024)],
        ['label' => 'api/ directory writable',    'result' => chk_writable($root . '/api')],
        ['label' => 'storage/ directory writable','result' => chk_writable($root . '/storage')],
    ];
}

function chk_php(): array {
    $v  = PHP_VERSION;
    $ok = version_compare($v, '7.4.0', '>=');
    return ['ok' => $ok, 'required' => true, 'value' => $v, 'note' => $ok ? '' : 'PHP 7.4 or newer required'];
}

function chk_ext(string $ext, bool $required): array {
    $loaded = extension_loaded($ext);
    return [
        'ok'       => $loaded || !$required,
        'required' => $required,
        'value'    => $loaded ? 'Loaded' : 'Not loaded',
        'note'     => (!$loaded && $required) ? "Required: {$ext}" : '',
    ];
}

function chk_ini(string $key, int $minBytes): array {
    $raw   = ini_get($key);
    $bytes = parse_bytes((string)$raw);
    $ok    = $bytes >= $minBytes;
    return [
        'ok'       => $ok,
        'required' => false,
        'value'    => $raw,
        'note'     => $ok ? '' : 'Recommend ≥' . fmt_bytes($minBytes),
    ];
}

function chk_writable(string $path): array {
    $writable = file_exists($path) ? is_writable($path) : is_writable(dirname($path));
    return [
        'ok'       => $writable,
        'required' => true,
        'value'    => $writable ? 'Writable' : 'Not writable',
        'note'     => $writable ? '' : "Not writable: {$path}",
    ];
}

function parse_bytes(string $val): int {
    $val  = trim($val);
    if ($val === '') return 0;
    $last = strtolower(substr($val, -1));
    $num  = (int)$val;
    if ($last === 'g') return $num * 1024 * 1024 * 1024;
    if ($last === 'm') return $num * 1024 * 1024;
    if ($last === 'k') return $num * 1024;
    return $num;
}

function fmt_bytes(int $b): string {
    if ($b >= 1073741824) return round($b / 1073741824, 1) . 'G';
    if ($b >= 1048576)    return round($b / 1048576, 1) . 'M';
    if ($b >= 1024)       return round($b / 1024, 1) . 'K';
    return $b . 'B';
}

function all_required_pass(array $checks): bool {
    foreach ($checks as $c) {
        if (($c['result']['required'] ?? true) && !$c['result']['ok']) return false;
    }
    return true;
}

// ─────────────────────────────────────────────────────────────────────────────
// Page routing
// ─────────────────────────────────────────────────────────────────────────────

$step = (int)($_GET['step'] ?? 1);
if ($step < 1 || $step > 4) $step = 1;

// Step 4 only valid when we have a session summary (just installed)
$installSummary = $_SESSION['install_summary'] ?? null;
if ($step === 4 && empty($installSummary)) {
    // If already installed show the locked page; otherwise redirect back
    $step = $isInstalled ? 1 : 1;
}
// Clear summary after reading it for step 4
if ($step === 4 && $installSummary !== null) {
    unset($_SESSION['install_summary']);
}

$checks     = run_checks();
$checksPass = all_required_pass($checks);

$appVersion = '1.0.0';
$vf = ROOT_PATH . '/VERSION.txt';
if (file_exists($vf)) {
    $appVersion = trim((string)file_get_contents($vf));
}

$fv = [
    'db_host'       => $_POST['db_host']       ?? 'localhost',
    'db_port'       => $_POST['db_port']       ?? '3306',
    'db_name'       => $_POST['db_name']       ?? '',
    'db_user'       => $_POST['db_user']       ?? '',
    'base_url'      => $_POST['base_url']      ?? '',
    'actor_name'    => $_POST['actor_name']    ?? '',
    'max_upload_mb' => $_POST['max_upload_mb'] ?? '128',
];

// ─────────────────────────────────────────────────────────────────────────────
// HTML output
// ─────────────────────────────────────────────────────────────────────────────
?><!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width,initial-scale=1">
    <title>Survey PDF Editor — Installer</title>
    <link rel="stylesheet" href="install.css">
</head>
<body>
<div class="installer-wrap">

    <div class="installer-header">
        <h1>Survey PDF Editor</h1>
        <p>Installation Wizard &nbsp;·&nbsp; v<?= esc($appVersion) ?></p>
    </div>

<?php if ($isInstalled && $step !== 4): ?>
<!-- ──────────────────────────────────────────────────────────────────────────
     Already installed
     ─────────────────────────────────────────────────────────────────────── -->
<div class="card">
    <div class="locked-box">
        <div class="lock-icon">🔒</div>
        <h2>Already Installed</h2>
        <p>The application is already installed and the installer is locked.</p>
        <br>
        <p style="font-size:0.85rem;color:#6b7280;">
            To re-run the installer: delete <code>install/install.lock</code> and
            <code>api/config.php</code> via FTP or your hosting file manager, then reload this page.
        </p>
        <br>
        <a href="../" class="btn btn-primary">Open Application →</a>
    </div>
</div>

<?php else: ?>
<!-- ──────────────────────────────────────────────────────────────────────────
     Step progress bar
     ─────────────────────────────────────────────────────────────────────── -->
<div class="steps-bar">
<?php
$stepLabels = ['1. Requirements', '2. Settings', '3. Install', '4. Complete'];
foreach ($stepLabels as $i => $label) {
    $n   = $i + 1;
    $cls = 'step-item';
    if ($n === $step)      $cls .= ' active';
    elseif ($n < $step)    $cls .= ' done';
    echo '<div class="' . $cls . '">' . esc($label) . '</div>';
}
?>
</div>

<?php if ($step === 1): ?>
<!-- ──────────────────────────────────────────────────────────────────────────
     Step 1: Requirements
     ─────────────────────────────────────────────────────────────────────── -->
<div class="card">
    <h2>Server Requirements</h2>
    <ul class="check-list">
    <?php foreach ($checks as $c):
        $r = $c['result'];
        $req = $r['required'] ?? true;
        if ($r['ok']) {
            $badge = 'badge-ok'; $status = $req ? 'OK' : 'Available';
        } elseif (!$req) {
            $badge = 'badge-warn'; $status = 'Optional';
        } else {
            $badge = 'badge-fail'; $status = 'FAIL';
        }
    ?>
        <li>
            <span class="badge <?= $badge ?>"><?= $status ?></span>
            <span><?= esc($c['label']) ?>
                <?php if (!$r['ok'] && $r['note']): ?>
                — <em style="color:#b91c1c;font-size:0.85rem;"><?= esc($r['note']) ?></em>
                <?php endif; ?>
            </span>
            <span style="margin-left:auto;color:#6b7280;font-size:0.8rem;"><?= esc($r['value']) ?></span>
        </li>
    <?php endforeach; ?>
    </ul>

    <?php if (!$checksPass): ?>
    <div class="alert alert-danger" style="margin-top:16px;">
        One or more required checks failed. Resolve them before continuing.
    </div>
    <?php else: ?>
    <div class="alert alert-success" style="margin-top:16px;">
        All required checks passed. You can continue.
    </div>
    <?php endif; ?>

    <div style="margin-top:20px;display:flex;gap:10px;align-items:center;">
        <?php if ($checksPass): ?>
        <a href="?step=2" class="btn btn-primary">Continue →</a>
        <?php endif; ?>
        <a href="?step=1" class="btn" style="background:#e5e7eb;color:#374151;">Re-check</a>
    </div>
</div>

<?php elseif ($step === 2): ?>
<!-- ──────────────────────────────────────────────────────────────────────────
     Step 2: Settings form
     ─────────────────────────────────────────────────────────────────────── -->
<div class="card">
    <h2>Database &amp; Application Settings</h2>
    <form id="installForm" autocomplete="off">

        <p class="section-title">Database Connection</p>
        <div class="form-row">
            <div class="form-group">
                <label for="db_host">Host</label>
                <input type="text" id="db_host" name="db_host" value="<?= esc($fv['db_host']) ?>" required>
                <p class="field-hint">Usually <code>localhost</code></p>
            </div>
            <div class="form-group" style="max-width:110px;">
                <label for="db_port">Port</label>
                <input type="number" id="db_port" name="db_port" value="<?= esc($fv['db_port']) ?>" min="1" max="65535">
            </div>
        </div>

        <div class="form-group">
            <label for="db_name">Database Name</label>
            <input type="text" id="db_name" name="db_name" value="<?= esc($fv['db_name']) ?>" required placeholder="e.g. survey_db">
            <p class="field-hint">Create an empty MySQL database first, then enter its name here.</p>
        </div>

        <div class="form-row">
            <div class="form-group">
                <label for="db_user">Database Username</label>
                <input type="text" id="db_user" name="db_user" value="<?= esc($fv['db_user']) ?>" required>
            </div>
            <div class="form-group">
                <label for="db_pass">Database Password</label>
                <input type="password" id="db_pass" name="db_pass" autocomplete="new-password">
            </div>
        </div>

        <hr class="divider">
        <p class="section-title">Application Settings</p>

        <div class="form-group">
            <label for="base_url">Base URL</label>
            <input type="url" id="base_url" name="base_url" value="<?= esc($fv['base_url']) ?>" placeholder="https://yoursite.com">
            <p class="field-hint">The URL where the app will be accessed. Leave blank to auto-detect.</p>
        </div>

        <div class="form-row">
            <div class="form-group">
                <label for="actor_name">Actor Name <span style="font-weight:400;color:#6b7280;">(optional)</span></label>
                <input type="text" id="actor_name" name="actor_name" value="<?= esc($fv['actor_name']) ?>" placeholder="e.g. Admin">
                <p class="field-hint">Used in audit log entries.</p>
            </div>
            <div class="form-group" style="max-width:160px;">
                <label for="max_upload_mb">Max Upload (MB)</label>
                <input type="number" id="max_upload_mb" name="max_upload_mb" value="<?= esc($fv['max_upload_mb']) ?>" min="1" max="2048">
            </div>
        </div>

        <div id="form-error" class="alert alert-danger" style="display:none;"></div>

        <div style="margin-top:4px;display:flex;gap:10px;align-items:center;flex-wrap:wrap;">
            <button type="button" id="testBtn" class="btn" style="background:#e5e7eb;color:#374151;">Test DB Connection</button>
            <div id="test-result"></div>
        </div>

        <hr class="divider">
        <button type="button" id="installBtn" class="btn btn-primary">Run Installation →</button>
        <p style="margin-top:10px;font-size:0.8rem;color:#6b7280;">
            This will import the database schema, write <code>api/config.php</code>, and create storage folders.
        </p>
    </form>
</div>

<?php elseif ($step === 4 && $installSummary): ?>
<!-- ──────────────────────────────────────────────────────────────────────────
     Step 4: Success
     ─────────────────────────────────────────────────────────────────────── -->
<div class="card">
    <div style="text-align:center;margin-bottom:20px;">
        <div style="font-size:3rem;line-height:1;">🎉</div>
        <h2 style="margin-top:10px;">Installation Complete!</h2>
    </div>

    <div class="alert alert-success">
        The application has been installed and configured successfully.
    </div>

    <p class="section-title">What was done</p>
    <ul class="result-list">
        <li>✔ Database schema imported
            (<?= (int)($installSummary['sql_statements'] ?? 0) ?> statements, MySQL <?= esc($installSummary['db_version'] ?? '') ?>)</li>
        <?php if (!empty($installSummary['dirs_created'])): ?>
        <li>✔ Created: <?= esc(implode(', ', $installSummary['dirs_created'])) ?></li>
        <?php else: ?>
        <li>✔ Storage directories already exist</li>
        <?php endif; ?>
        <li>✔ <code>api/config.php</code> written</li>
        <li>✔ Installer locked (<code>install/install.lock</code>)</li>
    </ul>

    <?php if (!empty($installSummary['warning'])): ?>
    <div class="alert alert-warning" style="margin-top:16px;">⚠ <?= esc($installSummary['warning']) ?></div>
    <?php endif; ?>

    <hr class="divider">
    <p class="section-title">Next steps</p>
    <ol class="next-steps">
        <li>Click <strong>Open Application</strong> to verify everything works.</li>
        <li>For security, you may restrict or remove the <code>install/</code> folder after setup.</li>
        <li>Check <code>api/config.php</code> if you need to update any settings later.</li>
    </ol>

    <div style="margin-top:24px;">
        <a href="../" class="btn btn-success btn-block">Open Application →</a>
    </div>
</div>

<?php else: ?>
<!-- fallback: redirect to step 1 -->
<?php header('Location: ?step=1'); exit; ?>
<?php endif; ?>

<?php endif; // isInstalled ?>

</div><!-- .installer-wrap -->

<?php if (!$isInstalled && $step === 2): ?>
<script>
(function () {
    "use strict";

    var testBtn    = document.getElementById('testBtn');
    var installBtn = document.getElementById('installBtn');
    var errBox     = document.getElementById('form-error');
    var testResult = document.getElementById('test-result');

    testBtn.addEventListener('click', function () {
        testResult.innerHTML = '<span style="color:#555;font-size:0.88rem;">Testing…</span>';
        post(formData(), 'test_connection', function (data) {
            if (data.ok) {
                testResult.innerHTML = '<span class="badge badge-ok">Connected</span> ' +
                    '<span style="font-size:0.85rem;color:#555;">MySQL ' + h(data.version || '') + '</span>';
            } else {
                testResult.innerHTML = '<span class="badge badge-fail">Failed</span> ' +
                    '<span style="font-size:0.85rem;color:#991b1b;">' + h(data.error || '') + '</span>';
            }
        });
    });

    installBtn.addEventListener('click', function () {
        errBox.style.display = 'none';
        var d = formData();
        if (!d.db_name || !d.db_user) {
            showErr('Database name and username are required.');
            return;
        }
        installBtn.disabled    = true;
        installBtn.textContent = 'Installing…';
        post(d, 'install', function (resp) {
            if (resp.ok) {
                window.location.href = '?step=4';
            } else {
                showErr(resp.error || 'Installation failed — check server logs.');
                installBtn.disabled    = false;
                installBtn.textContent = 'Run Installation →';
            }
        });
    });

    function showErr(msg) {
        errBox.textContent    = msg;
        errBox.style.display  = 'block';
    }

    function formData() {
        var fd  = new FormData(document.getElementById('installForm'));
        var obj = {};
        fd.forEach(function (v, k) { obj[k] = v; });
        return obj;
    }

    function post(data, action, cb) {
        data.action = action;
        fetch(window.location.pathname + window.location.search, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams(data).toString()
        })
        .then(function (r) { return r.json(); })
        .then(cb)
        .catch(function (e) { cb({ ok: false, error: String(e) }); });
    }

    function h(s) {
        return String(s)
            .replace(/&/g,'&amp;').replace(/</g,'&lt;')
            .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
    }
}());
</script>
<?php endif; ?>
</body>
</html>
