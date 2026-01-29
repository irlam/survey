<?php
require_once __DIR__ . '/config-util.php';
require_once __DIR__ . '/db.php';
if (php_sapi_name() !== 'cli') {
    require_method('POST');
    $plan_id = safe_int($_POST['plan_id'] ?? null);
    if (!$plan_id) error_response('Missing plan_id', 400);
    $pdo = db();
    // Fetch plan data to include in reports
    $stmtPlan = $pdo->prepare('SELECT * FROM plans WHERE id=?');
    $stmtPlan->execute([$plan_id]);
    $plan = $stmtPlan->fetch();
    $plan_name = $plan['name'] ?? ('Plan ' . $plan_id);
} else {
    // Included from CLI for testing: provide safe defaults so functions can be exercised
    $plan_id = null;
    $plan = null;
    $plan_name = 'plan';
}
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

    // If the plan file itself is an image (png/jpg/gif) and GD is available, composite directly
    $imgExt = strtolower(pathinfo($planFile, PATHINFO_EXTENSION));
    if (in_array($imgExt, ['png','jpg','jpeg','gif'])) {
        if (function_exists('imagecreatefrompng') && function_exists('imagecopyresampled')) {
            $base = null;
            switch ($imgExt) {
                case 'png': $base = @imagecreatefrompng($planFile); break;
                case 'jpg': case 'jpeg': $base = @imagecreatefromjpeg($planFile); break;
                case 'gif': $base = @imagecreatefromgif($planFile); break;
            }
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
                        return ['tmp'=>$tmp, 'method'=>'gd_image'];
                    }
                }
                imagedestroy($base);
            }
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

// When included from CLI, don't run the endpoint code so tests can include this file
if (php_sapi_name() === 'cli') return;

