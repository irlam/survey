<?php
/* api/list_trash.php - List trash folders (04/02/2026) */
require_once __DIR__ . '/config-util.php';
require_once __DIR__ . '/db.php';
require_method('GET');
$base = resolve_storage_path() . '/trash';
if (!is_dir($base)) json_response(['ok'=>true, 'trash'=>[]]);
$dirs = @scandir($base, SCANDIR_SORT_DESCENDING);
$res = [];
foreach ($dirs as $d) {
  if ($d === '.' || $d === '..') continue;
  $full = $base . '/' . $d;
  if (!is_dir($full)) continue;
  $manifest = null;
  $manifestFile = $full . '/manifest.json';
  if (is_file($manifestFile)) {
    $txt = @file_get_contents($manifestFile);
    $manifest = json_decode($txt, true);
  }
  // build file listing
  $files = [];
  $it = @scandir($full);
  if (is_array($it)){
    foreach ($it as $f){ if ($f=='.' || $f=='..') continue; if ($f==='manifest.json') continue; $fp = $full . '/' . $f; if (!is_file($fp)) continue; $files[] = ['name'=>$f, 'size'=>filesize($fp), 'mtime'=>filemtime($fp), 'rel'=> str_replace(resolve_storage_path() . '/', '', $fp)]; }
  }
  $res[] = ['dir' => $d, 'path' => str_replace(resolve_storage_path() . '/', '', $full), 'manifest' => $manifest, 'files' => $files, 'mtime'=>filemtime($full)];
}
json_response(['ok'=>true, 'trash'=>$res]);
