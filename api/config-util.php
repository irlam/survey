<?php
// api/config-util.php (open_basedir-safe)

function load_config(): array {
  $file = __DIR__ . '/config.php';
  if (!file_exists($file)) {
    $file = __DIR__ . '/config.sample.php';
  }
  $cfg = require $file;
  return is_array($cfg) ? $cfg : [];
}

function project_root(): string {
  // This will be /httpdocs
  return realpath(__DIR__ . '/..') ?: dirname(__DIR__);
}

function base_url(): string {
  $cfg = load_config();
  if (!empty($cfg['base_url'])) return rtrim((string)$cfg['base_url'], '/');

  $proto = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') ? 'https' : 'http';
  $host  = $_SERVER['HTTP_HOST'] ?? 'localhost';

  $basePath = '';
  if (!empty($cfg['base_path'])) {
    $basePath = '/' . trim((string)$cfg['base_path'], '/');
  }
  return $proto . '://' . $host . $basePath;
}

function ensure_dir(string $dir): bool {
  if ($dir === '') return false;
  if (@is_dir($dir)) return true;
  // Suppress warnings (open_basedir throws noisy warnings)
  @mkdir($dir, 0775, true);
  return @is_dir($dir);
}

function resolve_storage_path(): string {
  $cfg  = load_config();
  $root = project_root(); // /httpdocs

  // Preferred: storage inside httpdocs
  $preferred = $root . DIRECTORY_SEPARATOR . 'storage';

  // If config provides storage_path, try it first
  $path = $cfg['storage_path'] ?? 'storage';

  $isAbsolute = is_string($path) && (
    str_starts_with($path, '/') ||
    preg_match('/^[A-Za-z]:\\\\/', $path) === 1
  );

  $candidate = $isAbsolute
    ? (string)$path
    : ($root . DIRECTORY_SEPARATOR . trim((string)$path, "/\\"));

  // Try candidate (no warnings)
  if (ensure_dir($candidate)) return $candidate;

  // Fallback 1: /httpdocs/storage
  if (ensure_dir($preferred)) return $preferred;

  // Fallback 2: /tmp/survey_storage (always allowed)
  $tmp = rtrim(sys_get_temp_dir(), "/\\") . DIRECTORY_SEPARATOR . 'survey_storage';
  ensure_dir($tmp);
  return $tmp;
}

function storage_dir(string $subdir = ''): string {
  $base = resolve_storage_path();
  $dir = rtrim($base, "/\\");
  if ($subdir !== '') $dir .= DIRECTORY_SEPARATOR . trim($subdir, "/\\");
  ensure_dir($dir);
  return $dir;
}

function storage_path(string $relative): string {
  $base = resolve_storage_path();
  $full = rtrim($base, "/\\") . DIRECTORY_SEPARATOR . ltrim($relative, "/\\");
  ensure_dir(dirname($full));
  return $full;
}
