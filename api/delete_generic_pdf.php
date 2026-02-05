<?php
/* api/delete_generic_pdf.php - Soft delete a general PDF (02/05/2026) */
require_once __DIR__ . '/config-util.php';
require_once __DIR__ . '/db.php';
require_method('POST');

$body = read_json_body();
$id = safe_int($body['id'] ?? null);
if (!$id) error_response('File id required', 400);

$pdo = db();
$stmt = $pdo->prepare('UPDATE files SET deleted_at=? WHERE id=? AND plan_id IS NULL AND deleted_at IS NULL');
$stmt->execute([date('Y-m-d H:i:s'), $id]);
if ($stmt->rowCount() === 0) error_response('File not found', 404);

json_response(['ok'=>true]);
