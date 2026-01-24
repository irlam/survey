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
// helper to move files into storage/trash/<timestamp> for soft-delete (best-effort)
$trashTs = date('Ymd_His') . '_' . bin2hex(random_bytes(4));
$trashDir = storage_dir('trash/' . $trashTs);
ensure_dir($trashDir);

// Gather full manifest data before we delete DB rows so we can optionally restore
$manifest = [
    'plan' => $plan,
    'plan_id' => $plan_id,
    'notes' => 'Deleted by delete_plan.php',
    'timestamp' => date('c'), 'uk' => date('d/m/Y H:i'),
    'files' => [],
    'issues' => [],
    'photos' => []
];
// fetch issues to include in manifest
$stmtIssues = $pdo->prepare('SELECT * FROM issues WHERE plan_id=? ORDER BY id');
$stmtIssues->execute([$plan_id]);
$issues = $stmtIssues->fetchAll(PDO::FETCH_ASSOC);
foreach ($issues as $iss) {
    $manifest['issues'][] = $iss;
}
// fetch photos to include in manifest (we already fetch later, but ensure we have them now)
$stmtp = $pdo->prepare('SELECT * FROM photos WHERE plan_id=?');
$stmtp->execute([$plan_id]);
$photos = $stmtp->fetchAll(PDO::FETCH_ASSOC);
foreach ($photos as $ph) {
    $manifest['photos'][] = $ph;
}

function move_to_trash_file($src, $trashDir) {
    if (!is_file($src)) return false;
    $leaf = basename($src);
    $dest = rtrim($trashDir, '/') . '/' . $leaf;
    if (@rename($src, $dest)) return $dest;
    if (@copy($src, $dest) && @unlink($src)) return $dest;
    return false;
}

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

// Move plan file to trash (soft-delete)
if (!empty($plan['file_path'])) {
  $planRel = ltrim($plan['file_path'], '/');
  $planPath = storage_dir($planRel);
  if (is_file($planPath)) {
    $moved = move_to_trash_file($planPath, $trashDir);
    if ($moved) {
      $deleted['plan_file'] = ['from' => $planRel, 'to' => str_replace(resolve_storage_path() . '/', '', $moved)];
    } else {
      error_log('delete_plan: failed to move plan file to trash: ' . $planPath);
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
      $m = move_to_trash_file($p, $trashDir);
      if ($m) {
        $deleted['photos'][] = $fileRel . ' -> ' . str_replace(resolve_storage_path() . '/', '', $m);
        $manifest['files'][] = ['type'=>'photo', 'from'=>$fileRel, 'to'=>str_replace(resolve_storage_path() . '/', '', $m)];
      } else error_log('delete_plan: failed to move photo to trash: ' . $p);
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
      $m = move_to_trash_file($t, $trashDir);
      if ($m) {
        $deleted['thumbs'][] = $thumbRel . ' -> ' . str_replace(resolve_storage_path() . '/', '', $m);
        $manifest['files'][] = ['type'=>'thumb', 'from'=>$thumbRel, 'to'=>str_replace(resolve_storage_path() . '/', '', $m)];
      } else error_log('delete_plan: failed to move thumb to trash: ' . $t);
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
        $m = move_to_trash_file($full, $trashDir);
        if ($m) {
          $deleted['exports'][] = 'exports/' . $f . ' -> ' . str_replace(resolve_storage_path() . '/', '', $m);
          $manifest['files'][] = ['type'=>'export', 'from'=>'exports/' . $f, 'to'=>str_replace(resolve_storage_path() . '/', '', $m)];
        } else error_log('delete_plan: failed to move export to trash: ' . $full);
      }
    }
  }
}

// Write manifest into trash
$manifestFile = rtrim($trashDir, '/') . '/manifest.json';
@file_put_contents($manifestFile, json_encode($manifest, JSON_PRETTY_PRINT));

json_response(['ok'=>true, 'deleted'=>$deleted, 'trash' => str_replace(resolve_storage_path() . '/', '', $trashDir), 'manifest' => basename($manifestFile)]);
