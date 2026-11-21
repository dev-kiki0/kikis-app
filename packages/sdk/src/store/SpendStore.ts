import { resolveLogger, type KikisAppLogger } from '../internal/logger.js'

// ── Types ────────────────────────────────────────────────────────────────────

/**
 * A single in-flight spend reservation persisted durably.
 */
export interface PendingReserve {
  /** Unique identifier for this reservation */
  reserveId: string
  /** Amount reserved, in the asset's base units (e.g. stroops for 7-decimal assets) */
  amountMicros: string
  /** Endpoint origin key this reserve applies to (undefined for global only) */
  endpointKey?: string | undefined
  /** ISO timestamp when the reservation was created */
  timestamp: string
}

/**
 * Daily spend accumulator, keyed by an ISO date (YYYY-MM-DD).
 *
 * Totals are decimal strings of integer units (asset-specific base units) so
 * the record stays JSON-serializable with no floating point precision loss.
 *
 * pendingReserves holds in-flight reservations that have been written to the
 * durable store but not yet committed or rolled back. On client startup,
 * reconcilePendingReserves() prunes stale entries older than the TTL.
 */
export interface DailySpend {
  date: string
  /** Global accumulated spend for the day, in base units (e.g. "5000000" stroops for USDC) */
  totalMicros: string
  /** Per-endpoint accumulated spend for the day, keyed by origin URL, in base units */
  endpoints: Record<string, string>
  /** In-flight reservations awaiting commit or rollback.
   * Optional for backwards compatibility with fixtures written before durable
   * pending reserves were introduced — missing journals read as empty. */
  pendingReserves?: PendingReserve[] | undefined
}

// ── Interface ──────────────────────────────────────────────────────────────────

/**
 * Computes the next accumulator from the current one. Return `null` or
 * `undefined` to leave the stored state unchanged; throw to abort.
 */
export type SpendUpdater = (
  current: DailySpend | null,
) => DailySpend | null | undefined | Promise<DailySpend | null | undefined>

/**
 * Durable backing store for the client's local daily spend cap.
 *
 * The spend cap is a financial safety control: if its accumulator lives only in
 * heap memory, any crash, OOM kill, or container restart silently resets it to
 * zero and the cap can be bypassed. Inject a persistent implementation
 * (Redis, SQL, Supabase, a file, …) so the counter survives restarts.
 */
export interface SpendStore {
  /** Return the persisted accumulator, or null if none has been written yet. */
  read(): Promise<DailySpend | null>
  /** Persist the accumulator. */
  write(state: DailySpend): Promise<void>
  /**
   * Optionally, run a read-modify-write atomically with respect to every
   * other process sharing this store (e.g. under a lock or transaction).
   * When present, the client uses it for all spend-cap updates so concurrent
   * agents cannot read the same total and overwrite each other's spend.
   * Optional so stores written against the original `read`/`write` contract
   * keep compiling; those remain serialized only within one client instance.
   */
  mutate?(updateFn: SpendUpdater): Promise<void>
}

// ── In-memory implementation (default) ──────────────────────────────────────────

export interface InMemorySpendStoreOptions {
  /** Log a startup warning about non-durability. Defaults to true. */
  warn?: boolean
  /** Log sink for the non-durability warning. Defaults to a console-backed logger. */
  logger?: KikisAppLogger
}

/**
 * Default, non-durable {@link SpendStore}. Holds the accumulator on the heap, so
 * it resets on every process restart. Logs a startup warning unless silenced.
 * Use this only for development; inject a persistent store in production.
 */
export class InMemorySpendStore implements SpendStore {
  private state: DailySpend | null = null

  constructor(options: InMemorySpendStoreOptions = {}) {
    if (options.warn !== false) {
      resolveLogger(options.logger)(
        'warn',
        '[KikisApp] Using in-memory SpendStore: the daily spend cap is NOT durable ' +
          'and resets on every process restart. Inject a persistent SpendStore via ' +
          'KikisAppClientConfig.spendStore for production safety.',
      )
    }
  }

  async read(): Promise<DailySpend | null> {
    return this.state ? cloneDailySpend(this.state) : null
  }

  async write(state: DailySpend): Promise<void> {
    this.state = cloneDailySpend(state)
  }

  async mutate(updateFn: SpendUpdater): Promise<void> {
    const next = await updateFn(await this.read())
    if (next) await this.write(next)
  }
}

/**
 * Deep-copy a {@link DailySpend} snapshot so callers cannot mutate the stored
 * journal (or the store's copy of a caller's input) through shared references.
 * Missing pendingReserves is preserved as-is for backwards compatibility.
 */
function cloneDailySpend(state: DailySpend): DailySpend {
  return {
    ...state,
    endpoints: { ...state.endpoints },
    pendingReserves: state.pendingReserves?.map((reserve) => ({ ...reserve })),
  }
}

export * from './FileSpendStore.js'
