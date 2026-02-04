<?php
/* api/create_drawing.php - Attach plan to project (04/02/2026) */
require_once __DIR__ . '/config-util.php';
require_once __DIR__ . '/db.php';

require_method('POST');

$data = read_json_body();

$project_id = safe_int($data['project_id'] ?? null);
$plan_id    = safe_int($data['plan_id'] ?? null);
$ordering   = safe_int($data['ordering'] ?? 0);

if (!$project_id) error_response('Missing or invalid project_id', 400);
if (!$plan_id) error_response('Missing or invalid plan_id', 400);

$pdo = db();

// Ensure project exists
$chk = $pdo->prepare('SELECT id FROM projects WHERE id=?');
$chk->execute([$project_id]);
if (!$chk->fetch()) error_response('Project not found', 404);

// Ensure plan exists
$chk2 = $pdo->prepare('SELECT id FROM plans WHERE id=?');
$chk2->execute([$plan_id]);
if (!$chk2->fetch()) error_response('Plan not found', 404);

// Prevent duplicates (same plan attached twice to same project)
$dup = $pdo->prepare('SELECT id FROM drawings WHERE project_id=? AND plan_id=?');
$dup->execute([$project_id, $plan_id]);
$existing = $dup->fetch();
if ($existing) {
  error_response('This plan is already attached to the project', 409, ['drawing_id' => (int)$existing['id']]);
}

$stmt = $pdo->prepare('INSERT INTO drawings (project_id, plan_id, ordering) VALUES (?, ?, ?)');
$stmt->execute([$project_id, $plan_id, $ordering]);

$drawing_id = (int)$pdo->lastInsertId();

$out = $pdo->prepare('
  SELECT d.id, d.project_id, d.plan_id, d.ordering, d.created_at,
         p.name AS plan_name, p.revision AS plan_revision, p.uploaded_at AS plan_uploaded_at
  FROM drawings d
  JOIN plans p ON p.id = d.plan_id
  WHERE d.id=?
');
$out->execute([$drawing_id]);
$drawing = $out->fetch();
if (is_array($drawing)) $drawing = format_dates_in_row($drawing);

json_response(['ok' => true, 'drawing' => $drawing, 'created' => true], 201);
