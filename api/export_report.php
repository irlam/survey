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
// Helper to create safe filenames from plan / revision names
function slugify_filename($s) {
    $s = trim((string)$s);
    // replace any sequence of non-letter/digit characters with underscore (supports unicode letters)
    $s = preg_replace('/[^\p{L}\p{N}]+/u', '_', $s);
    // collapse multiple underscores
    $s = preg_replace('/_+/', '_', $s);
    $s = trim($s, '_');
    // limit length to avoid extremely long filenames
    if (mb_strlen($s) > 60) $s = mb_substr($s, 0, 60);
    return $s ?: 'plan';
}
$safe_plan_name = slugify_filename($plan_name);
$plan_revision_tag = !empty($plan['revision']) ? ('_' . slugify_filename($plan['revision'])) : '';

// Optional single-issue export
$issue_id = safe_int($_POST['issue_id'] ?? null);

// debug mode optionally enabled by POST param debug=1 or GET debug=1 (for troubleshooting only)
$debug = !empty($_POST['debug']) || !empty($_GET['debug']);

$format = strtolower($_POST['format'] ?? 'pdf');
// include pin thumbnails by default; explicitly set include_pin=0 or include_pin=false to disable
$include_pin = true;
if (isset($_POST['include_pin'])) {
    $val = strtolower(trim((string)($_POST['include_pin'] ?? '')));
    $include_pin = !in_array($val, ['0','false','']);
} elseif (isset($_GET['include_pin'])) {
    $val = strtolower(trim((string)($_GET['include_pin'] ?? '')));
    $include_pin = !in_array($val, ['0','false','']);
}

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



