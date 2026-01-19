<?php
require_once __DIR__ . '/config-util.php';
require_once __DIR__ . '/db.php';
require_method('POST');
$data = read_json_body();
$name = safe_string($data['name'] ?? '', 255);
if (!$name) error_response('Missing name', 400);
$pdo = db();
$stmt = $pdo->prepare('INSERT INTO projects (name) VALUES (?)');
$stmt->execute([$name]);
json_response(['ok'=>true, 'id'=>$pdo->lastInsertId()]);
