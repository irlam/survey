<?php
/* api/plan_file.php - Stream plan PDF with range support (04/02/2026) */
require_once __DIR__ . '/config-util.php';
require_once __DIR__ . '/db.php';

require_method('GET');

$plan_id = safe_int($_GET['plan_id'] ?? null);
if (!$plan_id) error_response('Missing or invalid plan_id', 400);

$pdo = db();
$stmt = $pdo->prepare('SELECT id, file_path, sha1 FROM plans WHERE id=?');
$stmt->execute([$plan_id]);
$plan = $stmt->fetch();
if (!$plan) error_response('Plan not found', 404);

// IMPORTANT: file_path is relative like "plans/xxx.pdf"
$rel = $plan['file_path'];
$full = storage_dir($rel);

if (!is_file($full)) error_response('File missing on server', 404);
if (!is_readable($full)) error_response('File not readable (permissions)', 500);

// Stop any accidental output buffering that can corrupt PDF bytes
while (ob_get_level()) { ob_end_clean(); }

$size = filesize($full);
$etag = '"' . ($plan['sha1'] ?? sha1_file($full)) . '"';
$mtime = filemtime($full);
$lastMod = gmdate('D, d M Y H:i:s', $mtime) . ' GMT';

// Caching headers (fine for same-origin PDF.js)
header('Content-Type: application/pdf');
header('Content-Disposition: inline; filename="plan_' . (int)$plan_id . '.pdf"');
header('Accept-Ranges: bytes');
header('ETag: ' . $etag);
header('Last-Modified: ' . $lastMod);
header('Cache-Control: private, max-age=0, must-revalidate');

// If client cache is valid, return 304
$ifNoneMatch = $_SERVER['HTTP_IF_NONE_MATCH'] ?? '';
$ifModifiedSince = $_SERVER['HTTP_IF_MODIFIED_SINCE'] ?? '';
if ($ifNoneMatch === $etag || ($ifModifiedSince && strtotime($ifModifiedSince) >= $mtime)) {
  header('HTTP/1.1 304 Not Modified');
  exit;
}

// Support Range requests (PDF.js likes this)
$range = $_SERVER['HTTP_RANGE'] ?? '';
if ($range && preg_match('/bytes=(\d+)-(\d*)/', $range, $m)) {
  $start = (int)$m[1];
  $end = ($m[2] !== '') ? (int)$m[2] : ($size - 1);
  if ($start > $end || $start >= $size) {
    header('HTTP/1.1 416 Range Not Satisfiable');
    header("Content-Range: bytes */$size");
    exit;
  }

  $len = $end - $start + 1;
  header('HTTP/1.1 206 Partial Content');
  header("Content-Range: bytes $start-$end/$size");
  header("Content-Length: $len");

  $fp = fopen($full, 'rb');
  fseek($fp, $start);
  $chunk = 8192;
  while (!feof($fp) && $len > 0) {
    $read = ($len > $chunk) ? $chunk : $len;
    $buf = fread($fp, $read);
    echo $buf;
    $len -= strlen($buf);
    if (connection_status() != CONNECTION_NORMAL) break;
  }
  fclose($fp);
  exit;
}

// Normal full response
header('Content-Length: ' . $size);
readfile($full);
exit;
