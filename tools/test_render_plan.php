<?php
// Test whether Imagick can rasterize the plan PDF we downloaded
$file = __DIR__ . '/plan_eec6.pdf';
if (!is_file($file)) { echo "Plan not found at $file\n"; exit(1); }
if (!class_exists('Imagick')) { echo "Imagick not available in this PHP runtime.\n"; exit(2); }
try {
    $im = new Imagick();
    $im->setResolution(150,150);
    $im->readImage($file . '[0]');
    $im->setImageFormat('png');
    $tmp = __DIR__ . '/plan_test.png';
    $im->thumbnailImage(800,0);
    $im->writeImage($tmp);
    echo "WROTE: $tmp (" . filesize($tmp) . " bytes)\n";
} catch (Exception $e) {
    echo "Imagick failed: " . $e->getMessage() . "\n";
    exit(3);
}
