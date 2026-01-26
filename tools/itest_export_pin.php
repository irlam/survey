<?php
require_once __DIR__ . '/../api/export_report.php'; // defines render_pin_thumbnail

// Simulate a plan and a single issue
$plan = ['id' => 123, 'name' => 'Test Plan', 'file_path' => 'tools/test_plan.png'];
// Ensure storage path exists
$testStoragePlan = storage_dir('plans/test_plan.png');
@mkdir(dirname($testStoragePlan), 0775, true);
// copy test PNG (generate if missing)
if (!is_file($testStoragePlan)) {
    if (function_exists('imagecreatetruecolor')) {
        $w = 1200; $h = 1600;
        $im = imagecreatetruecolor($w, $h);
        $bg = imagecolorallocate($im, 240, 240, 240);
        imagefilledrectangle($im, 0, 0, $w, $h, $bg);
        $black = imagecolorallocate($im, 0, 0, 0);
        imagestring($im, 5, 20, 20, 'Simulated plan for export', $black);
        imagepng($im, $testStoragePlan);
        imagedestroy($im);
    } else {
        copy(__DIR__ . '/test_plan_fallback.png', $testStoragePlan);
    }
}
$issue = ['id' => 999, 'title' => 'Simulated issue', 'page' => 1, 'x_norm' => 0.3, 'y_norm' => 0.6];

// Attempt to render a pin thumbnail and follow export_report embedding steps
$planFile = $testStoragePlan;
$pinImg = render_pin_thumbnail($planFile, $issue['page'] ?? 1, $issue['x_norm'] ?? 0.5, $issue['y_norm'] ?? 0.5, 800, ($issue['id'] ?? null));
$out = ['render_result' => $pinImg];

if (!$pinImg) {
    echo json_encode(['ok'=>false,'error'=>'render_pin_thumbnail_failed','render'=>$pinImg], JSON_PRETTY_PRINT);
    exit(1);
}

$src = is_array($pinImg) ? ($pinImg['tmp'] ?? null) : $pinImg;
$method = is_array($pinImg) ? ($pinImg['method'] ?? null) : null;

if (!$src || !is_file($src)) {
    echo json_encode(['ok'=>false,'error'=>'no_tmp_file','src'=>$src,'render'=>$pinImg], JSON_PRETTY_PRINT);
    exit(1);
}

// Try conversion to jpg like export_report
$jpgTmp = tempnam(sys_get_temp_dir(), 'srp') . '.jpg';
$pngImg = @imagecreatefrompng($src);
if ($pngImg) {
    $w = imagesx($pngImg); $h = imagesy($pngImg);
    $bg = imagecreatetruecolor($w, $h);
    $white = imagecolorallocate($bg, 255,255,255);
    imagefill($bg, 0,0, $white);
    imagecopy($bg, $pngImg, 0,0,0,0, $w, $h);
    imagejpeg($bg, $jpgTmp, 85);
    imagedestroy($bg);
    imagedestroy($pngImg);
} else {
    $jpgTmp = null; // conversion failed
}

$embedPath = $jpgTmp && is_file($jpgTmp) ? $jpgTmp : $src;

// Copy into storage/tmp
$bn2 = 'pin_export_test_' . bin2hex(random_bytes(4)) . '.png';
$dst2 = storage_dir('tmp/' . $bn2);
$copied = @copy($embedPath, $dst2);

$res = ['copied'=>$copied, 'dst'=>$dst2, 'embed'=>$embedPath, 'method'=>$method, 'src'=>$src, 'jpgTmp'=>$jpgTmp];

// Validate resulting file
$res['dst_exists'] = is_file($dst2);
$res['dst_size'] = is_file($dst2) ? filesize($dst2) : null;
$res['dst_valid_image'] = $res['dst_exists'] ? (bool)@getimagesize($dst2) : false;

// Clean up tmp files
if (isset($pinImg['tmp']) && is_file($pinImg['tmp'])) @unlink($pinImg['tmp']);
if ($jpgTmp && is_file($jpgTmp)) @unlink($jpgTmp);

echo json_encode(['ok'=>true,'result'=>$res], JSON_PRETTY_PRINT);
