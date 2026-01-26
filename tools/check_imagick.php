<?php
// tools/check_imagick.php
// Simple diagnostic page to check Imagick and related renderers

function safe_cmd_version($cmd, $args = '--version'){
    $bin = trim(@shell_exec("command -v " . escapeshellcmd($cmd) . " 2>/dev/null"));
    if (!$bin) return null;
    $out = @shell_exec(escapeshellcmd($bin) . ' ' . $args . ' 2>&1');
    return ['bin'=>$bin, 'version'=>trim($out)];
}

$imagick_available = class_exists('Imagick');
$imagick_ok = false;
$imagick_info = null;
$formats = [];
$imagick_err = null;
if ($imagick_available) {
    try {
        $i = new Imagick();
        $info = $i->getVersion();
        $imagick_info = is_array($info) ? ($info['versionString'] ?? json_encode($info)) : (string)$info;
        $formats = $i->queryFormats();
        $imagick_ok = true;
    } catch (Exception $e) {
        $imagick_ok = false;
        $imagick_err = $e->getMessage();
    }
}

$magick = safe_cmd_version('magick', '-version');
$convert = safe_cmd_version('convert', '-version');
$pdftoppm = safe_cmd_version('pdftoppm', '-v');
$gs = safe_cmd_version('gs', '--version');

$can_render_pdf_with_imagick = in_array('PDF', $formats) || in_array('pdf', $formats);

// Handle test render request
$test_result = null;
$show_image_param = $_GET['show_tmp'] ?? null;
if ($show_image_param) {
    // stream a temp image if it is in the system temp dir and prefixed correctly
    $tmpdir = rtrim(sys_get_temp_dir(), DIRECTORY_SEPARATOR);
    $b = basename($show_image_param);
    $path = $tmpdir . DIRECTORY_SEPARATOR . $b;
    if (strpos(realpath($path), $tmpdir) === 0 && is_file($path)) {
        header('Content-Type: image/png');
        header('Cache-Control: no-cache, no-store, must-revalidate');
        readfile($path);
        exit;
    } else {
        http_response_code(404);
        echo 'Not found';
        exit;
    }
}

if (isset($_GET['test_render'])) {
    // Attempt to render a page from the specified plan or the most recent plan
    // Load config helper and DB helper (db() depends on load_config())
    require_once __DIR__ . '/../api/config-util.php';
    require_once __DIR__ . '/../api/db.php';


    $plan_id = !empty($_GET['plan_id']) ? intval($_GET['plan_id']) : null;
    $pdo = db();
    if ($plan_id) {
        $stm = $pdo->prepare('SELECT * FROM plans WHERE id=?');
        $stm->execute([$plan_id]);
        $plan = $stm->fetch();
    } else {
        $stm = $pdo->query('SELECT * FROM plans ORDER BY id DESC LIMIT 1');
        $plan = $stm->fetch();
    }
    if (!$plan) {
        $test_result = ['ok'=>false, 'error'=>'No plan found to test render'];
    } else {
        $fileRel = $plan['file_path'] ?? null;
        // try several candidate locations so we can handle different storage layouts
        $tried = [];
        $planFile = null;
        if ($fileRel) {
            // 1) try as given (absolute/relative)
            $cand = realpath($fileRel);
            $tried[] = [$fileRel, $cand ?: null];
            if ($cand && is_file($cand)) $planFile = $cand;

            // 2) project-relative (httpdocs + fileRel)
            if (!$planFile) {
                $cand2 = realpath(__DIR__ . '/../' . ltrim($fileRel, '/'));
                $tried[] = [__DIR__ . '/../' . ltrim($fileRel, '/'), $cand2 ?: null];
                if ($cand2 && is_file($cand2)) $planFile = $cand2;
            }

            // 3) storage_dir(fileRel)
            if (!$planFile) {
                $cand3 = storage_dir($fileRel);
                $tried[] = [$cand3, is_file($cand3) ? realpath($cand3) : null];
                if (is_file($cand3)) $planFile = $cand3;
            }

            // 4) storage_dir('plans/' . basename(fileRel))
            if (!$planFile) {
                $cand4 = storage_dir('plans/' . basename($fileRel));
                $tried[] = [$cand4, is_file($cand4) ? realpath($cand4) : null];
                if (is_file($cand4)) $planFile = $cand4;
            }
        }

        if (!$planFile || !is_file($planFile)) {
            $test_result = ['ok'=>false, 'error'=>'Plan file not found or unreadable: ' . ($fileRel??'(none)'), 'tried'=>$tried];
        } else {
            // try Imagick
            $tmp = null; $method = null; $err = null;
            if ($imagick_available) {
                try {
                    $im = new Imagick();
                    $im->setResolution(150,150);
                    $im->readImage($planFile . '[0]');
                    $im->setImageFormat('png');
                    $im->thumbnailImage(400, 0);
                    $tmpfname = 'chk_imagick_' . bin2hex(random_bytes(6)) . '.png';
                    $tmp = sys_get_temp_dir() . DIRECTORY_SEPARATOR . $tmpfname;
                    $im->writeImage($tmp);
                    $method = 'imagick';
                    $im->clear();
                } catch (Exception $e) {
                    $err = $e->getMessage();
                }
            }
            // fallback to pdftoppm
            if (!$tmp && $pdftoppm) {
                $prefix = sys_get_temp_dir() . DIRECTORY_SEPARATOR . 'chk_' . bin2hex(random_bytes(6));
                $outPng = $prefix . '.png';
                $cmd = escapeshellcmd($pdftoppm['bin']) . ' -png -f 1 -singlefile -r 150 ' . escapeshellarg($planFile) . ' ' . escapeshellarg($prefix) . ' 2>&1';
                @exec($cmd, $out, $rc);
                if ($rc === 0 && is_file($outPng)) { $tmp = $outPng; $method = 'pdftoppm'; }
            }
            // fallback to gs
            if (!$tmp && $gs) {
                $prefix = sys_get_temp_dir() . DIRECTORY_SEPARATOR . 'chk_' . bin2hex(random_bytes(6));
                $outPng = $prefix . '.png';
                $cmd = escapeshellcmd($gs['bin']) . ' -dSAFER -dBATCH -dNOPAUSE -sDEVICE=pngalpha -r150 -dFirstPage=1 -dLastPage=1 -sOutputFile=' . escapeshellarg($outPng) . ' ' . escapeshellarg($planFile) . ' 2>&1';
                @exec($cmd, $out, $rc);
                if ($rc === 0 && is_file($outPng)) { $tmp = $outPng; $method = 'gs'; }
            }
            if ($tmp && is_file($tmp)) {
                $test_result = ['ok'=>true, 'method'=>$method, 'tmp'=>basename($tmp)];
            } else {
                $test_result = ['ok'=>false, 'error' => 'Render failed: ' . ($err ?? 'no renderer succeeded')];
            }
        }
    }
}

