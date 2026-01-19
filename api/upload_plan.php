<?php
// Milestone 2: Upload plan endpoint (PDF upload -> storage/plans -> plans table)
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

if ($file['size'] <= 0) {
  error_response('Empty upload', 400);
}
if ($file['size'] > $max_bytes) {
  error_response('File too large', 413, ['max_mb' => $max_mb]);
}

// Best-effort MIME check
$finfo = finfo_open(FILEINFO_MIME_TYPE);
$mime = finfo_file($finfo, $file['tmp_name']);
finfo_close($finfo);

if ($mime !== 'application/pdf') {
  error_response('Only PDF files allowed', 415, ['mime' => $mime]);
}

// Default name: original filename without .pdf
$origName = $file['name'] ?? 'plan.pdf';
$origBase = preg_replace('/\.pdf$/i', '', $origName);
$name = safe_string($_POST['name'] ?? $origBase, 255);

// Revision as string (Rev A, P03, etc.)
$revision = safe_string($_POST['revision'] ?? '', 50);
if ($revision === '') $revision = null;

// Random filename
$rand = bin2hex(random_bytes(12));
$filename = "plan_{$rand}.pdf";

// Destination (creates storage/plans automatically)
$dest = storage_path('plans/' . $filename);

if (!move_uploaded_file($file['tmp_name'], $dest)) {
  error_response('Failed to store file', 500);
}

// Insert into DB
$pdo = db();
$stmt = $pdo->prepare('INSERT INTO plans (name, filename, revision) VALUES (?, ?, ?)');
$stmt->execute([$name, $filename, $revision]);
$plan_id = (int)$pdo->lastInsertId();

json_response([
  'ok' => true,
  'plan' => [
    'id' => $plan_id,
    'name' => $name,
    'filename' => $filename,
    'revision' => $revision,
    'created_at' => date('Y-m-d H:i:s')
  ]
], 201);
