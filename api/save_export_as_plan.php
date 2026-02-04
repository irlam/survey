<?php
/* api/save_export_as_plan.php - Save export as plan (04/02/2026) */
require_once __DIR__ . '/config-util.php';
require_once __DIR__ . '/db.php';
require_method('POST');
$data = read_json_body();
$filename = $data['filename'] ?? null;
$name = safe_string($data['name'] ?? '', 255);
$revision = safe_string($data['revision'] ?? '', 50);
if (!$filename) error_response('Missing filename', 400);
$src = storage_dir('exports/' . $filename);
if (!is_file($src)) error_response('Export file not found', 404);
$sha = sha1_file($src);
$rand = bin2hex(random_bytes(8));
$destFile = 'plans/plan_' . substr($sha, 0, 8) . '_' . $rand . '.pdf';
$dest = storage_dir($destFile);
ensure_dir(dirname($dest));
if (!@rename($src, $dest)) {
    // fallback copy
    if (!@copy($src, $dest)) error_response('Failed to move export to plans storage', 500);
    @unlink($src);
}
// insert plan row
$pdo = db();
$stmt = $pdo->prepare('INSERT INTO plans (name, revision, file_path, sha1) VALUES (?, ?, ?, ?)');
if ($name === '') $name = 'Imported plan ' . date('d/m/Y H:i');
$stmt->execute([$name, $revision ?: null, $destFile, $sha]);
$plan_id = (int)$pdo->lastInsertId();
json_response(['ok'=>true, 'plan'=>['id'=>$plan_id,'name'=>$name,'file_path'=>$destFile,'sha1'=>$sha]]);
