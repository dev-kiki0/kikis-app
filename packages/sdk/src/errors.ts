/** Stable error codes for programmatic handling. */
export type KikisAppErrorCode =
  | 'MANIFEST'
  | 'MANIFEST_TIMEOUT'
  | 'MANIFEST_SUNSET'
  | 'NO_SUPPORTED_MODE'
  | 'FACILITATOR'
  | 'NETWORK'
  | 'SIGNATURE'
  | 'VOUCHER_MONOTONICITY'
  | 'POLICY_REJECT'
  | 'CHANNEL_STATE'
  | 'DISPUTE'
  | 'REFUND_WINDOW'
  | 'CLIENT_VERSION_TOO_OLD'
  | 'TRUSTLINE'
  | 'VAULT_CONFIG'
  | 'SECURITY'
  | 'FEE'
  | 'VAULT_CONFIG'

export interface KikisAppErrorOptions {
  cause?: unknown
  /** Milliseconds to wait before retry (e.g. from Retry-After header). */
  retryAfterMs?: number | undefined
}

/** Base error for all KikisApp SDK failures. */
export class KikisAppError extends Error {
  readonly code: KikisAppErrorCode
  readonly retryable: boolean
  readonly retryAfterMs?: number | undefined

  constructor(
    message: string,
    code: KikisAppErrorCode,
    retryable: boolean,
    options: KikisAppErrorOptions = {},
  ) {
    super(message, { cause: options.cause })
    this.name = 'KikisAppError'
    this.code = code
    this.retryable = retryable
    if (options.retryAfterMs !== undefined) {
      this.retryAfterMs = options.retryAfterMs
    }
  }
}

/** Manifest fetch failed, schema invalid, or required fields missing. */
export class KikisAppManifestError extends KikisAppError {
  constructor(message: string, options: KikisAppErrorOptions = {}) {
    super(message, 'MANIFEST', false, options)
    this.name = 'KikisAppManifestError'
  }
}

/** Manifest fetch exceeded the configured timeout without receiving a response. */
export class KikisAppManifestTimeoutError extends KikisAppError {
  constructor(message: string, options: KikisAppErrorOptions = {}) {
    super(message, 'MANIFEST_TIMEOUT', true, options)
    this.name = 'KikisAppManifestTimeoutError'
  }
}

/** The provider's signed manifest has reached its declared sunset timestamp. */
export class KikisAppManifestSunsetError extends KikisAppError {
  constructor(message: string, options: KikisAppErrorOptions = {}) {
    super(message, 'MANIFEST_SUNSET', false, options)
    this.name = 'KikisAppManifestSunsetError'
  }
}

/** No payment mode in the manifest is supported by this client. */
export class KikisAppNoSupportedModeError extends KikisAppError {
  constructor(message: string, options: KikisAppErrorOptions = {}) {
    super(message, 'NO_SUPPORTED_MODE', false, options)
    this.name = 'KikisAppNoSupportedModeError'
  }
}

/** This client's SDK version is below the manifest's min_client_version. Upgrade the SDK to proceed. */
export class KikisAppClientVersionError extends KikisAppError {
  constructor(message: string, options: KikisAppErrorOptions = {}) {
    super(message, 'CLIENT_VERSION_TOO_OLD', false, options)
    this.name = 'KikisAppClientVersionError'
  }
}

/**
 * Account is missing a trustline for the payment asset.
 * Thrown preflight — before any payment transaction is submitted —
 * so the caller can establish the trustline first.
 */
export class KikisAppTrustlineError extends KikisAppError {
  readonly asset: string
  readonly issuer: string
  readonly remediation: string

  constructor(
    asset: string,
    issuer: string,
    remediation: string,
    options: KikisAppErrorOptions = {},
  ) {
    super(
      `Missing trustline for ${asset} (issuer: ${issuer}). ${remediation}`,
      'TRUSTLINE',
      false,
      options,
    )
    this.name = 'KikisAppTrustlineError'
    this.asset = asset
    this.issuer = issuer
    this.remediation = remediation
  }
}

/** Vault configuration parameter is invalid (e.g. mock prover on mainnet, unknown prover, unsupported payment mode). */
export class KikisAppVaultConfigError extends KikisAppError {
  constructor(message: string, options: KikisAppErrorOptions = {}) {
    super(message, 'VAULT_CONFIG', false, options)
    this.name = 'KikisAppVaultConfigError'
  }

