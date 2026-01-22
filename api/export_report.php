<?php
require_once __DIR__ . '/config-util.php';
require_once __DIR__ . '/db.php';
require_method('POST');
$plan_id = safe_int($_POST['plan_id'] ?? null);
if (!$plan_id) error_response('Missing plan_id', 400);
$pdo = db();
// Fetch plan data to include in reports
$stmtPlan = $pdo->prepare('SELECT * FROM plans WHERE id=?');
$stmtPlan->execute([$plan_id]);
$plan = $stmtPlan->fetch();
$plan_name = $plan['name'] ?? ('Plan ' . $plan_id);

// Optional single-issue export
$issue_id = safe_int($_POST['issue_id'] ?? null);

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
$requireAutoload = __DIR__ . '/../vendor/autoload.php';
require_once $requireAutoload;
if (class_exists('\\setasign\\Fpdf\\Fpdf')) {
    $pdf = new \setasign\Fpdf\Fpdf();
} elseif (class_exists('FPDF')) {
    $pdf = new \FPDF();
} else {
    error_response('PDF export not available: setasign/fpdi-fpdf not installed', 500);
}
$pdf->AddPage();
$pdf->SetFont('Arial','B',16);
$pdf->Cell(0,10,'Survey Report',0,1,'C');
$pdf->SetFont('Arial','',12);

if ($format === 'csv') {
    // Generate CSV report for issues (no coords)
    $filename = 'report_' . $plan_id . '_' . ($issue_id ? 'issue_' . $issue_id . '_' : '') . time() . '.csv';
    $path = storage_dir('exports/' . $filename);
    $fh = fopen($path, 'w');
    if (!$fh) error_response('Failed to create CSV file', 500);
    // header
    $header = ['issue_id','page','title','notes','category','status','priority','assigned_to','due_date','created_at','updated_at'];
    fputcsv($fh, $header);
    if ($issue_id) {
        $stmt = $pdo->prepare('SELECT * FROM issues WHERE id=? AND plan_id=?');
        $stmt->execute([$issue_id, $plan_id]);
        $list = $stmt->fetchAll();
    } else {
        $stmt = $pdo->prepare('SELECT * FROM issues WHERE plan_id=? ORDER BY page, id');
        $stmt->execute([$plan_id]);
        $list = $stmt->fetchAll();
    }
    foreach ($list as $issue) {
        $row = [
            $issue['id'] ?? '',
            $issue['page'] ?? '',
            $issue['title'] ?? '',
            $issue['notes'] ?? '',
            $issue['category'] ?? '',
            $issue['status'] ?? '',
            $issue['priority'] ?? '',
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

// Build issue list to include in PDF
if ($issue_id) {
    $stmt = $pdo->prepare('SELECT * FROM issues WHERE id=? AND plan_id=?');
    $stmt->execute([$issue_id, $plan_id]);
    $issue_list = $stmt->fetchAll();
} else {
    $stmt = $pdo->prepare('SELECT * FROM issues WHERE plan_id=? ORDER BY page, id');
    $stmt->execute([$plan_id]);
    $issue_list = $stmt->fetchAll();
}

// Header with plan name
$pdf->SetFont('Arial','B',14);
$pdf->Cell(0,8,"Plan: " . ($plan['name'] ?? 'Plan ' . $plan_id),0,1,'C');
$pdf->Ln(4);

foreach ($issue_list as $issue) {
    $pdf->SetFont('Arial','B',13);
    $title = $issue['title'] ?: ('Issue #' . ($issue['id'] ?? ''));
    $pdf->Cell(0,7, $title, 0, 1);
    $pdf->SetFont('Arial','',11);
    $meta = [];
    if (!empty($issue['status'])) $meta[] = 'Status: ' . $issue['status'];
    if (!empty($issue['priority'])) $meta[] = 'Priority: ' . $issue['priority'];
    if (!empty($issue['assigned_to'])) $meta[] = 'Assignee: ' . $issue['assigned_to'];
    if (!empty($issue['created_at'])) $meta[] = 'Created: ' . $issue['created_at'];
    if (!empty($issue['page'])) $meta[] = 'Page: ' . $issue['page'];
    if (count($meta)) {
        $pdf->SetFont('Arial','I',10);
        $pdf->MultiCell(0,6, implode(' | ', $meta));
        $pdf->SetFont('Arial','',11);
    }
    $notes = $issue['notes'] ?? '';
    $pdf->MultiCell(0,6, $notes ?: '(No description)');

    // include photos for this issue right after description
    $stmtp = $pdo->prepare('SELECT * FROM photos WHERE plan_id=? AND issue_id=?');
    $stmtp->execute([$plan_id, $issue['id']]);
    $ips = $stmtp->fetchAll();
    if ($ips) {
        $pdf->Ln(3);
        $pdf->SetFont('Arial','B',12);
        $pdf->Cell(0,6,'Photos:',0,1);
        foreach ($ips as $ph) {
            $fileRel = $ph['file_path'] ?? ($ph['filename'] ?? null);
            if (!$fileRel) continue;
            $file = strpos($fileRel, '/') === 0 ? $fileRel : storage_dir($fileRel);
            if (!is_file($file)) continue;
            // ensure enough space
            $y = $pdf->GetY();
            $maxH = 120;
            if ($y + $maxH > ($pdf->GetPageHeight() - 20)) $pdf->AddPage();
            $pdf->Image($file, null, null, 160, 0);
            $pdf->Ln(6);
        }
    }
    $pdf->Ln(8);
}

$filename = 'report_' . $plan_id . '_' . ($issue_id ? 'issue_' . $issue_id . '_' : '') . time() . '.pdf';
$path = storage_dir('exports/' . $filename);
$pdf->Output('F', $path);
json_response(['ok'=>true, 'filename'=>$filename]);
