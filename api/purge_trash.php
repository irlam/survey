<?php
/* api/purge_trash.php - Permanently delete trash folder (04/02/2026) */
require_once __DIR__ . '/config-util.php';
require_once __DIR__ . '/db.php';
require_method('POST');
$data = read_json_body();
$trash = $data['trash'] ?? null;
if (!$trash) error_response('Missing trash parameter', 400);
$base = resolve_storage_path() . '/trash';
$dir = $base . '/' . basename($trash);
if (!is_dir($dir)) error_response('Trash folder not found', 404);
// Recursively delete directory (best-effort)
function rrmdir($dir) {
  $files = array_diff(scandir($dir), array('.','..'));
  foreach ($files as $file) {
    $full = "$dir/$file";
    if (is_dir($full)) rrmdir($full);
    else @unlink($full);
  }
  @rmdir($dir);
}
rrmdir($dir);
json_response(['ok'=>true]);
