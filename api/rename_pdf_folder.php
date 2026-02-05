<?php
/* api/rename_pdf_folder.php - Rename a PDF folder (02/05/2026) */
require_once __DIR__ . '/config-util.php';
require_once __DIR__ . '/db.php';
require_method('POST');

$body = read_json_body();
$id = safe_int($body['id'] ?? null);
$name = safe_string($body['name'] ?? '', 255);
if (!$id) error_response('Folder id required', 400);
if ($name === '') error_response('Folder name required', 400);

$pdo = db();
$stmt = $pdo->prepare('UPDATE pdf_folders SET name=? WHERE id=? AND deleted_at IS NULL');
$stmt->execute([$name, $id]);
if ($stmt->rowCount() === 0) error_response('Folder not found', 404);
json_response(['ok'=>true]);
