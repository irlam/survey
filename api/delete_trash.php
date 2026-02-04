<?php
/* api/delete_trash.php - Delete trash folder (04/02/2026) */
require_once __DIR__ . '/config-util.php';
require_once __DIR__ . '/db.php';
require_method('POST');
$data = read_json_body();
$trashRel = $data['trash'] ?? null;
if (!$trashRel) error_response('Missing trash', 400);
$base = resolve_storage_path() . '/trash';
$dir = realpath($base . '/' . basename($trashRel));
if (!$dir || strpos($dir, $base) !== 0) error_response('Invalid trash path', 400);
// delete files
$errors = [];
$it = new RecursiveIteratorIterator(new RecursiveDirectoryIterator($dir, RecursiveDirectoryIterator::SKIP_DOTS), RecursiveIteratorIterator::CHILD_FIRST);
foreach ($it as $file) {
  if ($file->isDir()) { @rmdir($file->getPathname()); } else { if (!@unlink($file->getPathname())) $errors[] = 'failed:' . $file->getPathname(); }
}
if (!@rmdir($dir)) $errors[] = 'failed to remove dir';
json_response(['ok'=>count($errors)===0, 'errors'=>$errors]);
