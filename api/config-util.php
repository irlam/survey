<?php
// api/config-util.php

function load_config(): array {
  $file = __DIR__ . '/config.php';
  if (!file_exists($file)) {
    $file = __DIR__ . '/config.sample.php';
  }
  $cfg = require $file;
  return is_array($cfg) ? $cfg : [];
}

function project_root(): string {
  return realpath(__DIR__ . '/..') ?: dirname(__DIR__);
}

function base_url(): string {
  $cfg = load_config();
  if (!empty($cfg['base_url'])) {
    return rtrim((string)$cfg['base_url'], '/');
  }

  $proto = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') ? 'https' : 'http';
  $host  = $_SERVER['HTTP_HOST'] ?? 'localhost';

  // Default to site root. If you deploy in a subfolder, set base_path in config.
  $basePath = '';
  if (!empty($cfg['base_path'])) {
    $basePath = '/' . trim((string)$cfg['base_path'], '/');
  }

  return $proto . '://' . $host . $basePath;
}

function ensure_dir(string $dir): void {
  if ($dir === '') return;
  if (!is_dir($dir)) {
    mkdir($dir, 0775, true);
  }
}

function resolve_storage_path(): string {
  $cfg  = load_config();
  $root = project_root();

  $path = $cfg['storage_path'] ?? 'storage';

  // Absolute path?
  $isAbsolute = is_string($path) && (
    str_starts_with($path, '/') ||
    preg_match('/^[A-Za-z]:\\\\/', $path) === 1
  );

  $full = $isAbsolute
    ? (string)$path
    : ($root . DIRECTORY_SEPARATOR . trim((string)$path, "/\\"));

  if (!$full) $full = $root . DIRECTORY_SEPARATOR . 'storage';

  ensure_dir($full);
  return $full;
}

/**
 * Returns an absolute DIRECTORY path under storage and ensures it exists.
 * Example: storage_dir('plans') => /abs/.../storage/plans
 */
function storage_dir(string $subdir = ''): string {
  $base = resolve_storage_path();
  $dir = rtrim($base, "/\\");
  if ($subdir !== '') {
    $dir .= DIRECTORY_SEPARATOR . trim($subdir, "/\\");
  }
  ensure_dir($dir);
  return $dir;
}

/**
 * Returns an absolute FILE path under storage and ensures parent directory exists.
 * Example: storage_path('plans/file.pdf') => /abs/.../storage/plans/file.pdf
 */
function storage_path(string $relative): string {
  $base = resolve_storage_path();
  $full = rtrim($base, "/\\") . DIRECTORY_SEPARATOR . ltrim($relative, "/\\");
  ensure_dir(dirname($full));
  return $full;
}
