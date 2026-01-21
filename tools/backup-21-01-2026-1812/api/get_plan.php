<?php
require_once __DIR__ . '/config-util.php';
require_once __DIR__ . '/db.php';

require_method('GET');

$plan_id = safe_int($_GET['plan_id'] ?? null);
if (!$plan_id) error_response('Missing or invalid plan_id', 400);

$pdo = db();
$stmt = $pdo->prepare('
  SELECT id, name, revision, file_path, sha1, uploaded_at
  FROM plans
  WHERE id=?
');
$stmt->execute([$plan_id]);
$plan = $stmt->fetch();

if (!$plan) error_response('Plan not found', 404);

$pdf_url = base_url() . '/api/plan_file.php?plan_id=' . $plan_id;

json_response([
  'ok' => true,
  'plan' => $plan,
  'pdf_url' => $pdf_url
]);