// Helper: ensure exports table has expected columns (best-effort).
function ensure_exports_table_columns(PDO $pdo) {
    try {
        $hasFilename = false; $hasType = false;
        $r = $pdo->query("SHOW COLUMNS FROM exports LIKE 'filename'")->fetch(); if ($r) $hasFilename = true;
        $r2 = $pdo->query("SHOW COLUMNS FROM exports LIKE 'type'")->fetch(); if ($r2) $hasType = true;
        if (!$hasFilename) {
            try { $pdo->exec("ALTER TABLE exports ADD COLUMN filename VARCHAR(255) NOT NULL DEFAULT '' AFTER plan_id"); $hasFilename = true; }
            catch (Exception $e) { error_log('ensure_exports_table_columns: failed to add filename column: ' . $e->getMessage()); }
        }
        if (!$hasType) {
            try { $pdo->exec("ALTER TABLE exports ADD COLUMN type VARCHAR(32) DEFAULT NULL AFTER filename"); $hasType = true; }
            catch (Exception $e) { error_log('ensure_exports_table_columns: failed to add type column: ' . $e->getMessage()); }
        }
        return ($hasFilename && $hasType);
    } catch (Exception $ex) {
        error_log('ensure_exports_table_columns: error checking exports table: ' . $ex->getMessage());
        return false;
    }
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
    $filename = $safe_plan_name . $plan_revision_tag . '_plan_' . ($issue_id ? 'issue_' . $issue_id . '_' : '') . date('Ymd_His') . '.csv';
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
    // record the CSV export in DB (best-effort)
    try {
        ensure_exports_table_columns($pdo);
        $stmtExp = $pdo->prepare('INSERT INTO exports (plan_id, filename, type) VALUES (?, ?, ?)');
        $stmtExp->execute([$plan_id, $filename, 'csv']);
        $expId = (int)$pdo->lastInsertId();
    } catch (Exception $e) {
        error_log('export_report: failed to record CSV export: ' . $e->getMessage());
        $expId = null;
    }
    json_response(['ok'=>true, 'filename'=>$filename, 'format'=>'csv', 'export_id'=>$expId]);
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
$allSkippedPins = [];
$render_debug = [];
$pins_included_count = 0;

// Optional single-A4 layout: place main plan image at the top and a grid of issue images below
// Enabled by default to provide a large plan image with a 4-column image grid underneath.
// Set fit_a4=0 or fit_a4=false to disable.
$fit_a4 = true;
if (isset($_POST['fit_a4']) || isset($_GET['fit_a4'])) {
    $val = strtolower(trim((string)($_POST['fit_a4'] ?? $_GET['fit_a4'] ?? '')));
    // honor explicit false-ish values
    $fit_a4 = !in_array($val, ['0','false']);
} 
$skip_issue_loop = false;
if ($fit_a4) {
    // Resolve plan file once
    $planFile = null; $fileRel = $plan['file_path'] ?? null;
    if ($fileRel) {
        $cand1 = realpath(__DIR__ . '/../' . ltrim($fileRel, '/'));
        if ($cand1 && is_file($cand1)) $planFile = $cand1;
        if (!$planFile) { $cand2 = storage_dir($fileRel); if (is_file($cand2)) $planFile = $cand2; }
        if (!$planFile) { $cand3 = storage_dir('plans/' . basename($fileRel)); if (is_file($cand3)) $planFile = $cand3; }
    }
    if ($planFile && is_file($planFile)) {
        // Render a large plan thumbnail to fit page width
        $pageW = $pdf->GetPageWidth(); $pageH = $pdf->GetPageHeight();
        $margin = 12; $gap = 6; // mm
        $availableW = $pageW - ($margin * 2);
        $planPage = (!empty($issue_list) && isset($issue_list[0]['page'])) ? $issue_list[0]['page'] : 1;
            $planThumb = render_plan_thumbnail($planFile, $planPage, 2000);
        if ($planThumb && isset($planThumb['tmp'])) {
            $tempFiles[] = $planThumb['tmp'];
            $imgInfo = @getimagesize($planThumb['tmp']);
            $w_px = $imgInfo ? $imgInfo[0] : ($planThumb['w'] ?? null);
            $h_px = $imgInfo ? $imgInfo[1] : ($planThumb['h'] ?? null);

            // Generate per-issue pin images (raster) to display in grid (do this before placing the plan so we can cap its height)
            $gridImgs = [];
            foreach ($issue_list as $iss) {
                $pinImg = render_pin_thumbnail($planFile, $iss['page'] ?? 1, $iss['x_norm'] ?? 0.5, $iss['y_norm'] ?? 0.5, 1200, ($iss['id'] ?? null));
                if ($pinImg && is_array($pinImg) && !empty($pinImg['tmp']) && is_file($pinImg['tmp'])) {
                    $gridImgs[] = ['tmp'=>$pinImg['tmp'],'w'=>null,'h'=>null,'issue_id'=>$iss['id'] ?? null];
                    $tempFiles[] = $pinImg['tmp'];
                } else {
                    // fallback: try to use any issue photo (first photo) as placeholder
                    $stmtp2 = $pdo->prepare('SELECT * FROM photos WHERE plan_id=? AND issue_id=? LIMIT 1');
                    $stmtp2->execute([$plan_id, $iss['id']]); $phs2 = $stmtp2->fetchAll();
                    if (!empty($phs2)) {
                        $frel = $phs2[0]['file_path'] ?? $phs2[0]['filename'] ?? null;
                        if ($frel) {
                            if (preg_match('#^https?://#i', $frel)) continue; // skip remote for grid
                            if (strpos($frel, 'photos/')===0) $fpath = storage_dir($frel);
                            else $fpath = storage_dir('photos/' . basename($frel));
                            if (is_file($fpath)) { $gridImgs[] = ['tmp'=>$fpath,'w'=>null,'h'=>null,'issue_id'=>$iss['id'] ?? null]; }
                        }
                    }
                }
            }

            if ($w_px && $h_px) {
                // Start by sizing to page width
                $planWidthMM = $availableW;
                $planHeightMM = $planWidthMM * ($h_px / $w_px);

                // Make the plan image much larger by preferring up to 75% of the available content height,
                // while reserving space for a 4-column grid underneath. Use smaller grid thumbs so we can
                // show more of the plan.
                $n = count($gridImgs);
                if ($n > 0) {
                    $hgap = 4; $vgap = 4; $minThumb = 12; $captionH = 3; // mm (smaller thumbs)
                    $colsForCalc = 4; // assume 4-wide grid below
                    $rows = (int)ceil($n / $colsForCalc);
                    $minGridHeight = $rows * ($minThumb + $captionH) + max(0, ($rows - 1) * $vgap) + 6; // padding
                    $availableForContent = $pageH - 2 * $margin - $gap;
                    // allow plan up to 75% of content height (but still leave room for the grid)
                    $planHeightCap = max(40, (int)floor($availableForContent * 0.75));
                    $desiredPlanHeight = min($planHeightCap, $availableForContent - $minGridHeight);

                    // If natural plan height is smaller than desired, enlarge it (scaling width accordingly) but don't overflow horizontally
                    if ($planHeightMM < $desiredPlanHeight) {
                        $planHeightMM = $desiredPlanHeight;
                        $planWidthMM = $planHeightMM * ($w_px / $h_px);
                        if ($planWidthMM > $availableW) {
                            $scale = $availableW / $planWidthMM;
                            $planWidthMM *= $scale;
                            $planHeightMM *= $scale;
                        }
                    } elseif ($planHeightMM > $desiredPlanHeight) {
                        // cap it down if it's too tall
                        $planHeightMM = $desiredPlanHeight;
                        $planWidthMM = $planHeightMM * ($w_px / $h_px);
                    }
                }

                // place at top margin
                $x = $margin; $y = $margin;
                $pdf->Image($planThumb['tmp'], $x, $y, $planWidthMM, 0);
                $currentY = $y + $planHeightMM + $gap;
            } else {
                // fallback fixed height (bigger by default, try to shrink if grid needs space)
                $planWidthMM = $availableW; $planHeightMM = 160;
                $n = count($gridImgs);
                if ($n > 0) {
                    $hgap = 4; $vgap = 4; $minThumb = 12; $captionH = 3;
                    $colsForCalc = 4;
                    $rows = (int)ceil($n / $colsForCalc);
                    $minGridHeight = $rows * ($minThumb + $captionH) + max(0, ($rows - 1) * $vgap) + 6;
                    $availableForContent = $pageH - 2 * $margin - $gap;
                    $planHeightCap = max(40, (int)floor($availableForContent * 0.75));
                    if ($planHeightMM > $planHeightCap) $planHeightMM = $planHeightCap;
                }
                $x = $margin; $y = $margin; $pdf->Image($planThumb['tmp'], $x, $y, $planWidthMM, 0);
                $currentY = $y + $planHeightMM + $gap;
            }
        } else {
            // if plan cannot be rendered, leave some header space
            // still generate grid images so they can be placed
            $gridImgs = [];
            foreach ($issue_list as $iss) {
                $stmtp2 = $pdo->prepare('SELECT * FROM photos WHERE plan_id=? AND issue_id=? LIMIT 1');
                $stmtp2->execute([$plan_id, $iss['id']]); $phs2 = $stmtp2->fetchAll();
                if (!empty($phs2)) {
                    $frel = $phs2[0]['file_path'] ?? $phs2[0]['filename'] ?? null;
                    if ($frel && !preg_match('#^https?://#i', $frel)) {
                        if (strpos($frel, 'photos/')===0) $fpath = storage_dir($frel);
                        else $fpath = storage_dir('photos/' . basename($frel));
                        if (is_file($fpath)) { $gridImgs[] = ['tmp'=>$fpath,'w'=>null,'h'=>null,'issue_id'=>$iss['id'] ?? null]; }
                    }
                }
            }
            $currentY = 30;
        }

        // Arrange grid to fit into remaining area on A4
        $left = $margin; $right = $pageW - $margin; $bottomY = $pageH - $margin;
        $availH = $bottomY - $currentY;
        $n = count($gridImgs);
        if ($n > 0 && $availH > 10) {
            // prefer a 4-column grid below the large plan image; fall back to fewer columns only if thumbs would be unusably small
            $hgap = 4; $vgap = 4; $minThumb = 12; // mm (smaller thumbs to fit 4 cols)

            // Try 4 columns first
            $cols = 4;
            $thumbW = floor((($pageW - 2*$margin) - ($cols-1)*$hgap) / $cols);
            $rows = ceil($n / $cols);
            $thumbH = floor(($availH - ($rows-1)*$vgap) / $rows);
            $sq = min($thumbW, $thumbH);

            // If thumbs would be too small, try fewer columns to increase size
            if ($sq < $minThumb) {
                $chosen = null;
                for ($c = 3; $c >= 1; $c--) {
                    $tw = floor((($pageW - 2*$margin) - ($c-1)*$hgap) / $c);
                    $r = ceil($n / $c);
                    $th = floor(($availH - ($r-1)*$vgap) / $r);
                    $s = min($tw, $th);
                    if ($s >= $minThumb) { $chosen = ['cols'=>$c,'thumb'=>$s,'rows'=>$r]; break; }
                }
                if ($chosen) { $cols = $chosen['cols']; $thumbSize = $chosen['thumb']; $rows = $chosen['rows']; }
                else { $cols = 1; $rows = $n; $thumbSize = max(8, floor(($availH - ($rows-1)*$vgap) / $rows)); }
            } else {
                $thumbSize = $sq;
            }

            $x = $left; $y = $currentY; $col = 0;
            foreach ($gridImgs as $gi) {
                if ($y + $thumbSize > $bottomY) break; // safety
                $pdf->Image($gi['tmp'], $x, $y, $thumbSize, 0);
                // caption below with issue id
                $pdf->SetFont('Arial','',8);
                $pdf->SetXY($x, $y + $thumbSize + 1);
                $txt = 'Issue ' . ($gi['issue_id'] ?? '');
                $pdf->Cell($thumbSize, 4, $txt, 0, 0, 'C');
                $col++;
                if ($col >= $cols) {
                    $col = 0; $x = $left; $y += $thumbSize + $vgap + 6;
                } else {
                    $x += $thumbSize + $hgap;
                }
            }
        }
    }
    // mark to skip per-issue detailed loop below
    $skip_issue_loop = true;
}

if (!$skip_issue_loop) foreach ($issue_list as $issue) {
    $skippedPhotos = []; // per-issue debug info about skipped photos
    $skippedPins = []; // per-issue debug info about skipped pin thumbnails
    $render_debug[$issue['id'] ?? ''] = ['plan_file_used'=>null,'http_fetch_ok'=>false,'render_method'=>null,'pin_tmp'=>null,'embedded'=>false,'skip_reason'=>null];
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

    // pin thumbnail preview (inserted before photos)
    if (!empty($include_pin) && !empty($plan['file_path'])) {
        $planFile = null; $fileRel = $plan['file_path'] ?? null;
        if ($fileRel) {
            $cand1 = realpath(__DIR__ . '/../' . ltrim($fileRel, '/'));
            if ($cand1 && is_file($cand1)) $planFile = $cand1;
            if (!$planFile) { $cand2 = storage_dir($fileRel); if (is_file($cand2)) $planFile = $cand2; }
            if (!$planFile) { $cand3 = storage_dir('plans/' . basename($fileRel)); if (is_file($cand3)) $planFile = $cand3; }
        }
        if ($planFile && is_file($planFile)) {
            // try HTTP-rendered thumb first
            $pinImg = null;
            $renderUrl = base_url() . '/api/render_pin.php?plan_id=' . urlencode($plan_id) . '&issue_id=' . urlencode($issue['id'] ?? '');
            $imgData = @file_get_contents($renderUrl);
            if ($imgData !== false && strlen($imgData) > 200) {
                $tmpf = tempnam(sys_get_temp_dir(), 'srp') . '.png';
                file_put_contents($tmpf, $imgData);
                if (is_file($tmpf) && filesize($tmpf) > 0) $pinImg = ['tmp'=>$tmpf,'method'=>'http_render'];
            }
            if (!$pinImg) $pinImg = render_pin_thumbnail($planFile, $issue['page'] ?? 1, $issue['x_norm'] ?? 0.5, $issue['y_norm'] ?? 0.5);
            if ($debug) { error_log('export_report: render_pin attempt for issue=' . ($issue['id'] ?? '') . ' plan=' . $planFile . ' result=' . var_export($pinImg, true)); $includedPins[] = ['issue_id'=>$issue['id']??null,'plan_file_used'=>$planFile]; }
            if (!$pinImg && $debug) { $skippedPins[] = ['issue_id'=>$issue['id']??null,'reason'=>'render_failed','plan_file'=>$planFile,'render_result'=> (is_array($pinImg) ? $pinImg : ['value' => $pinImg])]; }
            if ($pinImg) {
                $pinPathReal = is_array($pinImg) ? ($pinImg['tmp'] ?? null) : $pinImg;
                $pinMethod = is_array($pinImg) ? ($pinImg['method'] ?? null) : null;
                if ($pinPathReal && is_file($pinPathReal) && filesize($pinPathReal)>0 && @getimagesize($pinPathReal)) {
                    $tempFiles[] = $pinPathReal;
                    $x2 = $pdf->GetX(); $pdf->Image($pinPathReal, $x2, null, 60, 0); $pdf->Ln(4);
                    if ($debug) $includedPins[] = ['issue_id'=>$issue['id']??null,'img'=>$pinPathReal,'method'=>$pinMethod];
                } else { if ($debug) $skippedPins[] = ['issue_id'=>$issue['id']??null,'img'=>$pinPathReal,'reason'=>'invalid_or_missing']; }
            }
        }
    }

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
            // Resolve possible plan file locations (project-relative, storage, storage/plans)
            $planFile = null;
            $fileRel = $plan['file_path'] ?? null;
            if ($fileRel) {
                $cand1 = realpath(__DIR__ . '/../' . ltrim($fileRel, '/'));
                if ($cand1 && is_file($cand1)) $planFile = $cand1;
                if (!$planFile) {
                    $cand2 = storage_dir($fileRel);
                    if (is_file($cand2)) $planFile = $cand2;
                }
                if (!$planFile) {
                    $cand3 = storage_dir('plans/' . basename($fileRel));
                    if (is_file($cand3)) $planFile = $cand3;
                }
            }
            if ($planFile && is_file($planFile)) {
                    // try an HTTP-rendered thumbnail from our own API first (works around local rendering oddities)
                    $pinImg = null;
                    $renderUrl = base_url() . '/api/render_pin.php?plan_id=' . urlencode($plan_id) . '&issue_id=' . urlencode($issue['id'] ?? '');
                    $imgData = @file_get_contents($renderUrl);
                    if ($imgData !== false && strlen($imgData) > 200) {
                        $tmpf = tempnam(sys_get_temp_dir(), 'srp') . '.png';
                        file_put_contents($tmpf, $imgData);
                        if (is_file($tmpf) && filesize($tmpf) > 0) {
                            $pinImg = ['tmp'=>$tmpf,'method'=>'http_render'];
                            $render_debug[$issue['id'] ?? '']['http_fetch_ok'] = true;
                        }
                    }
                    // fallback to internal renderer if HTTP fetch failed
                    if (!$pinImg) {
                        $pinImg = render_pin_thumbnail($planFile, $issue['page'] ?? 1, $issue['x_norm'] ?? 0.5, $issue['y_norm'] ?? 0.5);
                    }
                    // diagnostic logging: record render attempt and quick trace in error log
                    if ($debug) {
                        error_log('export_report: render_pin attempt for issue=' . ($issue['id'] ?? '') . ' plan=' . $planFile . ' result=' . var_export($pinImg, true));
                        $includedPins[] = ['issue_id'=>$issue['id']??null,'plan_file_used'=>$planFile];
                    }
                    if (!$pinImg && $debug) {
                        $skippedPins[] = ['issue_id'=>$issue['id']??null,'reason'=>'render_failed','plan_file'=>$planFile,'render_result'=> (is_array($pinImg) ? $pinImg : ['value' => $pinImg])];
                        $render_debug[$issue['id'] ?? '']['render_method'] = null;
                    }
                    if ($pinImg && is_array($pinImg) && !empty($pinImg['method'])) {
                        $render_debug[$issue['id'] ?? '']['render_method'] = $pinImg['method'];
                        $render_debug[$issue['id'] ?? '']['pin_tmp'] = $pinImg['tmp'] ?? null;
                    }
                    if ($pinImg) {
                    // support array return from helper (tmp + method) for debugging
                    $pinPathReal = null; $pinMethod = null;
                    if (is_array($pinImg)) { $src = $pinImg['tmp'] ?? null; $pinMethod = $pinImg['method'] ?? null; }
                    else { $src = $pinImg; }
                    // copy into storage/tmp with a guaranteed readable path so FPDF can embed it reliably
                    if ($src && is_file($src)) {
                        $dst = storage_dir('tmp/pin_' . ($plan_id ?? 'p') . '_' . ($issue['id'] ?? 'i') . '_' . bin2hex(random_bytes(4)) . '.png');
                        if (@copy($src, $dst)) {
                            @chmod($dst, 0644);
                            $pinPathReal = $dst;
                            $tempFiles[] = $dst; // mark for cleanup
                        } else {
                            // fallback to original source (may still work)
                            $pinPathReal = $src;
                            $tempFiles[] = $src;
                        }
                    } else {
                        $pinPathReal = null;
                    }
                    if ($pinPathReal) {
                        // validate file existence and image validity before embedding
                        if (!is_file($pinPathReal) || filesize($pinPathReal) <= 0) {
                            $render_debug[$issue['id'] ?? '']['skip_reason'] = 'file_missing_or_empty';
                            if ($debug) $skippedPins[] = ['issue_id'=>$issue['id']??null,'img'=>$pinPathReal,'reason'=>'file_missing_or_empty','filesize'=>is_file($pinPathReal)?filesize($pinPathReal):null];
                        } else {
                            $imgInfo = @getimagesize($pinPathReal);
                            if (!$imgInfo) {
                                $render_debug[$issue['id'] ?? '']['skip_reason'] = 'invalid_image';
                                if ($debug) $skippedPins[] = ['issue_id'=>$issue['id']??null,'img'=>$pinPathReal,'reason'=>'invalid_image'];
                            } else {
                                // convert PNG (which may have alpha) to a JPG for reliable embedding in FPDF
                                $jpgTmp = tempnam(sys_get_temp_dir(), 'srp') . '.jpg';
                                $pngImg = @imagecreatefrompng($pinPathReal);
                                if ($pngImg) {
                                    // white background to flatten alpha
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

                                $embedPath = $jpgTmp && is_file($jpgTmp) ? $jpgTmp : $pinPathReal;
                                $tempFiles[] = $embedPath;
                                // For diagnostics: when debug enabled, write a small PDF with just the pin image
                                if ($debug && is_file($embedPath) && class_exists('\setasign\Fpdf\Fpdf')) {
                                    try {
                                        $testPdf = storage_dir('exports/pin_test_issue_' . ($issue['id'] ?? 'x') . '_' . time() . '.pdf');
                                        $pdfTest = new \setasign\Fpdf\Fpdf();
                                        $pdfTest->AddPage();
                                        $pdfTest->Image($embedPath, 10, 20, 100, 0);
                                        $pdfTest->Output('F', $testPdf);
                                        $render_debug[$issue['id'] ?? '']['test_pdf'] = $testPdf;
                                    } catch (Exception $e) {
                                        $render_debug[$issue['id'] ?? '']['test_pdf_error'] = $e->getMessage();
                                    }
                                }
                                // Copy the embed image into storage/tmp so it will be picked up by the photos loop (avoid direct embedding to keep a single code path)
                                $bn2 = 'pin_export_' . ($plan_id ?? 'p') . '_' . ($issue['id'] ?? 'i') . '_' . bin2hex(random_bytes(4)) . '.png';
                                $dst2 = storage_dir('tmp/' . $bn2);
                                if (@copy($embedPath, $dst2)) {
                                    @chmod($dst2, 0644);
                                    $render_debug[$issue['id'] ?? '']['pin_tmp'] = $dst2;
                                    $pinPhotoRel = 'tmp/' . $bn2;
                                    // ensure the generated pin is included in the photos list for this issue
                                    if (isset($ips) && is_array($ips)) {
                                        array_unshift($ips, ['file_path' => $pinPhotoRel]);
                                    }
                                    // count it as included so debug reflects it
                                    $pins_included_count++;
                                    if ($debug) $includedPins[] = ['issue_id'=>$issue['id']??null,'img'=>$dst2,'method'=>$pinMethod ?: 'copied_to_storage'];
                                } else {
                                    // fallback: embed directly if copy fails
                                    $x2 = $pdf->GetX();
                                    $pdf->Image($embedPath, $x2, null, 60, 0);
                                    $pdf->Ln(4);
                                    $render_debug[$issue['id'] ?? '']['embedded'] = true;
                                    $pins_included_count++;
                                    if ($debug) $includedPins[] = ['issue_id'=>$issue['id']??null,'img'=>$embedPath,'method'=>$pinMethod ?: 'converted_or_original_embedded'];
                                }
                                // note: using storage copy ensures the photos loop picks it up consistently across environments
                            }
                        }
                    }
                }
            }
        }
        if (!empty($pinWebPreviewPath)) {
            array_unshift($ips, ['file_path' => $pinWebPreviewPath]);
        }
        foreach ($ips as $ph) {
            $fileRel = $ph['file_path'] ?? ($ph['filename'] ?? null);
            if (!$fileRel) continue;
            // Resolve file path: prefer explicit paths, otherwise assume photos/<filename>
            if (preg_match('#^https?://#i', $fileRel)) {
                // remote URL (http/https)
                $sameOrigin = (stripos($fileRel, base_url()) === 0);
                if ($sameOrigin || !empty($_POST['fetch_remote']) || !empty($_GET['fetch_remote'])) {
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
    if ($debug && !empty($skippedPins)) {
        $allSkippedPins = array_merge($allSkippedPins, $skippedPins);
    }
    $pdf->Ln(8);
}

$filename = $safe_plan_name . $plan_revision_tag . '_plan_' . ($issue_id ? 'issue_' . $issue_id . '_' : '') . date('Ymd_His') . '.pdf';
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
// record the PDF export in DB (best-effort)
try {
    ensure_exports_table_columns($pdo);
    $stmtExp = $pdo->prepare('INSERT INTO exports (plan_id, filename, type) VALUES (?, ?, ?)');
    $etype = $issue_id ? 'issue' : 'pdf';
    $stmtExp->execute([$plan_id, $filename, $etype]);
    $expId = (int)$pdo->lastInsertId();
    $extra = $debug ? array_merge(['exports'=>get_exports_listing()], ['export_id'=>$expId]) : ['export_id'=>$expId];
} catch (Exception $e) {
    error_log('export_report: failed to record export: ' . $e->getMessage());
    $extra = $debug ? ['exports'=>get_exports_listing()] : [];
}
// Always report how many pin thumbnails were included (0 if none)
$extra['pins_included'] = $pins_included_count;
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
if ($debug && isset($allSkippedPins) && count($allSkippedPins)) {
    $extra['skipped_pins'] = $allSkippedPins;
}
// include render debug for diagnostics (always present for now)
$extra['render_debug'] = $render_debug;

// persist server-side render debug to a file (always write for inspection)
try {
    $dbgF = storage_dir('exports/render_debug_' . time() . '_' . bin2hex(random_bytes(4)) . '.json');
    @file_put_contents($dbgF, json_encode($render_debug, JSON_PRETTY_PRINT));
    $extra['render_debug_file'] = basename($dbgF);
    $extra['render_debug_path'] = $dbgF;
} catch (Exception $e) {
    // ignore file write errors
}

// cleanup any temporary files we created when fetching remote images
if (!empty($tempFiles) && is_array($tempFiles)) {
    foreach ($tempFiles as $tmpf) { if (is_file($tmpf)) @unlink($tmpf); }
}
json_response(array_merge(['ok'=>true, 'filename'=>$filename, 'path'=>$path, 'size'=>filesize($path)], $extra));
