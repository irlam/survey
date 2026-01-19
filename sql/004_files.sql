-- 004_files.sql
CREATE TABLE IF NOT EXISTS files (
    id INT AUTO_INCREMENT PRIMARY KEY,
    plan_id INT,
    filename VARCHAR(255) NOT NULL,
    original_name VARCHAR(255),
    size INT,
    mime VARCHAR(64),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (plan_id) REFERENCES plans(id) ON DELETE CASCADE
);
