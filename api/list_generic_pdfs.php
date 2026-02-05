<?php
/* api/list_generic_pdfs.php - List general PDFs and folders (02/05/2026) */
require_once __DIR__ . '/config-util.php';
require_once __DIR__ . '/db.php';
require_method('GET');

$pdo = db();
$folder_id = safe_int($_GET['folder_id'] ?? null);

// folders for current parent
if ($folder_id) {
    $chk = $pdo->prepare('SELECT id FROM pdf_folders WHERE id=? AND deleted_at IS NULL');
    $chk->execute([$folder_id]);
    if (!$chk->fetch()) error_response('Folder not found', 404);
}

$foldersStmt = $pdo->prepare('SELECT id, parent_id, name, created_at FROM pdf_folders WHERE deleted_at IS NULL AND parent_id '.($folder_id ? '= ?' : 'IS NULL').' ORDER BY name ASC');
$foldersStmt->execute($folder_id ? [$folder_id] : []);
$folders = $foldersStmt->fetchAll();
$folders = format_dates_in_rows($folders);

$filesStmt = $pdo->prepare('SELECT id, filename, original_name, size, mime, created_at FROM files WHERE plan_id IS NULL AND deleted_at IS NULL AND folder_id '.($folder_id ? '= ?' : 'IS NULL').' ORDER BY created_at DESC');
$filesStmt->execute($folder_id ? [$folder_id] : []);
$files = $filesStmt->fetchAll();
$files = format_dates_in_rows($files);
$base = base_url();
foreach ($files as &$row) {
    $row['url'] = $base . '/storage/files/' . $row['filename'];
}

// breadcrumb path
$crumbs = [];
if ($folder_id) {
    $mapStmt = $pdo->query('SELECT id, parent_id, name FROM pdf_folders WHERE deleted_at IS NULL');
    $map = [];
    foreach ($mapStmt->fetchAll() as $r) { $map[(int)$r['id']] = $r; }
    $cur = $folder_id;
    $guard = 0;
    while ($cur && isset($map[$cur]) && $guard < 50) {
        array_unshift($crumbs, ['id'=>$map[$cur]['id'], 'name'=>$map[$cur]['name']]);
        $cur = $map[$cur]['parent_id'] ? (int)$map[$cur]['parent_id'] : null;
        $guard++;
    }
}

json_response(['ok'=>true, 'folders'=>$folders, 'files'=>$files, 'breadcrumbs'=>$crumbs]);
