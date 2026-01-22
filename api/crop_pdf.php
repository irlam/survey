<?php
require_once __DIR__ . '/config-util.php';
require_once __DIR__ . '/db.php';
require_method('POST');

// Accept either multipart/form-data with 'file' OR plan_id
$plan_id = safe_int($_POST['plan_id'] ?? null);
$page = (int)($_POST['page'] ?? 0);
$x_norm = isset($_POST['x_norm']) ? (float)$_POST['x_norm'] : null;
$y_norm = isset($_POST['y_norm']) ? (float)$_POST['y_norm'] : null;
$w_norm = isset($_POST['w_norm']) ? (float)$_POST['w_norm'] : null;
$h_norm = isset($_POST['h_norm']) ? (float)$_POST['h_norm'] : null;
if ($page <= 0) error_response('Missing or invalid page', 400);
if ($x_norm === null || $y_norm === null || $w_norm === null || $h_norm === null) error_response('Missing crop rect', 400);
if ($w_norm <= 0 || $h_norm <= 0) error_response('Invalid crop size', 400);

$sourceFile = null;
$tempUploaded = false;
if (!empty($_FILES['file']) && !empty($_FILES['file']['tmp_name']) && is_uploaded_file($_FILES['file']['tmp_name'])) {
    $sourceFile = $_FILES['file']['tmp_name'];
    $tempUploaded = true;
} elseif ($plan_id) {
    $pdo = db(); $stmt = $pdo->prepare('SELECT * FROM plans WHERE id=?'); $stmt->execute([$plan_id]); $plan = $stmt->fetch(PDO::FETCH_ASSOC);
    if (!$plan) error_response('Plan not found', 404);
    $rel = ltrim($plan['file_path'],'/');
    $sourceFile = storage_dir($rel);
    if (!is_file($sourceFile)) error_response('Plan file missing', 404);
} else {
    error_response('Missing source (plan_id or uploaded file)', 400);
}

// sanity bounds for normalized coords
$x_norm = max(0.0, min(1.0, $x_norm));
$y_norm = max(0.0, min(1.0, $y_norm));
$w_norm = max(0.0, min(1.0, $w_norm));
$h_norm = max(0.0, min(1.0, $h_norm));

// Use FPDI to import the page and crop
if (!file_exists(__DIR__ . '/../vendor/autoload.php')) {
    error_response('FPDI not available: composer autoload missing', 500);
}
require_once __DIR__ . '/../vendor/autoload.php';
if (!class_exists('\setasign\Fpdi\Fpdi')) {
    error_response('FPDI classes not available', 500);
}
try {
    $pdf = new \setasign\Fpdi\Fpdi();
    $pageCount = $pdf->setSourceFile($sourceFile);
    if ($page > $pageCount) error_response('Page out of range', 400);
    $tpl = $pdf->importPage($page);
    $size = $pdf->getTemplateSize($tpl);
    // size has width and height in user unit (default 'mm' for FPDI/FPDF)
    $pageWidth = $size['width'];
    $pageHeight = $size['height'];

    // compute crop in user units. Input coords are normalized against canvas which used top-left origin
    // transform to PDF bottom-left origin
    $x = $x_norm * $pageWidth;
    $y_top = $y_norm * $pageHeight;
    $cropW = $w_norm * $pageWidth;
    $cropH = $h_norm * $pageHeight;
    $y = $pageHeight - $y_top - $cropH; // bottom coordinate

    // create new PDF sized to crop box
    $outPdf = new \setasign\Fpdi\Fpdi();
    $outPdf->AddPage('P', [$cropW, $cropH]);
    // place template shifted so the desired crop region is at the origin
    $outPdf->useTemplate($tpl, -$x, -$y, $pageWidth, $pageHeight);

    // Write output file
    $filename = 'crop_' . ($plan_id ? 'plan_' . $plan_id . '_' : '') . 'page_' . $page . '_' . time() . '.pdf';
    $path = storage_dir('exports/' . $filename);
    $outPdf->Output('F', $path);
    clearstatcache(true, $path);
    if (!is_file($path) || filesize($path) <= 0) error_response('Failed to write output PDF', 500);
    json_response(['ok'=>true, 'filename'=>$filename, 'path'=>$path, 'size'=>filesize($path)]);
} catch (Exception $e) {
    error_log('crop_pdf error: ' . $e->getMessage());
    error_response('Crop failed: ' . $e->getMessage(), 500);
} finally {
    if ($tempUploaded && isset($sourceFile) && is_file($sourceFile)) @unlink($sourceFile);
}
