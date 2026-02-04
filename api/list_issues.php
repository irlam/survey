<?php
/* api/list_issues.php - List issues for a plan (04/02/2026) */
require_once __DIR__ . '/config-util.php';
require_once __DIR__ . '/db.php';
require_method('GET');
$plan_id = safe_int($_GET['plan_id'] ?? null);
$pdo = db();
if ($plan_id) {
  $stmt = $pdo->prepare('SELECT issues.*, plans.name AS plan_name FROM issues LEFT JOIN plans ON issues.plan_id=plans.id WHERE plan_id=? ORDER BY created_at ASC');
  $stmt->execute([$plan_id]);
} else {
  // Tooling endpoint: allow listing all issues when plan_id is omitted
  $stmt = $pdo->query('SELECT issues.*, plans.name AS plan_name FROM issues LEFT JOIN plans ON issues.plan_id=plans.id ORDER BY created_at DESC');
}
$rows = $stmt->fetchAll();
$rows = format_dates_in_rows($rows);
// Ensure compatibility: older code expects `notes` field, whereas DB uses `description`.
foreach ($rows as &$r) {
  if (isset($r['description']) && !isset($r['notes'])) $r['notes'] = $r['description'];
  if (isset($r['assigned_to']) && !isset($r['assignee'])) $r['assignee'] = $r['assigned_to'];
}
unset($r);
json_response(['ok'=>true, 'issues'=>$rows]);
