<?php
require_once __DIR__ . '/config-util.php';
require_once __DIR__ . '/db.php';
require_method('GET');
$plan_id = safe_int($_GET['plan_id'] ?? null);
if (!$plan_id) error_response('Missing or invalid plan_id', 400);
$pdo = db();
$stmt = $pdo->prepare('SELECT id, plan_id, issue_id, filename, thumb, created_at FROM photos WHERE plan_id=? ORDER BY created_at DESC');
$stmt->execute([$plan_id]);
$rows = $stmt->fetchAll(PDO::FETCH_ASSOC);
$photos = [];
foreach ($rows as $r) {
	$photos[] = [
		'id' => (int)$r['id'],
		'plan_id' => (int)$r['plan_id'],
		'issue_id' => $r['issue_id'] !== null ? (int)$r['issue_id'] : null,
		'filename' => $r['filename'],
		'url' => '/storage/photos/' . $r['filename'],
		'thumb_url' => $r['thumb'] ? '/storage/' . $r['thumb'] : null,
		'created_at' => $r['created_at']
	];
}
json_response(['ok'=>true, 'photos'=>$photos]);
