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
$cols = $pdo->query("SHOW COLUMNS FROM files")->fetchAll(PDO::FETCH_COLUMN);
$hasPlanId = in_array('plan_id', $cols, true);
$hasLinkedPlanId = in_array('linked_plan_id', $cols, true);
$hasFilename = in_array('filename', $cols, true);
$hasFilePath = in_array('file_path', $cols, true);
$hasName = in_array('name', $cols, true);
$hasOriginal = in_array('original_name', $cols, true);
$hasDeletedAt = in_array('deleted_at', $cols, true);
$hasUpdatedAt = in_array('updated_at', $cols, true);

$selectCols = ['id'];
if ($hasFilename) $selectCols[] = 'filename';
if ($hasFilePath) $selectCols[] = 'file_path';
if ($hasName) $selectCols[] = 'name';
if ($hasOriginal) $selectCols[] = 'original_name';
$where = [];
$params = [$id];
if ($hasPlanId) $where[] = 'plan_id IS NULL';
if ($hasLinkedPlanId) $where[] = 'linked_plan_id IS NULL';
if ($hasDeletedAt) $where[] = 'deleted_at IS NULL';
$stmt = $pdo->prepare('SELECT '.implode(',', $selectCols).' FROM files WHERE id=?'.($where ? ' AND ' . implode(' AND ', $where) : ''));
$stmt->execute($params);
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
$dir = 'files';
if ($hasFilePath && !empty($row['file_path'])) {
    $dir = trim(dirname($row['file_path']), '/');
    if ($dir === '' || $dir === '.') $dir = 'files';
}
$dest = storage_dir($dir . '/' . $target);
$counter = 1;
while (file_exists($dest)) {
    $target = $base . '-' . $counter . '.' . $ext;
    $dest = storage_dir($dir . '/' . $target);
    $counter++;
    if ($counter > 200) error_response('Failed to find unique filename', 500);
}

$oldRel = $hasFilePath ? ($row['file_path'] ?? '') : ('files/' . ($row['filename'] ?? ''));
$oldPath = storage_dir($oldRel);
if (!file_exists($oldPath)) error_response('Stored file missing', 500);
if (!rename($oldPath, $dest)) error_response('Failed to rename file', 500);

$updFields = [];
$updValues = [];
if ($hasFilename) { $updFields[] = 'filename=?'; $updValues[] = $target; }
if ($hasFilePath) { $updFields[] = 'file_path=?'; $updValues[] = $dir . '/' . $target; }
if ($hasName) { $updFields[] = 'name=?'; $updValues[] = $base; }
if ($hasOriginal) { $updFields[] = 'original_name=?'; $updValues[] = $newName; }
if ($hasUpdatedAt) { $updFields[] = 'updated_at=?'; $updValues[] = date('Y-m-d H:i:s'); }
if ($updFields) {
    $updValues[] = $id;
    $upd = $pdo->prepare('UPDATE files SET '.implode(',', $updFields).' WHERE id=?');
    $upd->execute($updValues);
}

json_response(['ok'=>true, 'filename'=>$target]);
