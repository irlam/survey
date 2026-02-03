<?php
require_once __DIR__ . '/config-util.php';
require_once __DIR__ . '/db.php';
require_method('GET');
$plan_id = safe_int($_GET['plan_id'] ?? null);
$pdo = db();
if (!$plan_id) error_response('Missing or invalid plan_id', 400);
$stmt = $pdo->prepare('SELECT issues.*, plans.name AS plan_name FROM issues LEFT JOIN plans ON issues.plan_id=plans.id WHERE plan_id=? ORDER BY created_at ASC');
$stmt->execute([$plan_id]);
$rows = $stmt->fetchAll();
$rows = format_dates_in_rows($rows);
// Ensure compatibility: older code expects `notes` field, whereas DB uses `description`.
foreach ($rows as &$r) {
  if (isset($r['description']) && !isset($r['notes'])) $r['notes'] = $r['description'];
}
unset($r);
json_response(['ok'=>true, 'issues'=>$rows]);
