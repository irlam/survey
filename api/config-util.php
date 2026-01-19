<?php
function load_config() {
    $file = __DIR__ . '/config.php';
    if (!file_exists($file)) {
        $file = __DIR__ . '/config.sample.php';
    }
    return require $file;
}

function base_url() {
    $cfg = load_config();
    if (!empty($cfg['base_url'])) return rtrim($cfg['base_url'], '/');
    $proto = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') ? 'https' : 'http';
    $host = $_SERVER['HTTP_HOST'] ?? 'localhost';
    $script = $_SERVER['SCRIPT_NAME'] ?? '';
    $path = rtrim(dirname($script), '/\\');
    return $proto . '://' . $host . ($path ? '/' . $path : '');
}

function resolve_storage_path() {
    $cfg = load_config();
    $path = $cfg['storage_path'] ?? '../storage';
    return realpath(__DIR__ . '/../' . trim($path, '/')) ?: (__DIR__ . '/../storage');
}

function ensure_dir($path) {
    if (!is_dir($path)) {
        mkdir($path, 0775, true);
    }
}

function storage_dir($subpath) {
    $base = resolve_storage_path();
    $full = rtrim($base, '/\\') . '/' . ltrim($subpath, '/\\');
    ensure_dir(dirname($full));
    return $full;
}
