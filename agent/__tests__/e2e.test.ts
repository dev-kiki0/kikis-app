/**
 * End-to-End Integration Tests for KikisApp Agent
 *
 * This test suite validates the complete autonomous payment workflow across all
 * three payment modes (x402, MPP charge, MPP session) against live provider
 * services on Stellar testnet.
 *
 * Run with: pnpm --filter agent test:e2e
 *
 * Prerequisites:
 *   - Stellar testnet access via Horizon API
 *   - Funded agent keypair (AGENT_SECRET with USDC balance)
 *   - Running provider services (local or remote)
 *   - Network connectivity
 *
 * Environment Variables:
 *   STELLAR_NETWORK      Network to use (default: testnet)
 *   AGENT_SECRET         Stellar secret key (required, must start with S)
 *   COMMITMENT_SECRET    Ed25519 keypair for MPP session (optional)
 *   PROVIDER_A_URL       URL of price provider (default: http://localhost:3001)
 *   PROVIDER_B_URL       URL of orderbook provider (default: http://localhost:3002)
 *   AGENT_DAILY_CAP_USDC Daily spending cap in USDC (default: 0.002)
 */

import path from 'node:path'
import os from 'node:os'
import assert from 'node:assert/strict'
import { Keypair } from '@stellar/stellar-sdk'
import { KikisAppClient, FileSpendStore, KikisAppPolicyRejectedError } from '@kikis-app/kikis-app'

// ── Config ────────────────────────────────────────────────────────────────────

const STELLAR_NETWORK = (process.env['STELLAR_NETWORK'] ?? 'testnet') as 'testnet' | 'mainnet'
const AGENT_SECRET = process.env['AGENT_SECRET'] ?? ''
const PROVIDER_A_URL = (process.env['PROVIDER_A_URL'] ?? 'http://localhost:3001').replace(/\/$/, '')
const PROVIDER_B_URL = (process.env['PROVIDER_B_URL'] ?? 'http://localhost:3002').replace(/\/$/, '')
const AGENT_DAILY_CAP_USDC = process.env['AGENT_DAILY_CAP_USDC'] ?? '0.002'
const COMMITMENT_SECRET = process.env['COMMITMENT_SECRET'] ?? ''

const TARGET_VOUCHERS = 50
const PROVIDER_A_PRICE_STROOPS = 100_000 // 0.001 USDC

// ── Logging ───────────────────────────────────────────────────────────────────

function log(test: string, msg: string): void {
  const ts = new Date().toISOString()
  console.log(`[${ts}] [${test}] ${msg}`)
}

// ── Graceful shutdown helper ──────────────────────────────────────────────────

/**
 * Best-effort close of all active sessions with a 5-second timeout.
 *
 * Mirrors the shutdown handler registered in `agent/src/index.ts` so the
 * integration test can verify that open channels are settled before the
 * process exits on SIGINT/SIGTERM/uncaughtException.
 */
async function closeAllSessions(
  sessions: Set<{ close: () => Promise<unknown> }>,
  timeoutMs = 5_000,
): Promise<void> {
  const active = Array.from(sessions)
  if (active.length === 0) return

  await Promise.allSettled(
    active.map(async (session) => {
      let timer: ReturnType<typeof setTimeout> | undefined
      try {
        await Promise.race([
          session.close(),
          new Promise<never>((_, reject) => {
            timer = setTimeout(
              () => reject(new Error(`session close timed out after ${timeoutMs}ms`)),
              timeoutMs,
            )
          }),
        ])
      } catch (err) {
        log('shutdown', `⚠ Failed to close session: ${(err as Error).message}`)
      } finally {
        if (timer) clearTimeout(timer)
        sessions.delete(session)
      }
    }),
  )
}

// ── Test Suite ────────────────────────────────────────────────────────────────

