<?php
require_once __DIR__ . '/config-util.php';
require_once __DIR__ . '/db.php';
require_method('POST');
$plan_id = safe_int($_POST['plan_id'] ?? null);
if (!$plan_id) error_response('Missing plan_id', 400);
$pdo = db();
$stmt = $pdo->prepare('SELECT * FROM issues WHERE plan_id=?');
$stmt->execute([$plan_id]);
$issues = $stmt->fetchAll();
$stmt2 = $pdo->prepare('SELECT * FROM photos WHERE plan_id=?');
$stmt2->execute([$plan_id]);
$photos = $stmt2->fetchAll();
require_once __DIR__ . '/../vendor/autoload.php';
use setasign\Fpdi\Fpdi;
use setasign\Fpdf\Fpdf;
$pdf = new Fpdf();
$pdf->AddPage();
$pdf->SetFont('Arial','B',16);
$pdf->Cell(0,10,'Survey Report',0,1,'C');
$pdf->SetFont('Arial','',12);
foreach ($issues as $issue) {
    $pdf->Cell(0,10,"Issue: {$issue['title']}",0,1);
    $pdf->MultiCell(0,8,"Desc: {$issue['description']}");
}
$pdf->Cell(0,10,'Photos:',0,1);
foreach ($photos as $photo) {
    $file = storage_dir('photos/' . $photo['filename']);
    if (is_file($file)) {
        $pdf->Image($file, null, null, 40, 30);
        $pdf->Ln(5);
    }
}
$filename = 'report_' . $plan_id . '_' . time() . '.pdf';
$path = storage_dir('exports/' . $filename);
$pdf->Output('F', $path);
json_response(['ok'=>true, 'filename'=>$filename]);
