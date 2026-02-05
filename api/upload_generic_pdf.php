<?php
/* api/upload_generic_pdf.php - Upload a general PDF (02/05/2026) */
require_once __DIR__ . '/config-util.php';
require_once __DIR__ . '/db.php';
require_method('POST');

if (!isset($_FILES['file']) || $_FILES['file']['error'] !== UPLOAD_ERR_OK) {
    error_response('No file uploaded or upload error', 400);
}

$file = $_FILES['file'];
$original = safe_string($file['name'], 255);
$size = $file['size'];

$finfo = finfo_open(FILEINFO_MIME_TYPE);
if (!$finfo) error_response('File inspection failed', 500);
$mime = finfo_file($finfo, $file['tmp_name']);
finfo_close($finfo);

if ($mime !== 'application/pdf') {
    error_response('Only PDF files are allowed', 400);
}

$ext = pathinfo($original, PATHINFO_EXTENSION);
$rand = bin2hex(random_bytes(8));
$filename = $rand . ($ext ? ('.' . $ext) : '.pdf');
$dest = storage_dir('files/' . $filename);

if (!move_uploaded_file($file['tmp_name'], $dest)) {
    error_response('Failed to store file', 500);
}

$pdo = db();
$stmt = $pdo->prepare('INSERT INTO files (plan_id, filename, original_name, size, mime) VALUES (NULL, ?, ?, ?, ?)');
$stmt->execute([$filename, $original, $size, $mime]);

json_response(['ok'=>true, 'file_id'=>$pdo->lastInsertId(), 'filename'=>$filename]);
