<?php
require_once __DIR__ . '/config-util.php';
require_once __DIR__ . '/db.php';
require_method('POST');
$cfg = load_config();
$max_mb = $cfg['max_upload_mb'] ?? 25;
$max_bytes = $max_mb * 1024 * 1024;
if (!isset($_FILES['file']) || $_FILES['file']['error'] !== UPLOAD_ERR_OK) {
    error_response('No file uploaded or upload error', 400);
}
$file = $_FILES['file'];
if ($file['size'] > $max_bytes) {
    error_response('File too large', 413);
}
$finfo = finfo_open(FILEINFO_MIME_TYPE);
$mime = finfo_file($finfo, $file['tmp_name']);
$allowed = ['image/jpeg','image/png'];
finfo_close($finfo);
if (!in_array($mime, $allowed)) {
    error_response('Only JPEG/PNG allowed', 415);
}
$plan_id = safe_int($_POST['plan_id'] ?? null);
$issue_id = safe_int($_POST['issue_id'] ?? null);
if (!$plan_id) error_response('Missing plan_id', 400);
$ext = $mime === 'image/png' ? '.png' : '.jpg';
$rand = bin2hex(random_bytes(8));
$filename = $rand . $ext;
$dest = storage_dir('photos/' . $filename);
if (!move_uploaded_file($file['tmp_name'], $dest)) {
    error_response('Failed to store file', 500);
}
$pdo = db();
$stmt = $pdo->prepare('INSERT INTO photos (plan_id, issue_id, filename) VALUES (?, ?, ?)');
$stmt->execute([$plan_id, $issue_id, $filename]);
json_response(['ok'=>true, 'photo_id'=>$pdo->lastInsertId(), 'filename'=>$filename]);