// HTML output
?><!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>Check Imagick — Survey</title>
<link rel="stylesheet" href="/assets/ui.css?v=20260125_7">
</head>
<body>
  <header class="topbar"><button onclick="history.back()" class="iconBtn">←</button><div class="brand">Imagick Diagnostic</div></header>
  <main style="padding:16px;">
    <div class="card">
      <h2>ImageMagick / Renderer Diagnostics</h2>
      <div style="display:flex;gap:12px;flex-wrap:wrap;margin-top:8px;">
        <div style="min-width:240px;">
          <strong>Imagick PHP extension</strong>
          <div class="muted">Available: <?php echo $imagick_available ? '<span style="color:green">Yes</span>' : '<span style="color:red">No</span>'; ?></div>
          <?php if ($imagick_info): ?><div class="muted">Version: <?php echo htmlspecialchars($imagick_info); ?></div><?php endif; ?>
          <?php if ($imagick_err): ?><div class="error">Error: <?php echo htmlspecialchars($imagick_err); ?></div><?php endif; ?>
        </div>

        <div style="min-width:240px;">
          <strong>ImageMagick CLI</strong>
          <div class="muted">magick: <?php echo $magick ? '<span style="color:green">Yes</span> ' . htmlspecialchars($magick['bin']) : '<span style="color:orange">No (try convert)</span>'; ?></div>
          <?php if ($convert): ?><div class="muted">convert: Yes <?php echo htmlspecialchars($convert['bin']); ?></div><?php endif; ?>
        </div>

        <div style="min-width:240px;">
          <strong>pdftoppm (Poppler)</strong>
          <div class="muted"><?php echo $pdftoppm ? '<span style="color:green">Installed</span> ' . htmlspecialchars($pdftoppm['bin']) : '<span style="color:red">Not found</span>'; ?></div>
        </div>

        <div style="min-width:240px;">
          <strong>GhostScript (gs)</strong>
          <div class="muted"><?php echo $gs ? '<span style="color:green">Installed</span> ' . htmlspecialchars($gs['bin']) : '<span style="color:red">Not found</span>'; ?></div>
        </div>

      </div>

      <div style="margin-top:12px;">
        <strong>Capabilities</strong>
        <div class="muted">Imagick reports PDF support: <?php echo $can_render_pdf_with_imagick ? '<span style="color:green">Yes</span>' : '<span style="color:orange">No</span>'; ?></div>
        <?php if ($imagick_available): ?>
          <div class="muted">Supported formats (<?php echo count($formats); ?>): <?php echo in_array('PDF', $formats) || in_array('pdf', $formats) ? '<strong>PDF</strong>' : '(PDF not listed)'; ?></div>
        <?php endif; ?>
      </div>

      <div style="margin-top:14px;display:flex;gap:8px;align-items:center;">
        <form method="get" action="check_imagick.php">
          <input type="hidden" name="test_render" value="1">
          <label style="display:inline-flex;align-items:center;gap:6px;"><span class="muted">Plan ID (optional)</span><input name="plan_id" type="number" min="1" style="margin-left:8px;width:86px" value=""></label>
          <button class="btn" type="submit">Run render test</button>
        </form>
        <div class="muted">Tip: try with a plan ID to test a real plan PDF; otherwise the most recent plan is used.</div>
      </div>

      <?php if ($test_result): ?>
        <hr>
        <h3>Render Test Result</h3>
        <?php if ($test_result['ok']): ?>
          <div style="color:green">Success — method: <?php echo htmlspecialchars($test_result['method']); ?>. Temporary PNG: <?php echo htmlspecialchars($test_result['tmp']); ?></div>
          <div style="margin-top:8px;">
            <img src="check_imagick.php?show_tmp=<?php echo urlencode($test_result['tmp']); ?>" style="max-width:100%;height:auto;border:1px solid #ccc;border-radius:6px" alt="render test">
          </div>
          <div style="margin-top:8px;">
            <a href="check_imagick.php?show_tmp=<?php echo urlencode($test_result['tmp']); ?>" target="_blank" rel="noopener noreferrer" class="btn">Open PNG in new tab</a>
            <div class="muted" style="margin-top:6px;">Temp file (server): <?php echo htmlspecialchars(sys_get_temp_dir() . DIRECTORY_SEPARATOR . $test_result['tmp']); ?></div>
          </div>
        <?php else: ?>
          <div class="error">Failed: <?php echo htmlspecialchars($test_result['error'] ?? 'Unknown'); ?></div>
        <?php endif; ?>
      <?php endif; ?>

    </div>
  </main>
</body>
</html>