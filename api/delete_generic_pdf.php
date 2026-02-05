<?php
/* api/delete_generic_pdf.php - Soft delete a general PDF (02/05/2026) */
require_once __DIR__ . '/config-util.php';
require_once __DIR__ . '/db.php';
require_method('POST');

$body = read_json_body();
$id = safe_int($body['id'] ?? null);
if (!$id) error_response('File id required', 400);

$pdo = db();
$cols = $pdo->query("SHOW COLUMNS FROM files")->fetchAll(PDO::FETCH_COLUMN);
$hasPlanId = in_array('plan_id', $cols, true);
$hasLinkedPlanId = in_array('linked_plan_id', $cols, true);
$hasDeletedAt = in_array('deleted_at', $cols, true);
$where = [];
$params = [date('Y-m-d H:i:s'), $id];
if ($hasPlanId) $where[] = 'plan_id IS NULL';
if ($hasLinkedPlanId) $where[] = 'linked_plan_id IS NULL';
if ($hasDeletedAt) $where[] = 'deleted_at IS NULL';

if ($hasDeletedAt) {
	$stmt = $pdo->prepare('UPDATE files SET deleted_at=? WHERE id=?'.($where ? ' AND ' . implode(' AND ', $where) : ''));
	$stmt->execute($params);
} else {
	$stmt = $pdo->prepare('DELETE FROM files WHERE id=?'.($where ? ' AND ' . implode(' AND ', $where) : ''));
	$stmt->execute([$id]);
}
if ($stmt->rowCount() === 0) error_response('File not found', 404);

json_response(['ok'=>true]);
