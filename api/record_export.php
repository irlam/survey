<?php
require_once __DIR__ . '/config-util.php';
require_once __DIR__ . '/db.php';
require_method('POST');
$data = read_json_body();
$plan_id = safe_int($data['plan_id'] ?? null);
$filename = safe_string($data['filename'] ?? '', 255);
$type = safe_string($data['type'] ?? '', 32);
if (!$filename) error_response('Missing filename', 400);
$pdo = db();
$stmt = $pdo->prepare('INSERT INTO exports (plan_id, filename, type) VALUES (?, ?, ?)');
$stmt->execute([$plan_id, $filename, $type]);
json_response(['ok'=>true, 'id'=>$pdo->lastInsertId()]);