  static override [Symbol.hasInstance](instance: unknown): boolean {
    return (
      (instance instanceof KikisAppError && instance.code === 'VAULT_CONFIG') ||
      (typeof instance === 'object' &&
        instance !== null &&
        'name' in instance &&
        ((instance as { name?: string }).name === 'KikisAppVaultConfigError' ||
          (instance as { name?: string }).name === 'NulthConfigError' ||
          (instance as { code?: string }).code === 'VAULT_CONFIG'))
    )
  }
}

/** Vault code could not be verified against its configured Wasm hash. */
export class KikisAppSecurityError extends KikisAppError {
  constructor(message: string, options: KikisAppErrorOptions = {}) {
    super(message, 'SECURITY', false, options)
    this.name = 'KikisAppSecurityError'
  }
}

/** Alias for {@link KikisAppVaultConfigError} */
export const NulthConfigError = KikisAppVaultConfigError
export type NulthConfigError = KikisAppVaultConfigError

/** x402 facilitator or provider returned a retryable HTTP failure (5xx, 429). */
export class KikisAppFacilitatorError extends KikisAppError {
  readonly status: number

  constructor(
    message: string,
    status: number,
    options: KikisAppErrorOptions = {},
  ) {
    super(message, 'FACILITATOR', true, options)
    this.name = 'KikisAppFacilitatorError'
    this.status = status
  }
}

/** Transient network failure (timeouts, connection reset, unreachable host). */
export class KikisAppNetworkError extends KikisAppError {
  constructor(message: string, options: KikisAppErrorOptions = {}) {
    super(message, 'NETWORK', true, options)
    this.name = 'KikisAppNetworkError'
  }
}

/** Payment or commitment signature could not be produced or verified. */
export class KikisAppSignatureError extends KikisAppError {
  constructor(message: string, options: KikisAppErrorOptions = {}) {
    super(message, 'SIGNATURE', false, options)
    this.name = 'KikisAppSignatureError'
  }
}

/** Voucher cumulative amount did not increase monotonically. */
export class KikisAppVoucherMonotonicityError extends KikisAppError {
  constructor(message: string, options: KikisAppErrorOptions = {}) {
    super(message, 'VOUCHER_MONOTONICITY', false, options)
    this.name = 'KikisAppVoucherMonotonicityError'
  }
}

/** Local spend cap or on-chain policy rejected the payment. */
export class KikisAppPolicyRejectError extends KikisAppError {
  readonly reason: string

  constructor(reason: string, options: KikisAppErrorOptions = {}) {
    super(`Payment rejected by policy: ${reason}`, 'POLICY_REJECT', false, options)
    this.name = 'KikisAppPolicyRejectError'
    this.reason = reason
  }
}

/** Channel lifecycle failure (open, simulate, close, missing settlement fields). */
export class KikisAppChannelStateError extends KikisAppError {
  constructor(message: string, options: KikisAppErrorOptions = {}) {
    super(message, 'CHANNEL_STATE', false, options)
    this.name = 'KikisAppChannelStateError'
  }
}

/** Channel dispute operation failed (refund request, settlement, or contract invariant). */
export class KikisAppDisputeError extends KikisAppError {
  constructor(message: string, options: KikisAppErrorOptions = {}) {
    super(message, 'DISPUTE', false, options)
    this.name = 'KikisAppDisputeError'
  }
}

/** Refund window has not yet opened or has already expired. */
export class KikisAppRefundWindowError extends KikisAppError {
  constructor(message: string, options: KikisAppErrorOptions = {}) {
    super(message, 'REFUND_WINDOW', false, options)
    this.name = 'KikisAppRefundWindowError'
  }
}

/** Network fee exceeds max configured fee or base fee surge rejected. */
export class KikisAppFeeError extends KikisAppError {
  readonly fee?: number | string | undefined
  readonly maxFee?: number | string | undefined

  constructor(
    message: string,
    options: KikisAppErrorOptions & { fee?: number | string | undefined; maxFee?: number | string | undefined } = {},
  ) {
    super(message, 'FEE', false, options)
    this.name = 'KikisAppFeeError'
    if (options.fee !== undefined) {
      this.fee = options.fee
    }
    if (options.maxFee !== undefined) {
      this.maxFee = options.maxFee
    }
  }
}

