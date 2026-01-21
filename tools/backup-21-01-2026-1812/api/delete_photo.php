<?php
require_once __DIR__ . '/config-util.php';
require_once __DIR__ . '/db.php';
require_method('POST');
$data = read_json_body();
$id = safe_int($data['id'] ?? null);
$plan_id = safe_int($data['plan_id'] ?? null);
if (!$id || !$plan_id) error_response('Missing or invalid id/plan_id', 400);
$pdo = db();
$stmt = $pdo->prepare('SELECT filename FROM photos WHERE id=? AND plan_id=?');
$stmt->execute([$id, $plan_id]);
$row = $stmt->fetch();
if ($row) {
    $file = storage_dir('photos/' . $row['filename']);
    if (is_file($file)) unlink($file);
}
$stmt = $pdo->prepare('DELETE FROM photos WHERE id=? AND plan_id=?');
$stmt->execute([$id, $plan_id]);
json_response(['ok'=>true, 'deleted'=>($stmt->rowCount() > 0)]);
