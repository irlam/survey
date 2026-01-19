<?php
require_once __DIR__ . '/config-util.php';
require_once __DIR__ . '/db.php';

require_method('POST');

$cfg = load_config();
$max_mb = (int)($cfg['max_upload_mb'] ?? 25);
$max_bytes = $max_mb * 1024 * 1024;

if (!isset($_FILES['file']) || $_FILES['file']['error'] !== UPLOAD_ERR_OK) {
  error_response('No file uploaded or upload error', 400);
}

$file = $_FILES['file'];

if ($file['size'] <= 0) error_response('Empty upload', 400);
if ($file['size'] > $max_bytes) error_response('File too large', 413, ['max_mb' => $max_mb]);

// MIME check
$finfo = finfo_open(FILEINFO_MIME_TYPE);
$mime = finfo_file($finfo, $file['tmp_name']);
finfo_close($finfo);

if ($mime !== 'application/pdf') {
  error_response('Only PDF files allowed', 415, ['mime' => $mime]);
}

// Name defaults to original filename without .pdf
$origName = $file['name'] ?? 'plan.pdf';
$origBase = preg_replace('/\.pdf$/i', '', $origName);
$name = safe_string($_POST['name'] ?? $origBase, 255);

// revision is a string in your DB (varchar(50))
$revision = safe_string($_POST['revision'] ?? '', 50);
if (trim($revision) === '') $revision = null;

// Random filename
$rand = bin2hex(random_bytes(16));
$relPath = "plans/plan_{$rand}.pdf";
$dest = storage_path($relPath);

// Move upload
if (!move_uploaded_file($file['tmp_name'], $dest)) {
  error_response('Failed to store file', 500);
}

// Compute sha1
$sha1 = sha1_file($dest);
if (!$sha1) error_response('Failed to hash file', 500);

// Insert into DB (matches your schema)
$pdo = db();
$stmt = $pdo->prepare('INSERT INTO plans (name, revision, file_path, sha1) VALUES (?, ?, ?, ?)');
$stmt->execute([$name, $revision, $relPath, $sha1]);

$plan_id = (int)$pdo->lastInsertId();

// Return full plan row
$out = $pdo->prepare('SELECT id, name, revision, file_path, sha1, uploaded_at FROM plans WHERE id=?');
$out->execute([$plan_id]);
$plan = $out->fetch();

json_response(['ok' => true, 'plan' => $plan], 201);