// Render a small thumbnail of the plan page with a pin composited at normalized coordinates.
// Returns path to a temporary PNG file, or null on failure. Requires Imagick; falls back silently.
function render_pin_thumbnail($planFile, $page, $x_norm, $y_norm, $thumbWidthPx = 400) {
    // Try Imagick first (cleanest, server-side PDF rendering + composite)
    if (class_exists('Imagick')) {
        try {
            $im = new Imagick();
            $im->setResolution(150,150);
            $pageIndex = max(0, (int)$page - 1);
            $im->readImage($planFile . '[' . $pageIndex . ']');
            $im->setImageFormat('png');
            $im->thumbnailImage($thumbWidthPx, 0);
            $w = $im->getImageWidth(); $h = $im->getImageHeight();

            $pinPath = __DIR__ . '/../assets/pin.png';
            if (!is_file($pinPath)) return null;
            $pin = new Imagick($pinPath);
            $pin->setImageFormat('png');
            $pinHeight = max(24, intval($h * 0.12));
            $pin->thumbnailImage(0, $pinHeight);
            $pw = $pin->getImageWidth(); $ph = $pin->getImageHeight();

            $x = intval($x_norm * $w) - intval($pw / 2);
            $y = intval($y_norm * $h) - $ph;
            $x = max(0, min($x, $w - $pw));
            $y = max(0, min($y, $h - $ph));

            $im->compositeImage($pin, Imagick::COMPOSITE_OVER, $x, $y);
            $tmp = tempnam(sys_get_temp_dir(), 'pinimg_') . '.png';
            $im->setImageFormat('png');
            $im->writeImage($tmp);
            $im->clear(); $pin->clear();
            return ['tmp'=>$tmp, 'method'=>'imagick'];
        } catch (Exception $e) {
            // fall through to other methods
        }
    }

    // Fallback: try external pdftoppm (Poppler) to render the page to PNG, then use GD to composite the pin
    $pdftoppm = trim(shell_exec('command -v pdftoppm 2>/dev/null'));
    if ($pdftoppm) {
        $prefix = sys_get_temp_dir() . '/pinr_' . bin2hex(random_bytes(6));
        $outPng = $prefix . '.png';
        $cmd = escapeshellcmd($pdftoppm) . ' -png -f ' . (int)$page . ' -singlefile -r 150 ' . escapeshellarg($planFile) . ' ' . escapeshellarg($prefix) . ' 2>&1';
        @exec($cmd, $out, $rc);
        if ($rc === 0 && is_file($outPng)) {
            // composite using GD
            if (function_exists('imagecreatefrompng') && function_exists('imagecopyresampled')) {
                $base = @imagecreatefrompng($outPng);
                if ($base) {
                    imagesavealpha($base, true);
                    imagealphablending($base, true);
                    $w = imagesx($base); $h = imagesy($base);
                    $pinPath = __DIR__ . '/../assets/pin.png';
                    if (is_file($pinPath)) {
                        $pinSrc = @imagecreatefrompng($pinPath);
                        if ($pinSrc) {
                            $pinHeight = max(24, intval($h * 0.12));
                            $pw = imagesx($pinSrc); $ph = imagesy($pinSrc);
                            $pw2 = intval($pw * ($pinHeight / $ph));
                            $ph2 = $pinHeight;
                            $resPin = imagecreatetruecolor($pw2, $ph2);
                            imagesavealpha($resPin, true);
                            $trans_colour = imagecolorallocatealpha($resPin, 0, 0, 0, 127);
                            imagefill($resPin, 0, 0, $trans_colour);
                            imagecopyresampled($resPin, $pinSrc, 0, 0, 0, 0, $pw2, $ph2, $pw, $ph);

                            $x = intval($x_norm * $w) - intval($pw2 / 2);
                            $y = intval($y_norm * $h) - $ph2;
                            $x = max(0, min($x, $w - $pw2));
                            $y = max(0, min($y, $h - $ph2));

                            imagecopy($base, $resPin, $x, $y, 0, 0, $pw2, $ph2);
                            $tmp = tempnam(sys_get_temp_dir(), 'pinimg_') . '.png';
                            imagepng($base, $tmp);
                            imagedestroy($base); imagedestroy($pinSrc); imagedestroy($resPin);
                            @unlink($outPng);
                            return ['tmp'=>$tmp, 'method'=>'pdftoppm_gd'];
                        }
                    }
                    imagedestroy($base);
                    @unlink($outPng);
                }
            } else {
                @unlink($outPng);
            }
        }
    }

    // Another fallback: try GhostScript (gs) to render a single page, then composite with GD like above
    $gs = trim(shell_exec('command -v gs 2>/dev/null'));
    if ($gs) {
        $prefix = sys_get_temp_dir() . '/pinr_' . bin2hex(random_bytes(6));
        $outPng = $prefix . '.png';
        $cmd = escapeshellcmd($gs) . ' -dSAFER -dBATCH -dNOPAUSE -sDEVICE=pngalpha -r150 -dFirstPage=' . (int)$page . ' -dLastPage=' . (int)$page . ' -sOutputFile=' . escapeshellarg($outPng) . ' ' . escapeshellarg($planFile) . ' 2>&1';
        @exec($cmd, $out, $rc);
        if ($rc === 0 && is_file($outPng)) {
            if (function_exists('imagecreatefrompng') && function_exists('imagecopyresampled')) {
                $base = @imagecreatefrompng($outPng);
                if ($base) {
                    imagesavealpha($base, true);
                    imagealphablending($base, true);
                    $w = imagesx($base); $h = imagesy($base);
                    $pinPath = __DIR__ . '/../assets/pin.png';
                    if (is_file($pinPath)) {
                        $pinSrc = @imagecreatefrompng($pinPath);
                        if ($pinSrc) {
                            $pinHeight = max(24, intval($h * 0.12));
                            $pw = imagesx($pinSrc); $ph = imagesy($pinSrc);
                            $pw2 = intval($pw * ($pinHeight / $ph));
                            $ph2 = $pinHeight;
                            $resPin = imagecreatetruecolor($pw2, $ph2);
                            imagesavealpha($resPin, true);
                            $trans_colour = imagecolorallocatealpha($resPin, 0, 0, 0, 127);
                            imagefill($resPin, 0, 0, $trans_colour);
                            imagecopyresampled($resPin, $pinSrc, 0, 0, 0, 0, $pw2, $ph2, $pw, $ph);

                            $x = intval($x_norm * $w) - intval($pw2 / 2);
                            $y = intval($y_norm * $h) - $ph2;
                            $x = max(0, min($x, $w - $pw2));
                            $y = max(0, min($y, $h - $ph2));

                            imagecopy($base, $resPin, $x, $y, 0, 0, $pw2, $ph2);
                            $tmp = tempnam(sys_get_temp_dir(), 'pinimg_') . '.png';
                            imagepng($base, $tmp);
                            imagedestroy($base); imagedestroy($pinSrc); imagedestroy($resPin);
                            @unlink($outPng);
                            return ['tmp'=>$tmp, 'method'=>'gs_gd'];
                        }
                    }
                    imagedestroy($base);
                    @unlink($outPng);
                }
            } else {
                @unlink($outPng);
            }
        }
    }

    return null;
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
    // Generate CSV report for issues (no coords) — format dates to UK style
    $filename = $safe_plan_name . $plan_revision_tag . '_plan_' . ($issue_id ? 'issue_' . $issue_id . '_' : '') . date('d-m-Y') . '.csv';
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
        // format date fields to UK style if present
        $due = !empty($issue['due_date']) ? date('d/m/Y', strtotime($issue['due_date'])) : '';
        $created = !empty($issue['created_at']) ? date('d/m/Y H:i', strtotime($issue['created_at'])) : '';
        $updated = !empty($issue['updated_at']) ? date('d/m/Y H:i', strtotime($issue['updated_at'])) : '';

        $row = [
            $issue['id'] ?? '',
            $issue['page'] ?? '',
            $issue['title'] ?? '',
            $issue['notes'] ?? '',
            $issue['category'] ?? '',
            $issue['status'] ?? '',
            $issue['priority'] ?? '',
            $issue['assigned_to'] ?? '',
            $due,
            $created,
            $updated
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
$pdf->Cell(0,5,'Generated: ' . date('d/m/Y H:i'), 0, 1, 'C');
$pdf->Ln(4);

$allSkippedPhotos = [];
$tempFiles = [];
$fetchedPhotos = [];
$includedPhotos = [];
$includedPins = []; 
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
    if (!empty($issue['page'])) $meta[] = 'Page: ' . $issue['page'];
    if (!empty($issue['updated_at'])) { $issueUpdated = date('d/m/Y H:i', strtotime($issue['updated_at'])); } else { $issueUpdated = null; }
    if (count($meta)) {
        // format updated into meta if present
        if ($issueUpdated) $meta[] = 'Updated: ' . $issueUpdated;

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
        // optionally include a pin thumbnail showing the issue location on the plan
        if (!empty($include_pin) && !empty($plan['file_path'])) {
            $planFile = realpath(__DIR__ . '/../' . ltrim($plan['file_path'], '/'));
            if ($planFile && is_file($planFile)) {
                $pinImg = render_pin_thumbnail($planFile, $issue['page'] ?? 1, $issue['x_norm'] ?? 0.5, $issue['y_norm'] ?? 0.5);
                if ($pinImg) {
                    // support array return from helper (tmp + method) for debugging
                    $pinPathReal = null; $pinMethod = null;
                    if (is_array($pinImg)) { $pinPathReal = $pinImg['tmp'] ?? null; $pinMethod = $pinImg['method'] ?? null; }
                    else { $pinPathReal = $pinImg; }
                    if ($pinPathReal) {
                        $tempFiles[] = $pinPathReal; // ensure cleanup
                        $x2 = $pdf->GetX();
                        $pdf->Image($pinPathReal, $x2, null, 60, 0);
                        $pdf->Ln(4);
                        if ($debug) $includedPins[] = ['issue_id'=>$issue['id']??null,'img'=>$pinPathReal,'method'=>$pinMethod];
                    }
                }
            }
        }
        foreach ($ips as $ph) {
            $fileRel = $ph['file_path'] ?? ($ph['filename'] ?? null);
            if (!$fileRel) continue;
            // Resolve file path: prefer explicit paths, otherwise assume photos/<filename>
            if (preg_match('#^https?://#i', $fileRel)) {
                // remote URL (http/https)
                if (!empty($_POST['fetch_remote']) || !empty($_GET['fetch_remote'])) {
                    // attempt to fetch remote image with safeguards
                    $maxBytes = 5 * 1024 * 1024; // 5MB
                    $tmp = tempnam(sys_get_temp_dir(), 'srp');
                    $fp = fopen($tmp, 'w');
                    $ch = curl_init($fileRel);
                    curl_setopt($ch, CURLOPT_RETURNTRANSFER, false);
                    curl_setopt($ch, CURLOPT_FOLLOWLOCATION, true);
                    curl_setopt($ch, CURLOPT_TIMEOUT, 12);
                    curl_setopt($ch, CURLOPT_FILE, $fp);
                    curl_setopt($ch, CURLOPT_USERAGENT, 'SurveyReportBot/1.0');
                    // do a HEAD first to check content-type and length
                    curl_setopt($ch, CURLOPT_NOBODY, true);
                    curl_exec($ch);
                    $info = curl_getinfo($ch);
                    $ct = $info['content_type'] ?? null;
                    $cl = isset($info['download_content_length']) ? (int)$info['download_content_length'] : 0;
                    curl_setopt($ch, CURLOPT_NOBODY, false);
                    if (!$ct || stripos($ct, 'image/') !== 0) {
                        fclose($fp);
                        @unlink($tmp);
                        if ($debug) $skippedPhotos[] = ['issue_id'=>$issue['id']??null,'photo'=>$ph,'reason'=>'remote_not_image','content_type'=>$ct];
                        curl_close($ch);
                        continue;
                    }
                    if ($cl > 0 && $cl > $maxBytes) {
                        fclose($fp);
                        @unlink($tmp);
                        if ($debug) $skippedPhotos[] = ['issue_id'=>$issue['id']??null,'photo'=>$ph,'reason'=>'remote_too_large','content_length'=>$cl];
                        curl_close($ch);
                        continue;
                    }
                    // perform actual download (writing to $fp)
                    // reset file pointer
                    fseek($fp, 0);
                    // reopen curl for GET to stream
                    curl_close($ch);
                    $ch2 = curl_init($fileRel);
                    curl_setopt($ch2, CURLOPT_FILE, $fp);
                    curl_setopt($ch2, CURLOPT_FOLLOWLOCATION, true);
                    curl_setopt($ch2, CURLOPT_TIMEOUT, 20);
                    curl_setopt($ch2, CURLOPT_USERAGENT, 'SurveyReportBot/1.0');
                    $res = curl_exec($ch2);
                    $err = curl_error($ch2);
                    $status = curl_getinfo($ch2, CURLINFO_HTTP_CODE);
                    curl_close($ch2);
                    fclose($fp);
                    if (!$res || $status >= 400) {
                        @unlink($tmp);
                        if ($debug) $skippedPhotos[] = ['issue_id'=>$issue['id']??null,'photo'=>$ph,'reason'=>'fetch_failed','http_status'=>$status,'error'=>$err];
                        continue;
                    }
                    // success - use temp file as $file
                    $file = $tmp;
                    $tempFiles[] = $tmp; // remember to unlink later
                    if ($debug) $fetchedPhotos[] = ['issue_id'=>$issue['id']??null,'photo'=>$ph,'tmp'=>$tmp,'size'=>is_file($tmp)?filesize($tmp):null];
                } else {
                    if ($debug) $skippedPhotos[] = ['issue_id'=>$issue['id']??null,'photo'=>$ph,'reason'=>'remote_url'];
                    continue;
                }
            }
            if (strpos($fileRel, '/storage/') === 0) {
                // convert web path /storage/xxx to filesystem path
                $file = realpath(__DIR__ . '/..' . $fileRel);
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
            if ($debug) {
                $includedPhotos[] = ['issue_id'=>$issue['id']??null,'file'=>$file,'size'=>is_file($file)?filesize($file):null];
            }
            $pdf->Image($file, $x, null, $maxImgW, 0);
            // caption removed for PDF exports — add spacing instead
            $pdf->Ln(6);
        }
    }
    if ($debug && !empty($skippedPhotos)) {
        $allSkippedPhotos = array_merge($allSkippedPhotos, $skippedPhotos);
    }
    $pdf->Ln(8);
}

$filename = $safe_plan_name . $plan_revision_tag . '_plan_' . ($issue_id ? 'issue_' . $issue_id . '_' : '') . date('d-m-Y') . '.pdf';
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
// Always report how many pin thumbnails were included (0 if none)
$extra['pins_included'] = isset($includedPins) ? count($includedPins) : 0;
// attach any skipped photo info (if collected)
if ($debug && isset($allSkippedPhotos) && count($allSkippedPhotos)) {
    $extra['skipped_photos'] = $allSkippedPhotos;
}
if ($debug && isset($fetchedPhotos) && count($fetchedPhotos)) {
    $extra['fetched_photos'] = $fetchedPhotos;
}
if ($debug && isset($includedPhotos) && count($includedPhotos)) {
    $extra['included_photos'] = $includedPhotos;
}
if ($debug && isset($includedPins) && count($includedPins)) {
    $extra['included_pins'] = $includedPins;
}

// cleanup any temporary files we created when fetching remote images
if (!empty($tempFiles) && is_array($tempFiles)) {
    foreach ($tempFiles as $tmpf) { if (is_file($tmpf)) @unlink($tmpf); }
}
json_response(array_merge(['ok'=>true, 'filename'=>$filename, 'path'=>$path, 'size'=>filesize($path)], $extra));
