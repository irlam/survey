<?php
// Milestone 2: Upload plan endpoint stub
require_once __DIR__ . '/config-util.php';
require_once __DIR__ . '/db.php';
require_method('POST');
// Handle PDF upload, validate, store, insert into DB
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
finfo_close($finfo);
if ($mime !== 'application/pdf') {
	error_response('Only PDF files allowed', 415);
}

$name = safe_string($_POST['name'] ?? $file['name'], 255);
$revision = safe_int($_POST['revision'] ?? 1) ?: 1;

// Generate random filename
$ext = '.pdf';
$rand = bin2hex(random_bytes(8));
$filename = $rand . $ext;
$dest = storage_dir('plans/' . $filename);
if (!move_uploaded_file($file['tmp_name'], $dest)) {
	error_response('Failed to store file', 500);
}

// Insert into DB
$pdo = db();
$stmt = $pdo->prepare('INSERT INTO plans (name, filename, revision) VALUES (?, ?, ?)');
$stmt->execute([$name, $filename, $revision]);
$plan_id = $pdo->lastInsertId();

json_response(['ok'=>true, 'plan_id'=>$plan_id, 'name'=>$name, 'filename'=>$filename, 'revision'=>$revision]);