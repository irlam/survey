<?php
/* api/list_plans.php - List plan records (04/02/2026) */
require_once __DIR__ . '/config-util.php';
require_once __DIR__ . '/db.php';

require_method('GET');

$pdo = db();
$stmt = $pdo->query('
  SELECT id, name, revision, file_path, sha1, uploaded_at
  FROM plans
  ORDER BY uploaded_at DESC
');
$plans = $stmt->fetchAll();

$plans = format_dates_in_rows($plans);
json_response(['ok' => true, 'plans' => $plans]);
