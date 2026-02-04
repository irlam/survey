<?php
/* api/list_exports.php - List export records (04/02/2026) */
require_once __DIR__ . '/config-util.php';
require_once __DIR__ . '/db.php';
require_method('GET');
$plan_id = safe_int($_GET['plan_id'] ?? null);
$pdo = db();
if ($plan_id) {
    $stmt = $pdo->prepare('SELECT * FROM exports WHERE plan_id=? ORDER BY created_at DESC');
    $stmt->execute([$plan_id]);
    $rows = $stmt->fetchAll();
} else {
    $rows = $pdo->query('SELECT * FROM exports ORDER BY created_at DESC')->fetchAll();
}
$rows = format_dates_in_rows($rows);
json_response(['ok'=>true, 'exports'=>$rows]);
