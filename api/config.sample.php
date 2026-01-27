<?php
return [
    'base_url' => '', // e.g. https://survey.defecttracker.uk
    'db_host' => 'localhost',
    'db_name' => '',
    'db_user' => '',
    'db_pass' => '',
    'db_charset' => 'utf8mb4',
    'storage_path' => '../storage',
    'max_upload_mb' => 25,

    // Optional DWG converter configuration. Ideally install system converters (dwg2pdf, dwg2svg, dwg2dxf, pdf2svg, ImageMagick) on the server.
    // If you cannot install system packages, you may provide a Docker image that bundles conversion utilities.
    // Example:
    // 'dwg_converter' => [ 'use_docker' => true, 'docker_image' => 'libredwg/libredwg:latest' ]
    'dwg_converter' => [ 'use_docker' => false, 'docker_image' => '' ],

    'actor_name' => '' // optional, for audit,

    // Feature flags
    // Turn on experimental features by setting in config.php
    // 'FEATURE_PIN_DRAG' => false
];
