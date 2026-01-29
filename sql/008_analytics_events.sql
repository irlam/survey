-- 008_analytics_events.sql
CREATE TABLE IF NOT EXISTS analytics_events (
    id INT AUTO_INCREMENT PRIMARY KEY,
    event_name VARCHAR(100) NOT NULL,
    payload JSON NULL,
    user_agent VARCHAR(1024) NULL,
    source_ip VARCHAR(45) NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX (event_name),
    INDEX (created_at)
);
