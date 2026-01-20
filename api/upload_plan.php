<?php
require_once __DIR__ . '/config-util.php';
require_once __DIR__ . '/db.php';

require_method('POST');

$cfg = load_config();
$max_mb = (int)($cfg['max_upload_mb'] ?? 50);
if ($max_mb < 1) $max_mb = 50;
$max_bytes = $max_mb * 1024 * 1024;

if (!isset($_FILES['file']) || $_FILES['file']['error'] !== UPLOAD_ERR_OK) {
  error_response('No file uploaded or upload error', 400);
}

$f = $_FILES['file'];

if ($f['size'] <= 0) error_response('Empty file', 400);
if ($f['size'] > $max_bytes) error_response("File too large (max {$max_mb}MB)", 413);

// Basic PDF checks
$original = $f['name'] ?? 'upload.pdf';
$original = preg_replace('/[^A-Za-z0-9._ -]/', '_', $original);

$ext = strtolower(pathinfo($original, PATHINFO_EXTENSION));
if ($ext !== 'pdf') error_response('Only .pdf files allowed', 415);

$finfo = @finfo_open(FILEINFO_MIME_TYPE);
$mime = $finfo ? @finfo_file($finfo, $f['tmp_name']) : '';
if ($finfo) @finfo_close($finfo);

if ($mime && $mime !== 'application/pdf') {
  error_response('Only PDF files allowed', 415, ['mime' => $mime]);
}

// Check PDF header signature
$fh = @fopen($f['tmp_name'], 'rb');
$head = $fh ? @fread($fh, 5) : '';
if ($fh) @fclose($fh);
if ($head !== '%PDF-') error_response('File does not look like a PDF', 415);

// Name / revision fields
$name = safe_string($_POST['name'] ?? '', 255);
if (trim($name) === '') {
  $name = pathinfo($original, PATHINFO_FILENAME);
  $name = safe_string($name, 255);
}
$revision = safe_string($_POST['revision'] ?? '', 50);
$revision = trim($revision) === '' ? null : $revision;

// Store file
$sha1 = sha1_file($f['tmp_name']);
$rand = bin2hex(random_bytes(8));
$filename = "plan_{$rand}.pdf";
$rel_path = 'plans/' . $filename;
$abs_path = storage_path($rel_path);

if (!@move_uploaded_file($f['tmp_name'], $abs_path)) {
  error_response('Failed to store file (permissions?)', 500);
}

// Insert DB record (matches your plans schema: name, revision, file_path, sha1, uploaded_at)
$pdo = db();
$stmt = $pdo->prepare('INSERT INTO plans (name, revision, file_path, sha1) VALUES (?, ?, ?, ?)'); 
$stmt->execute([$name, $revision, $rel_path, $sha1]);

$plan_id = (int)$pdo->lastInsertId();

$out = $pdo->prepare('SELECT id, name, revision, file_path, sha1, uploaded_at FROM plans WHERE id=?');
$out->execute([$plan_id]);
$plan = $out->fetch();

json_response(['ok' => true, 'plan' => $plan], 201);
