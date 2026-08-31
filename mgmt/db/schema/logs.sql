-- D1 database: logs
-- Generated from live Google Sheet export (__नवय_वक_छठ_प_ज__सम_त__शहरप_र____-_Web_App.xlsx)

-- source sheet: "ERROR_LOG"
DROP TABLE IF EXISTS error_log;
CREATE TABLE error_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  error_id TEXT,
  source TEXT,
  page TEXT,
  message TEXT,
  stack TEXT,
  context TEXT,
  created_at TEXT,
  reported TEXT
);
CREATE INDEX idx_error_log_created_at ON error_log(created_at);
CREATE INDEX idx_error_log_reported ON error_log(reported);

-- source sheet: "ACTIVITY LOG"
DROP TABLE IF EXISTS activity_log;
CREATE TABLE activity_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  timestamp TEXT,
  name TEXT,
  action TEXT,
  details TEXT,
  device_info TEXT,
  ip_client_reported TEXT,
  device_id TEXT
);
CREATE INDEX idx_activity_log_name ON activity_log(name);

