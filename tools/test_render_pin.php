<?php
require_once __DIR__ . '/../api/export_report.php';

// Create a simple PNG to act as a plan file (write from embedded base64 to avoid GD dependency)
$tempPng = sys_get_temp_dir() . '/test_plan_' . bin2hex(random_bytes(6)) . '.png';
$pngBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAYAAACqaXHeAAAACXBIWXMAAAsSAAALEgHS3X78AAAA
B3RJTUUH5AQDCR8m4mB2kwAAAB1pVFh0Q29tbWVudAAAAAAAvK6ymQAAABl0RVh0U29mdHdhcmUA
QWRvYmUgSW1hZ2VSZWFkeXHJZTwAAABFSURBVHja7cEBDQAAAMKg909tDjegAAAAAAAAAAAAAAAA
AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAADwGQXAAAGV1OzJAAAAAElFTkSuQmCC';
file_put_contents($tempPng, base64_decode($pngBase64));

// Try multiple coordinates
$tests = [
    [0.5, 0.5],
    [0.1, 0.9],
    [0.9, 0.2],
];

$results = [];
foreach ($tests as $t) {
    list($x, $y) = $t;
    $res = render_pin_thumbnail($tempPng, 1, $x, $y, 400);
    $ok = false; $info = null;
    if (is_array($res) && isset($res['tmp']) && is_file($res['tmp'])) {
        $ok = true;
        $info = ['method' => ($res['method'] ?? 'unknown'), 'size' => filesize($res['tmp'])];
        // clean up generated tmp file
        unlink($res['tmp']);
    }
    $results[] = ['x'=>$x,'y'=>$y,'ok'=>$ok,'info'=>$info];
}

// Remove test plan file
@unlink($tempPng);

header('Content-Type: application/json');
echo json_encode(['ok'=>true,'results'=>$results], JSON_PRETTY_PRINT);
