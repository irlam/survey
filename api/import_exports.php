<?php
require_once __DIR__ . '/config-util.php';
require_once __DIR__ . '/db.php';
require_method('POST');
$pdo = db();
$exportsDir = storage_dir('exports');
$inserted = [];
if (!is_dir($exportsDir)) json_response(['ok'=>true,'inserted'=>[], 'count'=>0]);
$files = array_values(array_diff(scandir($exportsDir), ['.','..']));
// Ensure required columns exist (best-effort)
try {
    $r = $pdo->query("SHOW COLUMNS FROM exports LIKE 'filename'")->fetch();
    if (!$r) $pdo->exec("ALTER TABLE exports ADD COLUMN filename VARCHAR(255) NOT NULL DEFAULT '' AFTER plan_id");
    $r2 = $pdo->query("SHOW COLUMNS FROM exports LIKE 'type'")->fetch();
    if (!$r2) $pdo->exec("ALTER TABLE exports ADD COLUMN type VARCHAR(32) DEFAULT NULL AFTER filename");
} catch (Exception $e) {
    error_log('import_exports: could not ensure exports table columns: ' . $e->getMessage());
}

$stmtCheck = $pdo->prepare('SELECT id FROM exports WHERE filename=? LIMIT 1');
$stmtIns = $pdo->prepare('INSERT INTO exports (plan_id, filename, type) VALUES (?, ?, ?)');
foreach ($files as $f) {
    $full = $exportsDir . '/' . $f;
    if (!is_file($full)) continue;
    // skip hidden files
    if (strpos($f, '.') === 0) continue;
    $stmtCheck->execute([$f]);
    $row = $stmtCheck->fetch();
    if ($row) continue; // already exists
    $ext = strtolower(pathinfo($f, PATHINFO_EXTENSION));
    $type = 'file';
    if ($ext === 'csv') $type = 'csv';
    elseif ($ext === 'pdf') $type = 'pdf';
    try {
        $stmtIns->execute([null, $f, $type]);
        $inserted[] = $f;
    } catch (Exception $e) {
        error_log('import_exports: failed to insert ' . $f . ' err=' . $e->getMessage());
    }
}
json_response(['ok'=>true, 'inserted'=>$inserted, 'count'=>count($inserted)]);
