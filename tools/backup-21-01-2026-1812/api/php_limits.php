<?php
header('Content-Type: application/json; charset=utf-8');
echo json_encode([
  'ok' => true,
  'upload_max_filesize' => ini_get('upload_max_filesize'),
  'post_max_size' => ini_get('post_max_size'),
  'memory_limit' => ini_get('memory_limit'),
  'max_execution_time' => ini_get('max_execution_time'),
  'max_input_time' => ini_get('max_input_time'),
  'file_uploads' => ini_get('file_uploads'),
], JSON_PRETTY_PRINT);
