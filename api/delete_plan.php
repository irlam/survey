<?php
require_once __DIR__ . '/config-util.php';
require_once __DIR__ . '/db.php';

require_method('POST');
$data = json_decode(file_get_contents('php://input'), true);
$plan_id = safe_int($data['id'] ?? null);
if (!$plan_id) error_response('Missing or invalid id', 400);

$pdo = db();
// fetch plan
$stmt = $pdo->prepare('SELECT * FROM plans WHERE id=?');
$stmt->execute([$plan_id]);
$plan = $stmt->fetch(PDO::FETCH_ASSOC);
if (!$plan) error_response('Plan not found', 404);

$storageBase = resolve_storage_path();
$deleted = [ 'plan_file' => null, 'photos' => [], 'thumbs' => [], 'exports' => [], 'issues_deleted' => 0, 'photos_deleted' => 0 ];

try {
  $pdo->beginTransaction();

  // Delete issues for this plan
  $stmt = $pdo->prepare('DELETE FROM issues WHERE plan_id=?');
  $stmt->execute([$plan_id]);
  $deleted['issues_deleted'] = $stmt->rowCount();

  // Fetch photos to delete files
  $stmtp = $pdo->prepare('SELECT * FROM photos WHERE plan_id=?');
  $stmtp->execute([$plan_id]);
  $photos = $stmtp->fetchAll(PDO::FETCH_ASSOC);

  // Delete photo rows
  $stmt = $pdo->prepare('DELETE FROM photos WHERE plan_id=?');
  $stmt->execute([$plan_id]);
  $deleted['photos_deleted'] = $stmt->rowCount();

  // Delete the plan row
  $stmt = $pdo->prepare('DELETE FROM plans WHERE id=?');
  $stmt->execute([$plan_id]);

  $pdo->commit();
} catch (Exception $e) {
  $pdo->rollBack();
  error_log('delete_plan failed DB operation: ' . $e->getMessage());
  error_response('Failed to delete plan: ' . $e->getMessage(), 500);
}

// Remove plan file from storage
if (!empty($plan['file_path'])) {
  $planRel = ltrim($plan['file_path'], '/');
  $planPath = storage_dir($planRel);
  if (is_file($planPath)) {
    if (@unlink($planPath)) {
      $deleted['plan_file'] = $planRel;
    } else {
      error_log('delete_plan: failed to unlink plan file: ' . $planPath);
    }
  }
}

// Remove photo files and thumbs (best-effort)
foreach ($photos as $ph) {
  $fileRel = $ph['filename'] ?? null;
  if (!$fileRel && isset($ph['file_path'])) {
    // if file_path contains a directory, use it, otherwise fallback to photos/<basename>
    $fp = ltrim($ph['file_path'], '/');
    if (strpos($fp, '/') !== false) $fileRel = $fp; else $fileRel = 'photos/' . basename($fp);
  } else if ($fileRel) {
    $fileRel = 'photos/' . $fileRel;
  }
  if ($fileRel) {
    $p = storage_dir($fileRel);
    if (is_file($p) && strpos(realpath($p), $storageBase) === 0) {
      if (@unlink($p)) $deleted['photos'][] = $fileRel;
      else error_log('delete_plan: failed to unlink photo: ' . $p);
    }
  }
  // thumb
  $thumbRel = null;
  if (!empty($ph['thumb_path'])) {
    $tp = ltrim($ph['thumb_path'], '/');
    if (strpos($tp, '/') !== false) $thumbRel = $tp; else $thumbRel = 'photos/' . basename($tp);
  } elseif (!empty($ph['thumb'])) {
    $thumbRel = 'photos/' . $ph['thumb'];
  }
  if ($thumbRel) {
    $t = storage_dir($thumbRel);
    if (is_file($t) && strpos(realpath($t), $storageBase) === 0) {
      if (@unlink($t)) $deleted['thumbs'][] = $thumbRel;
      else error_log('delete_plan: failed to unlink thumb: ' . $t);
    }
  }
}

// Remove exports for this plan (report_<planid>_*) and CSVs
$exportsDir = storage_dir('exports');
$files = @scandir($exportsDir);
if ($files !== false) {
  foreach ($files as $f) {
    if ($f === '.' || $f === '..') continue;
    if (preg_match('/^report_' . preg_quote($plan_id, '/') . '_/', $f)) {
      $full = $exportsDir . '/' . $f;
      if (is_file($full)) {
        if (@unlink($full)) $deleted['exports'][] = 'exports/' . $f;
        else error_log('delete_plan: failed to unlink export: ' . $full);
      }
    }
  }
}

json_response(['ok'=>true, 'deleted'=>$deleted]);
