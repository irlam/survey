<?php
/* api/list_drawings.php - List drawings in a project (04/02/2026) */
require_once __DIR__ . '/config-util.php';
require_once __DIR__ . '/db.php';

require_method('GET');

$project_id = safe_int($_GET['project_id'] ?? null);
if (!$project_id) error_response('Missing or invalid project_id', 400);

$pdo = db();

// Ensure project exists
$chk = $pdo->prepare('SELECT id FROM projects WHERE id=?');
$chk->execute([$project_id]);
if (!$chk->fetch()) error_response('Project not found', 404);

$st = $pdo->prepare('
  SELECT d.id, d.project_id, d.plan_id, d.ordering, d.created_at,
         p.name AS plan_name, p.revision AS plan_revision, p.uploaded_at AS plan_uploaded_at
  FROM drawings d
  JOIN plans p ON p.id = d.plan_id
  WHERE d.project_id=?
  ORDER BY d.ordering ASC, d.created_at ASC
');
$st->execute([$project_id]);
$rows = $st->fetchAll();

// format any date fields
foreach ($rows as &$r) {
    if (isset($r['created_at'])) $r['created_at'] = format_date_field('created_at', $r['created_at']);
    if (isset($r['plan_uploaded_at'])) $r['plan_uploaded_at'] = format_date_field('uploaded_at', $r['plan_uploaded_at']);
}

json_response(['ok' => true, 'drawings' => $rows]);
