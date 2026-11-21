-- ============================================================
-- KikisApp — Development Seed Data
-- For local dashboard dev and demo purposes only.
-- Run: supabase db seed
-- ============================================================


-- ─── Sample Providers ────────────────────────────────────────

INSERT INTO providers (name, description, base_url, modes, tags, categories, network, payee, manifest, verified)
VALUES
  (
    'Stellar DEX Price Feed',
    'Real-time USDC/XLM mid-price from Stellar DEX orderbook via Horizon',
    'https://api-a.kikis-app.xyz',
    ARRAY['x402', 'mpp-charge'],
    ARRAY['price', 'stellar', 'dex', 'orderbook', 'usdc'],
    ARRAY['data/price/crypto'],
    'testnet',
    'GDEMO1PAYEEADDRESS11111111111111111111111111111111111111',
    '{
      "kikis-app": "1.0",
      "name": "Stellar DEX Price Feed",
      "description": "Real-time USDC/XLM mid-price from Stellar DEX orderbook via Horizon",
      "modes": ["x402", "mpp-charge"],
      "network": "testnet",
      "asset": "USDC",
      "asset_contract": "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA",
      "payee": "GDEMO1PAYEEADDRESS11111111111111111111111111111111111111",
      "pricing": {
        "x402": { "amount": "0.001", "per": "request", "facilitator": "https://channels.openzeppelin.com/x402/testnet" },
        "mpp-charge": { "amount": "0.0008", "per": "request" }
      },
      "endpoints": { "price": "GET /price" },
      "tags": ["price", "stellar", "dex", "orderbook", "usdc"],
      "categories": ["data/price/crypto"]
    }'::jsonb,
    true
  ),
  (
    'Stellar DEX Orderbook Stream',
    'Real-time USDC/XLM orderbook SSE stream from Stellar Horizon',
    'https://api-b.kikis-app.xyz',
    ARRAY['mpp-session', 'mpp-session-ws'],
    ARRAY['stream', 'stellar', 'dex', 'orderbook', 'usdc', 'sse', 'realtime'],
    ARRAY['data/stream/crypto'],
    'testnet',
    'GDEMO2PAYEEADDRESS11111111111111111111111111111111111111',
    '{
      "kikis-app": "1.0",
      "name": "Stellar DEX Orderbook Stream",
      "description": "Real-time USDC/XLM orderbook SSE stream from Stellar Horizon",
      "modes": ["mpp-session", "mpp-session-ws"],
      "network": "testnet",
      "asset": "USDC",
      "asset_contract": "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA",
      "payee": "GDEMO2PAYEEADDRESS11111111111111111111111111111111111111",
      "pricing": {
        "mpp-session": {
          "rate": "0.0001",
          "per": "voucher",
          "channel_contract": "CDEMO1CHANNELCONTRACT1111111111111111111111111111111111",
          "min_deposit": "0.10",
          "refund_waiting_period_ledgers": 17280
        },
        "mpp-session-ws": {
          "rate": "0.0001",
          "per": "voucher",
          "channel_contract": "CDEMO1CHANNELCONTRACT1111111111111111111111111111111111",
          "min_deposit": "0.10",
          "refund_waiting_period_ledgers": 17280
        }
      },
      "endpoints": { "stream": "GET /stream/orderbook" },
      "tags": ["stream", "stellar", "dex", "orderbook", "usdc", "sse", "realtime"],
      "categories": ["data/stream/crypto"]
    }'::jsonb,
    true
  )
ON CONFLICT (base_url) DO UPDATE
SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  modes = EXCLUDED.modes,
  tags = EXCLUDED.tags,
  categories = EXCLUDED.categories,
  network = EXCLUDED.network,
  payee = EXCLUDED.payee,
  manifest = EXCLUDED.manifest,
  verified = EXCLUDED.verified;


-- ─── Sample Sessions ──────────────────────────────────────────

