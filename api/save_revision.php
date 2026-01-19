<?php
require_once __DIR__ . '/config-util.php';
require_once __DIR__ . '/db.php';
require_method('POST');
$data = read_json_body();
drawing_id = safe_int($data['drawing_id'] ?? null);
$state_json = json_encode($data['state_json'] ?? []);
if (!$drawing_id || !$state_json) error_response('Missing fields', 400);
$pdo = db();
$stmt = $pdo->prepare('INSERT INTO revisions (drawing_id, state_json) VALUES (?, ?)');
$stmt->execute([$drawing_id, $state_json]);
json_response(['ok'=>true, 'id'=>$pdo->lastInsertId()]);
