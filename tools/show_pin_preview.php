<?php
// Creates a simple PDF using the vector pin drawing helper and renders a PNG preview.
// Usage: php tools/show_pin_preview.php

// try to load FPDF from vendor or bundled path
if (!class_exists('FPDF')) {
    $fpdfPath = __DIR__ . '/../vendor/setasign/fpdf/fpdf.php';
    if (file_exists($fpdfPath)) require_once $fpdfPath;
}
if (!class_exists('FPDF')) {
    echo "FPDF not available. Aborting.\n";
    exit(1);
}

class PDF_With_Pins_Local extends FPDF {
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
        $w = $width;
        $h = $width * 1.2;
        $cx = $x + ($w/2);
        $headR = max(3, $w * 0.22);
        $tailTipY = $y + $h;
        $tailYTop = $y + ($h * 0.5);

        $this->SetDrawColor(6,56,56);
        $this->SetFillColor(57,255,20);

        $this->_out('q');
        $this->_out($this->FillColor);
        $this->_out($this->DrawColor);
        $x1 = $cx - $headR * 0.6; $y1 = $tailYTop;
        $x2 = $cx + $headR * 0.6; $y2 = $tailYTop;
        $x3 = $cx; $y3 = $tailTipY;
        $k = $this->k; $H = $this->h;
        $this->_out(sprintf('%.2F %.2F m', $x1*$k, ($H-$y1)*$k));
        $this->_out(sprintf('%.2F %.2F l', $x3*$k, ($H-$y3)*$k));
        $this->_out(sprintf('%.2F %.2F l', $x2*$k, ($H-$y2)*$k));
        $this->_out('h');
        $this->_out('f');
        $this->_out('Q');

        $this->SetFillColor(0,255,200);
        $this->SetDrawColor(6,56,56);
        $this->Ellipse($cx, $y + ($headR * 0.9), $headR, $headR, 'F');

        $this->SetFillColor(255,255,255);
        $this->Ellipse($cx, $y + ($headR * 0.9), max(1, $headR * 0.45), max(1, $headR * 0.45), 'F');

        if ($label !== null && $label !== '') {
            $oldFontSize = $this->FontSize;
            $this->SetFont('Arial','B',8);
            $this->SetTextColor(0,0,0);
            $txtW = $this->GetStringWidth((string)$label);
            $tx = $cx - ($txtW / 2);
            $ty = $y + ($headR * 0.9) - 2;
            $this->SetXY($tx, $ty);
            $this->Cell($txtW, 3, (string)$label, 0, 0, 'C');
            $this->SetFont('Arial','', $oldFontSize);
        }
    }
}

$pdf = new PDF_With_Pins_Local();
$pdf->AddPage();
$pdf->SetFont('Arial','B',14);
$pdf->Cell(0,10,'Pin Demo',0,1,'C');
$pdf->Ln(10);
// Draw a couple of pins at different sizes/locations
$pdf->DrawPinAt(30, 50, 30, '1');
$pdf->DrawPinAt(90, 90, 40, '2');
$pdf->DrawPinAt(140, 60, 24, 'A');

$outPdf = __DIR__ . '/../storage/tmp/pin_demo.pdf';
$outPng = __DIR__ . '/../storage/tmp/pin_demo.png';
$pdf->Output('F', $outPdf);

// Try to render the PDF to PNG using Imagick; otherwise draw a simple raster fallback
if (class_exists('Imagick')) {
    try {
        $im = new Imagick();
        $im->setResolution(300,300);
        $im->readImage($outPdf . '[0]');
        $im->setImageFormat('png');
        $im->thumbnailImage(800, 0);
        $im->writeImage($outPng);
        echo "WROTE_PNG: $outPng\n";
        exit(0);
    } catch (Exception $e) {
        // fall through to GD fallback
    }
}

// GD fallback - render a simple white page and draw simplified pins for an approximation
$w = 800; $h = 1120;
$img = imagecreatetruecolor($w, $h);
$white = imagecolorallocate($img, 255,255,255);
imagefilledrectangle($img, 0,0, $w, $h, $white);
function draw_pin_gd($img, $cx, $cy, $headR, $label) {
    $fill = imagecolorallocate($img, 57,255,20);
    $gloss = imagecolorallocate($img, 0,255,160);
    $black = imagecolorallocate($img, 6,56,56);
    // tail - smoother approximation using filled polygon with control points
    $x1 = (int)($cx - $headR * 0.45); $y1 = (int)($cy + $headR * 0.8);
    $x2 = (int)($cx + $headR * 0.45); $y2 = $y1;
    $tipY = (int)($cy + $headR * 1.8);
    $points = [$x1, $y1, $cx, $tipY, $x2, $y2];
    imagefilledpolygon($img, $points, 3, $fill);
    // head
    imagefilledellipse($img, $cx, $cy, (int)($headR*2), (int)($headR*2), $gloss);
    imagefilledellipse($img, $cx, $cy, (int)($headR*0.9), (int)($headR*0.9), $white);
    // label - center using built-in font metrics
    $textcol = imagecolorallocate($img, 0,0,0);
    $font = 5;
    $tw = imagefontwidth($font) * strlen((string)$label);
    $th = imagefontheight($font);
    imagestring($img, $font, $cx - ($tw/2), $cy - ($th/2), (string)$label, $textcol);
}
// approximate positions (PDF mm-> pixels mapping is rough but fine for preview)
draw_pin_gd($img, 200, 200, 40, '1');
draw_pin_gd($img, 500, 450, 55, '2');
draw_pin_gd($img, 700, 220, 28, 'A');

imagepng($img, $outPng);
imagedestroy($img);

echo "WROTE_PNG_FALLBACK: $outPng\n";
exit(0);
