<?php
require_once __DIR__ . '/config-util.php';
require_once __DIR__ . '/db.php';

require_method('GET');

$revision_id = safe_int($_GET['revision_id'] ?? null);
if (!$revision_id) error_response('Missing or invalid revision_id', 400);

$pdo = db();

$st = $pdo->prepare('SELECT id, drawing_id, state_json, created_at FROM revisions WHERE id=?');
$st->execute([$revision_id]);
$rev = $st->fetch();

if (!$rev) error_response('Revision not found', 404);

json_response(['ok' => true, 'revision' => $rev]);
