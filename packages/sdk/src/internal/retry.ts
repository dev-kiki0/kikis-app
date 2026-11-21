/**
 * Retry utilities with exponential backoff and a lightweight circuit breaker.
 */

export interface RetryPolicy {
  /** Maximum number of attempts (including the first). Defaults to 3. */
  maxAttempts?: number;
  /** Base delay in milliseconds. Defaults to 250. */
  baseDelayMs?: number;
  /** Maximum delay in milliseconds. Defaults to 5000. */
  maxDelayMs?: number;
  /** Optional predicate to decide whether an error is retryable. */
  shouldRetry?: (error: unknown) => boolean;
  /** Alias for `shouldRetry` used by some callers. */
  retryable?: (error: unknown) => boolean;
  /** Optional hook invoked before each retry with the attempt number and delay. */
  onRetry?: (attempt: number, delayMs: number, error: unknown) => void;
  /** Optional abort signal to cancel pending retries. */
  signal?: AbortSignal;
}

/** Backwards-compatible alias for the retry policy shape. */
export type RetryOptions = RetryPolicy;

export const DEFAULT_RETRY_POLICY: Required<
  Pick<RetryPolicy, 'maxAttempts' | 'baseDelayMs' | 'maxDelayMs'>
> = {
  maxAttempts: 3,
  baseDelayMs: 250,
  maxDelayMs: 5000,
};

const DEFAULT_MAX_ATTEMPTS = DEFAULT_RETRY_POLICY.maxAttempts;
const DEFAULT_BASE_DELAY_MS = DEFAULT_RETRY_POLICY.baseDelayMs;
const DEFAULT_MAX_DELAY_MS = DEFAULT_RETRY_POLICY.maxDelayMs;

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason ?? new Error('Aborted'));
      return;
    }
    const timer = setTimeout(() => {
      if (signal) {
        signal.removeEventListener('abort', onAbort);
      }
      resolve();
    }, ms);
    const onAbort = (): void => {
      clearTimeout(timer);
      reject(signal?.reason ?? new Error('Aborted'));
    };
    if (signal) {
      signal.addEventListener('abort', onAbort, { once: true });
    }
  });
}

/**
 * Compute the backoff delay for a given attempt using exponential backoff
 * with full jitter: `Math.random() * min(baseDelayMs * 2^attempt, maxDelayMs)`.
 */
export function backoffDelayMs(
  attempt: number,
  baseDelayMs: number = DEFAULT_BASE_DELAY_MS,
  maxDelayMs: number = DEFAULT_MAX_DELAY_MS,
): number {
  const exponential = baseDelayMs * 2 ** attempt;
  return Math.random() * Math.min(exponential, maxDelayMs);
}

/**
 * Execute `fn` with exponential backoff retries.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options: RetryPolicy = {},
): Promise<T> {
  const maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  const baseDelayMs = options.baseDelayMs ?? DEFAULT_BASE_DELAY_MS;
  const maxDelayMs = options.maxDelayMs ?? DEFAULT_MAX_DELAY_MS;
  const shouldRetry = options.shouldRetry ?? options.retryable ?? (() => true);
  const signal = options.signal;

  let lastError: unknown;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    if (signal?.aborted) {
      throw signal.reason ?? new Error('Aborted');
    }
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      const isLast = attempt === maxAttempts - 1;
      if (isLast || !shouldRetry(error)) {
        throw error;
      }
      const delay = backoffDelayMs(attempt, baseDelayMs, maxDelayMs);
      options.onRetry?.(attempt + 1, delay, error);
      await sleep(delay, signal);
    }
  }
  throw lastError;
}

export type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

export interface CircuitBreakerOptions {
  /** Consecutive failures required to trip the circuit. Defaults to 5. */
  failureThreshold?: number;
  /** Cooldown in milliseconds before a half-open probe. Defaults to 30000. */
  cooldownMs?: number;
  /** Time window in milliseconds for counting consecutive failures. Defaults to 60000. */
  windowMs?: number;
  /** Injectable clock for testing. Defaults to Date.now. */
  now?: () => number;
}

/**
 * Lightweight circuit breaker tracking consecutive failures per instance.
 *
 * States:
 * - CLOSED: requests flow normally; failures are counted.
 * - OPEN: requests fast-fail until the cooldown elapses.
 * - HALF_OPEN: a single probe request is allowed; success closes the circuit,
 *   failure re-opens it.
 */
export class CircuitBreaker {
  private state: CircuitState = 'CLOSED';
  private consecutiveFailures = 0;
  private firstFailureAt = 0;
  private openedAt = 0;
  private probeInFlight = false;

  private readonly failureThreshold: number;
  private readonly cooldownMs: number;
  private readonly windowMs: number;
  private readonly now: () => number;

  constructor(options: CircuitBreakerOptions = {}) {
    this.failureThreshold = options.failureThreshold ?? 5;
    this.cooldownMs = options.cooldownMs ?? 30000;
    this.windowMs = options.windowMs ?? 60000;
    this.now = options.now ?? Date.now;
  }

  getState(): CircuitState {
    this.maybeTransitionToHalfOpen();
    return this.state;
  }

  /**
   * Returns true when a request may proceed. In HALF_OPEN only a single probe
   * is permitted at a time.
   */
  canRequest(): boolean {
    this.maybeTransitionToHalfOpen();
    if (this.state === 'OPEN') {
      return false;
    }
    if (this.state === 'HALF_OPEN') {
      if (this.probeInFlight) {
        return false;
      }
      this.probeInFlight = true;
      return true;
    }
    return true;
  }

  recordSuccess(): void {
    this.state = 'CLOSED';
    this.consecutiveFailures = 0;
    this.firstFailureAt = 0;
    this.openedAt = 0;
    this.probeInFlight = false;
  }

  recordFailure(): void {
    const now = this.now();

    if (this.state === 'HALF_OPEN') {
      this.trip(now);
      return;
    }

    if (this.state === 'OPEN') {
      return;
    }

    if (this.consecutiveFailures === 0) {
      this.firstFailureAt = now;
    } else if (now - this.firstFailureAt > this.windowMs) {
      // Window elapsed; restart the count.
      this.firstFailureAt = now;
      this.consecutiveFailures = 0;
    }

    this.consecutiveFailures += 1;
    if (this.consecutiveFailures >= this.failureThreshold) {
      this.trip(now);
    }
  }

  private trip(now: number): void {
    this.state = 'OPEN';
    this.openedAt = now;
    this.probeInFlight = false;
  }

  private maybeTransitionToHalfOpen(): void {
    if (this.state === 'OPEN' && this.now() - this.openedAt >= this.cooldownMs) {
      this.state = 'HALF_OPEN';
      this.probeInFlight = false;
    }
  }
}
