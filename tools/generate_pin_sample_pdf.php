<?php
// Generate a sample PDF demonstrating vector pins (label 22 centered)
if (!class_exists('FPDF')) {
    $fpdfPath = __DIR__ . '/../vendor/setasign/fpdf/fpdf.php';
    if (file_exists($fpdfPath)) require_once $fpdfPath;
}
if (!class_exists('FPDF')) {
    echo "FPDF not available. Aborting.\n";
    exit(1);
}

class PDFPinSample extends FPDF {
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

$pdf = new PDFPinSample();
$pdf->AddPage();
$pdf->SetFont('Arial','B',16);
$pdf->Cell(0,10,'Vector Pin Sample (label 22)',0,1,'C');
$pdf->Ln(20);
// draw a large single pin in center
$pdf->DrawPinAt(80, 80, 120, '22');
$pdf->Ln(40);
// draw a row with different sizes
$pdf->DrawPinAt(30, 200, 40, '1');
$pdf->DrawPinAt(120, 200, 60, '22');
$pdf->DrawPinAt(230, 200, 80, 'A');

$out = __DIR__ . '/../storage/tmp/pin_sample_22.pdf';
$pdf->Output('F', $out);

echo "WROTE: $out\n";