<?php
require_once __DIR__ . '/config-util.php';
require_once __DIR__ . '/db.php';
require_method('GET');
$plan_id = safe_int($_GET['plan_id'] ?? null);
$pdo = db();
if ($plan_id) {
  // list issues for a specific plan
  $stmt = $pdo->prepare('SELECT * FROM issues WHERE plan_id=? ORDER BY created_at ASC');
  $stmt->execute([$plan_id]);
} else {
  // no plan_id supplied — return all issues (useful for admin/tools views)
  $stmt = $pdo->query('SELECT * FROM issues ORDER BY created_at ASC');
}
$rows = $stmt->fetchAll();
$rows = format_dates_in_rows($rows);
// Ensure compatibility: older code expects `notes` field, whereas DB uses `description`.
foreach ($rows as &$r) {
  if (isset($r['description']) && !isset($r['notes'])) $r['notes'] = $r['description'];
}
unset($r);
json_response(['ok'=>true, 'issues'=>$rows]);
