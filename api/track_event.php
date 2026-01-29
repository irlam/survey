<?php
require_once __DIR__ . '/config-util.php';
require_once __DIR__ . '/db.php';

require_method('POST');
$data = read_json_body();

$event = safe_string($data['event'] ?? '', 100);
$payload = $data['payload'] ?? ($data['data'] ?? null);

if (trim($event) === '') error_response('Missing event name', 400);

// Allow only arrays/objects or null in payload for safety
if ($payload !== null && !is_array($payload)) {
  // If the client passed a scalar, wrap it
  if (is_scalar($payload)) {
    $payload = ['value' => $payload];
  } else {
    error_response('Invalid payload, must be JSON object or array', 400);
  }
}

$ua = $_SERVER['HTTP_USER_AGENT'] ?? '';
$ip = $_SERVER['REMOTE_ADDR'] ?? '';

try {
  $pdo = db();
  $stmt = $pdo->prepare('INSERT INTO analytics_events (event_name, payload, user_agent, source_ip) VALUES (?, ?, ?, ?)');
  $stmt->execute([
    $event,
    $payload === null ? null : json_encode($payload, JSON_UNESCAPED_SLASHES),
    $ua,
    $ip
  ]);
  json_response(['ok' => true], 201);
} catch (Exception $e) {
  // As a fallback, write to a server-side log file so events are not lost
  try {
    $logdir = storage_dir('logs');
    $file = rtrim($logdir, '/\\') . '/analytics.log';
    $entry = json_encode([
      'event' => $event,
      'payload' => $payload,
      'user_agent' => $ua,
      'source_ip' => $ip,
      'error' => $e->getMessage(),
      'ts' => date('c')
    ], JSON_UNESCAPED_SLASHES);
    file_put_contents($file, $entry . "\n", FILE_APPEND | LOCK_EX);
  } catch (Exception $ign) {
    // ignore logging failures
  }
  // Return success to client to avoid breaking beacon fire-and-forget flows—but include debug message when in dev
  json_response(['ok' => true, 'warning' => 'Stored to server log due to DB error'], 201);
}
