<?php
$s = file_get_contents(__DIR__ . '/../api/export_report.php');
$balance = 0;
$lines = explode("\n", $s);
foreach ($lines as $i => $l) {
    $balance += substr_count($l, '{');
    $balance -= substr_count($l, '}');
    if ($balance < 0) {
        echo 'Extra closing brace at line ' . ($i + 1) . "\n";
        exit(1);
    }
}
if ($balance !== 0) {
    echo 'Unmatched braces, final balance: ' . $balance . "\n";
    // print running balance for the region where we made edits
    $bal = 0;
    for ($i = 640; $i <= 980; $i++) {
        if (!isset($lines[$i-1])) break;
        $l = $lines[$i-1];
        $bal += substr_count($l, '{') - substr_count($l, '}');
        echo str_pad($i,4,' ',STR_PAD_LEFT) . ' [' . str_pad($bal,3,' ',STR_PAD_LEFT) . ']: ' . $l . "\n";
    }
    exit(1);
}
echo 'Braces balanced' . "\n";
exit(0);
