<?php
// Milestone 2: List plans endpoint stub
require_once __DIR__ . '/config-util.php';
require_once __DIR__ . '/db.php';
require_method('GET');
$pdo = db();
$rows = $pdo->query('SELECT id, name, filename, revision, created_at FROM plans ORDER BY created_at DESC')->fetchAll();
json_response(['ok'=>true, 'plans'=>$rows]);