<?php
/* api/config-util.php - Config loader and shared helpers (04/02/2026) */

function load_config() {
  $file = __DIR__ . '/config.php';
  if (file_exists($file)) return require $file;
  return require __DIR__ . '/config.sample.php';
}

// Ensure PHP warnings/errors are not sent as HTML in API responses.
// Log errors instead; prevent display of HTML-formatted errors which break JSON APIs.
@ini_set('display_errors', '0');
@ini_set('display_startup_errors', '0');
@error_reporting(E_ALL);

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

// Format known date fields in a row to UK format (d/m/Y H:i or d/m/Y for dates)
function format_date_field($key, $value) {
  if (empty($value)) return '';
  // try parseable date
  $ts = strtotime($value);
  if ($ts === false) return $value;
  // keys that are date-only
  $date_only = ['due_date'];
  if (in_array($key, $date_only)) return date('d/m/Y', $ts);
  // default to datetime
  return date('d/m/Y H:i', $ts);
}

function format_dates_in_row(array $row) : array {
  $keys = array_keys($row);
  foreach ($keys as $k) {
    if (in_array($k, ['created_at','updated_at','due_date','saved_at','mtime','modified'])) {
      $row[$k] = format_date_field($k, $row[$k]);
    }
  }
  return $row;
}

function format_dates_in_rows(array $rows) : array {
  return array_map('format_dates_in_row', $rows);
}
