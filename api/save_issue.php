<?php
require_once __DIR__ . '/config-util.php';
require_once __DIR__ . '/db.php';

require_method('POST');

$data = read_json_body();

$plan_id = safe_int($data['plan_id'] ?? null);
$id      = safe_int($data['id'] ?? null);

$page    = safe_int($data['page'] ?? 1);
$x_norm  = isset($data['x_norm']) ? floatval($data['x_norm']) : null;
$y_norm  = isset($data['y_norm']) ? floatval($data['y_norm']) : null;

$title   = safe_string($data['title'] ?? '', 255);
$desc    = safe_string($data['description'] ?? '', 2000);

// Status normalization
$status  = safe_string($data['status'] ?? 'open', 32);
$status  = strtolower(trim($status));
$allowed_status = ['open', 'in_progress', 'closed'];
if (!in_array($status, $allowed_status, true)) {
  $status = 'open';
}

// Validation
if (!$plan_id) error_response('Missing or invalid plan_id', 400);
if ($page < 1) error_response('Invalid page', 400);
if ($x_norm === null || $y_norm === null) error_response('Missing x_norm/y_norm', 400);

// normalized coords must be within 0..1
if ($x_norm < 0 || $x_norm > 1 || $y_norm < 0 || $y_norm > 1) {
  error_response('x_norm/y_norm must be between 0 and 1', 400);
}

if ($title === '') error_response('Title is required', 400);

$pdo = db();

// Ensure plan exists
$chk = $pdo->prepare('SELECT id FROM plans WHERE id=?');
$chk->execute([$plan_id]);
if (!$chk->fetch()) error_response('Plan not found', 404);

if ($id) {
  // Ensure issue exists and belongs to plan
  $chk2 = $pdo->prepare('SELECT id FROM issues WHERE id=? AND plan_id=?');
  $chk2->execute([$id, $plan_id]);
  if (!$chk2->fetch()) error_response('Issue not found for this plan', 404);

  $stmt = $pdo->prepare('
    UPDATE issues
    SET x_norm=?, y_norm=?, page=?, title=?, description=?, status=?, updated_at=NOW()
    WHERE id=? AND plan_id=?
  ');
  $stmt->execute([$x_norm, $y_norm, $page, $title, $desc, $status, $id, $plan_id]);

  $out = $pdo->prepare('SELECT * FROM issues WHERE id=?');
  $out->execute([$id]);
  $issue = $out->fetch();

  json_response(['ok' => true, 'issue' => $issue, 'updated' => true], 200);
} else {
  // Create
  $stmt = $pdo->prepare('
    INSERT INTO issues (plan_id, x_norm, y_norm, page, title, description, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, NOW(), NOW())
  ');
  $stmt->execute([$plan_id, $x_norm, $y_norm, $page, $title, $desc, $status]);

  $new_id = (int)$pdo->lastInsertId();
  $out = $pdo->prepare('SELECT * FROM issues WHERE id=?');
  $out->execute([$new_id]);
  $issue = $out->fetch();

  json_response(['ok' => true, 'issue' => $issue, 'created' => true], 201);
}
