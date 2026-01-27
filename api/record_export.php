<?php
require_once __DIR__ . '/config-util.php';
require_once __DIR__ . '/db.php';
require_method('POST');
$data = read_json_body();
$plan_id = safe_int($data['plan_id'] ?? null);
$filename = safe_string($data['filename'] ?? '', 255);
$type = safe_string($data['type'] ?? '', 32);
if (!$filename) error_response('Missing filename', 400);
$pdo = db();
try {
    // ensure columns exist
    $r = $pdo->query("SHOW COLUMNS FROM exports LIKE 'filename'")->fetch();
    if (!$r) $pdo->exec("ALTER TABLE exports ADD COLUMN filename VARCHAR(255) NOT NULL DEFAULT '' AFTER plan_id");
    $r2 = $pdo->query("SHOW COLUMNS FROM exports LIKE 'type'")->fetch();
    if (!$r2) $pdo->exec("ALTER TABLE exports ADD COLUMN type VARCHAR(32) DEFAULT NULL AFTER filename");
} catch (Exception $e) {
    error_log('record_export: could not ensure exports table columns: ' . $e->getMessage());
}
$stmt = $pdo->prepare('INSERT INTO exports (plan_id, filename, type) VALUES (?, ?, ?)');
$stmt->execute([$plan_id, $filename, $type]);
json_response(['ok'=>true, 'id'=>$pdo->lastInsertId()]);
