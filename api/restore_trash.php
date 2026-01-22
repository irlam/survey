<?php
require_once __DIR__ . '/config-util.php';
require_once __DIR__ . '/db.php';
require_method('POST');
$data = json_decode(file_get_contents('php://input'), true);
$trash = $data['trash'] ?? null; $overwrite = !empty($data['overwrite']);
if (!$trash) error_response('Missing trash parameter', 400);
$base = resolve_storage_path() . '/trash';
$dir = $base . '/' . basename($trash);
if (!is_dir($dir)) error_response('Trash folder not found', 404);
$manifestFile = $dir . '/manifest.json';
$manifest = null;
if (is_file($manifestFile)) {
  $manifest = json_decode(@file_get_contents($manifestFile), true);
}
$files = @scandir($dir);
if ($files === false) error_response('Unable to read trash folder', 500);
$results = ['restored' => [], 'skipped' => [], 'failed' => []];
$pdo = db();
try {
  // First, restore files to their original locations based on manifest if present, otherwise try heuristics
  foreach ($files as $f) {
    if ($f === '.' || $f === '..' || $f === 'manifest.json') continue;
    $full = $dir . '/' . $f;
    if (!is_file($full)) continue;
    $targetRel = null;
    // find in manifest.files by matching 'to' basename
    if (is_array($manifest['files'] ?? null)) {
      foreach ($manifest['files'] as $mf) {
        if (basename($mf['to']) === $f) { $targetRel = $mf['from']; break; }
      }
    }
    // fallback: if name starts with plan_ or report_ or photos, try reasonable places
    if (!$targetRel) {
      if (strpos($f, 'plan_') === 0) $targetRel = 'plans/' . $f;
      else if (strpos($f, 'report_') === 0) $targetRel = 'exports/' . $f;
      else $targetRel = 'photos/' . $f;
    }
    $dest = storage_dir($targetRel);
    ensure_dir(dirname($dest));
    if (is_file($dest) && !$overwrite) { $results['skipped'][] = $targetRel; continue; }
    // try to move from trash to dest
    if (@rename($full, $dest) || (@copy($full, $dest) && @unlink($full))) {
      $results['restored'][] = $targetRel;
    } else {
      $results['failed'][] = $targetRel;
    }
  }

  // Recreate DB rows if plan present in manifest
  $restoredPlanId = null;
  if ($manifest && !empty($manifest['plan'])) {
    $p = $manifest['plan'];
    // insert plan (do not attempt to reuse id)
    $stmt = $pdo->prepare('INSERT INTO plans (name, revision, file_path, sha1) VALUES (?, ?, ?, ?)');
    $file_path = $p['file_path'] ?? null;
    $stmt->execute([$p['name'] ?? null, $p['revision'] ?? null, $file_path, $p['sha1'] ?? null]);
    $restoredPlanId = (int)$pdo->lastInsertId();
    // restore photos rows
    if (!empty($manifest['photos']) && is_array($manifest['photos'])) {
      $added = 0;
      $stmtIns = $pdo->prepare('INSERT INTO photos (plan_id, issue_id, filename, thumb, created_at) VALUES (?, ?, ?, ?, ?)');
      foreach ($manifest['photos'] as $ph) {
        $filename = $ph['filename'] ?? (isset($ph['file_path']) ? basename($ph['file_path']) : null);
        $thumb = $ph['thumb'] ?? null;
        $created_at = $ph['created_at'] ?? null;
        $stmtIns->execute([$restoredPlanId, null, $filename, $thumb, $created_at]);
        $added++;
      }
      $results['photos_added'] = $added;
    }
    // restore issues rows
    if (!empty($manifest['issues']) && is_array($manifest['issues'])) {
      $addedIssues = 0;
      $stmtInsI = $pdo->prepare('INSERT INTO issues (plan_id, page, x_norm, y_norm, title, notes, status, priority, assigned_to, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
      foreach ($manifest['issues'] as $iss) {
        $stmtInsI->execute([$restoredPlanId, $iss['page'] ?? null, $iss['x_norm'] ?? null, $iss['y_norm'] ?? null, $iss['title'] ?? null, $iss['notes'] ?? null, $iss['status'] ?? null, $iss['priority'] ?? null, $iss['assigned_to'] ?? null, $iss['created_at'] ?? null]);
        $addedIssues++;
      }
      $results['issues_added'] = $addedIssues;
    }
  }

  // After restoring files, if directory is empty (only manifest was left), delete the manifest and directory
  $left = @scandir($dir);
  $left = array_filter($left, function($n){ return $n !== '.' && $n !== '..'; });
  if (count($left) === 0 || (count($left) === 1 && isset($left[1]) && $left[1] === 'manifest.json')) {
    @unlink($manifestFile);
    @rmdir($dir);
  }

  json_response(array_merge(['ok'=>true, 'results'=>$results], $restoredPlanId ? ['plan_id'=>$restoredPlanId] : []));
} catch (Exception $e) {
  error_log('restore_trash error: ' . $e->getMessage());
  error_response('Restore failed: ' . $e->getMessage(), 500);
}
