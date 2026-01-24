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

// debug mode optionally enabled by POST param debug=1 or GET debug=1 (for troubleshooting only)
$debug = !empty($_POST['debug']) || !empty($_GET['debug']);

$format = strtolower($_POST['format'] ?? 'pdf');

function get_exports_listing($limit = 20) {
    $dir = storage_dir('exports');
    if (!is_dir($dir)) return [];
    $files = array_values(array_diff(scandir($dir, SCANDIR_SORT_DESCENDING), ['.','..']));
    $res = [];
    foreach ($files as $f) {
        $full = $dir . '/' . $f;
        if (!is_file($full)) continue;
        $res[] = ['filename'=>$f, 'size'=>filesize($full), 'mtime'=>filemtime($full)];
        if (count($res) >= $limit) break;
    }
    return $res;
}



// Default: PDF (if requested)
if ($format !== 'pdf') {
    error_response('Unsupported format', 400);
}

// Ensure PDF libs are available
if (!file_exists(__DIR__ . '/../vendor/autoload.php')) {
    error_log('export_report: composer autoload missing at ' . __DIR__ . '/../vendor/autoload.php');
    $extra = $debug ? ['exports'=>get_exports_listing()] : [];
    error_response('PDF export not available: composer dependencies missing', 500, $extra);
}
$requireAutoload = __DIR__ . '/../vendor/autoload.php';
require_once $requireAutoload;
if (class_exists('\setasign\Fpdf\Fpdf')) {
    $pdf = new \setasign\Fpdf\Fpdf();
} elseif (class_exists('FPDF')) {
    $pdf = new \FPDF();
} else {
    error_log('export_report: FPDI classes missing; declared classes count=' . count(get_declared_classes()));
    $extra = $debug ? ['exports'=>get_exports_listing()] : [];
    error_response('PDF export not available: setasign/fpdi-fpdf not installed', 500, $extra);
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
$pdf->SetFont('Arial','',10);
$pdf->Cell(0,5,'Generated: ' . date('Y-m-d H:i'), 0, 1, 'C');
$pdf->Ln(4);

$allSkippedPhotos = [];
foreach ($issue_list as $issue) {
    $skippedPhotos = []; // per-issue debug info about skipped photos
    // issue header with subtle background for a more modern look
    $pdf->SetFont('Arial','B',13);
    $title = $issue['title'] ?: ('Issue #' . ($issue['id'] ?? ''));
    $pdf->SetFillColor(230,248,245);
    $pdf->SetTextColor(6,56,56);
    $pdf->Cell(0,10, ' ' . $title, 0, 1, 'L', true);
    // thin divider
    $x1 = $pdf->GetX(); $y1 = $pdf->GetY(); $pdf->SetDrawColor(200,200,200); $pdf->Line(10, $y1, $pdf->GetPageWidth()-10, $y1);
    $pdf->Ln(2);
    $pdf->SetTextColor(0,0,0);
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
        // nicer photos block header
        $pdf->Ln(3);
        $pdf->SetFont('Arial','B',12);
        $pdf->Cell(0,6,'Photos:',0,1);
        foreach ($ips as $ph) {
            $fileRel = $ph['file_path'] ?? ($ph['filename'] ?? null);
            if (!$fileRel) continue;
            // Resolve file path: prefer explicit paths, otherwise assume photos/<filename>
            if (preg_match('#^https?://#i', $fileRel)) {
                // skip remote URLs for now
                if ($debug) $skippedPhotos[] = ['issue_id'=>$issue['id']??null,'photo'=>$ph,'reason'=>'remote_url'];
                continue;
            }
            if (strpos($fileRel, '/storage/') === 0) {
                $file = $fileRel;
            } elseif (strpos($fileRel, 'photos/') === 0 || strpos($fileRel, 'files/') === 0) {
                $file = storage_dir($fileRel);
            } elseif (strpos($fileRel, '/') === false) {
                // plain filename -> photos directory
                $file = storage_dir('photos/' . $fileRel);
            } else {
                // other relative path
                $file = storage_dir($fileRel);
            }
            if (!is_file($file)) {
                // try alternative: storage/photos/<filename>
                $alt = storage_dir('photos/' . basename($fileRel));
                if (is_file($alt)) {
                    $file = $alt;
                } else {
                    if ($debug) $skippedPhotos[] = ['issue_id'=>$issue['id']??null,'photo'=>$ph,'reason'=>'file_missing','tried'=>$file,'alt'=>$alt];
                    continue;
                }
            }

            // ensure enough space on page
            $y = $pdf->GetY();
            $pageH = $pdf->GetPageHeight();
            $bottomMargin = 20;
            $maxImgW = 60; // mm width for thumbnails
            $maxImgH = 60;
            if ($y + $maxImgH > ($pageH - $bottomMargin)) $pdf->AddPage();

            // place image and caption
            $x = $pdf->GetX();
            $pdf->Image($file, $x, null, $maxImgW, 0);
            // caption beneath image (filename or note)
            $pdf->Ln(2);
            $pdf->SetFont('Arial','',9);
            $caption = $ph['caption'] ?? ($ph['filename'] ?? basename($file));
            $pdf->MultiCell(0,5, $caption);
            $pdf->Ln(4);
        }
    }
    if ($debug && !empty($skippedPhotos)) {
        $allSkippedPhotos = array_merge($allSkippedPhotos, $skippedPhotos);
    }
    $pdf->Ln(8);
}

$filename = 'report_' . $plan_id . '_' . ($issue_id ? 'issue_' . $issue_id . '_' : '') . time() . '.pdf';
$path = storage_dir('exports/' . $filename);
$pdf->Output('F', $path);
// ensure file was written
clearstatcache(true, $path);
if (!is_file($path) || filesize($path) <= 0) {
    $last = error_get_last();
    error_log('export_report: failed to write PDF to ' . $path . ' last error: ' . print_r($last, true));
    $msg = 'Failed to write PDF file';
    if ($last && !empty($last['message'])) $msg .= ': ' . $last['message'];
    $extra = $debug ? ['exports'=>get_exports_listing()] : [];
    error_response($msg, 500, $extra);
}
error_log('export_report: wrote ' . $path . ' size:' . filesize($path) . ' plan:' . $plan_id . ' issue:' . ($issue_id ?: 'all'));
$extra = $debug ? ['exports'=>get_exports_listing()] : [];
// attach any skipped photo info (if collected)
if ($debug && isset($allSkippedPhotos) && count($allSkippedPhotos)) {
    $extra['skipped_photos'] = $allSkippedPhotos;
}
json_response(array_merge(['ok'=>true, 'filename'=>$filename, 'path'=>$path, 'size'=>filesize($path)], $extra));
