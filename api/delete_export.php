<?php
require_once __DIR__ . '/config-util.php';
require_once __DIR__ . '/db.php';
require_method('POST');
$data = read_json_body();
$id = safe_int($data['id'] ?? null);
if (!$id) error_response('Missing or invalid id', 400);
$pdo = db();
$stmt = $pdo->prepare('SELECT * FROM exports WHERE id=?');
$stmt->execute([$id]);
$export = $stmt->fetch(PDO::FETCH_ASSOC);
if (!$export) error_response('Export not found', 404);

$filename = $export['filename'];
$exportsDir = storage_dir('exports');
$fullPath = $exportsDir . '/' . $filename;

// prepare trash
$trashTs = date('Ymd_His') . '_' . bin2hex(random_bytes(4));
$trashDir = storage_dir('trash/' . $trashTs);
if (!is_dir($trashDir)) @mkdir($trashDir, 0755, true);

function move_to_trash_file_local($src, $trashDir){
    if (!is_file($src)) return false;
    $leaf = basename($src);
    $dest = rtrim($trashDir, '/') . '/' . $leaf;
    if (@rename($src, $dest)) return $dest;
    if (@copy($src, $dest) && @unlink($src)) return $dest;
    return false;
}

$moved = null;
if (is_file($fullPath)) {
    $moved = move_to_trash_file_local($fullPath, $trashDir);
}

// delete DB row
$del = $pdo->prepare('DELETE FROM exports WHERE id=?');
$del->execute([$id]);
$deleted = ($del->rowCount() > 0);

json_response(['ok'=>true, 'deleted'=>$deleted, 'moved'=>$moved ? str_replace(resolve_storage_path() . '/', '', $moved) : null, 'trash' => str_replace(resolve_storage_path() . '/', '', $trashDir)]);
