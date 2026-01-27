<?php
require_once __DIR__ . '/config-util.php';
require_once __DIR__ . '/db.php';
require_method('POST');
$data = read_json_body();
$id = safe_int($data['id'] ?? null);
$plan_id = safe_int($data['plan_id'] ?? null);
if (!$id || !$plan_id) error_response('Missing or invalid id/plan_id', 400);
$pdo = db();

// fetch issue to confirm
$stmt = $pdo->prepare('SELECT * FROM issues WHERE id=? AND plan_id=?');
$stmt->execute([$id, $plan_id]);
$issue = $stmt->fetch(PDO::FETCH_ASSOC);
if (!$issue) error_response('Issue not found', 404);

$storageBase = resolve_storage_path();
$trashTs = date('Ymd_His') . '_' . bin2hex(random_bytes(4));
$trashDir = storage_dir('trash/' . $trashTs);
if (!is_dir($trashDir)) @mkdir($trashDir, 0755, true);

function move_to_trash_file_local($src, $trashDir){
    if (!is_file($src)) return false;
    $leaf = basename($src);
    $dest = rtrim($trashDir, '/') . '/' . $leaf;
    if (@rename($src, $dest)) return $dest;
    if (@copy($src, $dest) && @unlink($src)) return $dest;
    return false;
}

$deleted = ['issue_deleted'=>false, 'photos_deleted'=>0, 'photos'=>[], 'thumbs'=>[], 'exports_deleted'=>[]];

// write a manifest with issue + photos + intent so undo can restore
try {
    $manifest = ['type'=>'issue','issue'=>$issue, 'photos'=>$photos, 'timestamp'=>date('c')];
    @file_put_contents(rtrim($trashDir, '/') . '/manifest.json', json_encode($manifest, JSON_PRETTY_PRINT));
} catch (Exception $e) { error_log('delete_issue_with_photos: failed to write manifest: ' . $e->getMessage()); }

try {
  $pdo->beginTransaction();

  // fetch photos for issue
  $sp = $pdo->prepare('SELECT * FROM photos WHERE plan_id=? AND issue_id=?');
  $sp->execute([$plan_id, $id]);
  $photos = $sp->fetchAll(PDO::FETCH_ASSOC);

  // delete photo rows
  $dp = $pdo->prepare('DELETE FROM photos WHERE plan_id=? AND issue_id=?');
  $dp->execute([$plan_id, $id]);
  $deleted['photos_deleted'] = $dp->rowCount();

  // delete the issue
  $di = $pdo->prepare('DELETE FROM issues WHERE id=? AND plan_id=?');
  $di->execute([$id, $plan_id]);
  $deleted['issue_deleted'] = ($di->rowCount() > 0);

  // Remove any exports that reference this issue in filename (best-effort)
  $selExp = $pdo->prepare("SELECT * FROM exports WHERE filename LIKE ?");
  $like = '%issue_' . $id . '_%';
  $selExp->execute([$like]);
  $exps = $selExp->fetchAll(PDO::FETCH_ASSOC);
  $delExp = $pdo->prepare('DELETE FROM exports WHERE id=?');
  foreach ($exps as $e) {
    // attempt to move file to trash
    $f = storage_dir('exports/' . $e['filename']);
    if (is_file($f)) {
      $m = move_to_trash_file_local($f, $trashDir);
      if ($m) $deleted['exports_deleted'][] = ['id'=>$e['id'],'from'=>'exports/'.$e['filename'],'to'=>str_replace(resolve_storage_path() . '/', '', $m)];
    }
    $delExp->execute([$e['id']]);
  }

  $pdo->commit();
} catch (Exception $e) {
  $pdo->rollBack();
  error_log('delete_issue_with_photos failed DB operation: ' . $e->getMessage());
  error_response('Failed to delete issue: ' . $e->getMessage(), 500);
}

// Move physical photo files & thumbs to trash (best-effort)
foreach ($photos as $ph) {
  $fileRel = $ph['filename'] ?? null;
  if (!$fileRel && isset($ph['file_path'])) {
    $fp = ltrim($ph['file_path'], '/');
    if (strpos($fp, '/') !== false) $fileRel = $fp; else $fileRel = 'photos/' . basename($fp);
  } else if ($fileRel) {
    $fileRel = 'photos/' . $fileRel;
  }
  if ($fileRel) {
    $p = storage_dir($fileRel);
    if (is_file($p) && strpos(realpath($p), $storageBase) === 0) {
      $m = move_to_trash_file_local($p, $trashDir);
      if ($m) {
        $deleted['photos'][] = $fileRel . ' -> ' . str_replace(resolve_storage_path() . '/', '', $m);
      } else error_log('delete_issue_with_photos: failed to move photo to trash: ' . $p);
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
      $m = move_to_trash_file_local($t, $trashDir);
      if ($m) {
        $deleted['thumbs'][] = $thumbRel . ' -> ' . str_replace(resolve_storage_path() . '/', '', $m);
      } else error_log('delete_issue_with_photos: failed to move thumb to trash: ' . $t);
    }
  }
}

// write final manifest into trash for restore
try { @file_put_contents(rtrim($trashDir, '/') . '/manifest.json', json_encode(['type'=>'issue','issue'=>$issue,'deleted'=>$deleted,'photos'=>$photos,'timestamp'=>date('c')], JSON_PRETTY_PRINT)); } catch (Exception $_) {}

json_response(['ok'=>true, 'deleted'=>$deleted, 'trash' => str_replace(resolve_storage_path() . '/', '', $trashDir)]);
