<?php

function require_method(string $method): void {
  if (($_SERVER['REQUEST_METHOD'] ?? '') !== $method) {
    error_response('Method not allowed', 405);
  }
}

function json_response(array $data, int $status = 200): void {
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
  ]);

  return $pdo;
}
