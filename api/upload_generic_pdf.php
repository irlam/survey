<?php
/* api/upload_generic_pdf.php - Upload a general PDF (02/05/2026) */
require_once __DIR__ . '/config-util.php';
require_once __DIR__ . '/db.php';
require_method('POST');

$folder_id = safe_int($_POST['folder_id'] ?? null);

if (!isset($_FILES['file']) || $_FILES['file']['error'] !== UPLOAD_ERR_OK) {
    error_response('No file uploaded or upload error', 400);
}

$file = $_FILES['file'];
$original = safe_string($file['name'], 255);
$size = $file['size'];

$finfo = finfo_open(FILEINFO_MIME_TYPE);
if (!$finfo) error_response('File inspection failed', 500);
$mime = finfo_file($finfo, $file['tmp_name']);
finfo_close($finfo);

if ($mime !== 'application/pdf') {
    error_response('Only PDF files are allowed', 400);
}

if ($folder_id) {
    $pdo = db();
    $chk = $pdo->prepare('SELECT id FROM pdf_folders WHERE id=? AND deleted_at IS NULL');
    $chk->execute([$folder_id]);
    if (!$chk->fetch()) error_response('Folder not found', 404);
}

$ext = pathinfo($original, PATHINFO_EXTENSION);
$rand = bin2hex(random_bytes(8));
$filename = $rand . ($ext ? ('.' . $ext) : '.pdf');
$fileRel = 'files/' . $filename;
$dest = storage_dir($fileRel);

if (!move_uploaded_file($file['tmp_name'], $dest)) {
    error_response('Failed to store file', 500);
}

$pdo = db();
$cols = $pdo->query("SHOW COLUMNS FROM files")->fetchAll(PDO::FETCH_COLUMN);
$hasPlanId = in_array('plan_id', $cols, true);
$hasLinkedPlanId = in_array('linked_plan_id', $cols, true);
$hasFilename = in_array('filename', $cols, true);
$hasFilePath = in_array('file_path', $cols, true);
$hasName = in_array('name', $cols, true);
$hasOriginal = in_array('original_name', $cols, true);
$hasType = in_array('type', $cols, true);
$hasFolderId = in_array('folder_id', $cols, true);
$hasDeletedAt = in_array('deleted_at', $cols, true);
$hasUpdatedAt = in_array('updated_at', $cols, true);

$baseName = pathinfo($original, PATHINFO_FILENAME);
$displayName = safe_string($baseName !== '' ? $baseName : $original, 255);

$fields = [];
$values = [];
if ($hasPlanId) { $fields[] = 'plan_id'; $values[] = null; }
if ($hasLinkedPlanId) { $fields[] = 'linked_plan_id'; $values[] = null; }
if ($hasFolderId) { $fields[] = 'folder_id'; $values[] = $folder_id; }
if ($hasFilePath) { $fields[] = 'file_path'; $values[] = $fileRel; }
if ($hasFilename) { $fields[] = 'filename'; $values[] = $filename; }
if ($hasName) { $fields[] = 'name'; $values[] = $displayName; }
if ($hasOriginal) { $fields[] = 'original_name'; $values[] = $original; }
$fields[] = 'size'; $values[] = $size;
$fields[] = 'mime'; $values[] = $mime;
if ($hasType) { $fields[] = 'type'; $values[] = 'reference'; }
if ($hasDeletedAt) { $fields[] = 'deleted_at'; $values[] = null; }
if ($hasUpdatedAt) { $fields[] = 'updated_at'; $values[] = date('Y-m-d H:i:s'); }

$placeholders = implode(',', array_fill(0, count($fields), '?'));
$sql = 'INSERT INTO files (' . implode(',', $fields) . ') VALUES (' . $placeholders . ')';
$stmt = $pdo->prepare($sql);
$stmt->execute($values);

json_response(['ok'=>true, 'file_id'=>$pdo->lastInsertId(), 'filename'=>$filename]);
