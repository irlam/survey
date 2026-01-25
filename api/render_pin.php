<?php
require_once __DIR__ . '/config-util.php';
require_once __DIR__ . '/db.php';
require_method('GET');

$plan_id = isset($_GET['plan_id']) ? (int)$_GET['plan_id'] : null;
$issue_id = isset($_GET['issue_id']) ? (int)$_GET['issue_id'] : null;
$page = isset($_GET['page']) ? (int)$_GET['page'] : null;
$x_norm = isset($_GET['x_norm']) ? (float)$_GET['x_norm'] : null;
$y_norm = isset($_GET['y_norm']) ? (float)$_GET['y_norm'] : null;

if (!$plan_id) {
    http_response_code(400);
    echo 'Missing plan_id';
    exit;
}

$pdo = db();
$planStmt = $pdo->prepare('SELECT * FROM plans WHERE id=?');
$planStmt->execute([$plan_id]);
$plan = $planStmt->fetch();
if (!$plan) { http_response_code(404); echo 'Plan not found'; exit; }

// If issue_id provided, fetch issue and override page/x_norm/y_norm
if ($issue_id) {
    $is = $pdo->prepare('SELECT * FROM issues WHERE id=? AND plan_id=?');
    $is->execute([$issue_id, $plan_id]);
    $issue = $is->fetch();
    if (!$issue) { http_response_code(404); echo 'Issue not found'; exit; }
    $page = $issue['page'] ?? $page;
    $x_norm = isset($issue['x_norm']) ? (float)$issue['x_norm'] : $x_norm;
    $y_norm = isset($issue['y_norm']) ? (float)$issue['y_norm'] : $y_norm;
}

if (!$page) { http_response_code(400); echo 'Missing page info'; exit; }
if ($x_norm === null || $y_norm === null) { http_response_code(400); echo 'Missing coordinates'; exit; }

// resolve plan file path
$fileRel = $plan['file_path'] ?? null;
$candidates = [];
$planFile = null;
if ($fileRel) {
    $cand = realpath($fileRel);
    $candidates[] = $cand ?: null;
    if ($cand && is_file($cand)) $planFile = $cand;
    if (!$planFile) {
        $cand2 = realpath(__DIR__ . '/../' . ltrim($fileRel, '/'));
        $candidates[] = $cand2 ?: null;
        if ($cand2 && is_file($cand2)) $planFile = $cand2;
    }
    if (!$planFile) {
        $cand3 = storage_dir($fileRel);
        $candidates[] = is_file($cand3) ? realpath($cand3) : null;
        if (is_file($cand3)) $planFile = $cand3;
    }
    if (!$planFile) {
        $cand4 = storage_dir('plans/' . basename($fileRel));
        $candidates[] = is_file($cand4) ? realpath($cand4) : null;
        if (is_file($cand4)) $planFile = $cand4;
    }
}

if (!$planFile || !is_file($planFile)) { http_response_code(404); echo 'Plan file not found'; exit; }

// attempt to render using Imagick first
$thumbWidthPx = 200; // reasonable preview size
$pinPath = __DIR__ . '/../assets/pin.png';

if (class_exists('Imagick')) {
    try {
        $im = new Imagick();
        $im->setResolution(150,150);
        $pageIndex = max(0, (int)$page - 1);
        $im->readImage($planFile . '[' . $pageIndex . ']');
        $im->setImageFormat('png');
        $im->thumbnailImage($thumbWidthPx, 0);
        $w = $im->getImageWidth(); $h = $im->getImageHeight();
        if (is_file($pinPath)) {
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
            $pin->clear();
        }
        header('Content-Type: image/png');
        header('Cache-Control: no-cache, no-store, must-revalidate');
        echo $im->getImageBlob();
        $im->clear();
        exit;
    } catch (Exception $e) {
        // fallthrough to other renderers
    }
}

