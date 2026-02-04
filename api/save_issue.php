<?php
/* api/save_issue.php - Create/update issue records (04/02/2026) */
require_once __DIR__ . '/config-util.php';
require_once __DIR__ . '/db.php';

require_method('POST');
$data = read_json_body();
$cfg = load_config();
$debug = !empty($cfg['debug']);

$plan_id = safe_int($data['plan_id'] ?? null);
$id      = safe_int($data['id'] ?? null);

$page    = safe_int($data['page'] ?? 1);
$x_norm  = isset($data['x_norm']) ? (float)$data['x_norm'] : null;
$y_norm  = isset($data['y_norm']) ? (float)$data['y_norm'] : null;

$title   = safe_string($data['title'] ?? '', 255);
$notes   = safe_string($data['notes'] ?? ($data['description'] ?? ''), 5000);

$category    = safe_string($data['category'] ?? 'Other', 50);
$status      = safe_string($data['status'] ?? 'Open', 50);
$priority    = safe_string($data['priority'] ?? 'Medium', 20);
$trade       = safe_string($data['trade'] ?? '', 100);
$assigned_to = safe_string($data['assigned_to'] ?? '', 100);
$due_date    = safe_string($data['due_date'] ?? '', 20);

$trade = trim($trade) !== '' ? $trade : null;
$assigned_to = trim($assigned_to) !== '' ? $assigned_to : null;
$due_date = trim($due_date) !== '' ? $due_date : null;

// Validate required fields
if (!$plan_id) error_response('Missing or invalid plan_id', 400);
if ($page < 1) error_response('Invalid page', 400);
if ($x_norm === null || $y_norm === null) error_response('Missing x_norm/y_norm', 400);
if ($x_norm < 0 || $x_norm > 1 || $y_norm < 0 || $y_norm > 1) {
  error_response('x_norm/y_norm must be between 0 and 1', 400);
}
// For new issues require a non-empty title; for updates we'll prefer the existing title if client leaves it blank
if (!$id && trim($title) === '') error_response('Title is required', 400);

// Validate status/category/priority to known sets (server-side enforcement)
$allowed_status = ['Open', 'In Progress', 'Closed'];
if (!in_array($status, $allowed_status, true)) $status = 'Open';

$allowed_priority = ['Low', 'Medium', 'High'];
if (!in_array($priority, $allowed_priority, true)) $priority = 'Medium';

$allowed_category = ['Safety','Quality','Design','Access','MEP','Fire','Snag','Other'];
if (!in_array($category, $allowed_category, true)) $category = 'Other';

// Validate due_date if provided (YYYY-MM-DD)
if ($due_date !== null && !preg_match('/^\d{4}-\d{2}-\d{2}$/', $due_date)) {
  error_response('due_date must be YYYY-MM-DD', 400);
}

$pdo = db();

// Ensure plan exists
$chk = $pdo->prepare('SELECT id FROM plans WHERE id=?');
$chk->execute([$plan_id]);
if (!$chk->fetch()) error_response('Plan not found', 404);

if ($id) {
  // Update existing issue (must belong to plan)
  $chk2 = $pdo->prepare('SELECT id FROM issues WHERE id=? AND plan_id=?');
  $chk2->execute([$id, $plan_id]);
  if (!$chk2->fetch()) error_response('Issue not found for this plan', 404);

  // If client left title blank on update, preserve existing title if present
  if (trim($title) === '') {
    $cur = $pdo->prepare('SELECT title FROM issues WHERE id=? AND plan_id=?');
    $cur->execute([$id, $plan_id]);
    $row = $cur->fetch();
    if ($row && trim($row['title']) !== '') {
      $title = $row['title'];
    } else {
      error_response('Title is required', 400);
    }
  }

  $stmt = $pdo->prepare('
    UPDATE issues
    SET page=?, x_norm=?, y_norm=?, title=?, notes=?, category=?, status=?, priority=?,
        trade=?, assigned_to=?, due_date=?, updated_at=NOW()
    WHERE id=? AND plan_id=?
  ');
  $stmt->execute([
    $page, $x_norm, $y_norm, $title, $notes, $category, $status, $priority,
    $trade, $assigned_to, $due_date, $id, $plan_id
  ]);

  $out = $pdo->prepare('SELECT * FROM issues WHERE id=?');
  $out->execute([$id]);
  $issue = $out->fetch();
  if (is_array($issue)) $issue = format_dates_in_row($issue);

  json_response(['ok' => true, 'issue' => $issue, 'updated' => true], 200);

} else {
  // Create new issue — allocate next issue_no per plan (transaction + row lock)
  try {
    $pdo->beginTransaction();
    $stmtNo = $pdo->prepare('SELECT issue_no FROM issues WHERE plan_id=? ORDER BY issue_no DESC LIMIT 1 FOR UPDATE');
    $stmtNo->execute([$plan_id]);
    $row = $stmtNo->fetch();
    $next_no = $row ? ((int)$row['issue_no'] + 1) : 1;

    $stmt = $pdo->prepare('
      INSERT INTO issues
        (plan_id, issue_no, page, x_norm, y_norm, title, notes, category, status, priority, trade, assigned_to, due_date)
      VALUES
        (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ');
    $stmt->execute([
      $plan_id, $next_no, $page, $x_norm, $y_norm, $title, $notes, $category, $status, $priority,
      $trade, $assigned_to, $due_date
    ]);
    $pdo->commit();
  } catch (Throwable $e) {
    if ($pdo->inTransaction()) $pdo->rollBack();
    $extra = $debug ? ['detail' => $e->getMessage()] : [];
    error_response('Failed to save issue', 500, $extra);
  }

  $new_id = (int)$pdo->lastInsertId();
  $out = $pdo->prepare('SELECT * FROM issues WHERE id=?');
  $out->execute([$new_id]);
  $issue = $out->fetch();
  if (is_array($issue)) $issue = format_dates_in_row($issue);

  json_response(['ok' => true, 'issue' => $issue, 'created' => true], 201);
}
