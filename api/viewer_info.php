<?php
// api/viewer_info.php
// Returns JSON info about the app/viewer.js file on disk to help diagnose truncation/caching issues
header('Content-Type: application/json');
$path = __DIR__ . '/../app/viewer.js';
if(!file_exists($path)){
    echo json_encode(['ok'=>0,'error'=>'viewer.js not found','path'=>$path]);
    exit;
}
$size = filesize($path);
$sha = hash_file('sha256', $path);
$mtime = filemtime($path);
echo json_encode(['ok'=>1,'path'=>str_replace($_SERVER['DOCUMENT_ROOT'],'',$path),'size'=>$size,'sha256'=>$sha,'mtime'=>date('c',$mtime)]);
