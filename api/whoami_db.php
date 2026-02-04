<?php
/* api/whoami_db.php - DB identity check (04/02/2026) */
require_once __DIR__ . '/config-util.php';
require_once __DIR__ . '/db.php';

$pdo = db();
$dbname = $pdo->query('SELECT DATABASE() AS db')->fetch()['db'] ?? null;

json_response([
  'ok' => true,
  'connected_db' => $dbname,
  'expected_db' => (load_config()['db']['dbname'] ?? null),
]);
