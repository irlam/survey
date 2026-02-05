-- 009_general_pdfs.sql
CREATE TABLE IF NOT EXISTS pdf_folders (
    id INT AUTO_INCREMENT PRIMARY KEY,
    parent_id INT NULL,
    name VARCHAR(255) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    deleted_at TIMESTAMP NULL,
    FOREIGN KEY (parent_id) REFERENCES pdf_folders(id) ON DELETE SET NULL
);

ALTER TABLE files
    ADD COLUMN folder_id INT NULL,
    ADD COLUMN deleted_at TIMESTAMP NULL,
    ADD CONSTRAINT fk_files_folder_id FOREIGN KEY (folder_id) REFERENCES pdf_folders(id) ON DELETE SET NULL;

CREATE INDEX idx_files_folder_id ON files(folder_id);
CREATE INDEX idx_files_deleted_at ON files(deleted_at);
CREATE INDEX idx_pdf_folders_parent_id ON pdf_folders(parent_id);
CREATE INDEX idx_pdf_folders_deleted_at ON pdf_folders(deleted_at);
