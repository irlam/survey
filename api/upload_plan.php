<?php
require_once __DIR__ . '/config-util.php';
require_once __DIR__ . '/db.php';

require_method('POST');

$cfg = load_config();
$max_mb = (int)($cfg['max_upload_mb'] ?? 25);
$max_bytes = $max_mb * 1024 * 1024;

if (!isset($_FILES['file'])) {
  error_response('Missing file field (expected name="file")', 400);
}

$f = $_FILES['file'];
if (!empty($f['error']) && $f['error'] !== UPLOAD_ERR_OK) {
  error_response('Upload error code: ' . $f['error'], 400);
}

if (empty($f['tmp_name']) || !is_uploaded_file($f['tmp_name'])) {
  error_response('No uploaded file received', 400);
}

if ((int)$f['size'] <= 0) {
  error_response('Empty upload', 400);
}

if ((int)$f['size'] > $max_bytes) {
  error_response('File too large. Max ' . $max_mb . 'MB', 413);
}

// Basic PDF validation: extension + header signature
$origName = $f['name'] ?? 'plan.pdf';
$ext = strtolower(pathinfo($origName, PATHINFO_EXTENSION));
if ($ext !== 'pdf') {
  error_response('Only PDF files allowed (.pdf)', 415);
}

// Check first 4 bytes are "%PDF"
$fh = fopen($f['tmp_name'], 'rb');
$head = $fh ? fread($fh, 4) : '';
if ($fh) fclose($fh);
if ($head !== '%PDF') {
  // Some servers mangle mime; signature is best check
  error_response('File does not look like a valid PDF', 415);
}

$name = safe_string($_POST['name'] ?? '', 255);
if ($name === '') {
  $name = safe_string(pathinfo($origName, PATHINFO_FILENAME), 255);
}
$revision = safe_string($_POST['revision'] ?? '', 50);
if ($revision === '') $revision = null;

// Store file
$sha1 = sha1_file($f['tmp_name']);
$rand = bin2hex(random_bytes(12));
$filename = "plan_" . substr($sha1, 0, 8) . "_" . $rand . ".pdf";
$relPath = "plans/" . $filename;
$dest = storage_dir($relPath);

if (!@move_uploaded_file($f['tmp_name'], $dest)) {
  error_response('Failed to store upload (permissions?)', 500);
}

// Insert DB row (matches your real schema)
$pdo = db();
$stmt = $pdo->prepare('
  INSERT INTO plans (name, revision, file_path, sha1)
  VALUES (?, ?, ?, ?)
');
$stmt->execute([$name, $revision, $relPath, $sha1]);

$plan_id = (int)$pdo->lastInsertId();

json_response([
  'ok' => true,
  'plan' => [
    'id' => $plan_id,
    'name' => $name,
    'revision' => $revision,
    'file_path' => $relPath,
    'sha1' => $sha1
  ]
]);
