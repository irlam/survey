<?php
// Copy this file to config.php and fill in your values before first deployment.
// api/db.php reads the 'db' sub-array; the flat db_host/db_name keys used here
// previously were ignored, causing "DB config missing" on every request.
return [
    'base_url' => '', // e.g. https://survey.defecttracker.uk

    // Database connection — nested array required by api/db.php
    'db' => [
        'host'    => 'localhost',
        'port'    => 3306,
        'dbname'  => '',          // MySQL database name
        'user'    => '',          // MySQL username
        'pass'    => '',          // MySQL password
        'charset' => 'utf8mb4',
    ],

    // Storage path relative to httpdocs (the directory that contains api/).
    // 'storage' keeps files inside httpdocs, which is safe under Plesk open_basedir.
    // Do NOT use '../storage' — that resolves outside httpdocs and will be blocked.
    'storage_path' => 'storage',

    // Note: Also set in php.ini: upload_max_filesize, post_max_size
    // And in nginx/Apache: client_max_body_size
    'max_upload_mb' => 128,
    'debug' => false,

    // Security: Enable CSRF protection for state-changing requests
    'csrf_enabled' => true,

    // Optional DWG converter configuration. Ideally install system converters
    // (dwg2pdf, dwg2svg, pdf2svg, ImageMagick) on the server.
    // If you cannot install system packages, you may provide a Docker image.
    // Example:
    // 'dwg_converter' => [ 'use_docker' => true, 'docker_image' => 'libredwg/libredwg:latest' ]
    'dwg_converter' => [ 'use_docker' => false, 'docker_image' => '' ],

    'actor_name' => '', // optional, used in audit log

    // Feature flags — uncomment to enable experimental features
    // 'FEATURE_PIN_DRAG' => false,
];
