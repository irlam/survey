<?php
/* api/rename_generic_pdf.php - Rename a general PDF (02/05/2026) */
require_once __DIR__ . '/config-util.php';
require_once __DIR__ . '/db.php';
require_method('POST');

$body = read_json_body();
$id = safe_int($body['id'] ?? null);
$newName = safe_string($body['name'] ?? '', 255);
if (!$id) error_response('File id required', 400);
if ($newName === '') error_response('Name required', 400);

$pdo = db();
$stmt = $pdo->prepare('SELECT id, filename, original_name FROM files WHERE id=? AND plan_id IS NULL AND deleted_at IS NULL');
$stmt->execute([$id]);
$row = $stmt->fetch();
if (!$row) error_response('File not found', 404);

function sanitize_filename($name){
    $name = trim($name);
    $name = preg_replace('/[^a-zA-Z0-9._-]+/', '_', $name);
    $name = preg_replace('/_+/', '_', $name);
    return $name;
}

$ext = pathinfo($newName, PATHINFO_EXTENSION);
$base = pathinfo($newName, PATHINFO_FILENAME);
$base = sanitize_filename($base);
if ($base === '') error_response('Invalid name', 400);
$ext = $ext ? strtolower($ext) : 'pdf';
if ($ext !== 'pdf') $ext = 'pdf';

$target = $base . '.' . $ext;
$storageBase = resolve_storage_path();
$dest = storage_dir('files/' . $target);
$counter = 1;
while (file_exists($dest)) {
    $target = $base . '-' . $counter . '.' . $ext;
    $dest = storage_dir('files/' . $target);
    $counter++;
    if ($counter > 200) error_response('Failed to find unique filename', 500);
}

$oldPath = storage_dir('files/' . $row['filename']);
if (!file_exists($oldPath)) error_response('Stored file missing', 500);
if (!rename($oldPath, $dest)) error_response('Failed to rename file', 500);

$upd = $pdo->prepare('UPDATE files SET filename=?, original_name=? WHERE id=?');
$upd->execute([$target, $newName, $id]);

json_response(['ok'=>true, 'filename'=>$target]);
