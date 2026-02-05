<?php
/* api/create_pdf_folder.php - Create a PDF folder (02/05/2026) */
require_once __DIR__ . '/config-util.php';
require_once __DIR__ . '/db.php';
require_method('POST');

$body = read_json_body();
$name = safe_string($body['name'] ?? '', 255);
$parent_id = safe_int($body['parent_id'] ?? null);
if ($name === '') error_response('Folder name required', 400);

$pdo = db();
if ($parent_id) {
    $chk = $pdo->prepare('SELECT id FROM pdf_folders WHERE id=? AND deleted_at IS NULL');
    $chk->execute([$parent_id]);
    if (!$chk->fetch()) error_response('Parent folder not found', 404);
}

$stmt = $pdo->prepare('INSERT INTO pdf_folders (parent_id, name) VALUES (?, ?)');
$stmt->execute([$parent_id, $name]);
json_response(['ok'=>true, 'folder_id'=>$pdo->lastInsertId()]);
