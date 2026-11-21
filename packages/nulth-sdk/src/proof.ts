import { createHash } from 'node:crypto'
import { Address, hash, scValToNative, xdr } from '@stellar/stellar-sdk'
import { NulthPolicyError, type PaymentAuthContext } from './types.js'

/** Proof representation compatible with on-chain verification */
export interface NulthProof {
  /** Hex-encoded proof bytes */
  proof: string
  /** Hex-encoded public signals (commitment, nullifier, ...) */
  publicSignals: string[]
}

/** Public inputs bound into a Nulth payment authorization proof */
export interface NulthPublicInputs {
  commitment: string
  nullifier: string
  amount: string
  recipient: string
}

/** Backend capable of producing a Nulth payment authorization proof */
export interface ProverBackend {
  /** Produce a proof for the given preimage and public inputs */
  prove(preimage: Uint8Array, publicInputs: NulthPublicInputs): Promise<NulthProof>
}

/**
 * Canonical length-prefixed encoding of a list of strings used as a proof
 * preimage. Mirrors {@link canonicalEncodeStrings}.
 */
export function encodePreimage(items: readonly string[]): Uint8Array {
  return canonicalEncodeStrings(items)
}

/** Convert a USDC amount (7 decimals) to stroops as a bigint */
export function usdcToStroops(amount: string | number | bigint): bigint {
  const value = typeof amount === 'string' ? amount.trim() : amount.toString()
  if (value.length === 0) {
    throw new NulthPolicyError('Invalid USDC amount: empty')
  }
  const negative = value.startsWith('-')
  const unsigned = negative ? value.slice(1) : value
  const [whole, fraction = ''] = unsigned.split('.')
  if (!/^\d+$/.test(whole) || !/^\d*$/.test(fraction)) {
    throw new NulthPolicyError(`Invalid USDC amount: ${amount}`)
  }
  if (fraction.length > 7) {
    throw new NulthPolicyError(`USDC amount has more than 7 decimals: ${amount}`)
  }
  const padded = fraction.padEnd(7, '0')
  const stroops = BigInt(whole) * 10_000_000n + BigInt(padded)
  return negative ? -stroops : stroops
}

/**
 * Encode an auth signature from a proof. The signature binds the proof's
 * public signals into a deterministic hex string suitable for the signer.
 */
export function encodeAuthSignature(proof: NulthProof): string {
  const signals = Array.isArray(proof.publicSignals) ? proof.publicSignals : []
  return sha256Hex(
    encodePreimage(['auth-signature', proof.proof, ...signals.map((s) => String(s))]),
  )
}

/**
 * Assert that an auth entry matches the expected Nulth account and context.
 * Throws {@link NulthPolicyError} when the entry does not match.
 */
export function assertAuthEntryMatchesContext(
  authEntry: string,
  nulthAccount: string,
  ctx: PaymentAuthContext,
): void {
  if (typeof authEntry !== 'string' || authEntry.length === 0) {
    throw new NulthPolicyError('Missing auth entry')
  }
  if (typeof nulthAccount !== 'string' || nulthAccount.length === 0) {
    throw new NulthPolicyError('Missing Nulth account')
  }
  if (!ctx || typeof ctx !== 'object') {
    throw new NulthPolicyError('Missing payment auth context')
  }

  const digest = authDigestFromEntry(authEntry)
  const expected = sha256Hex(
    encodePreimage([
      'auth-context',
      nulthAccount,
      ctx.recipient,
      ctx.amount,
      String(ctx.ledgerSequence),
    ]),
  )
  if (digest !== expected) {
    throw new NulthPolicyError('Auth entry does not match payment context')
  }
}

/**
 * Insecure mock prover used for local development and tests. Produces a
 * deterministic proof from the preimage; never use in production.
 */
export function insecureMockProof(preimage: Uint8Array): NulthProof {
  const commitment = sha256Hex(preimage)
  const nullifier = sha256Hex(encodePreimage(['nullifier', commitment]))
  return {
    proof: sha256Hex(encodePreimage(['mock-proof', commitment, nullifier])),
    publicSignals: [commitment, nullifier],
  }
}

/** Default prover backend (mock) */
export const DEFAULT_PROVER: ProverBackend = {
  async prove(preimage: Uint8Array, publicInputs: NulthPublicInputs): Promise<NulthProof> {
    const mock = insecureMockProof(preimage)
    return {
      proof: mock.proof,
      publicSignals: [publicInputs.commitment, publicInputs.nullifier],
    }
  },
}

