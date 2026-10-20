import fs from 'node:fs/promises'
import path from 'node:path'
import type { DailySpend, SpendStore, SpendUpdater } from './SpendStore.js'

export interface FileSpendStoreOptions {
  /**
   * A lock file whose mtime is older than this is treated as abandoned by a
   * crashed process and reclaimed. Must comfortably exceed the time a single
   * read-modify-write takes. Defaults to 10,000 ms.
   */
  staleLockMs?: number
  /**
   * Give up acquiring the lock after this long and throw, so a wedged peer
   * cannot hang a payment forever. Defaults to 15,000 ms.
   */
  lockTimeoutMs?: number
  /** Initial retry delay while the lock is held elsewhere. Defaults to 5 ms. */
  retryBaseDelayMs?: number
  /** Ceiling for the exponential retry delay. Defaults to 200 ms. */
  retryMaxDelayMs?: number
}

const DEFAULT_STALE_LOCK_MS = 10_000
const DEFAULT_LOCK_TIMEOUT_MS = 15_000
const DEFAULT_RETRY_BASE_DELAY_MS = 5
const DEFAULT_RETRY_MAX_DELAY_MS = 200

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

/**
 * File-backed durable {@link SpendStore}.
 *
 * Persists the daily spend accumulator to a JSON file on disk, preserving
 * cumulative spending totals across process restarts, crashes, and redeploys.
 *
 * ### Error semantics
 * - File absent (ENOENT): returns null — legitimately no spend recorded yet.
 * - File present but unreadable or malformed: throws — a safety control must
 *   fail closed, not assume nothing was spent.
 *
 * ### Write atomicity
 * Writes go to a unique `<filePath>.<pid>.<n>.tmp` first, then `fs.rename`
 * onto the target. `rename` is atomic within a filesystem, so there is no
 * window where the target file is truncated but not yet fully written.
 *
 * ### Cross-process locking
 * Atomic writes alone do not stop two processes that share the file from
 * reading the same total, each adding their own spend, and clobbering one
 * another — bypassing the cap. {@link mutate} holds an advisory lock
 * (`<filePath>.lock`, created with `O_EXCL`) for the whole read-modify-write
 * so concurrent agents, workers and cluster nodes serialize. The lock is
 * always released when the updater finishes or throws, and a lock left behind
 * by a crashed process is reclaimed once it is older than `staleLockMs`.
 */
export class FileSpendStore implements SpendStore {
  readonly filePath: string
  readonly lockPath: string
  private readonly staleLockMs: number
  private readonly lockTimeoutMs: number
  private readonly retryBaseDelayMs: number
  private readonly retryMaxDelayMs: number
  private tmpCounter = 0

  constructor(filePath: string, options: FileSpendStoreOptions = {}) {
    this.filePath = filePath
    this.lockPath = `${filePath}.lock`
    this.staleLockMs = options.staleLockMs ?? DEFAULT_STALE_LOCK_MS
    this.lockTimeoutMs = options.lockTimeoutMs ?? DEFAULT_LOCK_TIMEOUT_MS
    this.retryBaseDelayMs = options.retryBaseDelayMs ?? DEFAULT_RETRY_BASE_DELAY_MS
    this.retryMaxDelayMs = options.retryMaxDelayMs ?? DEFAULT_RETRY_MAX_DELAY_MS
  }

  async read(): Promise<DailySpend | null> {
    let data: string
    try {
      data = await fs.readFile(this.filePath, 'utf-8')
    } catch (err) {
      // ENOENT is expected on first run — no spend recorded yet.
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        return null
      }
      // Any other I/O error (permission denied, EISDIR, etc.) must throw.
      // A cap that cannot read its state should refuse to spend, not assume zero.
      throw new Error(
        `[FileSpendStore] Failed to read spend file at ${this.filePath}: ${(err as Error).message}`,
      )
    }

