<?php

function load_config() {
  $file = __DIR__ . '/config.php';
  if (file_exists($file)) return require $file;
  return require __DIR__ . '/config.sample.php';
}

function base_url() {
  $cfg = load_config();
  if (!empty($cfg['base_url'])) return rtrim($cfg['base_url'], '/');

  $proto = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') ? 'https' : 'http';
  $host = $_SERVER['HTTP_HOST'] ?? 'localhost';
  return $proto . '://' . $host;
}

/**
 * Plesk/open_basedir safe:
 * Keep storage inside httpdocs by default: httpdocs/storage
 *
 * Optional config.php key:
 *   'storage_path' => 'storage'
 * (relative to httpdocs)
 */
function resolve_storage_path() {
  $cfg = load_config();

  $rel = isset($cfg['storage_path']) && $cfg['storage_path'] !== ''
    ? $cfg['storage_path']
    : 'storage';

  $httpdocs = realpath(__DIR__ . '/..'); // httpdocs
  $path = rtrim($httpdocs, '/\\') . '/' . trim($rel, '/\\');

  if (!is_dir($path)) {
    @mkdir($path, 0775, true);
  }

  return $path;
}

function ensure_dir($dir) {
  if (!is_dir($dir)) {
    @mkdir($dir, 0775, true);
  }
}

function storage_dir($subpath) {
  $base = resolve_storage_path();
  $full = rtrim($base, '/\\') . '/' . ltrim($subpath, '/\\');
  ensure_dir(dirname($full));
  return $full;
}