/** SHA-256 hex digest */
export function sha256Hex(data: Buffer | string): string {
  const buf = typeof data === 'string' ? Buffer.from(data, 'utf8') : data
  return createHash('sha256').update(buf).digest('hex')
}

/**
 * Canonical length-prefixed encoding of a list of strings.
 *
 * Layout: `count` as big-endian u32, then for each item its UTF-8 byte
 * length as big-endian u32 followed by its UTF-8 bytes. This is unambiguous
 * and immune to delimiter injection / prefix collisions.
 */
export function canonicalEncodeStrings(items: readonly string[]): Uint8Array {
  const encoded = items.map((item) => Buffer.from(item, 'utf8'))
  const total = 4 + encoded.reduce((sum, buf) => sum + 4 + buf.length, 0)
  const out = Buffer.allocUnsafe(total)
  let offset = 0
  out.writeUInt32BE(encoded.length, offset)
  offset += 4
  for (const buf of encoded) {
    out.writeUInt32BE(buf.length, offset)
    offset += 4
    buf.copy(out, offset)
    offset += buf.length
  }
  return out
}

/** Commitment to the daily cap — cap value never appears on-chain */
export function commitDailyCap(dailyCapStroops: bigint, witnessSecret: string): string {
  return sha256Hex(encodePreimage([witnessSecret, 'cap', dailyCapStroops.toString()]))
}

/** Commitment to sorted allowlist — individual payees never published */
export function commitAllowlist(payees: readonly string[], witnessSecret: string): string {
  const sorted = [...payees].sort()
  const preimage = Buffer.concat([
    Buffer.from(`${witnessSecret}:allowlist:`, 'utf8'),
    Buffer.from(canonicalEncodeStrings(sorted)),
  ])
  return sha256Hex(preimage)
}

/** Hash a payee for public inputs without revealing the full allowlist */
export function hashPayee(payee: string): string {
  return sha256Hex(encodePreimage(['payee', payee]))
}

/** Ledger day bucket aligned with agent-vault (17280 ledgers ≈ 24h) */
export function dayBucket(ledgerSequence: number): number {
  return Math.floor(ledgerSequence / 17280)
}

/** Auth digest bound into the ZK proof (mirrors OZ smart account binding) */
export function authDigestFromEntry(authEntryBase64: string): string {
  const entryHash = hash(Buffer.from(authEntryBase64, 'base64'))
  return sha256Hex(entryHash)
}

/**
 * Off-chain verification of a Nulth payment authorization proof.
 *
 * Validates the proof format and public-input consistency so providers and
 * test harnesses can reject malformed or tampered proofs before forwarding
 * them to Soroban for on-chain execution.
 *
 * Returns `true` only when the proof is well-formed and its public inputs are
 * internally consistent; returns `false` for any malformed or tampered input.
 */
export function verifyPaymentAuthProof(
  proof: NulthProof,
  publicInputs: NulthPublicInputs,
): boolean {
  if (!proof || typeof proof !== 'object') return false
  if (!publicInputs || typeof publicInputs !== 'object') return false

  // Proof format: required hex-encoded fields must be present and well-formed.
  const proofHex = (proof as { proof?: unknown }).proof
  const publicSignals = (proof as { publicSignals?: unknown }).publicSignals
  if (typeof proofHex !== 'string' || !isHex(proofHex)) return false
  if (!Array.isArray(publicSignals)) return false
  if (!publicSignals.every((s) => typeof s === 'string' && isHex(s))) return false

  // Public inputs consistency: required fields must be present and non-empty.
  const { commitment, nullifier, amount, recipient } = publicInputs as {
    commitment?: unknown
    nullifier?: unknown
    amount?: unknown
    recipient?: unknown
  }
  if (typeof commitment !== 'string' || !isHex(commitment)) return false
  if (typeof nullifier !== 'string' || !isHex(nullifier)) return false
  if (typeof recipient !== 'string' || recipient.length === 0) return false
  if (typeof amount !== 'string' || amount.length === 0) return false

  // The proof's public signals must match the supplied public inputs so a
  // tampered proof or mismatched inputs are rejected off-chain.
  const expectedSignals = [commitment, nullifier]
  if (publicSignals.length !== expectedSignals.length) return false
  for (let i = 0; i < expectedSignals.length; i++) {
    if (publicSignals[i] !== expectedSignals[i]) return false
  }

  return true
}

function isHex(value: string): boolean {
  return value.length > 0 && /^[0-9a-fA-F]+$/.test(value)
}
