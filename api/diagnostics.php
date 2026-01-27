<?php
// api/diagnostics.php
// Simple diagnostics endpoint to help validate deployment & environment
require_once __DIR__ . '/config-util.php';
require_once __DIR__ . '/db.php';
require_method('GET');

$info = [
  'ok' => true,
  'time' => date('c'),
];

// Git commit (best-effort)
$gitSha = null;
$gitDir = __DIR__ . '/../.git';
$headFile = $gitDir . '/HEAD';
if (file_exists($headFile)) {
  $head = trim(@file_get_contents($headFile));
  if ($head !== '') {
    if (strpos($head, 'ref: ') === 0) {
      $ref = substr($head, 5);
      $refFile = $gitDir . '/' . $ref;
      if (file_exists($refFile)) $gitSha = trim(@file_get_contents($refFile));
    } else {
      $gitSha = $head;
    }
  }
}
if (!$gitSha && function_exists('shell_exec')) {
  $out = @shell_exec('git rev-parse --short HEAD 2>/dev/null');
  if ($out) $gitSha = trim($out);
}
$info['git_short'] = $gitSha ? substr($gitSha,0,12) : null;

// Composer / vendor
$vendorAutoload = realpath(__DIR__ . '/../vendor/autoload.php');
$info['vendor_autoload'] = $vendorAutoload ? $vendorAutoload : null;

// PDF class availability
$info['pdf_class_exists'] = false;
if ($vendorAutoload) {
  try {
    require_once $vendorAutoload;
    $info['pdf_class_exists'] = class_exists('setasign\\Fpdf\\Fpdf');
  } catch (Throwable $e) {
    $info['pdf_class_error'] = $e->getMessage();
  }
}

// Probe for DWG/graphics utilities (if probe=dwg query param present)
if (!empty($_GET['probe']) && $_GET['probe'] === 'dwg') {
  function cmd_exists_probe($c){ $p = trim((string)shell_exec('command -v ' . escapeshellarg($c) . ' 2>/dev/null')); return $p ? $p : false; }
  $cands = ['dwg2pdf','dwg2svg','dwg2dxf','pdf2svg','convert','pdfimages','ODAFileConverter','TeighaFileConverter','libredwg'];
  $found = [];
  foreach ($cands as $c){ $p = cmd_exists_probe($c); if ($p) $found[] = $c; }
  $info['dwg'] = ['found' => $found, 'imagemagick' => (bool)cmd_exists_probe('convert')];
  json_response($info);
}

// viewer.js file info
$viewerPath = realpath(__DIR__ . '/../app/viewer.js');
if ($viewerPath && file_exists($viewerPath)) {
  $info['viewer_js'] = [
    'path' => $viewerPath,
    'size' => filesize($viewerPath),
    'sha256' => hash_file('sha256', $viewerPath),
    'mtime' => date('c', filemtime($viewerPath)),
  ];
} else {
  $info['viewer_js'] = null;
}

// DB checks
try {
  $pdo = db();
  $info['db'] = ['ok' => true];
  // check photos table columns
  $cols = $pdo->query("SHOW COLUMNS FROM photos")->fetchAll(PDO::FETCH_COLUMN);
  $info['photos_table_columns'] = $cols;
  $info['photos_expected'] = [
    'has_file_path' => in_array('file_path', $cols),
    'has_thumb_path' => in_array('thumb_path', $cols),
    'has_filename' => in_array('filename', $cols),
    'has_thumb' => in_array('thumb', $cols),
  ];
  // quick counts
  $stmt = $pdo->prepare('SELECT COUNT(*) AS c FROM issues'); $stmt->execute(); $info['issue_count'] = (int)$stmt->fetchColumn();
  $stmt2 = $pdo->prepare('SELECT COUNT(*) AS c FROM photos'); $stmt2->execute(); $info['photo_count'] = (int)$stmt2->fetchColumn();
} catch (Throwable $e) {
  $info['db'] = ['ok' => false, 'error' => $e->getMessage()];
}

// Imagick availability (server-side PHP Imagick extension)
$info['imagick'] = ['available' => class_exists('Imagick')];
if ($info['imagick']['available']) {
  try {
    $im = new Imagick();
    $ver = (array)$im->getVersion();
    $info['imagick']['version'] = $ver['versionString'] ?? null;
  } catch (Throwable $e) {
    $info['imagick']['available'] = false;
    $info['imagick']['error'] = $e->getMessage();
  }
}

json_response($info);