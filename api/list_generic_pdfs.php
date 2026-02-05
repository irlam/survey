<?php
/* api/list_generic_pdfs.php - List general PDFs (02/05/2026) */
require_once __DIR__ . '/config-util.php';
require_once __DIR__ . '/db.php';
require_method('GET');

$pdo = db();
$stmt = $pdo->query('SELECT id, filename, original_name, size, mime, created_at FROM files WHERE plan_id IS NULL ORDER BY created_at DESC');
$rows = $stmt->fetchAll();
$rows = format_dates_in_rows($rows);
$base = base_url();
foreach ($rows as &$row) {
    $row['url'] = $base . '/storage/files/' . $row['filename'];
}
json_response(['ok'=>true, 'files'=>$rows]);