INSERT INTO sessions (
  channel_id, payee, payer, cumulative_amount, last_signature,
  status, channel_contract, network, opened_at, updated_at,
  settlement_tx_hash, open_tx_hash, voucher_count
)
VALUES
  (
    'chan_demo_001_open',
    'GDEMO2PAYEEADDRESS11111111111111111111111111111111111111',
    'GDEMO1AGENTADDRESS1111111111111111111111111111111111111',
    0.0023,
    'DEMOBASE64SIGNATURE001==',
    'open',
    'CDEMO1CHANNELCONTRACT1111111111111111111111111111111111',
    'testnet',
    NOW() - INTERVAL '2 hours',
    NOW() - INTERVAL '5 minutes',
    NULL,
    'demotxhash001xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
    23
  ),
  (
    'chan_demo_002_closed',
    'GDEMO2PAYEEADDRESS11111111111111111111111111111111111111',
    'GDEMO1AGENTADDRESS1111111111111111111111111111111111111',
    0.0050,
    'DEMOBASE64SIGNATURE002==',
    'closed',
    'CDEMO1CHANNELCONTRACT1111111111111111111111111111111111',
    'testnet',
    NOW() - INTERVAL '6 hours',
    NOW() - INTERVAL '3 hours',
    'demotxhash003xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
    'demotxhash002xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
    50
  ),
  (
    'chan_demo_003_closing',
    'GDEMO2PAYEEADDRESS11111111111111111111111111111111111111',
    'GDEMO1AGENTADDRESS1111111111111111111111111111111111111',
    0.0011,
    'DEMOBASE64SIGNATURE003==',
    'closing',
    'CDEMO1CHANNELCONTRACT1111111111111111111111111111111111',
    'testnet',
    NOW() - INTERVAL '30 minutes',
    NOW() - INTERVAL '1 minute',
    NULL,
    'demotxhash004xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
    11
  )
ON CONFLICT (channel_id) DO NOTHING;


-- ─── Sample tx_log entries ────────────────────────────────────

INSERT INTO tx_log (id, tx_type, tx_hash, amount, mode, network, provider_url, agent_address, metadata)
SELECT fixture.id::uuid, fixture.tx_type, fixture.tx_hash, fixture.amount, fixture.mode,
       fixture.network, fixture.provider_url, fixture.agent_address, fixture.metadata
FROM (VALUES
  (
    'dea00000-0000-4000-8000-000000000001',
    'x402_settle',
    'demotxhash005xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
    0.001,
    'x402',
    'testnet',
    'https://provider-a.railway.app/price',
    'GDEMO1AGENTADDRESS1111111111111111111111111111111111111',
    '{"status": 200, "latency_ms": 142}'::jsonb
  ),
  (
    'dea00000-0000-4000-8000-000000000002',
    'mpp_charge',
    'demotxhash006xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
    0.0008,
    'mpp-charge',
    'testnet',
    'https://provider-a.railway.app/price',
    'GDEMO1AGENTADDRESS1111111111111111111111111111111111111',
    '{"status": 200, "latency_ms": 98}'::jsonb
  ),
  (
    'dea00000-0000-4000-8000-000000000003',
    'channel_open',
    'demotxhash004xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
    0.10,
    'mpp-session',
    'testnet',
    'https://provider-b.railway.app/stream/orderbook',
    'GDEMO1AGENTADDRESS1111111111111111111111111111111111111',
    '{"channel_id": "chan_demo_003_closing"}'::jsonb
  )
) AS fixture(id, tx_type, tx_hash, amount, mode, network, provider_url, agent_address, metadata)
-- Earlier seed runs assigned generated IDs to these same transaction fixtures.
WHERE NOT EXISTS (
  SELECT 1 FROM tx_log AS existing
  WHERE existing.tx_hash = fixture.tx_hash
    AND existing.tx_type = fixture.tx_type
    AND existing.network = fixture.network
)
ON CONFLICT (id) DO NOTHING;
