<?php
require_once __DIR__ . '/config-util.php';
require_once __DIR__ . '/db.php';

require_method('GET');

$pdo = db();
$rows = $pdo->query('
  SELECT id, name, created_at
  FROM projects
  ORDER BY created_at DESC
')->fetchAll();

$rows = format_dates_in_rows($rows);
json_response(['ok' => true, 'projects' => $rows]);
