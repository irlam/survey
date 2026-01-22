<?php
require_once __DIR__ . '/config-util.php';
require_once __DIR__ . '/db.php';
require_method('POST');

// Accept a DWG/DXF upload and attempt conversion to PDF/SVG/DXF using available system tools.
$fmt = strtolower($_POST['format'] ?? ($_REQUEST['format'] ?? 'pdf'));
if (empty($_FILES['file']) || empty($_FILES['file']['tmp_name']) || !is_uploaded_file($_FILES['file']['tmp_name'])) {
    error_response('Missing file upload (field name=file)', 400);
}
$origName = $_FILES['file']['name'] ?? 'upload.dwg';
$ext = strtolower(pathinfo($origName, PATHINFO_EXTENSION));
if (!in_array($ext, ['dwg','dxf'])) {
    error_response('Unsupported file type. Expect .dwg or .dxf', 415);
}

$tmp = $_FILES['file']['tmp_name'];
$sha = sha1_file($tmp);
$rand = bin2hex(random_bytes(6));
$baseName = sprintf('dwg_%s_%s', substr($sha,0,8), $rand);
$destRel = 'tmp/' . $baseName . '.' . $ext;
$dest = storage_dir($destRel);
if (!@move_uploaded_file($tmp, $dest)) {
    // fallback copy
    if (!@copy($_FILES['file']['tmp_name'], $dest)) error_response('Failed to store uploaded file', 500);
}

// Helper: command exists
function cmd_exists($cmd){ $p = trim((string)shell_exec('command -v ' . escapeshellarg($cmd) . ' 2>/dev/null')); return $p ? $p : false; }

$available = [];
// probe common converter commands
$probeCmds = ['dwg2pdf','dwg2svg','dwg2dxf','dwg2ps','libredwg','testiga','oda','ODAFileConverter','TeighaFileConverter','pstoedit','convert'];
foreach ($probeCmds as $c){ $p = cmd_exists($c); if ($p) $available[] = $c; }

// Choose conversion strategy
$outFilename = null;
$outPath = null;

try {
    if ($fmt === 'svg') {
        // prefer dwg2svg
        if ($p = cmd_exists('dwg2svg')) {
            $out = storage_dir('exports/' . $baseName . '.svg');
            $cmd = escapeshellcmd($p) . ' ' . escapeshellarg($dest) . ' ' . escapeshellarg($out) . ' 2>&1';
            $outTxt = shell_exec($cmd);
            if (is_file($out) && filesize($out) > 0) { $outFilename = basename($out); $outPath = $out; }
            else throw new Exception('dwg2svg failed: ' . $outTxt);
        } elseif ($p = cmd_exists('dwg2pdf')) {
            // create PDF and then convert to SVG using pdf2svg if available
            $inter = storage_dir('exports/' . $baseName . '.pdf');
            $cmd = escapeshellcmd($p) . ' ' . escapeshellarg($dest) . ' ' . escapeshellarg($inter) . ' 2>&1';
            $outTxt = shell_exec($cmd);
            if (is_file($inter) && filesize($inter) > 0) {
                if ($q = cmd_exists('pdf2svg')) {
                    $out = storage_dir('exports/' . $baseName . '.svg');
                    $c2 = escapeshellcmd($q) . ' ' . escapeshellarg($inter) . ' ' . escapeshellarg($out) . ' 2>&1';
                    $outTxt2 = shell_exec($c2);
                    if (is_file($out) && filesize($out) > 0) { $outFilename = basename($out); $outPath = $out; }
                    else throw new Exception('pdf2svg failed: ' . $outTxt2);
                } else {
                    // return PDF (fallback)
                    $outFilename = basename($inter); $outPath = $inter;
                }
            } else throw new Exception('dwg2pdf failed: ' . $outTxt);
        } else {
            throw new Exception('No SVG conversion utility found');
        }
    } elseif ($fmt === 'dxf') {
        if ($p = cmd_exists('dwg2dxf')) {
            $out = storage_dir('exports/' . $baseName . '.dxf');
            $cmd = escapeshellcmd($p) . ' ' . escapeshellarg($dest) . ' ' . escapeshellarg($out) . ' 2>&1';
            $outTxt = shell_exec($cmd);
            if (is_file($out) && filesize($out) > 0) { $outFilename = basename($out); $outPath = $out; }
            else throw new Exception('dwg2dxf failed: ' . $outTxt);
        } else {
            throw new Exception('No DWG->DXF converter found');
        }
    } else { // pdf
        // prefer dwg2pdf
        if ($p = cmd_exists('dwg2pdf')) {
            $out = storage_dir('exports/' . $baseName . '.pdf');
            $cmd = escapeshellcmd($p) . ' ' . escapeshellarg($dest) . ' ' . escapeshellarg($out) . ' 2>&1';
            $outTxt = shell_exec($cmd);
            if (is_file($out) && filesize($out) > 0) { $outFilename = basename($out); $outPath = $out; }
            else throw new Exception('dwg2pdf failed: ' . $outTxt);
        } elseif ($p = cmd_exists('dwg2svg')) {
            // convert via svg then to pdf if imagemagick present
            $tmpSvg = storage_dir('tmp/' . $baseName . '.svg');
            $cmd = escapeshellcmd($p) . ' ' . escapeshellarg($dest) . ' ' . escapeshellarg($tmpSvg) . ' 2>&1';
            $outTxt = shell_exec($cmd);
            if (is_file($tmpSvg) && filesize($tmpSvg) > 0) {
                if ($im = cmd_exists('convert')) {
                    $outPdf = storage_dir('exports/' . $baseName . '.pdf');
                    $c2 = escapeshellcmd($im) . ' ' . escapeshellarg($tmpSvg) . ' ' . escapeshellarg($outPdf) . ' 2>&1';
                    $outTxt2 = shell_exec($c2);
                    if (is_file($outPdf) && filesize($outPdf) > 0) { $outFilename = basename($outPdf); $outPath = $outPdf; }
                    else throw new Exception('imagemagick convert failed: ' . $outTxt2);
                } else {
                    // return svg instead
                    $outFilename = basename($tmpSvg); $outPath = $tmpSvg;
                }
            } else throw new Exception('dwg2svg failed: ' . $outTxt);
        } else {
            throw new Exception('No DWG->PDF converter found on server');
        }
    }
} catch (Exception $e) {
    // helpful guidance
    $help = 'Conversion not available: please install LibreDWG (dwg2svg), dwg2pdf or ODA File Converter on the server. See README for details.';
    error_response($e->getMessage() . ' — ' . $help, 500);
}

json_response(['ok'=>true, 'filename'=>$outFilename, 'path'=>$outPath]);
