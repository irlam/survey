<?php
// Milestone 2: Stream plan PDF file stub
require_once __DIR__ . '/config-util.php';
require_once __DIR__ . '/db.php';
require_method('GET');
$plan_id = safe_int($_GET['plan_id'] ?? null);
if (!$plan_id) {
	http_response_code(400); echo 'Missing plan_id'; exit;
}
$pdo = db();
$stmt = $pdo->prepare('SELECT filename FROM plans WHERE id=?');
$stmt->execute([$plan_id]);
$row = $stmt->fetch();
if (!$row) {
	http_response_code(404); echo 'Plan not found'; exit;
}
$file = storage_dir('plans/' . $row['filename']);
if (!is_file($file)) {
	http_response_code(404); echo 'File not found'; exit;
}
$size = filesize($file);
header('Content-Type: application/pdf');
header('Content-Disposition: inline; filename="plan.pdf"');
header('Accept-Ranges: bytes');
if (isset($_SERVER['HTTP_RANGE'])) {
	$range = $_SERVER['HTTP_RANGE'];
	if (preg_match('/bytes=(\d+)-(\d*)/', $range, $m)) {
		$start = intval($m[1]);
		$end = ($m[2] !== '') ? intval($m[2]) : $size-1;
		if ($start > $end || $end >= $size) {
			http_response_code(416); exit;
		}
		header('HTTP/1.1 206 Partial Content');
		header("Content-Range: bytes $start-$end/$size");
		header('Content-Length: ' . ($end-$start+1));
		$fp = fopen($file, 'rb');
		fseek($fp, $start);
		$to_send = $end-$start+1;
		while ($to_send > 0 && !feof($fp)) {
			$chunk = fread($fp, min(8192, $to_send));
			echo $chunk;
			$to_send -= strlen($chunk);
		}
		fclose($fp);
		exit;
	}
}
header('Content-Length: ' . $size);
readfile($file);
exit;