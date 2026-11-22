/**
 * USDC conversion — canonical implementation lives in @kikis-app/nulth-sdk and is
 * re-exported here so SDK consumers (client, provider) share one converter.
 *
 * @kikis-app/kikis-app already depends on @kikis-app/nulth-sdk, so re-exporting
 * (rather than defining a parallel helper) keeps a single source of truth.
 */
import { usdcToStroops, stroopsToUsdc, USDC_DECIMALS } from '@kikis-app/nulth-sdk'
export { usdcToStroops, stroopsToUsdc, USDC_DECIMALS }

/** Canonical Circle USDC issuers keyed by Stellar network. */
export const USDC_ISSUERS = {
  testnet: 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5',
  mainnet: 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN',
} as const

/** Canonical EURC issuers keyed by Stellar network. */
export const EURC_ISSUERS = {
  testnet: 'GB3Q6QDZYTHWT7E5PVS3W7FUT5GVAFC5KSZFFLPU25GO7VTC3NM2ZTVO',
  mainnet: 'GDHU6WRG4IEQXM5NZ4BMPKOXHW76MZM4Y2IEMFDVXBSDP6SJY4ITNPP2',
} as const

/**
 * Well-known Stellar asset issuers keyed by asset code then network.
 * Used by the trustline preflight to resolve the expected issuer for any
 * supported credit asset. Only assets listed here can be validated;
 * unknown assets cannot be issuer-checked and are rejected.
 */
export const ASSET_ISSUERS: Record<string, Record<string, string>> = {
  USDC: USDC_ISSUERS,
  EURC: EURC_ISSUERS,
} as const

/**
 * Resolve the expected on-chain issuer for a given asset code and network.
 * Returns the issuer address string, or an empty string if the asset is
 * not registered in ASSET_ISSUERS.
 */
export function getAssetIssuer(asset: string, network: string): string {
  return ASSET_ISSUERS[asset]?.[network] ?? ''
}

/**
 * Assert `decimals` is a usable asset scale: a non-negative integer.
 *
 * The converters never reach an invalid scale through amount parsing — it
 * only surfaces later as a BigInt conversion or a negative-exponent error, or
 * worse, as a misleading "excess amount precision" message: a negative scale
 * makes `frac.length > decimals` true for any amount, so a valid amount is
 * rejected for the wrong reason. Validate the scale up front so a bad asset
 * config is reported as an invalid scale, distinct from a bad amount input.
 */
function assertValidScale(decimals: number): void {
  if (!Number.isInteger(decimals) || decimals < 0) {
    throw new RangeError(
      `Invalid asset scale: decimals must be a non-negative integer, got ${decimals}`,
    )
  }
}

/**
 * Convert a decimal amount string to integer units using asset-specific decimals.
 * Throws RangeError on an invalid scale (negative, non-integer, NaN, or
 * Infinity), on malformed amount input, on negatives, or on over-precision.
 */
export function amountToStroops(amount: string, decimals: number): bigint {
  assertValidScale(decimals)
  const match = /^(\d+)(?:\.(\d+))?$/.exec(amount.trim())
  if (!match) {
    throw new RangeError(`Invalid amount: "${amount}"`)
  }
  const whole = match[1]!
  const frac = match[2] ?? ''
  if (frac.length > decimals) {
    throw new RangeError(
      `Amount "${amount}" exceeds ${decimals} decimals of precision`,
    )
  }
  const scale = 10n ** BigInt(decimals)
  const fracUnits = BigInt(frac.padEnd(decimals, '0'))
  const units = BigInt(whole) * scale + fracUnits
  if (units > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new RangeError(`Amount "${amount}" is too large to represent exactly`)
  }
  return units
}

/**
 * Inverse of {@link amountToStroops}: format integer units as a canonical
 * decimal string with the given number of decimals. Throws RangeError on an
 * invalid scale (negative, non-integer, NaN, or Infinity) or on negative units.
 */
export function stroopsToAmount(units: bigint, decimals: number): string {
  assertValidScale(decimals)
  if (units < 0n) {
    throw new RangeError(`Invalid units: "${units.toString()}" is negative`)
  }
  const scale = 10n ** BigInt(decimals)
  const whole = units / scale
  const frac = units % scale
  if (frac === 0n) return whole.toString()
  const fracStr = frac.toString().padStart(decimals, '0').replace(/0+$/, '')
  return `${whole.toString()}.${fracStr}`
}

/**
 * Convert a USDC decimal amount string to integer stroops, enforcing that the
 * result is strictly positive. Rejects zero, negative, and non-numeric inputs
 * so spend reservations cannot deflate accumulators or corrupt accounting.
 *
 * Throws RangeError for malformed/negative input and for non-positive amounts.
 */
export function usdcToPositiveStroops(amount: string): bigint {
  const micros = usdcToStroops(amount)
  if (micros <= 0n) {
    throw new RangeError(`Amount "${amount}" must be greater than zero`)
  }
  return micros
}

/**
 * @deprecated Use {@link usdcToStroops} — the same validated bigint converter.
 * Kept as a thin alias so existing call sites keep working during migration.
 */
export const usdcToUnits = usdcToStroops
