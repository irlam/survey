<?php
/* api/track_event.php - Analytics event collector (04/02/2026) */
require_once __DIR__ . '/config-util.php';
require_once __DIR__ . '/db.php';

require_method('POST');
$data = read_json_body();

$event = safe_string($data['event'] ?? '', 100);

// Security: Validate event name format - only allow alphanumeric, underscore, dot, hyphen
// This prevents injection of malicious event names
if (trim($event) === '') error_response('Missing event name', 400);
if (!preg_match('/^[a-zA-Z][a-zA-Z0-9._-]{0,99}$/', $event)) {
  error_response('Invalid event name format. Must start with letter and contain only letters, numbers, dots, underscores, or hyphens', 400);
}

// Security: Whitelist of allowed event names
// Add new events here as they are implemented
$allowed_events = [
  // Plan events
  'plan.open', 'plan.close', 'plan.upload', 'plan.delete', 'plan.export',
  'plan.page.change', 'plan.zoom',
  
  // Issue events
  'issue.create', 'issue.update', 'issue.delete', 'issue.pin.place', 'issue.pin.remove',
  
  // Photo events
  'photo.upload', 'photo.delete', 'photo.view',
  
  // Report events
  'report.generate', 'report.download', 'report.email',
  
  // Navigation events
  'nav.menu.open', 'nav.tab.change',
  
  // User events
  'user.login', 'user.logout', 'user.settings.change',
  
  // Error events
  'error.client', 'error.api',
  
  // Feature events
  'feature.use', 'feature.error',
];

// Allow unknown events in debug mode, but enforce whitelist in production
$cfg = load_config();
if (empty($cfg['debug']) && !in_array($event, $allowed_events, true)) {
  error_response('Unknown event type: ' . $event, 400);
}

// Extract and validate payload
$payload = $data['payload'] ?? ($data['data'] ?? null);

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
  // Ensure table exists (safe to call repeatedly)
  $pdo->exec("CREATE TABLE IF NOT EXISTS analytics_events (
    id INT AUTO_INCREMENT PRIMARY KEY,
    event_name VARCHAR(100) NOT NULL,
    payload JSON NULL,
    user_agent VARCHAR(1024) NULL,
    source_ip VARCHAR(45) NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX (event_name),
    INDEX (created_at)
  )");

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
