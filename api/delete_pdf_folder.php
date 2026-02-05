<?php
/* api/delete_pdf_folder.php - Soft delete a PDF folder and contents (02/05/2026) */
require_once __DIR__ . '/config-util.php';
require_once __DIR__ . '/db.php';
require_method('POST');

$body = read_json_body();
$id = safe_int($body['id'] ?? null);
if (!$id) error_response('Folder id required', 400);

$pdo = db();
$chk = $pdo->prepare('SELECT id FROM pdf_folders WHERE id=? AND deleted_at IS NULL');
$chk->execute([$id]);
if (!$chk->fetch()) error_response('Folder not found', 404);

// Build descendant list
$allStmt = $pdo->query('SELECT id, parent_id FROM pdf_folders WHERE deleted_at IS NULL');
$rows = $allStmt->fetchAll();
$children = [];
foreach ($rows as $r) {
    $pid = $r['parent_id'] ? (int)$r['parent_id'] : 0;
    if (!isset($children[$pid])) $children[$pid] = [];
    $children[$pid][] = (int)$r['id'];
}
$queue = [$id];
$ids = [];
while ($queue) {
    $cur = array_shift($queue);
    if (in_array($cur, $ids, true)) continue;
    $ids[] = $cur;
    if (isset($children[$cur])) {
        foreach ($children[$cur] as $child) $queue[] = $child;
    }
}

$placeholders = implode(',', array_fill(0, count($ids), '?'));
$now = date('Y-m-d H:i:s');
$pdo->beginTransaction();
try {
    $stmt = $pdo->prepare("UPDATE pdf_folders SET deleted_at=? WHERE id IN ($placeholders)");
    $stmt->execute(array_merge([$now], $ids));
    $stmt2 = $pdo->prepare("UPDATE files SET deleted_at=? WHERE plan_id IS NULL AND folder_id IN ($placeholders)");
    $stmt2->execute(array_merge([$now], $ids));
    $pdo->commit();
} catch (Exception $e) {
    $pdo->rollBack();
    error_response('Failed to delete folder', 500);
}

json_response(['ok'=>true]);
