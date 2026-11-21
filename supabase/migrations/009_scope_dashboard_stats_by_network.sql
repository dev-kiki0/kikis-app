-- 009_scope_dashboard_stats_by_network.sql
-- Scope the public dashboard aggregation view by network so testnet dummy
-- USDC never mixes with mainnet real USDC in the reported totals.
-- Also restore the last settlement hash and timestamp fields that the
-- dashboard metrics component expects.

DROP VIEW IF EXISTS public_dashboard_stats;

CREATE VIEW public_dashboard_stats AS
SELECT
  agg.network,
  agg.active_sessions,
  agg.open_vouchers,
  agg.total_settled,
  latest.settlement_tx_hash AS last_settlement_tx_hash,
  latest.updated_at         AS last_settlement_at
FROM (
  SELECT
    network,
    COUNT(*) FILTER (WHERE status = 'open')                                    AS active_sessions,
    COALESCE(SUM(voucher_count) FILTER (WHERE status = 'open'), 0)             AS open_vouchers,
    COALESCE(SUM(cumulative_amount) FILTER (WHERE status = 'closed'), 0)::text AS total_settled
  FROM sessions
  GROUP BY network
) agg
LEFT JOIN LATERAL (
  SELECT settlement_tx_hash, updated_at
  FROM sessions
  WHERE status = 'closed'
    AND settlement_tx_hash IS NOT NULL
    AND network = agg.network
  ORDER BY updated_at DESC
  LIMIT 1
) latest ON true;

COMMENT ON VIEW public_dashboard_stats IS
  'Per-network dashboard aggregation. One row per network; totals are isolated by network. Includes the most recent settlement hash and timestamp for each network.';
