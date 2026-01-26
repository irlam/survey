<?php
$s = file_get_contents(__DIR__ . '/../api/export_report.php');
$tokens = token_get_all($s);
$stack = [];
$line = 1;
$pos = 0;
foreach ($tokens as $t) {
    if (is_array($t)) {
        $tokenId = $t[0];
        $text = $t[1];
        $line = $t[2];
        // Skip strings/comments where braces are not code
        if (in_array($tokenId, [T_CONSTANT_ENCAPSED_STRING, T_ENCAPSED_AND_WHITESPACE, T_COMMENT, T_DOC_COMMENT])) {
            $pos += strlen($text);
            continue;
        }
    } else {
        $text = $t;
    }
    $len = strlen($text);
    for ($i = 0; $i < $len; $i++) {
        $ch = $text[$i];
        if ($ch === '{') {
            $stack[] = ['line' => $line, 'pos' => $pos + $i];
        } elseif ($ch === '}') {
            if (!empty($stack)) array_pop($stack);
            else echo "Extra closing brace at line $line\n";
        }
    }
    $pos += $len;
}
if (!empty($stack)) {
    echo "Unclosed braces (count=" . count($stack) . "):\n";
    foreach ($stack as $idx => $item) {
        echo sprintf(" #%d at line %d pos %d\n", $idx, $item['line'], $item['pos']);
    }
    // show recent closing brace locations for context
    $closings = [];
    $pos = 0;
    while (($p = strpos($s, '}', $pos)) !== false) { $ln = substr_count(substr($s, 0, $p), "\n") + 1; $closings[] = $ln; $pos = $p + 1; }
    $c = array_slice($closings, -20);
    echo "Recent closing brace line numbers: " . implode(', ', $c) . "\n";
} else {
    echo "All braces matched\n";
}
?>