<?php
require_once __DIR__ . '/config-util.php';
require_once __DIR__ . '/db.php';
require_method('POST');
$data = read_json_body();
$plan_id = safe_int($data['plan_id'] ?? null);
$x_norm = floatval($data['x_norm'] ?? null);
$y_norm = floatval($data['y_norm'] ?? null);
$page = safe_int($data['page'] ?? 1);
$title = safe_string($data['title'] ?? '', 255);
$desc = safe_string($data['description'] ?? '', 1000);
$status = safe_string($data['status'] ?? 'open', 32);
$id = safe_int($data['id'] ?? null);
if (!$plan_id || $x_norm < 0 || $y_norm < 0 || !$title) error_response('Missing or invalid fields', 400);
$pdo = db();
if ($id) {
    $stmt = $pdo->prepare('UPDATE issues SET x_norm=?, y_norm=?, page=?, title=?, description=?, status=?, updated_at=NOW() WHERE id=? AND plan_id=?');
    $stmt->execute([$x_norm, $y_norm, $page, $title, $desc, $status, $id, $plan_id]);
    json_response(['ok'=>true, 'id'=>$id, 'updated'=>true]);
} else {
    $stmt = $pdo->prepare('INSERT INTO issues (plan_id, x_norm, y_norm, page, title, description, status) VALUES (?, ?, ?, ?, ?, ?, ?)');
    $stmt->execute([$plan_id, $x_norm, $y_norm, $page, $title, $desc, $status]);
    json_response(['ok'=>true, 'id'=>$pdo->lastInsertId(), 'created'=>true]);
}
