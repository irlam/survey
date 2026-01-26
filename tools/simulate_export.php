<?php
// tools/simulate_export.php
// Create a small sample PDF like export_report.php using a local test image to validate embedding.
require_once __DIR__ . "/../vendor/autoload.php";
require_once __DIR__ . "/../api/config-util.php";

// create a tiny test PNG into storage/photos/test_sample.png
$photosDir = storage_dir('photos');
$testFile = $photosDir . '/test_sample.png';
if (!is_file($testFile)) {
    // create 160x120 PNG with a simple filled rectangle
    $im = imagecreatetruecolor(160, 120);
    $bg = imagecolorallocate($im, 3, 45, 60);
    $fg = imagecolorallocate($im, 0, 255, 231);
    imagefilledrectangle($im, 0, 0, 159, 119, $bg);
    imagestring($im, 5, 12, 46, 'Sample Photo', $fg);
    imagepng($im, $testFile);
    imagedestroy($im);
    echo "Created sample image: $testFile\n";
} else {
    echo "Sample image exists: $testFile\n";
}

// ensure export dir
$exportDir = storage_dir('exports');
$filename = 'sim_report_' . time() . '.pdf';
$path = $exportDir . '/' . $filename;

// create PDF
$pdf = new \setasign\Fpdf\Fpdf();
$pdf->AddPage();
$pdf->SetFont('Arial','B',14);
$pdf->Cell(0,10,'Simulated Survey Report',0,1,'C');
$pdf->Ln(4);
$pdf->SetFont('Arial','B',12);
$pdf->Cell(0,8,'Issue: Sample Issue with Photo',0,1);
$pdf->Ln(3);
$pdf->SetFont('Arial','',11);
$pdf->MultiCell(0,6,'Notes: This is a simulated issue used to verify image embedding in generated PDF.');
$pdf->Ln(4);

// insert image (thumbnail style)
$maxImgW = 80;
try {
    $pdf->Image($testFile, null, null, $maxImgW, 0);
} catch (Exception $e) {
    echo "PDF image insertion failed: " . $e->getMessage() . "\n";
    exit(2);
}
$pdf->Ln(6);
$pdf->SetFont('Arial','',9);
$pdf->MultiCell(0,5, basename($testFile));

// output
$pdf->Output('F', $path);
if (is_file($path) && filesize($path) > 0) {
    echo "Wrote simulated PDF: $path (" . filesize($path) . " bytes)\n";
    // print debug arrays similar to export_report
    $debug = [
        'included_photos' => [ ['file' => $testFile, 'size' => filesize($testFile)] ],
        'skipped_photos' => [],
        'fetched_photos' => []
    ];
    echo json_encode($debug, JSON_PRETTY_PRINT) . "\n";
    exit(0);
} else {
    echo "Failed to write PDF to $path\n";
    exit(3);
}
