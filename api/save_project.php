<?php
require_once __DIR__ . '/config-util.php';
require_once __DIR__ . '/db.php';

require_method('POST');

$data = read_json_body();

$id   = safe_int($data['id'] ?? null);
$name = safe_string($data['name'] ?? '', 255);
$name = trim($name);

if ($name === '') error_response('Missing name', 400);

$pdo = db();

if ($id) {
  // Update existing project
  $chk = $pdo->prepare('SELECT id FROM projects WHERE id=?');
  $chk->execute([$id]);
  if (!$chk->fetch()) error_response('Project not found', 404);

  $stmt = $pdo->prepare('UPDATE projects SET name=?, updated_at=NOW() WHERE id=?');
  $stmt->execute([$name, $id]);

  $out = $pdo->prepare('SELECT * FROM projects WHERE id=?');
  $out->execute([$id]);
  $project = $out->fetch();

  json_response(['ok' => true, 'project' => $project, 'updated' => true], 200);
} else {
  // Create new project
  $stmt = $pdo->prepare('INSERT INTO projects (name, created_at, updated_at) VALUES (?, NOW(), NOW())');
  $stmt->execute([$name]);

  $new_id = (int)$pdo->lastInsertId();

  $out = $pdo->prepare('SELECT * FROM projects WHERE id=?');
  $out->execute([$new_id]);
  $project = $out->fetch();

  json_response(['ok' => true, 'project' => $project, 'created' => true], 201);
}
