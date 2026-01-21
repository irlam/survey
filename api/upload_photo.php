<?php
require_once __DIR__ . '/config-util.php';
require_once __DIR__ . '/db.php';
require_method('POST');
$cfg = load_config();
$max_mb = $cfg['max_upload_mb'] ?? 25;
$max_bytes = $max_mb * 1024 * 1024;
if (!isset($_FILES['file']) || $_FILES['file']['error'] !== UPLOAD_ERR_OK) {
    error_response('No file uploaded or upload error', 400);
}
$file = $_FILES['file'];
if ($file['size'] > $max_bytes) {
    error_response('File too large', 413);
}
$finfo = finfo_open(FILEINFO_MIME_TYPE);
$mime = finfo_file($finfo, $file['tmp_name']);
$allowed = ['image/jpeg','image/png'];
finfo_close($finfo);
if (!in_array($mime, $allowed)) {
    error_response('Only JPEG/PNG allowed', 415);
}
$plan_id = safe_int($_POST['plan_id'] ?? null);
$issue_id = safe_int($_POST['issue_id'] ?? null);
if (!$plan_id) error_response('Missing plan_id', 400);
$ext = $mime === 'image/png' ? '.png' : '.jpg';
$rand = bin2hex(random_bytes(8));
$filename = $rand . $ext;
$dest = storage_dir('photos/' . $filename);
if (!move_uploaded_file($file['tmp_name'], $dest)) {
    error_response('Failed to store file', 500);
}
// Attempt to create a thumbnail (GD required). Thumb will be stored as 'thumb_<filename>' in same folder.
$thumbFilename = 'thumb_' . $filename;
$thumbRel = 'photos/' . $thumbFilename;
$destDir = dirname($dest);
if (!is_dir($destDir . '/thumbs')) {
    // try to create a thumbs subdir, otherwise store thumbs alongside originals
    @mkdir($destDir . '/thumbs', 0755, true);
}
$thumbPath = $destDir . '/thumbs/' . $thumbFilename;
$thumbCreated = false;
try {
    list($width, $height) = getimagesize($dest);
    if ($width && $height) {
        $max = 300; // max dimension for thumbnail
        $scale = min(1, $max / max($width, $height));
        $tw = max(40, (int)round($width * $scale));
        $th = max(40, (int)round($height * $scale));
        if ($mime === 'image/png') {
            $src = @imagecreatefrompng($dest);
        } else {
            $src = @imagecreatefromjpeg($dest);
        }
        if ($src) {
            $thumb = imagecreatetruecolor($tw, $th);
            // preserve PNG alpha
            if ($mime === 'image/png') {
                imagealphablending($thumb, false);
                imagesavealpha($thumb, true);
                $transparent = imagecolorallocatealpha($thumb, 0, 0, 0, 127);
                imagefilledrectangle($thumb, 0, 0, $tw, $th, $transparent);
            } else {
                $bg = imagecolorallocate($thumb, 255, 255, 255);
                imagefilledrectangle($thumb, 0, 0, $tw, $th, $bg);
            }
            imagecopyresampled($thumb, $src, 0, 0, 0, 0, $tw, $th, $width, $height);
            if (!is_dir(dirname($thumbPath))) {@mkdir(dirname($thumbPath), 0755, true);}            
            if ($mime === 'image/png') {
                @imagepng($thumb, $thumbPath);
            } else {
                @imagejpeg($thumb, $thumbPath, 78);
            }
            imagedestroy($thumb);
            imagedestroy($src);
            $thumbCreated = file_exists($thumbPath);
        }
    }
} catch (
    Throwable $e
) {
    // thumbnail generation failed; continue without blocking upload
}

$pdo = db();
// Store paths in DB columns `file_path` and `thumb_path` (supports both schemas)
$fileRel = 'photos/' . $filename;
$thumbDbValue = $thumbCreated ? ('photos/thumbs/' . $thumbFilename) : null;
// If the production DB uses `file_path`/`thumb_path`, insert into those; otherwise fall back to older names
$cols = $pdo->query("SHOW COLUMNS FROM photos")->fetchAll(PDO::FETCH_COLUMN);
if (in_array('file_path', $cols) && in_array('thumb_path', $cols)) {
    $stmt = $pdo->prepare('INSERT INTO photos (plan_id, issue_id, file_path, thumb_path) VALUES (?, ?, ?, ?)');
    $stmt->execute([$plan_id, $issue_id, $fileRel, $thumbDbValue]);
} else {
    // older schema
    $stmt = $pdo->prepare('INSERT INTO photos (plan_id, issue_id, filename, thumb) VALUES (?, ?, ?, ?)');
    $stmt->execute([$plan_id, $issue_id, $filename, $thumbDbValue]);
}
json_response(['ok'=>true, 'photo_id'=>$pdo->lastInsertId(), 'file'=> $fileRel, 'thumb'=>$thumbDbValue]);
