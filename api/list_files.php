<?php
require_once __DIR__ . '/config-util.php';
require_once __DIR__ . '/db.php';
require_method('GET');
$plan_id = safe_int($_GET['plan_id'] ?? null);
if (!$plan_id) error_response('Missing or invalid plan_id', 400);
$pdo = db();
$stmt = $pdo->prepare('SELECT * FROM files WHERE plan_id=? ORDER BY created_at DESC');
$stmt->execute([$plan_id]);
$rows = $stmt->fetchAll();
$rows = format_dates_in_rows($rows);
json_response(['ok'=>true, 'files'=>$rows]);
