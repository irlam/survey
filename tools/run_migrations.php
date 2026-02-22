<?php
/**
 * Database Migration Runner
 * 
 * Usage: php tools/run_migrations.php
 * 
 * This script runs all SQL migrations in order from the sql/ directory.
 * Migrations are named with prefix: 001_xxx.sql, 002_xxx.sql, etc.
 */

require_once __DIR__ . '/../api/config-util.php';
require_once __DIR__ . '/../api/db.php';

$sqlDir = __DIR__ . '/../sql';
$migrations = glob($sqlDir . '/*.sql');

if (empty($migrations)) {
    echo "No migration files found in {$sqlDir}\n";
    exit(1);
}

// Sort migrations by filename (numeric order)
sort($migrations, SORT_NATURAL);

echo "Found " . count($migrations) . " migration file(s)\n";

$pdo = db();

// Create migrations tracking table if not exists
$pdo->exec("CREATE TABLE IF NOT EXISTS _migrations (
    id INT AUTO_INCREMENT PRIMARY KEY,
    filename VARCHAR(255) NOT NULL UNIQUE,
    applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
)");

// Get already applied migrations
$stmt = $pdo->query('SELECT filename FROM _migrations');
$applied = array_column($stmt->fetchAll(), 'filename');

$appliedCount = 0;
$skippedCount = 0;
$errorCount = 0;

foreach ($migrations as $migration) {
    $filename = basename($migration);
    
    // Skip tracking table migration
    if ($filename === '_migrations.sql') {
        continue;
    }
    
    if (in_array($filename, $applied, true)) {
        echo "  [SKIP] {$filename} (already applied)\n";
        $skippedCount++;
        continue;
    }
    
    echo "  [RUN] {$filename}... ";
    
    try {
        $sql = file_get_contents($migration);
        
        // Execute multi-statement SQL
        $pdo->exec($sql);
        
        // Record migration
        $stmt = $pdo->prepare('INSERT INTO _migrations (filename) VALUES (?)');
        $stmt->execute([$filename]);
        
        echo "OK\n";
        $appliedCount++;
    } catch (PDOException $e) {
        $msg = $e->getMessage();
        // Check if it's a "already exists" error - if so, still mark as applied
        if (strpos($msg, 'already exists') !== false || strpos($msg, 'Duplicate') !== false) {
            echo "OK (already applied)\n";
            // Mark as applied anyway to continue
            $stmt = $pdo->prepare('INSERT IGNORE INTO _migrations (filename) VALUES (?)');
            $stmt->execute([$filename]);
            $skippedCount++;
        } else {
            echo "ERROR: " . $msg . "\n";
            $errorCount++;
            
            // Stop on first error to prevent partial migrations
            echo "\nMigration stopped due to error. Please fix and re-run.\n";
            break;
        }
    }
}

echo "\n";
echo "Summary:\n";
echo "  Applied: {$appliedCount}\n";
echo "  Skipped: {$skippedCount}\n";
echo "  Errors:  {$errorCount}\n";

if ($errorCount > 0) {
    exit(1);
}

echo "\nAll migrations completed successfully!\n";
