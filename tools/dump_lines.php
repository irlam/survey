<?php
$lines = file(__DIR__ . '/../api/export_report.php');
$start = 1008; $end = 1070;
for ($i = $start; $i <= $end; $i++) {
    $ln = isset($lines[$i-1]) ? rtrim($lines[$i-1], "\r\n") : '';
    printf("%4d: %s\n", $i, $ln);
}
