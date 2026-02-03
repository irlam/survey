<?php
require_once __DIR__ . '/config-util.php';
require_once __DIR__ . '/db.php';

require_method('POST');

$cfg = load_config();
$max_mb = (int)($cfg['max_upload_mb'] ?? 128);
$max_bytes = $max_mb * 1024 * 1024;
$debug = !empty($cfg['debug']);

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

// Validate PDF by extension + signature
$origName = $f['name'] ?? 'plan.pdf';
$ext = strtolower(pathinfo($origName, PATHINFO_EXTENSION));
if ($ext !== 'pdf') {
  error_response('Only PDF files allowed (.pdf)', 415);
}

$fh = @fopen($f['tmp_name'], 'rb');
$head = $fh ? fread($fh, 4) : '';
if ($fh) fclose($fh);

if ($head !== '%PDF') {
  error_response('File does not look like a valid PDF', 415);
}

$name = safe_string($_POST['name'] ?? '', 255);
if ($name === '') $name = safe_string(pathinfo($origName, PATHINFO_FILENAME), 255);
$revision = safe_string($_POST['revision'] ?? '', 50);
if ($revision === '') $revision = null;

// Ensure plans directory exists & is writable
$plansDir = storage_dir('plans/.keep');
$plansRoot = dirname($plansDir);

if (!is_dir($plansRoot)) {
  $extra = $debug ? ['detail' => $plansRoot] : [];
  error_response('Storage plans directory missing', 500, $extra);
}
if (!is_writable($plansRoot)) {
  $extra = $debug ? ['detail' => $plansRoot] : [];
  error_response('Storage plans directory not writable', 500, $extra);
}

$sha1 = sha1_file($f['tmp_name']);
$rand = bin2hex(random_bytes(12));
$filename = "plan_" . substr($sha1, 0, 8) . "_" . $rand . ".pdf";
$relPath = "plans/" . $filename;
$dest = storage_dir($relPath);

// Try to move upload
$ok = @move_uploaded_file($f['tmp_name'], $dest);

// Fallback: some hosts are weird; try copy then unlink
if (!$ok) {
  $ok = @copy($f['tmp_name'], $dest);
  if ($ok) @unlink($f['tmp_name']);
}

if (!$ok) {
  error_response('Failed to store upload. Check permissions/ownership of: ' . $plansRoot, 500);
}

// Insert DB row
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
    'sha1' => $sha1,
  ]
]);
