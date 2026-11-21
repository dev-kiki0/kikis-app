-- ─── Settlement retention ─────────────────────────────────────
--
-- The `settlements` table is an idempotency cache: it prevents a retried
-- payment from settling (and billing) a second time. Its useful lifetime
-- is bounded by the agent retry window — seconds to minutes at most.
-- Rows older than a day serve no purpose; the idx_settlements_created_at
-- index (added in migration 003) exists specifically for this cleanup.
--
-- Policy: delete settlements older than 7 days. This is comfortably beyond
-- any reasonable retry window while leaving room to investigate a dispute
-- in the first week after settlement.
--
-- Scheduling: Supabase projects include pg_cron. We conditionally enable
-- it and register a daily cleanup job. If pg_cron is not available (e.g.
-- a local dev Supabase instance), the function still exists and can be
-- called manually or from an external scheduler.

-- ── 1. Cleanup function ──────────────────────────────────────

CREATE OR REPLACE FUNCTION cleanup_stale_settlements(retention_days integer DEFAULT 7)
RETURNS integer
LANGUAGE plpgsql
AS $$
DECLARE
  deleted_count integer;
BEGIN
  DELETE FROM settlements
  WHERE created_at < now() - (retention_days || ' days')::interval;

  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$;

-- ── 2. Idempotent cron registration ──────────────────────────
-- Registers the daily cleanup job exactly once. Safe to call repeatedly:
-- if a job with the same name already exists it is left untouched, so
-- re-running never creates duplicate jobs. Raises a clear error when
-- pg_cron is not installed so operators know to enable it first.
--
-- Operators who enable pg_cron AFTER this migration ran can install the
-- job without replaying old migrations by calling:
--
--   SELECT schedule_settlement_retention();
--
-- This is idempotent — invoking it twice still yields exactly one job.

CREATE OR REPLACE FUNCTION schedule_settlement_retention()
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    RAISE EXCEPTION
      'pg_cron is not installed; enable it (CREATE EXTENSION pg_cron) before scheduling settlement retention';
  END IF;

  -- Only schedule if the job does not already exist (idempotent).
  IF NOT EXISTS (
    SELECT 1 FROM cron.job WHERE jobname = 'settlement-retention-cleanup'
  ) THEN
    -- Schedule daily cleanup at 03:00 UTC.
    -- cron.schedule(job_name, schedule, command)
    PERFORM cron.schedule(
      'settlement-retention-cleanup',
      '0 3 * * *',           -- daily at 03:00 UTC
      'SELECT cleanup_stale_settlements(7)'
    );
  END IF;
END;
$$;

-- ── 3. pg_cron schedule (conditional) ────────────────────────
-- Enable the pg_cron extension if available. Supabase projects ship with
-- it, but local/self-hosted instances may not. CREATE EXTENSION IF NOT
-- EXISTS is safe — it no-ops when the extension is already installed.
-- When pg_cron is absent we skip silently; the manual cleanup function
-- above remains available and the job can be installed later via
-- schedule_settlement_retention().

DO $$
BEGIN
  -- Only proceed if pg_cron is installed.
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM schedule_settlement_retention();
  END IF;
END $$;

-- ── 4. tx_log retention policy ───────────────────────────────
-- tx_log is an audit ledger — append-only by design. Every settlement,
-- channel open, channel close, and policy rejection is recorded here.
-- Unlike settlements, tx_log is never cleaned up: it is the permanent
-- record of all payment activity for compliance, debugging, and
-- dashboard display. If storage becomes a concern, archive old rows
-- to cold storage rather than deleting them.
--
-- The existing idx on tx_log is not yet added; consider one if query
-- patterns warrant it (e.g. filtering by provider_url or agent_address).
COMMENT ON TABLE tx_log IS
  'Immutable audit ledger of all payment activity. Retained indefinitely — '
  'do not delete rows. Archive to cold storage if storage costs grow.';
