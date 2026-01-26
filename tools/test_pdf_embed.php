<?php
require_once __DIR__ . '/../vendor/autoload.php';
// simple test: fetch a pin image from render_pin.php and try to embed in PDF
$plan_id = 19; $issue_id = 22;
$url = "https://survey.defecttracker.uk/api/render_pin.php?plan_id={$plan_id}&issue_id={$issue_id}";
$img = file_get_contents($url);
if ($img === false) { echo "Failed to fetch image\n"; exit(1); }
$tmp = tempnam(sys_get_temp_dir(), 'pin_test_') . '.png';
file_put_contents($tmp, $img);
if (!is_file($tmp)) { echo "Failed to write tmp file\n"; exit(1); }
$size = filesize($tmp);
echo "Wrote tmp file: $tmp size=$size\n";
// create pdf
if (class_exists('\setasign\Fpdf\Fpdf')) {
    $pdf = new \setasign\Fpdf\Fpdf();
} else {
    $pdf = new FPDF();
}
$pdf->AddPage();
$pdf->SetFont('Arial','',12);
$pdf->Cell(0,6,'PDF embed test',0,1);
try {
    $pdf->Image($tmp, 10, 30, 60, 0);
    $out = sys_get_temp_dir() . '/test_embed_' . bin2hex(random_bytes(6)) . '.pdf';
    $pdf->Output('F', $out);
    clearstatcache(true, $out);
    if (is_file($out) && filesize($out) > 0) {
        echo "PDF wrote to $out size=" . filesize($out) . "\n";
        exit(0);
    } else {
        echo "Failed to write PDF or filesize 0\n"; exit(1);
    }
} catch (Exception $e) {
    echo "FPDF Image threw: " . $e->getMessage() . "\n";
    exit(1);
}