// fallback to pdftoppm or gs + GD
$pdftoppm = trim(shell_exec('command -v pdftoppm 2>/dev/null'));
if ($pdftoppm) {
    $prefix = sys_get_temp_dir() . '/pinr_' . bin2hex(random_bytes(6));
    $outPng = $prefix . '.png';
    $cmd = escapeshellcmd($pdftoppm) . ' -png -f ' . (int)$page . ' -singlefile -r 150 ' . escapeshellarg($planFile) . ' ' . escapeshellarg($prefix) . ' 2>&1';
    @exec($cmd, $out, $rc);
    if ($rc === 0 && is_file($outPng) && function_exists('imagecreatefrompng')) {
        $base = @imagecreatefrompng($outPng);
        if ($base) {
            imagesavealpha($base, true); imagealphablending($base, true);
            $w = imagesx($base); $h = imagesy($base);
            if (is_file($pinPath)) {
                $pinSrc = @imagecreatefrompng($pinPath);
                if ($pinSrc) {
                    $pw = imagesx($pinSrc); $ph = imagesy($pinSrc);
                    $pinHeight = max(24, intval($h * 0.12));
                    $pw2 = intval($pw * ($pinHeight / $ph)); $ph2 = $pinHeight;
                    $resPin = imagecreatetruecolor($pw2, $ph2);
                    imagesavealpha($resPin, true);
                    $trans_colour = imagecolorallocatealpha($resPin, 0, 0, 0, 127);
                    imagefill($resPin, 0, 0, $trans_colour);
                    imagecopyresampled($resPin, $pinSrc, 0, 0, 0, 0, $pw2, $ph2, $pw, $ph);
                    $x = intval($x_norm * $w) - intval($pw2 / 2);
                    $y = intval($y_norm * $h) - $ph2;
                    $x = max(0, min($x, $w - $pw2)); $y = max(0, min($y, $h - $ph2));
                    imagecopy($base, $resPin, $x, $y, 0, 0, $pw2, $ph2);
                    header('Content-Type: image/png');
                    header('Cache-Control: no-cache, no-store, must-revalidate');
                    imagepng($base);
                    imagedestroy($base); imagedestroy($pinSrc); imagedestroy($resPin);
                    @unlink($outPng);
                    exit;
                }
            }
            imagedestroy($base);
            @unlink($outPng);
        }
    }
}

$gs = trim(shell_exec('command -v gs 2>/dev/null'));
if ($gs) {
    $prefix = sys_get_temp_dir() . '/pinr_' . bin2hex(random_bytes(6));
    $outPng = $prefix . '.png';
    $cmd = escapeshellcmd($gs) . ' -dSAFER -dBATCH -dNOPAUSE -sDEVICE=pngalpha -r150 -dFirstPage=' . (int)$page . ' -dLastPage=' . (int)$page . ' -sOutputFile=' . escapeshellarg($outPng) . ' ' . escapeshellarg($planFile) . ' 2>&1';
    @exec($cmd, $out, $rc);
    if ($rc === 0 && is_file($outPng) && function_exists('imagecreatefrompng')) {
        $base = @imagecreatefrompng($outPng);
        if ($base) {
            imagesavealpha($base, true); imagealphablending($base, true);
            $w = imagesx($base); $h = imagesy($base);
            if (is_file($pinPath)) {
                $pinSrc = @imagecreatefrompng($pinPath);
                if ($pinSrc) {
                    $pw = imagesx($pinSrc); $ph = imagesy($pinSrc);
                    $pinHeight = max(24, intval($h * 0.12));
                    $pw2 = intval($pw * ($pinHeight / $ph)); $ph2 = $pinHeight;
                    $resPin = imagecreatetruecolor($pw2, $ph2);
                    imagesavealpha($resPin, true);
                    $trans_colour = imagecolorallocatealpha($resPin, 0, 0, 0, 127);
                    imagefill($resPin, 0, 0, $trans_colour);
                    imagecopyresampled($resPin, $pinSrc, 0, 0, 0, 0, $pw2, $ph2, $pw, $ph);
                    $x = intval($x_norm * $w) - intval($pw2 / 2);
                    $y = intval($y_norm * $h) - $ph2;
                    $x = max(0, min($x, $w - $pw2)); $y = max(0, min($y, $h - $ph2));
                    imagecopy($base, $resPin, $x, $y, 0, 0, $pw2, $ph2);
                    header('Content-Type: image/png');
                    header('Cache-Control: no-cache, no-store, must-revalidate');
                    imagepng($base);
                    imagedestroy($base); imagedestroy($pinSrc); imagedestroy($resPin);
                    @unlink($outPng);
                    exit;
                }
            }
            imagedestroy($base);
            @unlink($outPng);
        }
    }
}

// nothing worked
http_response_code(204);
exit;
