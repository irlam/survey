<?php
/* api/db.php - DB connection + JSON helpers (04/02/2026) */

// Start output buffering to capture any unexpected HTML or warnings
if (function_exists('ob_start') && ob_get_level() === 0) {
  @ob_start();
}

/**
 * Verify CSRF token for state-changing requests.
 * Skipped when csrf_enabled is false/absent in config.
 */
function verify_csrf(): void {
  // Respect the csrf_enabled config flag; skip if disabled
  $cfg = load_config();
  if (empty($cfg['csrf_enabled'])) return;

  // Skip CSRF check for safe methods
  $method = $_SERVER['REQUEST_METHOD'] ?? '';
  if ($method === 'GET' || $method === 'OPTIONS' || $method === 'HEAD') {
    return;
  }

  // Get token from header or POST body
  $token = $_SERVER['HTTP_X_CSRF_TOKEN'] ?? $_POST['_csrf'] ?? '';

  // Start session if not already started
  if (session_status() === PHP_SESSION_NONE) {
    @session_start();
  }

  $session_token = $_SESSION['csrf_token'] ?? '';

  if (empty($token) || empty($session_token) || !hash_equals($session_token, $token)) {
    error_response('Invalid or missing CSRF token', 403);
  }
}

/**
 * Generate a CSRF token for use in forms or JavaScript.
 * Store it in the session and return it.
 */
function generate_csrf_token(): string {
  if (session_status() === PHP_SESSION_NONE) {
    @session_start();
  }
  
  if (empty($_SESSION['csrf_token'])) {
    $_SESSION['csrf_token'] = bin2hex(random_bytes(32));
  }
  
  return $_SESSION['csrf_token'];
}

function require_method(string $method): void {
  if (($_SERVER['REQUEST_METHOD'] ?? '') !== $method) {
    error_response('Method not allowed', 405);
  }
  // Enforce CSRF protection for all state-changing requests
  if (in_array($method, ['POST', 'PUT', 'DELETE', 'PATCH'], true)) {
    verify_csrf();
  }
}

function json_response(array $data, int $status = 200): void {
  // If unexpected output (PHP warnings/html) was emitted earlier, capture it when debug requested
  $rawOutput = '';
  if (function_exists('ob_get_level') && ob_get_level() > 0) {
    $raw = @ob_get_clean();
    if ($raw !== false && is_string($raw) && trim($raw) !== '') $rawOutput = $raw;
  }
  // If unexpected output (PHP warnings/html) was emitted earlier, include it
  // in the JSON response so clients can surface server-side errors.
  // NOTE: this makes responses include captured raw output which is useful
  // for debugging in development environments. Remove or guard this in
  // production if it leaks sensitive info.
  $includeRaw = false;
  if (function_exists('load_config')) {
    $cfg = load_config();
    $includeRaw = !empty($cfg['debug']);
  }
  if ($rawOutput !== '' && $includeRaw) $data['_raw_output'] = $rawOutput;

  http_response_code($status);
  header('Content-Type: application/json; charset=utf-8');
  echo json_encode($data, JSON_UNESCAPED_SLASHES);
  exit;
}

function error_response(string $message, int $status = 400, array $extra = []): void {
  json_response(array_merge(['ok' => false, 'error' => $message], $extra), $status);
}

function read_json_body(): array {
  $raw = file_get_contents('php://input');
  if ($raw === false || trim($raw) === '') return [];
  $data = json_decode($raw, true);
  if (!is_array($data)) error_response('Invalid JSON body', 400);
  return $data;
}

function safe_int($v): ?int {
  if ($v === null) return null;
  if (is_int($v)) return $v;
  if (is_string($v) && preg_match('/^\d+$/', $v)) return (int)$v;
  return null;
}

function safe_string($v, int $max = 255): string {
  $s = is_string($v) ? $v : '';
  $s = trim($s);
  if (mb_strlen($s) > $max) $s = mb_substr($s, 0, $max);
  return $s;
}

function db(): PDO {
  static $pdo = null;
  if ($pdo instanceof PDO) return $pdo;

  $cfg = load_config();
  $db = $cfg['db'] ?? null;
  if (!is_array($db)) error_response('DB config missing (api/config.php)', 500);

  $host = $db['host'] ?? '127.0.0.1';
  $port = (int)($db['port'] ?? 3306);
  $name = $db['dbname'] ?? '';
  $user = $db['user'] ?? '';
  $pass = $db['pass'] ?? '';
  $charset = $db['charset'] ?? 'utf8mb4';

  if ($name === '' || $user === '') error_response('DB config incomplete', 500);

  $dsn = "mysql:host={$host};port={$port};dbname={$name};charset={$charset}";
  $pdo = new PDO($dsn, $user, $pass, [
    PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
    PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
    PDO::ATTR_EMULATE_PREPARES => false,
  ]);

  return $pdo;
}
