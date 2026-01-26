<?php
$s = file_get_contents(__DIR__ . '/../api/export_report.php');
$open = 0;
$lines = explode('\n', $s);
foreach ($lines as $i => $l) {
    $open += substr_count($l, '{');
    $open -= substr_count($l, '}');
    if ($open < 0) {
        echo 'Extra closing brace at line ' . ($i + 1) . "\n";
        exit(1);
    }
}
echo 'Final balance: ' . $open . "\n";
exit(0);
