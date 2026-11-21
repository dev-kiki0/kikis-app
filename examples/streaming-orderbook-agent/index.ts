import { KikisAppClient, type SessionHandle } from '@kikis-app/kikis-app'

const TARGET_UPDATES = 100
const PROVIDER_B_URL = cleanBaseUrl(process.env['PROVIDER_B_URL'] ?? 'https://api-b.kikis-app.xyz')
const ORDERBOOK_URL = `${PROVIDER_B_URL}/stream/orderbook`
const STELLAR_NETWORK = process.env['STELLAR_NETWORK'] === 'mainnet' ? 'mainnet' : 'testnet'
const AGENT_SECRET = process.env['AGENT_SECRET'] ?? ''
const COMMITMENT_SECRET = process.env['COMMITMENT_SECRET'] ?? ''

// The session handle is assigned after openSession() so the Ctrl+C handler can
// settle the highest voucher even if the user interrupts the stream.
let session: SessionHandle | undefined
let closing = false

function cleanBaseUrl(url: string): string {
  return url.replace(/\/$/, '')
}

function requireSecret(name: string, value: string): void {
  // Stellar secret keys start with S; fail before any network calls if setup is
  // incomplete so first-time users get a direct fix.
  if (!value.startsWith('S')) {
    throw new Error(`${name} must be a Stellar secret key beginning with S...`)
  }
}

function toNumber(value: unknown): number | null {
  // Reject null, empty and whitespace-only values before Number() so a blank
  // price is not silently coerced to 0 and accepted as a valid quote.
  if (value === null || value === undefined) return null
  if (typeof value === 'string' && value.trim() === '') return null

  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

interface OrderbookEntry {
  price?: string
  amount?: string
}

interface OrderbookPayload {
  pair?: string
  timestamp?: string
  bids?: OrderbookEntry[]
  asks?: OrderbookEntry[]
}

function summarizeOrderbook(update: unknown) {
  // Provider B returns top-of-book arrays as decimal strings. Convert only the
  // fields needed for the summary so malformed updates are easy to skip.
  const payload = update as OrderbookPayload | undefined
  const bids = Array.isArray(payload?.bids) ? payload!.bids! : []
  const asks = Array.isArray(payload?.asks) ? payload!.asks! : []
  const bestBid = toNumber(bids[0]?.price)
  const bestAsk = toNumber(asks[0]?.price)

  if (bestBid === null || bestAsk === null) {
    return null
  }

  const spread = bestAsk - bestBid
  const mid = (bestAsk + bestBid) / 2

  return {
    pair: payload?.pair ?? 'unknown',
    timestamp: payload?.timestamp ?? new Date().toISOString(),
    bestBid,
    bestAsk,
    spread,
    mid,
  }
}

function printStats(index: number, stats: NonNullable<ReturnType<typeof summarizeOrderbook>>): void {
  console.log(
    [
      `#${String(index).padStart(3, '0')}`,
      stats.timestamp,
      stats.pair,
      `bestBid=${stats.bestBid.toFixed(7)}`,
      `bestAsk=${stats.bestAsk.toFixed(7)}`,
      `spread=${stats.spread.toFixed(7)}`,
      `mid=${stats.mid.toFixed(7)}`,
    ].join(' | '),
  )
}

async function closeSession(reason: string): Promise<void> {
  // close() sends the final cumulative commitment to Provider B, which submits
  // one on-chain settlement transaction for all vouchers used by the session.
  if (!session || closing) return
  closing = true

  console.log(`\n[session] closing (${reason})...`)
  const closeResult = await session.close()

  console.log(`[session] settled tx hash: ${closeResult.closeTxHash}`)
  console.log(`[session] vouchers issued: ${closeResult.vouchersIssued}`)
  console.log(`[session] total paid: ${closeResult.totalPaid} USDC`)
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    // A long-lived agent should always close the session before exiting; otherwise
    // the provider has no final settlement request for the consumed stream.
    closeSession(signal)
      .then(() => process.exit(0))
      .catch((error) => {
        console.error('[session] close failed:', error)
        process.exit(1)
      })
  })
}

async function main(): Promise<void> {
  requireSecret('AGENT_SECRET', AGENT_SECRET)
  requireSecret('COMMITMENT_SECRET', COMMITMENT_SECRET)

  // KikisApp discovers Provider B's manifest, verifies it supports
  // mpp-session, and returns a handle for voucher-backed streaming.
  const client = new KikisAppClient({
    wallet: AGENT_SECRET,
    network: STELLAR_NETWORK,
    commitmentSecret: COMMITMENT_SECRET,
  })

  console.log(`[client] network=${STELLAR_NETWORK}`)
  console.log(`[client] provider=${ORDERBOOK_URL}`)
  console.log('[session] opening MPP session...')

  session = await client.openSession(ORDERBOOK_URL)

  console.log(`[session] channel: ${session.channelId}`)
  console.log(`[session] open tx hash: ${session.openTxHash ?? 'n/a (pre-deployed channel)'}`)
  console.log(`[stream] consuming ${TARGET_UPDATES} orderbook updates\n`)

  let count = 0

  // Each iteration asks the SDK to send the next monotonic voucher, then yields
  // the provider's orderbook payload after the voucher is accepted.
  for await (const update of session.stream()) {
    const stats = summarizeOrderbook(update)
    count += 1

    if (stats) {
      printStats(count, stats)
    } else {
      console.log(`#${String(count).padStart(3, '0')} | skipped malformed orderbook update`)
    }

    if (count >= TARGET_UPDATES) break
  }

  await closeSession(`received ${count} updates`)
}

main().catch(async (error) => {
  console.error('[fatal]', error)
  try {
    await closeSession('fatal error')
  } catch (closeError) {
    console.error('[session] close after fatal error failed:', closeError)
  }
  process.exit(1)
})
