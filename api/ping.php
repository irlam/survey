<?php
// api/ping.php — health check
require_once __DIR__ . '/config-util.php';
require_once __DIR__ . '/db.php';

require_method('GET');

$storageRoot = resolve_storage_path();

$paths = [
  'root'    => $storageRoot,
  'plans'   => storage_dir('plans'),
  'photos'  => storage_dir('photos'),
  'files'   => storage_dir('files'),
  'exports' => storage_dir('exports'),
  'tmp'     => storage_dir('tmp'),
];

$storage = [
  'root'    => ['path' => $paths['root'],    'writable' => is_writable($paths['root'])],
  'plans'   => ['path' => $paths['plans'],   'writable' => is_writable($paths['plans'])],
  'photos'  => ['path' => $paths['photos'],  'writable' => is_writable($paths['photos'])],
  'files'   => ['path' => $paths['files'],   'writable' => is_writable($paths['files'])],
  'exports' => ['path' => $paths['exports'], 'writable' => is_writable($paths['exports'])],
  'tmp'     => ['path' => $paths['tmp'],     'writable' => is_writable($paths['tmp'])],
];

$db_ok = false;
$db_error = null;

try {
  db();
  $db_ok = true;
} catch (Exception $e) {
  $db_ok = false;
  $db_error = $e->getMessage();
}

json_response([
  'ok' => true,
  'timestamp' => time(),
  'iso' => gmdate('c'),
  'php_version' => PHP_VERSION,
  'base_url' => base_url(),
  'storage' => $storage,
  'db' => [
    'ok' => $db_ok,
    'error' => $db_ok ? null : $db_error
  ],
]);
