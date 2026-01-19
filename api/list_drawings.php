<?php
require_once __DIR__ . '/config-util.php';
require_once __DIR__ . '/db.php';
require_method('GET');
$project_id = safe_int($_GET['project_id'] ?? null);
if (!$project_id) error_response('Missing project_id', 400);
$pdo = db();
$stmt = $pdo->prepare('SELECT * FROM drawings WHERE project_id=? ORDER BY ordering ASC');
$stmt->execute([$project_id]);
json_response(['ok'=>true, 'drawings'=>$stmt->fetchAll()]);