    try {
      return JSON.parse(data) as DailySpend
    } catch {
      throw new Error(
        `[FileSpendStore] Spend file at ${this.filePath} contains invalid JSON. ` +
          `Delete or repair it before resuming. Raw content: ${data.slice(0, 120)}`,
      )
    }
  }

  async write(state: DailySpend): Promise<void> {
    const dir = path.dirname(this.filePath)
    await fs.mkdir(dir, { recursive: true, mode: 0o700 })

    // A per-process, per-write temp name: concurrent writers sharing one
    // `.tmp` path could rename each other's half-written file into place.
    const tmpPath = `${this.filePath}.${process.pid}.${this.tmpCounter++}.tmp`
    try {
      await fs.writeFile(tmpPath, JSON.stringify(state, null, 2), {
        encoding: 'utf-8',
        mode: 0o600,
      })
      // rename is atomic within a filesystem: the target is either the old
      // content or the new content, never a partial write.
      await fs.rename(tmpPath, this.filePath)
    } catch (err) {
      await fs.rm(tmpPath, { force: true }).catch(() => {})
      throw err
    }
  }

  /**
   * Atomically read, update and persist the accumulator while holding an
   * exclusive cross-process lock. `updateFn` receives the current state and
   * returns the state to persist, or `null`/`undefined` to leave the file
   * untouched. If `updateFn` throws, nothing is written and the error
   * propagates. The lock is released in every case.
   */
  async mutate(updateFn: SpendUpdater): Promise<void> {
    const release = await this.acquireLock()
    try {
      const next = await updateFn(await this.read())
      if (next) await this.write(next)
    } finally {
      await release()
    }
  }

  /** Acquire `<filePath>.lock`; resolves to a function that releases it. */
  private async acquireLock(): Promise<() => Promise<void>> {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true })
    const token = `${process.pid}:${Date.now()}:${Math.random().toString(36).slice(2)}`
    const deadline = Date.now() + this.lockTimeoutMs
    let attempt = 0

    for (;;) {
      try {
        const handle = await fs.open(this.lockPath, 'wx')
        try {
          await handle.writeFile(token, 'utf-8')
        } finally {
          await handle.close()
        }
        return () => this.releaseLock(token)
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err
      }

      if (await this.reclaimIfStale()) continue

      if (Date.now() >= deadline) {
        throw new Error(
          `[FileSpendStore] Timed out after ${this.lockTimeoutMs}ms waiting for lock ${this.lockPath}`,
        )
      }
      const cap = Math.min(this.retryMaxDelayMs, this.retryBaseDelayMs * 2 ** attempt++)
      await sleep(Math.floor(Math.random() * cap) + 1)
    }
  }

  /**
   * Remove the lock if it was abandoned by a crashed holder. Returns true when
   * the caller should retry acquisition immediately.
   */
  private async reclaimIfStale(): Promise<boolean> {
    let mtimeMs: number
    try {
      mtimeMs = (await fs.stat(this.lockPath)).mtimeMs
    } catch (err) {
      // Released between our open() and stat() — retry right away.
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return true
      throw err
    }
    if (Date.now() - mtimeMs <= this.staleLockMs) return false

    // Rename (atomic) rather than unlink so that when two waiters race to
    // reclaim the same stale lock only one wins; the loser sees ENOENT and
    // simply retries acquisition instead of deleting the winner's new lock.
    const graveyard = `${this.lockPath}.${process.pid}.${Math.random().toString(36).slice(2)}.stale`
    try {
      await fs.rename(this.lockPath, graveyard)
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return true
      throw err
    }
    await fs.rm(graveyard, { force: true }).catch(() => {})
    return true
  }

  private async releaseLock(token: string): Promise<void> {
    try {
      // Only delete a lock we still own — if ours was reclaimed as stale,
      // the file now belongs to another holder.
      const current = await fs.readFile(this.lockPath, 'utf-8')
      if (current === token) await fs.rm(this.lockPath, { force: true })
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err
    }
  }
}
