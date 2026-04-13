<?php
/* api/restore_trash.php - Restore trash folder contents (04/02/2026) */
require_once __DIR__ . '/config-util.php';
require_once __DIR__ . '/db.php';
require_method('POST');
$data = read_json_body();
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

    // Restore issues rows first so we can build an old-id → new-id map for photos
    $issueIdMap = []; // old issue id => new issue id
    if (!empty($manifest['issues']) && is_array($manifest['issues'])) {
      $addedIssues = 0;
      // issue_no is NOT NULL in the schema; restore the original value where present.
      $stmtInsI = $pdo->prepare('
        INSERT INTO issues
          (plan_id, issue_no, page, x_norm, y_norm, title, notes, category, status, priority, trade, assigned_to, due_date, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ');
      $nextNo = 1;
      foreach ($manifest['issues'] as $iss) {
        // Prefer the stored issue_no; fall back to a counter in case it was missing from an old manifest.
        $issueNo = isset($iss['issue_no']) ? (int)$iss['issue_no'] : $nextNo;
        $stmtInsI->execute([
          $restoredPlanId,
          $issueNo,
          $iss['page']        ?? null,
          $iss['x_norm']      ?? null,
          $iss['y_norm']      ?? null,
          $iss['title']       ?? null,
          $iss['notes']       ?? null,
          $iss['category']    ?? 'Other',
          $iss['status']      ?? 'Open',
          $iss['priority']    ?? 'Medium',
          $iss['trade']       ?? null,
          $iss['assigned_to'] ?? null,
          $iss['due_date']    ?? null,
          $iss['created_at']  ?? null,
        ]);
        $newIssueId = (int)$pdo->lastInsertId();
        // Record mapping from old ID to new ID so photos can be remapped
        if (!empty($iss['id'])) {
          $issueIdMap[(int)$iss['id']] = $newIssueId;
        }
        $nextNo = max($nextNo, $issueNo) + 1;
        $addedIssues++;
      }
      $results['issues_added'] = $addedIssues;
    }

    // Restore photos rows, remapping issue_id to newly-assigned IDs
    if (!empty($manifest['photos']) && is_array($manifest['photos'])) {
      $added = 0;
      // Use the real schema columns: file_path and thumb_path (not the old filename/thumb names).
      $stmtIns = $pdo->prepare('INSERT INTO photos (plan_id, issue_id, file_path, thumb_path, created_at) VALUES (?, ?, ?, ?, ?)');
      foreach ($manifest['photos'] as $ph) {
        $file_path  = $ph['file_path']  ?? (isset($ph['filename']) ? 'photos/' . basename($ph['filename']) : null);
        $thumb_path = $ph['thumb_path'] ?? $ph['thumb'] ?? null;
        $created_at = $ph['created_at'] ?? null;
        $issue_id   = isset($ph['issue_id']) ? (int)$ph['issue_id'] : null;
        // Remap old issue_id to the new ID assigned during this restore;
        // if the old ID is not in the map (e.g. orphaned photo), leave issue_id as NULL.
        if ($issue_id !== null) {
          $issue_id = $issueIdMap[$issue_id] ?? null;
        }
        $stmtIns->execute([$restoredPlanId, $issue_id, $file_path, $thumb_path, $created_at]);
        $added++;
      }
      $results['photos_added'] = $added;
    }
  }

  // After restoring files, if directory is empty (only manifest was left), delete the manifest and directory
  $left = @scandir($dir);
  $left = array_values(array_filter($left, function($n){ return $n !== '.' && $n !== '..'; }));
  if (count($left) === 0 || (count($left) === 1 && $left[0] === 'manifest.json')) {
    @unlink($manifestFile);
    @rmdir($dir);
  }

  json_response(array_merge(['ok'=>true, 'results'=>$results], $restoredPlanId ? ['plan_id'=>$restoredPlanId] : []));
} catch (Exception $e) {
  error_log('restore_trash error: ' . $e->getMessage());
  error_response('Restore failed: ' . $e->getMessage(), 500);
}
