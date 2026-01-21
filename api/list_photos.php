<?php
require_once __DIR__ . '/config-util.php';
require_once __DIR__ . '/db.php';
require_method('GET');
$plan_id = safe_int($_GET['plan_id'] ?? null);
if (!$plan_id) error_response('Missing or invalid plan_id', 400);
$pdo = db();
$stmt = $pdo->prepare('SELECT * FROM photos WHERE plan_id=? ORDER BY created_at DESC');
$stmt->execute([$plan_id]);
$rows = $stmt->fetchAll(PDO::FETCH_ASSOC);
$photos = [];
foreach ($rows as $r) {
	// Determine file and thumb columns for compatibility with different schemas
	$fileField = $r['filename'] ?? null;
	$thumbField = $r['thumb'] ?? null;
	if (!$fileField && isset($r['file_path'])) {
		$fileField = basename($r['file_path']);
	}
	if (!$thumbField && isset($r['thumb_path'])) {
		$thumbField = basename($r['thumb_path']);
	}
	$photos[] = [
		'id' => (int)$r['id'],
		'plan_id' => (int)$r['plan_id'],
		'issue_id' => $r['issue_id'] !== null ? (int)$r['issue_id'] : null,
		'filename' => $fileField,
		'url' => $fileField ? '/storage/photos/' . $fileField : null,
		'thumb_url' => $thumbField ? (isset($r['thumb_path']) ? '/storage/' . $r['thumb_path'] : '/storage/photos/' . $thumbField) : null,
		'created_at' => $r['created_at']
	];
}
json_response(['ok'=>true, 'photos'=>$photos]);
