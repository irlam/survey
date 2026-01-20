<?php
require_once __DIR__ . '/config-util.php';
require_once __DIR__ . '/db.php';

require_method('POST');

$data = read_json_body();

$drawing_id = safe_int($data['drawing_id'] ?? null);
if (!$drawing_id) error_response('Missing or invalid drawing_id', 400);

// Accept state object OR state_json string
$state_json = null;

if (isset($data['state']) && (is_array($data['state']) || is_object($data['state']))) {
  $state_json = json_encode($data['state'], JSON_UNESCAPED_SLASHES);
} elseif (isset($data['state_json']) && is_string($data['state_json'])) {
  $candidate = trim($data['state_json']);
  if ($candidate === '') error_response('state_json is empty', 400);

  json_decode($candidate);
  if (json_last_error() !== JSON_ERROR_NONE) {
    error_response('state_json is not valid JSON', 400);
  }
  $state_json = $candidate;
} else {
  error_response('Missing state (object) or state_json (string)', 400);
}

$pdo = db();

// Ensure drawing exists
$chk = $pdo->prepare('SELECT id FROM drawings WHERE id=?');
$chk->execute([$drawing_id]);
if (!$chk->fetch()) error_response('Drawing not found', 404);

// Insert revision
$stmt = $pdo->prepare('INSERT INTO revisions (drawing_id, state_json) VALUES (?, ?)');
$stmt->execute([$drawing_id, $state_json]);

$rev_id = (int)$pdo->lastInsertId();

$out = $pdo->prepare('SELECT id, drawing_id, created_at FROM revisions WHERE id=?');
$out->execute([$rev_id]);
$rev = $out->fetch();

json_response(['ok' => true, 'revision' => $rev, 'created' => true], 201);
