CREATE DATABASE IF NOT EXISTS smart_cache CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE smart_cache;
CREATE TABLE IF NOT EXISTS test_runs (
 id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, name VARCHAR(160) NOT NULL,
 created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, started_at DATETIME(3) NULL, stopped_at DATETIME(3) NULL,
 duration_ms BIGINT UNSIGNED NOT NULL, read_interval DECIMAL(4,2) NOT NULL, write_interval DECIMAL(4,2) NOT NULL,
 objective ENUM('response','throughput','reliability') NOT NULL, total_reads BIGINT UNSIGNED NOT NULL, total_writes BIGINT UNSIGNED NOT NULL,
 total_requests BIGINT UNSIGNED NOT NULL, summary_json JSON NOT NULL, result_json JSON NOT NULL
);
