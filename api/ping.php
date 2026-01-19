<?php
require_once __DIR__ . '/config-util.php';
require_once __DIR__ . '/db.php';

$storage = [
    'root' => is_writable(resolve_storage_path()),
    'plans' => is_writable(storage_dir('plans')),
    'photos' => is_writable(storage_dir('photos')),
    'files' => is_writable(storage_dir('files')),
    'exports' => is_writable(storage_dir('exports')),
    'tmp' => is_writable(storage_dir('tmp')),
];

$db_ok = false;
try {
    db();
    $db_ok = true;
} catch (Exception $e) {
    $db_ok = false;
}

json_response([
    'ok' => true,
    'timestamp' => time(),
    'php_version' => PHP_VERSION,
    'storage' => $storage,
    'db' => $db_ok
]);
