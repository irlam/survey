<?php
function db() {
    static $pdo = null;
    if ($pdo) return $pdo;
    $cfg = load_config();
    $dsn = "mysql:host={$cfg['db_host']};dbname={$cfg['db_name']};charset={$cfg['db_charset']}";
    $pdo = new PDO($dsn, $cfg['db_user'], $cfg['db_pass'], [
        PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC
    ]);
    return $pdo;
}

function json_response($data, $status=200) {
    http_response_code($status);
    header('Content-Type: application/json');
    echo json_encode($data);
    exit;
}

function error_response($msg, $status=400, $extra=[]) {
    $data = array_merge(['ok'=>false, 'error'=>$msg], $extra);
    json_response($data, $status);
}

function require_method($method) {
    if ($_SERVER['REQUEST_METHOD'] !== strtoupper($method)) {
        error_response('Method Not Allowed', 405);
    }
}

function read_json_body() {
    $body = file_get_contents('php://input');
    return json_decode($body, true);
}

function safe_int($value) {
    return filter_var($value, FILTER_VALIDATE_INT);
}

function safe_string($value, $maxLen) {
    $s = trim((string)$value);
    return mb_substr($s, 0, $maxLen);
}
