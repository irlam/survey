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
$format = strtolower($_POST['format'] ?? 'pdf');

if ($format === 'csv') {
    // Generate CSV report
    $filename = 'report_' . $plan_id . '_' . time() . '.csv';
    $path = storage_dir('exports/' . $filename);
    $fh = fopen($path, 'w');
    if (!$fh) error_response('Failed to create CSV file', 500);
    // header
    $header = ['issue_no','page','x_norm','y_norm','title','notes','category','status','priority','trade','assigned_to','due_date','created_at','updated_at'];
    fputcsv($fh, $header);
    foreach ($issues as $issue) {
        $row = [
            $issue['issue_no'] ?? '',
            $issue['page'] ?? '',
            $issue['x_norm'] ?? '',
            $issue['y_norm'] ?? '',
            $issue['title'] ?? '',
            $issue['notes'] ?? '',
            $issue['category'] ?? '',
            $issue['status'] ?? '',
            $issue['priority'] ?? '',
            $issue['trade'] ?? '',
            $issue['assigned_to'] ?? '',
            $issue['due_date'] ?? '',
            $issue['created_at'] ?? '',
            $issue['updated_at'] ?? ''
        ];
        fputcsv($fh, $row);
    }
    fclose($fh);
    json_response(['ok'=>true, 'filename'=>$filename, 'format'=>'csv']);
}

// Default: PDF (if requested)
if ($format !== 'pdf') {
    error_response('Unsupported format', 400);
}

// Ensure PDF libs are available
if (!file_exists(__DIR__ . '/../vendor/autoload.php')) {
    error_response('PDF export not available: composer dependencies missing', 500);
}
require_once __DIR__ . '/../vendor/autoload.php';
if (!class_exists('\\setasign\\Fpdf\\Fpdf')) {
    error_response('PDF export not available: setasign/fpdi-fpdf not installed', 500);
}
$pdf = new \setasign\Fpdf\Fpdf();
$pdf->AddPage();
$pdf->SetFont('Arial','B',16);
$pdf->Cell(0,10,'Survey Report',0,1,'C');
$pdf->SetFont('Arial','',12);

if ($format === 'csv') {
    // Generate CSV report
    $filename = 'report_' . $plan_id . '_' . time() . '.csv';
    $path = storage_dir('exports/' . $filename);
    $fh = fopen($path, 'w');
    if (!$fh) error_response('Failed to create CSV file', 500);
    // header
    $header = ['issue_no','page','x_norm','y_norm','title','notes','category','status','priority','trade','assigned_to','due_date','created_at','updated_at'];
    fputcsv($fh, $header);
    foreach ($issues as $issue) {
        $row = [
            $issue['issue_no'] ?? '',
            $issue['page'] ?? '',
            $issue['x_norm'] ?? '',
            $issue['y_norm'] ?? '',
            $issue['title'] ?? '',
            $issue['notes'] ?? '',
            $issue['category'] ?? '',
            $issue['status'] ?? '',
            $issue['priority'] ?? '',
            $issue['trade'] ?? '',
            $issue['assigned_to'] ?? '',
            $issue['due_date'] ?? '',
            $issue['created_at'] ?? '',
            $issue['updated_at'] ?? ''
        ];
        fputcsv($fh, $row);
    }
    fclose($fh);
    json_response(['ok'=>true, 'filename'=>$filename, 'format'=>'csv']);
}

// Default: PDF
foreach ($issues as $issue) {
    $pdf->Cell(0,10,"Issue: {$issue['title']}",0,1);
    // use notes field instead of description
    $pdf->MultiCell(0,8,"Desc: {$issue['notes']}");
}
$pdf->Cell(0,10,'Photos:',0,1);
foreach ($photos as $photo) {
    // support different schema column names
    $fileRel = $photo['file_path'] ?? ($photo['filename'] ?? null);
    if (!$fileRel) continue;
    // fileRel may already include 'photos/...'
    $file = strpos($fileRel, '/') === 0 ? $fileRel : storage_dir($fileRel);
    if (is_file($file)) {
        $pdf->Image($file, null, null, 40, 30);
        $pdf->Ln(5);
    }
}
$filename = 'report_' . $plan_id . '_' . time() . '.pdf';
$path = storage_dir('exports/' . $filename);
$pdf->Output('F', $path);
json_response(['ok'=>true, 'filename'=>$filename]);
