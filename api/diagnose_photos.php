<?php
require_once __DIR__ . '/config-util.php';
require_once __DIR__ . '/db.php';
require_method('GET');

$plan_id = safe_int($_GET['plan_id'] ?? null);
$limit = safe_int($_GET['limit'] ?? 200);
if ($limit <= 0 || $limit > 2000) $limit = 200;

$pdo = db();
$sql = 'SELECT p.* FROM photos p';
$params = [];
if ($plan_id) {
  $sql .= ' WHERE p.plan_id=?';
  $params[] = $plan_id;
}
$sql .= ' ORDER BY p.created_at DESC LIMIT ' . $limit;
$stmt = $pdo->prepare($sql);
$stmt->execute($params);
$rows = $stmt->fetchAll(PDO::FETCH_ASSOC);

$missing = [];
$ok = 0;
$missing_count = 0;
$used_thumb_count = 0;

function resolve_photo_path($fileRel) {
  if (!$fileRel) return null;
  if (strpos($fileRel, '/storage/') === 0) return realpath(__DIR__ . '/..' . $fileRel);
  if (strpos($fileRel, 'photos/') === 0 || strpos($fileRel, 'files/') === 0) return storage_dir($fileRel);
  if (strpos($fileRel, '/') === false) return storage_dir('photos/' . $fileRel);
  return storage_dir($fileRel);
}

foreach ($rows as $r) {
  $fileRel = $r['file_path'] ?? ($r['filename'] ?? null);
  $thumbRel = $r['thumb_path'] ?? ($r['thumb'] ?? null);
  $filePath = resolve_photo_path($fileRel);
  $thumbPath = resolve_photo_path($thumbRel);

  $fileExists = $filePath && is_file($filePath);
  $thumbExists = $thumbPath && is_file($thumbPath);

  if ($fileExists) {
    $ok++;
    continue;
  }

  if (!$fileExists && $thumbExists) $used_thumb_count++;
  $missing_count++;
  $missing[] = [
    'photo_id' => (int)$r['id'],
    'plan_id' => (int)$r['plan_id'],
    'issue_id' => $r['issue_id'] !== null ? (int)$r['issue_id'] : null,
    'file_rel' => $fileRel,
    'file_path' => $filePath,
    'thumb_rel' => $thumbRel,
    'thumb_path' => $thumbPath,
    'file_exists' => $fileExists,
    'thumb_exists' => $thumbExists,
    'created_at' => format_date_field('created_at', $r['created_at'])
  ];
}

json_response([
  'ok' => true,
  'plan_id' => $plan_id,
  'limit' => $limit,
  'checked' => count($rows),
  'ok_count' => $ok,
  'missing_count' => $missing_count,
  'missing_file_but_thumb_exists' => $used_thumb_count,
  'missing_samples' => array_slice($missing, 0, 50)
]);