async function runTests(): Promise<void> {
  log('setup', 'Starting KikisApp E2E test suite')
  log('setup', `Network: ${STELLAR_NETWORK}`)
  log('setup', `Provider A: ${PROVIDER_A_URL}`)
  log('setup', `Provider B: ${PROVIDER_B_URL}`)
  log('setup', `Daily cap: ${AGENT_DAILY_CAP_USDC} USDC`)

  // ── Validation: Required environment variables ────────────────────────────
  if (!AGENT_SECRET || !AGENT_SECRET.startsWith('S')) {
    throw new Error(
      'FATAL: AGENT_SECRET is required and must be a valid Stellar secret key (S...)',
    )
  }

  const keypair = Keypair.fromSecret(AGENT_SECRET)
  const agentAddress = keypair.publicKey()
  log('setup', `Agent address: ${agentAddress}`)

  const spendStorePath =
    process.env['AGENT_SPEND_STORE_PATH'] ??
    process.env['KIKIS_APP_SPEND_STORE_PATH'] ??
    path.join(os.homedir(), '.kikis-app', 'spend.json')

  const client = new KikisAppClient({
    wallet: keypair,
    network: STELLAR_NETWORK,
    spendCap: { daily: AGENT_DAILY_CAP_USDC, asset: 'USDC' },
    spendStore: new FileSpendStore(spendStorePath),
    commitmentSecret: COMMITMENT_SECRET || undefined,
  })

  // ── Test 1: x402 discrete query ────────────────────────────────────────────
  log('x402', 'Running x402 discrete query test...')

  let x402Result: any
  try {
    x402Result = await client.pay(`${PROVIDER_A_URL}/price`, { forceMode: 'x402' })
  } catch (err) {
    if (
      err instanceof Error &&
      (err.message.includes('ECONNREFUSED') || err.message.includes('fetch failed'))
    ) {
      if (process.env.CI && process.env.E2E_ALLOW_SKIP !== 'true') {
        throw err
      }
      log(
        'x402',
        'SKIP: Provider A unavailable (connection refused). Ensure Provider A is running.',
      )
      return
    }
    throw err
  }

  assert(x402Result, 'x402 result should exist')
  assert.equal(x402Result.mode, 'x402', `expected mode x402, got ${x402Result.mode}`)
  assert(x402Result.txHash, 'x402 should have txHash')
  assert(x402Result.data, 'x402 should have response data')
  assert(x402Result.amount, 'x402 should have amount paid')
  log('x402', `✓ mode=${x402Result.mode} amount=${x402Result.amount} USDC`)
  log('x402', `✓ txHash=${x402Result.txHash}`)

  // ── Test 2: MPP charge query ───────────────────────────────────────────────
  log('mpp-charge', 'Running MPP charge query test...')

  let chargeResult: any
  try {
    chargeResult = await client.pay(`${PROVIDER_A_URL}/price`, { forceMode: 'mpp-charge' })
  } catch (err) {
    if (
      err instanceof Error &&
      (err.message.includes('ECONNREFUSED') || err.message.includes('fetch failed'))
    ) {
      if (process.env.CI && process.env.E2E_ALLOW_SKIP !== 'true') {
        throw err
      }
      log(
        'mpp-charge',
        'SKIP: Provider A unavailable (connection refused). Ensure Provider A is running.',
      )
      return
    }
    throw err
  }

  assert(chargeResult, 'charge result should exist')
  assert.equal(
    chargeResult.mode,
    'mpp-charge',
    `expected mpp-charge, got ${chargeResult.mode} (x402 does not satisfy the MPP charge phase)`,
  )
  assert(chargeResult.data, 'charge should have response data')
  assert(chargeResult.amount, 'charge should have amount paid')
  log('mpp-charge', `✓ mode=${chargeResult.mode} amount=${chargeResult.amount} USDC`)
  if (chargeResult.txHash) {
    log('mpp-charge', `✓ txHash=${chargeResult.txHash}`)
  } else {
    log('mpp-charge', '✓ txHash=null (expected for discrete MPP charge)')
  }

  // ── Test 3: MPP session streaming ──────────────────────────────────────────
  log('mpp-session', 'Running MPP session streaming test...')

  let session: any
  try {
    session = await client.openSession(`${PROVIDER_B_URL}/stream/orderbook`)
  } catch (err) {
    if (
      err instanceof Error &&
      (err.message.includes('ECONNREFUSED') || err.message.includes('fetch failed'))
    ) {
      if (process.env.CI && process.env.E2E_ALLOW_SKIP !== 'true') {
        throw err
      }
      log(
        'mpp-session',
        'SKIP: Provider B unavailable (connection refused). Ensure Provider B is running.',
      )
      return
    }
    throw err
  }

  assert(session, 'session handle should exist')
  assert(session.channelId, 'session should have channelId')
  // The channel is pre-deployed, so the client issues no open transaction and
  // openTxHash is null — it must NOT be the contract address (channelId).
  assert(session.openTxHash === null, 'session openTxHash should be null for a pre-deployed channel')
  assert(session.openTxHash !== session.channelId, 'openTxHash must not be the contract address')
  log('mpp-session', `✓ Channel opened: ${session.channelId}`)
  log('mpp-session', `✓ openTxHash=${session.openTxHash ?? 'null (pre-deployed channel)'}`)

  // Consume vouchers from stream
  let voucherCount = 0
  let lastError: Error | null = null

  try {
    for await (const item of session.stream()) {
      voucherCount++

      // Validate each item is an object (SSE event)
      assert(item, `voucher ${voucherCount} should not be null`)

      if (voucherCount % 10 === 0)

/* … truncated 2824 chars — edit only what you need near the top … */
