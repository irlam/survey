<?php
require_once __DIR__ . '/config-util.php';
require_once __DIR__ . '/db.php';
require_method('POST');
$plan_id = safe_int($_POST['plan_id'] ?? null);
if (!$plan_id) error_response('Missing plan_id', 400);
if (!isset($_FILES['file']) || $_FILES['file']['error'] !== UPLOAD_ERR_OK) {
    error_response('No file uploaded or upload error', 400);
}
$file = $_FILES['file'];
$original = safe_string($file['name'], 255);
$size = $file['size'];
$finfo = finfo_open(FILEINFO_MIME_TYPE);
$mime = finfo_file($finfo, $file['tmp_name']);
finfo_close($finfo);
$ext = pathinfo($original, PATHINFO_EXTENSION);
$rand = bin2hex(random_bytes(8));
$filename = $rand . ($ext ? ('.' . $ext) : '');
$dest = storage_dir('files/' . $filename);
if (!move_uploaded_file($file['tmp_name'], $dest)) {
    error_response('Failed to store file', 500);
}
$pdo = db();
$stmt = $pdo->prepare('INSERT INTO files (plan_id, filename, original_name, size, mime) VALUES (?, ?, ?, ?, ?)');
$stmt->execute([$plan_id, $filename, $original, $size, $mime]);
json_response(['ok'=>true, 'file_id'=>$pdo->lastInsertId(), 'filename'=>$filename]);
