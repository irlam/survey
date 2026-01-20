<?php

function load_config(): array {
  $file = __DIR__ . '/config.php';
  if (file_exists($file)) return require $file;
  return require __DIR__ . '/config.sample.php';
}

function base_url(): string {
  $cfg = load_config();
  if (!empty($cfg['base_url'])) return rtrim($cfg['base_url'], '/');

  $proto = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') ? 'https' : 'http';
  $host = $_SERVER['HTTP_HOST'] ?? 'localhost';
  return $proto . '://' . $host;
}

/**
 * IMPORTANT (Plesk/open_basedir safe):
 * Store everything INSIDE httpdocs/storage by default.
 */
function resolve_storage_path(): string {
  $cfg = load_config();

  // If you set storage_path in config.php, treat it as RELATIVE to httpdocs.
 ്  // Example: 'storage' or 'storage_alt'
  $rel = $cfg['storage_path'] ?? 'storage';

  $root = realpath(__DIR__ . '/..'); // httpdocs
  $path = $root . '/' . trim($rel, "/\\");
  if (!is_dir($path)) {
    @mkdir($path, 0775, true);
  }
  return $path;
}

function ensure_dir(string $dir): void {
  if (!is_dir($dir)) {
    @mkdir($dir, 0775, true);
  }
}

function storage_dir(string $subpath = ''): string {
  $base = resolve_storage_path();
  $full = rtrim($base, "/\\") . '/' . ltrim($subpath, "/\\");
  $parent = dirname($full);
  ensure_dir($parent);
  return $full;
}
