<?php
/* api/delete_photo.php - Delete a photo + file (04/02/2026) */
require_once __DIR__ . '/config-util.php';
require_once __DIR__ . '/db.php';
require_method('POST');
$data = read_json_body();
$id = safe_int($data['id'] ?? null);
$plan_id = safe_int($data['plan_id'] ?? null);
if (!$id || !$plan_id) error_response('Missing or invalid id/plan_id', 400);
$pdo = db();
$stmt = $pdo->prepare('SELECT filename, file_path, thumb, thumb_path FROM photos WHERE id=? AND plan_id=?');
$stmt->execute([$id, $plan_id]);
$row = $stmt->fetch();
if ($row) {
    if (!empty($row['file_path'])) {
        $file = storage_dir($row['file_path']);
        if (is_file($file)) @unlink($file);
    } elseif (!empty($row['filename'])) {
        $file = storage_dir('photos/' . $row['filename']);
        if (is_file($file)) @unlink($file);
    }
    if (!empty($row['thumb_path'])) {
        $thumb = storage_dir($row['thumb_path']);
        if (is_file($thumb)) @unlink($thumb);
    } elseif (!empty($row['thumb'])) {
        $thumb = storage_dir('photos/' . $row['thumb']);
        if (is_file($thumb)) @unlink($thumb);
    }
}
$stmt = $pdo->prepare('DELETE FROM photos WHERE id=? AND plan_id=?');
$stmt->execute([$id, $plan_id]);
json_response(['ok'=>true, 'deleted'=>($stmt->rowCount() > 0)]);