/** @deprecated Use {@link KikisAppPolicyRejectError} */
export const KikisAppPolicyRejectedError = KikisAppPolicyRejectError

/** @deprecated Use {@link KikisAppVoucherMonotonicityError} or {@link KikisAppChannelStateError} */
export const KikisAppSessionError = KikisAppVoucherMonotonicityError

/** Parse Retry-After from a Response (seconds or HTTP-date). */
export function parseRetryAfterMs(response: Response): number | undefined {
  const header = response.headers.get('Retry-After')
  if (!header) return undefined

  const seconds = Number(header)
  if (!Number.isNaN(seconds) && seconds >= 0) {
    return seconds * 1000
  }

  const date = Date.parse(header)
  if (!Number.isNaN(date)) {
    return Math.max(0, date - Date.now())
  }

  return undefined
}

/** Map an HTTP status to a typed, retryable-aware KikisApp error. */
export function httpStatusToError(
  message: string,
  status: number,
  response?: Response,
): KikisAppError {
  const retryAfterMs = response ? parseRetryAfterMs(response) : undefined
  const opts = retryAfterMs !== undefined ? { retryAfterMs } : {}

  if (status === 429 || status === 503 || (status >= 500 && status < 600)) {
    return new KikisAppFacilitatorError(message, status, opts)
  }

  if (status >= 400) {
    return new KikisAppManifestError(message, opts)
  }

  return new KikisAppNetworkError(message, opts)
}

/** Wrap a low-level fetch failure; preserves existing KikisAppErrors. */
export function wrapFetchError(err: unknown, context: string): KikisAppError {
  if (err instanceof KikisAppError) return err
  return new KikisAppNetworkError(`${context}: ${String(err)}`, { cause: err })
}

/**
 * Wrap an mppx failure; differentiates network transport/abort errors, RPC simulation
 * failures, policy rejections, and cryptographic signing/credential errors.
 */
export function wrapMppError(err: unknown, context: string): KikisAppError {
  if (err instanceof KikisAppError) return err

  const cause = (err as Record<string, unknown>)?.['cause']
  const errName =
    (err instanceof Error ? err.name : '') ||
    (typeof err === 'object' && err !== null && 'name' in err ? String((err as any).name) : '')
  const causeName =
    (cause instanceof Error ? cause.name : '') ||
    (typeof cause === 'object' && cause !== null && 'name' in cause ? String((cause as any).name) : '')
  const errCode = (err as Record<string, unknown>)?.['code']
  const causeCode = (cause as Record<string, unknown>)?.['code']

  const fullMessage = [
    err instanceof Error ? err.message : String(err),
    cause instanceof Error ? cause.message : typeof cause === 'string' ? cause : '',
  ]
    .filter(Boolean)
    .join(' ')

  const isNetworkOrAbort =
    err instanceof TypeError ||
    cause instanceof TypeError ||
    errName === 'AbortError' ||
    causeName === 'AbortError' ||
    errName === 'TimeoutError' ||
    causeName === 'TimeoutError' ||
    errName === 'ConnectTimeoutError' ||
    causeName === 'ConnectTimeoutError' ||
    errName === 'SocketError' ||
    causeName === 'SocketError' ||
    errCode === 'ECONNRESET' ||
    causeCode === 'ECONNRESET' ||
    errCode === 'ETIMEDOUT' ||
    causeCode === 'ETIMEDOUT' ||
    /abort|timeout|timed out|fetch failed|socket hang up|econnreset|etimedout/i.test(fullMessage)

  if (isNetworkOrAbort) {
    return new KikisAppNetworkError(`${context}: ${String(err)}`, { cause: err })
  }

  const isPolicyReject =
    /insufficient[ _]?balance|underfunded|policy[ _]?reject|spend[ _]?cap/i.test(fullMessage)

  if (isPolicyReject) {
    return new KikisAppPolicyRejectError(
      err instanceof Error ? err.message : String(err),
      { cause: err },
    )
  }

  const isSimulationOrSequence =
    /simulation|simulate|sequence[ _]?mismatch|tx_bad_seq|bad[ _]?seq|ledger[ _]?sequence/i.test(fullMessage)

  if (isSimulationOrSequence) {
    return new KikisAppChannelStateError(`${context}: ${String(err)}`, { cause: err })
  }

  return new KikisAppSignatureError(`${context}: ${String(err)}`, { cause: err })
}
