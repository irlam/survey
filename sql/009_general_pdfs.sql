-- 009_general_pdfs.sql
CREATE TABLE IF NOT EXISTS pdf_folders (
    id INT AUTO_INCREMENT PRIMARY KEY,
    parent_id INT NULL,
    name VARCHAR(255) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    deleted_at TIMESTAMP NULL,
    FOREIGN KEY (parent_id) REFERENCES pdf_folders(id) ON DELETE SET NULL
);

-- Add folder_id to files table if not exists
SET @col_exists = (SELECT COUNT(*) FROM information_schema.COLUMNS 
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'files' AND COLUMN_NAME = 'folder_id');
SET @sql = IF(@col_exists = 0, 
    'ALTER TABLE files ADD COLUMN folder_id INT NULL', 
    'SELECT "Column folder_id already exists" AS skipped');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- Add deleted_at to files table if not exists
SET @col_exists = (SELECT COUNT(*) FROM information_schema.COLUMNS 
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'files' AND COLUMN_NAME = 'deleted_at');
SET @sql = IF(@col_exists = 0, 
    'ALTER TABLE files ADD COLUMN deleted_at TIMESTAMP NULL', 
    'SELECT "Column deleted_at already exists" AS skipped');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- Add foreign key constraint if not exists
SET @fk_exists = (SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS 
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'files' AND CONSTRAINT_NAME = 'fk_files_folder_id');
SET @sql = IF(@fk_exists = 0, 
    'ALTER TABLE files ADD CONSTRAINT fk_files_folder_id FOREIGN KEY (folder_id) REFERENCES pdf_folders(id) ON DELETE SET NULL', 
    'SELECT "Foreign key fk_files_folder_id already exists" AS skipped');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- Create indexes if not exist (MySQL 8.0.17+ supports CREATE INDEX IF NOT EXISTS)
-- For compatibility, we use a workaround
SET @idx_exists = (SELECT COUNT(*) FROM information_schema.STATISTICS 
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'files' AND INDEX_NAME = 'idx_files_folder_id');
SET @sql = IF(@idx_exists = 0, 
    'CREATE INDEX idx_files_folder_id ON files(folder_id)', 
    'SELECT "Index idx_files_folder_id already exists" AS skipped');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @idx_exists = (SELECT COUNT(*) FROM information_schema.STATISTICS 
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'files' AND INDEX_NAME = 'idx_files_deleted_at');
SET @sql = IF(@idx_exists = 0, 
    'CREATE INDEX idx_files_deleted_at ON files(deleted_at)', 
    'SELECT "Index idx_files_deleted_at already exists" AS skipped');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @idx_exists = (SELECT COUNT(*) FROM information_schema.STATISTICS 
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'pdf_folders' AND INDEX_NAME = 'idx_pdf_folders_parent_id');
SET @sql = IF(@idx_exists = 0, 
    'CREATE INDEX idx_pdf_folders_parent_id ON pdf_folders(parent_id)', 
    'SELECT "Index idx_pdf_folders_parent_id already exists" AS skipped');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @idx_exists = (SELECT COUNT(*) FROM information_schema.STATISTICS 
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'pdf_folders' AND INDEX_NAME = 'idx_pdf_folders_deleted_at');
SET @sql = IF(@idx_exists = 0, 
    'CREATE INDEX idx_pdf_folders_deleted_at ON pdf_folders(deleted_at)', 
    'SELECT "Index idx_pdf_folders_deleted_at already exists" AS skipped');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
