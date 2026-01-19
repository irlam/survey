<?php
require_once __DIR__ . '/config-util.php';
require_once __DIR__ . '/db.php';
require_method('GET');
$pdo = db();
$rows = $pdo->query('SELECT * FROM projects ORDER BY created_at DESC')->fetchAll();
json_response(['ok'=>true, 'projects'=>$rows]);
