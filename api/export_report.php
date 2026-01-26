<?php
require_once __DIR__ . '/config-util.php';
require_once __DIR__ . '/db.php';
if (php_sapi_name() !== 'cli') {
    // Convert PHP warnings/notices into exceptions so we can return JSON errors
    set_error_handler(function($severity, $message, $file, $line) {
        throw new ErrorException($message, 0, $severity, $file, $line);
    });
    // If a fatal error occurs, attempt to return JSON describing it (best-effort)
    register_shutdown_function(function() {
        $err = error_get_last();
        if ($err && in_array($err['type'], [E_ERROR, E_PARSE, E_CORE_ERROR, E_COMPILE_ERROR])) {
            error_log('export_report shutdown fatal: ' . print_r($err, true));
            if (!headers_sent()) {
                http_response_code(500);
                header('Content-Type: application/json; charset=utf-8');
                echo json_encode(['ok' => false, 'error' => 'Internal server error (fatal)', '_fatal' => $err]);
            }
        }
    });

    try {
        require_method('POST');
        $plan_id = safe_int($_POST['plan_id'] ?? null);
        if (!$plan_id) error_response('Missing plan_id', 400);
        $pdo = db();
        // Fetch plan data to include in reports
        $stmtPlan = $pdo->prepare('SELECT * FROM plans WHERE id=?');
        $stmtPlan->execute([$plan_id]);
        $plan = $stmtPlan->fetch();
        $plan_name = $plan['name'] ?? ('Plan ' . $plan_id);
    } catch (Throwable $e) {
        error_log('export_report exception during request init: ' . $e->getMessage() . '\n' . $e->getTraceAsString());
        // Expose exception details only when debug explicitly requested
        $extra = !empty($_REQUEST['debug']) ? ['exception' => ['message' => $e->getMessage(), 'file' => $e->getFile(), 'line' => $e->getLine(), 'trace' => $e->getTraceAsString()]] : [];
        error_response('Internal server error', 500, $extra);
    }
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

// Pin rendering mode: 'vector' (default) or 'raster' (legacy PNG embedding)
$pin_mode = 'vector';
if (isset($_POST['pin_mode'])) {
    $val = strtolower(trim((string)($_POST['pin_mode'] ?? '')));
    if (in_array($val, ['raster','image','png'])) $pin_mode = 'raster';
} elseif (isset($_GET['pin_mode'])) {
    $val = strtolower(trim((string)($_GET['pin_mode'] ?? '')));
    if (in_array($val, ['raster','image','png'])) $pin_mode = 'raster';
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
function render_pin_thumbnail($planFile, $page, $x_norm, $y_norm, $thumbWidthPx = 800, $label = null) {
    // Try Imagick first (cleanest, server-side PDF rendering + composite)
    if (class_exists('Imagick')) {
        try {
            $im = new Imagick();
            // Render at higher resolution for better quality
            $im->setResolution(300,300);
            $pageIndex = max(0, (int)$page - 1);
            $im->readImage($planFile . '[' . $pageIndex . ']');
            $im->setImageFormat('png');
            $im->thumbnailImage($thumbWidthPx, 0);
            $w = $im->getImageWidth(); $h = $im->getImageHeight();
            // Generate a neon-green SVG pin (matching UI neon theme) and rasterize it.
            // This avoids relying on filesystem `assets/pin.png` or `assets/pin.svg`.
            $safeLabel = $label !== null ? htmlspecialchars((string)$label, ENT_QUOTES | ENT_XML1, 'UTF-8') : '';
            $svg = <<<SVG
<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 80" width="64" height="80" aria-hidden="true" focusable="false">
  <defs>
    <linearGradient id="g" x1="16" y1="10" x2="52" y2="58" gradientUnits="userSpaceOnUse">
      <stop stop-color="#00FFE7"/>
      <stop offset="1" stop-color="#39FF14"/>
    </linearGradient>
  </defs>
  <path d="M32 76s20-16.3 20-34A20 20 0 1 0 12 42c0 17.7 20 34 20 34Z" fill="url(#g)"/>
  <circle cx="32" cy="26" r="11" fill="rgba(0,0,0,0.18)"/>
  <circle cx="32" cy="26" r="8.5" fill="white" fill-opacity="0.18"/>
  <text class="pin-number" x="32" y="26" text-anchor="middle" dominant-baseline="central" fill="#000" font-weight="900" font-size="12">{$safeLabel}</text>
</svg>
SVG;
            $pin = new Imagick();
            try {
                $pin->readImageBlob($svg);
                // ensure PNG has alpha preserved
                $pin->setImageBackgroundColor(new ImagickPixel('transparent'));
                if (defined('Imagick::ALPHACHANNEL_SET')) $pin->setImageAlphaChannel(Imagick::ALPHACHANNEL_SET);
                $pin->setImageFormat('png');
            } catch (Exception $e) {
                // If Imagick fails to rasterize SVG, fall back to existing raster PNG if available
                $pin = null;
                $pinPath = __DIR__ . '/../assets/pin.png';
                if (is_file($pinPath)) {
                    try { $pin = new Imagick($pinPath); $pin->setImageFormat('png'); } catch (Exception $_) { $pin = null; }
                }
            }
            $pinHeight = max(40, intval($h * 0.12));
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
    $pdftoppm = trim((string)shell_exec('command -v pdftoppm 2>/dev/null'));
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
    $gs = trim((string)shell_exec('command -v gs 2>/dev/null'));
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

// Render a small thumbnail of just the plan page (no pin) and return path + method + pixel dims.
// Returns ['tmp'=>path,'method'=>string,'w'=>px,'h'=>px] or null on failure.
function render_plan_thumbnail($planFile, $page = 1, $thumbWidthPx = 800) {
    // Prefer external renderers first (pdftoppm/gs) which are often
    // available on servers and can be more reliable than Imagick in some envs.
    $pdftoppm = trim((string)shell_exec('command -v pdftoppm 2>/dev/null'));
    if ($pdftoppm) {
        $prefix = sys_get_temp_dir() . '/planr_' . bin2hex(random_bytes(6));
        $outPng = $prefix . '.png';
        $cmd = escapeshellcmd($pdftoppm) . ' -png -f ' . (int)$page . ' -singlefile -r 150 ' . escapeshellarg($planFile) . ' ' . escapeshellarg($prefix) . ' 2>&1';
        @exec($cmd, $out, $rc);
        if ($rc === 0 && is_file($outPng)) {
            if (function_exists('imagecreatefrompng')) {
                $src = @imagecreatefrompng($outPng);
                if ($src) {
                    $w0 = imagesx($src); $h0 = imagesy($src);
                    $scale = min(1, $thumbWidthPx / $w0);
                    $nw = max(1, intval($w0 * $scale)); $nh = max(1, intval($h0 * $scale));
                    $outIm = imagecreatetruecolor($nw, $nh);
                    imagesavealpha($outIm, true);
                    $trans = imagecolorallocatealpha($outIm, 0, 0, 0, 127);
                    imagefilledrectangle($outIm, 0, 0, $nw, $nh, $trans);
                    imagecopyresampled($outIm, $src, 0, 0, 0, 0, $nw, $nh, $w0, $h0);
                    $tmp = tempnam(sys_get_temp_dir(), 'planthumb_') . '.png';
                    imagepng($outIm, $tmp);
                    imagedestroy($outIm); imagedestroy($src);
                    @unlink($outPng);
                    return ['tmp'=>$tmp,'method'=>'pdftoppm','w'=>$nw,'h'=>$nh];
                } else {
                    return ['tmp'=>$outPng,'method'=>'pdftoppm','w'=>null,'h'=>null];
                }
            } else {
                return ['tmp'=>$outPng,'method'=>'pdftoppm','w'=>null,'h'=>null];
            }
        }
    }

    // GhostScript fallback
    $gs = trim((string)shell_exec('command -v gs 2>/dev/null'));
    if ($gs) {
        $prefix = sys_get_temp_dir() . '/planr_' . bin2hex(random_bytes(6));
        $outPng = $prefix . '.png';
        $cmd = escapeshellcmd($gs) . ' -dSAFER -dBATCH -dNOPAUSE -sDEVICE=pngalpha -r150 -dFirstPage=' . (int)$page . ' -dLastPage=' . (int)$page . ' -sOutputFile=' . escapeshellarg($outPng) . ' ' . escapeshellarg($planFile) . ' 2>&1';
        @exec($cmd, $out, $rc);
        if ($rc === 0 && is_file($outPng)) {
            if (function_exists('imagecreatefrompng')) {
                $src = @imagecreatefrompng($outPng);
                if ($src) {
                    $w0 = imagesx($src); $h0 = imagesy($src);
                    $scale = min(1, $thumbWidthPx / $w0);
                    $nw = max(1, intval($w0 * $scale)); $nh = max(1, intval($h0 * $scale));
                    $outIm = imagecreatetruecolor($nw, $nh);
                    imagesavealpha($outIm, true);
                    $trans = imagecolorallocatealpha($outIm, 0, 0, 0, 127);
                    imagefilledrectangle($outIm, 0, 0, $nw, $nh, $trans);
                    imagecopyresampled($outIm, $src, 0, 0, 0, 0, $nw, $nh, $w0, $h0);
                    $tmp = tempnam(sys_get_temp_dir(), 'planthumb_') . '.png';
                    imagepng($outIm, $tmp);
                    imagedestroy($outIm); imagedestroy($src);
                    @unlink($outPng);
                    return ['tmp'=>$tmp,'method'=>'gs','w'=>$nw,'h'=>$nh];
                } else {
                    return ['tmp'=>$outPng,'method'=>'gs','w'=>null,'h'=>null];
                }
            } else {
                return ['tmp'=>$outPng,'method'=>'gs','w'=>null,'h'=>null];
            }
        }
    }

    // Try Imagick as a fallback (works when available)
    if (class_exists('Imagick')) {
        try {
            $im = new Imagick();
            $im->setResolution(150,150);
            $pageIndex = max(0, (int)$page - 1);
            $im->readImage($planFile . '[' . $pageIndex . ']');
            $im->setImageFormat('png');
            $im->thumbnailImage($thumbWidthPx, 0);
            $tmp = tempnam(sys_get_temp_dir(), 'planthumb_') . '.png';
            $im->setImageFormat('png');
            $im->writeImage($tmp);
            $w = $im->getImageWidth(); $h = $im->getImageHeight();
            $im->clear();
            return ['tmp'=>$tmp,'method'=>'imagick','w'=>$w,'h'=>$h];
        } catch (Exception $e) {
            error_log('render_plan_thumbnail imagick failed for ' . $planFile . ' page=' . (int)$page . ' err=' . $e->getMessage());
        }
    }

    // If the plan is already an image, resize with GD if available (last resort)
    $imgExt = strtolower(pathinfo($planFile, PATHINFO_EXTENSION));
    if (in_array($imgExt, ['png','jpg','jpeg','gif'])) {
        if (function_exists('imagecreatefrompng') && function_exists('imagecopyresampled')) {
            $src = null;
            switch ($imgExt) {
                case 'png': $src = @imagecreatefrompng($planFile); break;
                case 'jpg': case 'jpeg': $src = @imagecreatefromjpeg($planFile); break;
                case 'gif': $src = @imagecreatefromgif($planFile); break;
            }
            if ($src) {
                $w0 = imagesx($src); $h0 = imagesy($src);
                $scale = min(1, $thumbWidthPx / $w0);
                $nw = max(1, intval($w0 * $scale)); $nh = max(1, intval($h0 * $scale));
                $out = imagecreatetruecolor($nw, $nh);
                imagesavealpha($out, true);
                $trans = imagecolorallocatealpha($out, 0, 0, 0, 127);
                imagefilledrectangle($out, 0, 0, $nw, $nh, $trans);
                imagecopyresampled($out, $src, 0, 0, 0, 0, $nw, $nh, $w0, $h0);
                $tmp = tempnam(sys_get_temp_dir(), 'planthumb_') . '.png';
                imagepng($out, $tmp);
                imagedestroy($out); imagedestroy($src);
                return ['tmp'=>$tmp,'method'=>'gd_image','w'=>$nw,'h'=>$nh];
            }
        }
    }

    error_log('render_plan_thumbnail: failed to render plan ' . $planFile . ' page=' . (int)$page);
    return null;
}

// When included from CLI, don't run the endpoint code so tests can include this file
if (php_sapi_name() === 'cli') return;

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
    // Subclass FPDF to add vector pin drawing helpers (ellipse + simple teardrop tail)
    class PDF_With_Pins extends \setasign\Fpdf\Fpdf {
        // output a cubic bezier arc (helper for ellipse)
        protected function _Arc($x1, $y1, $x2, $y2, $x3, $y3) {
            $this->_out(sprintf('%.2F %.2F %.2F %.2F %.2F %.2F c', $x1*$this->k, ($this->h-$y1)*$this->k, $x2*$this->k, ($this->h-$y2)*$this->k, $x3*$this->k, ($this->h-$y3)*$this->k));
        }
        // draw an ellipse centered at x,y with radii rx,ry (style: 'F' fill, 'S' stroke, 'B' both)
        public function Ellipse($x, $y, $rx, $ry, $style='F') {
            $lx = 4/3 * (sqrt(2) - 1);
            $k = $this->k; $h = $this->h;
            $this->_out('q');
            // set current fill/draw color operators (already stored by SetFillColor/SetDrawColor)
            $this->_out($this->FillColor);
            $this->_out($this->DrawColor);
            // start path at rightmost point
            $this->_out(sprintf('%.2F %.2F m', ($x+$rx)*$k, ($h-$y)*$k));
            $this->_Arc($x+$rx, $y-$ry*$lx, $x+$rx*$lx, $y-$ry, $x, $y-$ry);
            $this->_Arc($x-$rx*$lx, $y-$ry, $x-$rx, $y-$ry*$lx, $x-$rx, $y);
            $this->_Arc($x-$rx, $y+$ry*$lx, $x-$rx*$lx, $y+$ry, $x, $y+$ry);
            $this->_Arc($x+$rx*$lx, $y+$ry, $x+$rx, $y+$ry*$lx, $x+$rx, $y);
            if ($style === 'F') $this->_out('f');
            elseif ($style === 'FD' || $style === 'DF') $this->_out('B');
            else $this->_out('S');
            $this->_out('Q');
        }
        // Draw a simple vector pin at top-left origin x,y with given width (mm). Label is optional.
        public function DrawPinAt($x, $y, $width, $label = null) {
            // Improved teardrop pin: round head + smooth curved tail; tuned proportions to avoid vertical stretching
            $w = $width;
            // head radius bigger so the head is dominant and number fits
            $headR = max(4, $w * 0.40);
            // shorter overall height so pin isn't elongated
            $totalH = max($w * 0.9, $headR * 2 + 6);
            $cx = $x + ($w/2);
            $tailTopY = $y + ($headR * 0.8);
            $tipY = $y + $totalH;

            // colors
            $this->SetDrawColor(6,56,56);
            $this->SetFillColor(0,255,160);

            // Draw smooth tail using two cubic Bezier segments for a teardrop shape
            $k = $this->k; $H = $this->h;
            $x1 = $cx - ($headR * 0.45); $y1 = $tailTopY;
            $x2 = $cx + ($headR * 0.45); $y2 = $tailTopY;
            $ctrl1x = $cx - ($headR * 0.8); $ctrl1y = ($tailTopY + $tipY) / 2;
            $ctrl2x = $cx - ($headR * 0.12); $ctrl2y = $tipY - ($headR * 0.12);
            $ctrl3x = $cx + ($headR * 0.12); $ctrl3y = $tipY - ($headR * 0.12);
            $ctrl4x = $cx + ($headR * 0.8); $ctrl4y = ($tailTopY + $tipY) / 2;

            $this->_out('q');
            $this->_out($this->FillColor);
            $this->_out($this->DrawColor);
            $this->_out(sprintf('%.2F %.2F m', $x1*$k, ($H-$y1)*$k));
            $this->_out(sprintf('%.2F %.2F %.2F %.2F %.2F %.2F c', $ctrl1x*$k, ($H-$ctrl1y)*$k, $ctrl2x*$k, ($H-$ctrl2y)*$k, $cx*$k, ($H-$tipY)*$k));
            $this->_out(sprintf('%.2F %.2F %.2F %.2F %.2F %.2F c', $ctrl3x*$k, ($H-$ctrl3y)*$k, $ctrl4x*$k, ($H-$ctrl4y)*$k, $x2*$k, ($H-$y2)*$k));
            $this->_out('h');
            $this->_out('f');
            $this->_out('Q');

            // head circle
            $this->SetFillColor(57,255,20);
            $this->SetDrawColor(6,56,56);
            $this->Ellipse($cx, $y + ($headR * 0.9), $headR, $headR, 'F');

            // inner glossy circle
            $this->SetFillColor(255,255,255);
            $this->Ellipse($cx, $y + ($headR * 0.9) - 0.5, max(1, $headR * 0.45), max(1, $headR * 0.45), 'F');

            // label text (centered)
            if ($label !== null && $label !== '') {
                $fontPt = max(8, min(14, (int)round($headR * 0.9)));
                $this->SetFont('Arial','B',$fontPt);
                $this->SetTextColor(0,0,0);
                $txtW = $this->GetStringWidth((string)$label);
                // center horizontally; vertical adjustment so text sits centrally in the head circle
                $tx = $cx - ($txtW / 2);
                $ty = $y + ($headR * 0.9) - ($fontPt * 0.35);
                $this->SetXY($tx, $ty);
                $this->Cell($txtW, $fontPt/2 + 0.5, (string)$label, 0, 0, 'C');
            }
        }
    }
    $pdf = new PDF_With_Pins();
} elseif (class_exists('FPDF')) {
    // Fallback for non-namespaced FPDF
    class PDF_With_Pins_Global extends \FPDF {
        protected function _Arc($x1, $y1, $x2, $y2, $x3, $y3) {
            $this->_out(sprintf('%.2F %.2F %.2F %.2F %.2F %.2F c', $x1*$this->k, ($this->h-$y1)*$this->k, $x2*$this->k, ($this->h-$y2)*$this->k, $x3*$this->k, ($this->h-$y3)*$this->k));
        }
        public function Ellipse($x, $y, $rx, $ry, $style='F') {
            $lx = 4/3 * (sqrt(2) - 1);
            $k = $this->k; $h = $this->h;
            $this->_out('q');
            $this->_out($this->FillColor);
            $this->_out($this->DrawColor);
            $this->_out(sprintf('%.2F %.2F m', ($x+$rx)*$k, ($h-$y)*$k));
            $this->_Arc($x+$rx, $y-$ry*$lx, $x+$rx*$lx, $y-$ry, $x, $y-$ry);
            $this->_Arc($x-$rx*$lx, $y-$ry, $x-$rx, $y-$ry*$lx, $x-$rx, $y);
            $this->_Arc($x-$rx, $y+$ry*$lx, $x-$rx*$lx, $y+$ry, $x, $y+$ry);
            $this->_Arc($x+$rx*$lx, $y+$ry, $x+$rx, $y+$ry*$lx, $x+$rx, $y);
            if ($style === 'F') $this->_out('f');
            elseif ($style === 'FD' || $style === 'DF') $this->_out('B');
            else $this->_out('S');
            $this->_out('Q');
        }
        public function DrawPinAt($x, $y, $width, $label = null) {
            // Improved teardrop pin (global FPDF fallback variant)
            $w = $width; $headR = max(4, $w * 0.40); $totalH = max($w * 0.9, $headR * 2 + 6);
            $cx = $x + ($w/2); $tailTopY = $y + ($headR * 0.8); $tipY = $y + $totalH;
            $this->SetDrawColor(6,56,56); $this->SetFillColor(0,255,160);
            $k = $this->k; $H = $this->h;
            $x1 = $cx - ($headR * 0.45); $y1 = $tailTopY; $x2 = $cx + ($headR * 0.45); $y2 = $tailTopY;
            $ctrl1x = $cx - ($headR * 0.8); $ctrl1y = ($tailTopY + $tipY) / 2;
            $ctrl2x = $cx - ($headR * 0.12); $ctrl2y = $tipY - ($headR * 0.12);
            $ctrl3x = $cx + ($headR * 0.12); $ctrl3y = $tipY - ($headR * 0.12);
            $ctrl4x = $cx + ($headR * 0.8); $ctrl4y = ($tailTopY + $tipY) / 2;
            $this->_out('q'); $this->_out($this->FillColor); $this->_out($this->DrawColor);
            $this->_out(sprintf('%.2F %.2F m', $x1*$k, ($H-$y1)*$k));
            $this->_out(sprintf('%.2F %.2F %.2F %.2F %.2F %.2F c', $ctrl1x*$k, ($H-$ctrl1y)*$k, $ctrl2x*$k, ($H-$ctrl2y)*$k, $cx*$k, ($H-$tipY)*$k));
            $this->_out(sprintf('%.2F %.2F %.2F %.2F %.2F %.2F c', $ctrl3x*$k, ($H-$ctrl3y)*$k, $ctrl4x*$k, ($H-$ctrl4y)*$k, $x2*$k, ($H-$y2)*$k));
            $this->_out('h'); $this->_out('f'); $this->_out('Q');
            $this->SetFillColor(57,255,20); $this->SetDrawColor(6,56,56);
            $this->Ellipse($cx, $y + ($headR * 0.9), $headR, $headR, 'F');
            $this->SetFillColor(255,255,255); $this->Ellipse($cx, $y + ($headR * 0.9) - 0.5, max(1, $headR * 0.45), max(1, $headR * 0.45), 'F');
            if ($label !== null && $label !== '') {
                $fontPt = max(8, min(14, (int)round($headR * 0.9)));
                $this->SetFont('Arial','B',$fontPt);
                $this->SetTextColor(0,0,0);
                $txtW = $this->GetStringWidth((string)$label);
                $tx = $cx - ($txtW / 2);
                $ty = $y + ($headR * 0.9) - ($fontPt * 0.35);
                $this->SetXY($tx, $ty);
                $this->Cell($txtW, $fontPt/2 + 0.5, (string)$label, 0, 0, 'C');
            }
        }
    }
    $pdf = new PDF_With_Pins_Global();
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
$allSkippedPins = [];
$render_debug = [];
$pins_included_count = 0;
foreach ($issue_list as $issue) {
    $skippedPhotos = []; // per-issue debug info about skipped photos
    $skippedPins = []; // per-issue debug info about skipped pin thumbnails
    $render_debug[$issue['id'] ?? ''] = ['plan_file_used'=>null,'http_fetch_ok'=>false,'render_method'=>null,'pin_tmp'=>null,'embedded'=>false,'skip_reason'=>null];
    // Ensure pin coordinates exist for this issue. If missing, generate sensible defaults
    // and persist them so subsequent rendering endpoints (eg. render_pin.php) have values.
    if (!isset($issue['x_norm']) || $issue['x_norm'] === null || $issue['x_norm'] === '') {
        $x_def = 0.5; $y_def = 0.5;
        try {
            $stmtUpd = $pdo->prepare('UPDATE issues SET x_norm=?, y_norm=? WHERE id=? AND plan_id=?');
            $stmtUpd->execute([$x_def, $y_def, $issue['id'] ?? null, $plan_id]);
            $issue['x_norm'] = $x_def; $issue['y_norm'] = $y_def;
            if ($debug) error_log('export_report: generated default coords for issue=' . ($issue['id'] ?? '') . ' => x_norm=' . $x_def . ' y_norm=' . $y_def);
        } catch (Exception $e) {
            if ($debug) error_log('export_report: failed to persist default coords for issue=' . ($issue['id'] ?? '') . ' error=' . $e->getMessage());
        }
    }
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
            // Prefer server-side internal renderer first (works when HTTP to localhost is blocked);
            // fall back to HTTP-rendered thumbnail if internal render fails.
            // Prefer plan-only thumbnail + vector overlay when available
            $planThumb = render_plan_thumbnail($planFile, $issue['page'] ?? 1, 800);
            if ($planThumb) {
                $render_debug[$issue['id'] ?? '']['plan_file_used'] = $planFile;
                $render_debug[$issue['id'] ?? '']['render_method'] = $planThumb['method'] ?? null;
                $tmpThumb = $planThumb['tmp'];
                $tempFiles[] = $tmpThumb;
                $imgInfo = @getimagesize($tmpThumb);
                $w_px = $imgInfo ? $imgInfo[0] : ($planThumb['w'] ?? null);
                $h_px = $imgInfo ? $imgInfo[1] : ($planThumb['h'] ?? null);
                if ($w_px && $h_px) {
                    $thumbWidthMM = 25; // small plan preview width (reduced by 50%)
                    $thumbHeightMM = $thumbWidthMM * ($h_px / $w_px);
                    $x2 = $pdf->GetX();
                    $yTop = $pdf->GetY();
                    $pdf->Image($tmpThumb, $x2, $yTop, $thumbWidthMM, 0);
                    if ($pin_mode === 'vector') {
                        // Draw vector pin centered at normalized coords on the placed thumbnail
                        $pinWidthMM = min(14, max(8, $thumbWidthMM * 0.18));
                        $pinX = $x2 + ($issue['x_norm'] ?? 0.5) * $thumbWidthMM - ($pinWidthMM / 2);
                        $pinY = $yTop + ($issue['y_norm'] ?? 0.5) * $thumbHeightMM - ($pinWidthMM * 0.9);
                        $pdf->DrawPinAt($pinX, $pinY, $pinWidthMM, ($issue['id'] ?? null));
                        $pdf->Ln($thumbHeightMM + 4);
                        $pins_included_count++;
                        if ($debug) $includedPins[] = ['issue_id'=>$issue['id']??null,'method'=>'vector_draw','plan_thumb'=>$tmpThumb,'render_method'=>$planThumb['method'] ?? null];
                    } else {
                        // Raster: generate a composite with pin and embed it on top of the placed plan image
                        $pinImg = render_pin_thumbnail($planFile, $issue['page'] ?? 1, $issue['x_norm'] ?? 0.5, $issue['y_norm'] ?? 0.5, 800, ($issue['id'] ?? null));
                        if ($pinImg) {
                            $pinPathReal = $pinImg['tmp'] ?? null;
                            if ($pinPathReal && is_file($pinPathReal)) {
                                $pdf->Image($pinPathReal, $x2, $yTop, $thumbWidthMM, 0);
                                $pdf->Ln($thumbHeightMM + 4);
                                $pins_included_count++;
                                if ($debug) $includedPins[] = ['issue_id'=>$issue['id']??null,'img'=>$pinPathReal,'method'=>'raster_embedded'];
                            }
                        } else {
                            $pdf->Ln($thumbHeightMM + 4);
                        }
                    }
                } else {
                    // Unknown pixel dims; place a fallback-sized image (reduced)
                    $x2 = $pdf->GetX(); $yTop = $pdf->GetY(); $pdf->Image($tmpThumb, $x2, $yTop, 25, 0); $pdf->Ln(28);
                }
            } else {
                // fallback: try raster pin renderer and embed directly as before
                $pinImg = render_pin_thumbnail($planFile, $issue['page'] ?? 1, $issue['x_norm'] ?? 0.5, $issue['y_norm'] ?? 0.5, 800, ($issue['id'] ?? null));
                if (!$pinImg) {
                    $renderUrl = base_url() . '/api/render_pin.php?plan_id=' . urlencode($plan_id) . '&issue_id=' . urlencode($issue['id'] ?? '');
                    $imgData = @file_get_contents($renderUrl);
                    if ($imgData !== false && strlen($imgData) > 200) {
                        $tmpf = tempnam(sys_get_temp_dir(), 'srp') . '.png';
                        file_put_contents($tmpf, $imgData);
                        if (is_file($tmpf) && filesize($tmpf) > 0) $pinImg = ['tmp'=>$tmpf,'method'=>'http_render'];
                    }
                }
                if ($debug) { error_log('export_report: render_pin attempt for issue=' . ($issue['id'] ?? '') . ' plan=' . $planFile . ' result=' . var_export($pinImg, true)); $includedPins[] = ['issue_id'=>$issue['id']??null,'plan_file_used'=>$planFile]; }
                if (!$pinImg && $debug) { $skippedPins[] = ['issue_id'=>$issue['id']??null,'reason'=>'render_failed','plan_file'=>$planFile,'render_result'=> (is_array($pinImg) ? $pinImg : ['value' => $pinImg])]; }
                if ($pinImg) {
                    // record that a plan image was used even if it contains a raster pin (fallback)
                    $render_debug[$issue['id'] ?? '']['plan_file_used'] = $planFile;
                    $render_debug[$issue['id'] ?? '']['render_method'] = is_array($pinImg) ? ($pinImg['method'] ?? null) : null;

                    $pinPathReal = is_array($pinImg) ? ($pinImg['tmp'] ?? null) : $pinImg;
                    $pinMethod = is_array($pinImg) ? ($pinImg['method'] ?? null) : null;
                    if ($pinPathReal && is_file($pinPathReal) && filesize($pinPathReal)>0 && @getimagesize($pinPathReal)) {
                        $tempFiles[] = $pinPathReal;
                        // If plan thumbnail was not available, embed the raster composite so the exported PDF still shows plan context
                        $x2 = $pdf->GetX(); $yTop = $pdf->GetY();
                        $pdf->Image($pinPathReal, $x2, $yTop, 50, 0);
                        $pdf->Ln(54);
                        $pins_included_count++;
                        if ($debug) $includedPins[] = ['issue_id'=>$issue['id']??null,'img'=>$pinPathReal,'method'=>$pinMethod ?: 'raster_fallback_embedded'];
                    } else { if ($debug) $skippedPins[] = ['issue_id'=>$issue['id']??null,'img'=>$pinPathReal,'reason'=>'invalid_or_missing']; }
                }
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
                    // Prefer a plan-only thumbnail for vector overlay; fall back to pin-render for raster or when plan-thumb unavailable.
                    $planThumb = render_plan_thumbnail($planFile, $issue['page'] ?? 1, 800);
                    if ($planThumb && $pin_mode === 'vector') {
                        $render_debug[$issue['id'] ?? '']['plan_file_used'] = $planFile;
                        $render_debug[$issue['id'] ?? '']['render_method'] = $planThumb['method'] ?? null;
                        $tmpThumb = $planThumb['tmp'];
                        $tempFiles[] = $tmpThumb;
                        $imgInfo = @getimagesize($tmpThumb);
                        $w_px = $imgInfo ? $imgInfo[0] : ($planThumb['w'] ?? null);
                        $h_px = $imgInfo ? $imgInfo[1] : ($planThumb['h'] ?? null);
                        if ($w_px && $h_px) {
                            $thumbWidthMM = 30; // reduced by 50%
                            $thumbHeightMM = $thumbWidthMM * ($h_px / $w_px);
                            $x2 = $pdf->GetX(); $yTop = $pdf->GetY();
                            $pdf->Image($tmpThumb, $x2, $yTop, $thumbWidthMM, 0);
                            $pinWidthMM = min(14, max(8, $thumbWidthMM * 0.18));
                            $pinX = $x2 + ($issue['x_norm'] ?? 0.5) * $thumbWidthMM - ($pinWidthMM / 2);
                            $pinY = $yTop + ($issue['y_norm'] ?? 0.5) * $thumbHeightMM - ($pinWidthMM * 0.9);
                            $pdf->DrawPinAt($pinX, $pinY, $pinWidthMM, ($issue['id'] ?? null));
                            $pdf->Ln($thumbHeightMM + 4);
                            $render_debug[$issue['id'] ?? '']['pin_tmp'] = null;
                            $pins_included_count++;
                            if ($debug) $includedPins[] = ['issue_id'=>$issue['id']??null,'method'=>'vector_draw','plan_thumb'=>$tmpThumb];
                        } else {
                            // fallback placement if dims unknown (reduced)
                            $x2 = $pdf->GetX(); $yTop = $pdf->GetY(); $pdf->Image($tmpThumb, $x2, $yTop, 30, 0); $pdf->DrawPinAt($x2 + 15, $yTop + 15, 8, ($issue['id'] ?? null)); $pdf->Ln(34);
                        }
                    } else {
                        // Raster path or planThumb absent: render a pin-composited PNG and proceed with existing copy-to-storage flow
                        $pinImg = render_pin_thumbnail($planFile, $issue['page'] ?? 1, $issue['x_norm'] ?? 0.5, $issue['y_norm'] ?? 0.5, 800, ($issue['id'] ?? null));
                        if (!$pinImg) {
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
                            // record plan_file_used so diagnostics show which plan was used for the image
                            $render_debug[$issue['id'] ?? '']['plan_file_used'] = $planFile;
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
                                // Prefer PNG embed to preserve transparency (FPDF supports PNG).
                                $embedPath = $pinPathReal;
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
                                // Copy the embed image into storage/tmp so it will be picked up by the photos loop
                                // Preserve the embed file's extension so FPDF sees the correct format.
                                $ext = strtolower(pathinfo($embedPath, PATHINFO_EXTENSION)) ?: 'png';
                                $bn2 = 'pin_export_' . ($plan_id ?? 'p') . '_' . ($issue['id'] ?? 'i') . '_' . bin2hex(random_bytes(4)) . '.' . $ext;
                                $dst2 = storage_dir('tmp/' . $bn2);
                                // If embed is a PNG, re-encode with GD to ensure proper alpha channel is preserved.
                                $prepareEmbed = $embedPath;
                                $ext = strtolower(pathinfo($embedPath, PATHINFO_EXTENSION));
                                if ($ext === 'png' && function_exists('imagecreatefrompng')) {
                                    try {
                                        $tmpAlpha = tempnam(sys_get_temp_dir(), 'pinalpha_') . '.png';
                                        $srcIm = @imagecreatefrompng($embedPath);
                                        if ($srcIm) {
                                            $w0 = imagesx($srcIm); $h0 = imagesy($srcIm);
                                            $outIm = imagecreatetruecolor($w0, $h0);
                                            imagealphablending($outIm, false);
                                            imagesavealpha($outIm, true);
                                            $transparent = imagecolorallocatealpha($outIm, 0, 0, 0, 127);
                                            imagefilledrectangle($outIm, 0, 0, $w0, $h0, $transparent);
                                            imagecopyresampled($outIm, $srcIm, 0, 0, 0, 0, $w0, $h0, $w0, $h0);
                                            imagepng($outIm, $tmpAlpha);
                                            imagedestroy($outIm);
                                            imagedestroy($srcIm);
                                            $prepareEmbed = $tmpAlpha;
                                            $tempFiles[] = $tmpAlpha; // ensure cleanup later
                                        }
                                    } catch (Exception $_) {
                                        // ignore - fall back to original embed
                                        $prepareEmbed = $embedPath;
                                    }
                                }
                                if (@copy($prepareEmbed, $dst2)) {
                                    @chmod($dst2, 0644);
                                    $render_debug[$issue['id'] ?? '']['pin_tmp'] = $dst2;
                                    $pinPhotoRel = 'tmp/' . $bn2;
                                    // Inject generated pin PNG into photos list only when raster mode is requested
                                    if ($pin_mode === 'raster' && isset($ips) && is_array($ips)) {
                                        array_unshift($ips, ['file_path' => $pinPhotoRel]);
                                        $pins_included_count++;
                                        if ($debug) $includedPins[] = ['issue_id'=>$issue['id']??null,'img'=>$dst2,'method'=>$pinMethod ?: 'copied_to_storage'];
                                    } else {
                                        // vector mode: mark included and continue (pin will be drawn as vector later)
                                        $pins_included_count++;
                                        if ($debug) $includedPins[] = ['issue_id'=>$issue['id']??null,'img'=>$dst2,'method'=>'vector_draw_available'];
                                    }
                                } else {
                                    if ($pin_mode === 'raster') {
                                        // fallback: embed directly if copy fails
                                        $x2 = $pdf->GetX();
                                        $pdf->Image($prepareEmbed, $x2, null, 60, 0);
                                        $pdf->Ln(4);
                                        $render_debug[$issue['id'] ?? '']['embedded'] = true;
                                        $pins_included_count++;
                                        if ($debug) $includedPins[] = ['issue_id'=>$issue['id']??null,'img'=>$prepareEmbed,'method'=>$pinMethod ?: 'converted_or_original_embedded'];
                                    } else {
                                        // fallback: draw vector pin directly (guaranteed transparent vector)
                                        $x2 = $pdf->GetX();
                                        $pdf->DrawPinAt($x2, $pdf->GetY(), 60, ($issue['id'] ?? null));
                                        $pdf->Ln(4);
                                        $render_debug[$issue['id'] ?? '']['embedded'] = true;
                                        $pins_included_count++;
                                        if ($debug) $includedPins[] = ['issue_id'=>$issue['id']??null,'method'=>'vector_draw','fallback_embed'=>$prepareEmbed,'orig_method'=>$pinMethod ?: null];
                                    }
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
