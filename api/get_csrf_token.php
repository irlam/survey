<?php
/* api/get_csrf_token.php - Generate and return CSRF token (22/02/2026) */
require_once __DIR__ . '/config-util.php';
require_once __DIR__ . '/db.php';

// CSRF token endpoint - always allow GET
header('Content-Type: application/json; charset=utf-8');

$cfg = load_config();

// Check if CSRF protection is enabled
if (!empty($cfg['csrf_enabled'])) {
    $token = generate_csrf_token();
    json_response(['ok' => true, 'csrf_token' => $token]);
} else {
    // CSRF disabled - return null token
    json_response(['ok' => true, 'csrf_token' => null, 'warning' => 'CSRF protection is disabled']);
}
