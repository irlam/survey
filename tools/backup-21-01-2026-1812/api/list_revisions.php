<?php
require_once __DIR__ . '/config-util.php';
require_once __DIR__ . '/db.php';

require_method('GET');

$drawing_id = safe_int($_GET['drawing_id'] ?? null);
if (!$drawing_id) error_response('Missing or invalid drawing_id', 400);

$pdo = db();

// Ensure drawing exists
$chk = $pdo->prepare('SELECT id FROM drawings WHERE id=?');
$chk->execute([$drawing_id]);
if (!$chk->fetch()) error_response('Drawing not found', 404);

$st = $pdo->prepare('
  SELECT id, drawing_id, created_at
  FROM revisions
  WHERE drawing_id=?
  ORDER BY created_at DESC
');
$st->execute([$drawing_id]);
$rows = $st->fetchAll();

json_response(['ok' => true, 'revisions' => $rows]);
