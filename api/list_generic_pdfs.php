<?php
/* api/list_generic_pdfs.php - List general PDFs and folders (02/05/2026) */
require_once __DIR__ . '/config-util.php';
require_once __DIR__ . '/db.php';
require_method('GET');

$pdo = db();
$folder_id = safe_int($_GET['folder_id'] ?? null);

$fileCols = $pdo->query("SHOW COLUMNS FROM files")->fetchAll(PDO::FETCH_COLUMN);
$hasPlanId = in_array('plan_id', $fileCols, true);
$hasLinkedPlanId = in_array('linked_plan_id', $fileCols, true);
$hasFilename = in_array('filename', $fileCols, true);
$hasFilePath = in_array('file_path', $fileCols, true);
$hasName = in_array('name', $fileCols, true);
$hasOriginal = in_array('original_name', $fileCols, true);
$hasCreatedAt = in_array('created_at', $fileCols, true);
$hasUploadedAt = in_array('uploaded_at', $fileCols, true);
$hasType = in_array('type', $fileCols, true);
$hasFolderId = in_array('folder_id', $fileCols, true);
$hasDeletedAt = in_array('deleted_at', $fileCols, true);

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

$where = [];
$params = [];
if ($hasPlanId) {
    $where[] = 'plan_id IS NULL';
} elseif ($hasLinkedPlanId) {
    $where[] = 'linked_plan_id IS NULL';
}
if ($hasType) $where[] = "type='reference'";
if ($hasDeletedAt) $where[] = 'deleted_at IS NULL';
if ($hasFolderId) {
    $where[] = $folder_id ? 'folder_id = ?' : 'folder_id IS NULL';
    if ($folder_id) $params[] = $folder_id;
} elseif ($folder_id) {
    error_response('Folders not supported by files table', 400);
}

$nameExpr = $hasOriginal ? 'original_name' : ($hasName ? 'name' : "''");
$pathExpr = $hasFilePath ? 'file_path' : ($hasFilename ? 'filename' : "''");
$dateExpr = $hasCreatedAt ? 'created_at' : ($hasUploadedAt ? 'uploaded_at AS created_at' : 'NULL AS created_at');
$sql = "SELECT id, {$pathExpr} AS path_value, {$nameExpr} AS original_name, size, mime, {$dateExpr} FROM files";
if ($where) $sql .= ' WHERE ' . implode(' AND ', $where);
$orderCol = $hasCreatedAt ? 'created_at' : ($hasUploadedAt ? 'uploaded_at' : 'id');
$sql .= " ORDER BY {$orderCol} DESC";

$filesStmt = $pdo->prepare($sql);
$filesStmt->execute($params);
$files = $filesStmt->fetchAll();
$files = format_dates_in_rows($files);
$base = base_url();
foreach ($files as &$row) {
    $path = $row['path_value'] ?? '';
    if ($hasFilePath) {
        $clean = ltrim($path, '/');
        if (strpos($clean, 'storage/') === 0) {
            $row['url'] = $base . '/' . $clean;
        } else {
            $row['url'] = $base . '/storage/' . $clean;
        }
    } else {
        $row['url'] = $base . '/storage/files/' . $path;
    }
    unset($row['path_value']);
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
