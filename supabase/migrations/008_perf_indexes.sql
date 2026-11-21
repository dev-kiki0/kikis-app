-- ============================================================
-- KikisApp — Performance Indexes Migration
-- Migration 008: Composite and Secondary Indexes for tx_log and sessions
-- ============================================================

-- ─── 1. Transaction Log (tx_log) Performance Indexes ─────────

-- Dashboard feed queries: SELECT * FROM tx_log ORDER BY created_at DESC LIMIT 20
CREATE INDEX IF NOT EXISTS idx_tx_log_created_at_desc
  ON tx_log (created_at DESC);

-- Network-filtered queries: SELECT * FROM tx_log WHERE network = $1 ORDER BY created_at DESC
CREATE INDEX IF NOT EXISTS idx_tx_log_network_created
  ON tx_log (network, created_at DESC);

-- Foreign key lookup and joins from session records to their transaction logs
CREATE INDEX IF NOT EXISTS idx_tx_log_session_id
  ON tx_log (session_id);

-- Agent address queries: filter transactions by agent
CREATE INDEX IF NOT EXISTS idx_tx_log_agent_address
  ON tx_log (agent_address);

-- ─── 2. Sessions Performance Indexes ──────────────────────────

-- Optimizes public_dashboard_stats lateral subquery:
-- SELECT settlement_tx_hash, updated_at FROM sessions WHERE status = 'closed' AND settlement_tx_hash IS NOT NULL ORDER BY updated_at DESC LIMIT 1
CREATE INDEX IF NOT EXISTS idx_sessions_status_updated
  ON sessions (status, updated_at DESC)
  WHERE status = 'closed';
