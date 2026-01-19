<?php
// Milestone 2: Stream plan PDF safely (supports Range for PDF.js performance)
require_once __DIR__ . '/config-util.php';
require_once __DIR__ . '/db.php';

require_method('GET');

$plan_id = safe_int($_GET['plan_id'] ?? null);
if (!$plan_id) error_response('Missing or invalid plan_id', 400);

$pdo = db();
$stmt = $pdo->prepare('SELECT id, filename FROM plans WHERE id=?');
$stmt->execute([$plan_id]);
$row = $stmt->fetch();

if (!$row) error_response('Plan not found', 404);

$path = storage_path('plans/' . $row['filename']);
if (!is_file($path)) error_response('File missing on server', 404);

$size = filesize($path);
$fp = fopen($path, 'rb');
if (!$fp) error_response('Unable to open file', 500);

header('Content-Type: application/pdf');
header('Content-Disposition: inline; filename="plan_' . (int)$plan_id . '.pdf"');
header('Accept-Ranges: bytes');

$start = 0;
$end = $size - 1;

// Basic Range support
if (isset($_SERVER['HTTP_RANGE']) && preg_match('/bytes=(\d+)-(\d*)/', $_SERVER['HTTP_RANGE'], $m)) {
  $start = (int)$m[1];
  if ($m[2] !== '') $end = (int)$m[2];
  if ($end > $size - 1) $end = $size - 1;

  if ($start < 0 || $start > $end) {
    header('HTTP/1.1 416 Range Not Satisfiable');
    header("Content-Range: bytes */{$size}");
    fclose($fp);
    exit;
  }

  header('HTTP/1.1 206 Partial Content');
}

$length = $end - $start + 1;

header("Content-Length: {$length}");
header("Content-Range: bytes {$start}-{$end}/{$size}");

fseek($fp, $start);

$chunk = 8192;
while (!feof($fp) && $length > 0) {
  $read = ($length > $chunk) ? $chunk : $length;
  $buf = fread($fp, $read);
  if ($buf === false) break;
  echo $buf;
  flush();
  $length -= strlen($buf);
}

fclose($fp);
exit;
