import { Keypair } from '@stellar/stellar-sdk'
import { stellar } from '@stellar/mpp/charge/client'
import { Mppx } from 'mppx/client'
import type { ClientStellarSigner } from '@x402/stellar'
import type { KikisAppManifest, PaymentResult, MppChargeClientOptions } from '../types.js'
import {
  KikisAppManifestError,
  KikisAppPolicyRejectError,
  KikisAppFeeError,
  KikisAppNetworkError,
  httpStatusToError,
  wrapMppError,
} from '../errors.js'
import { stroopsToAmount } from '../internal/usdc.js'
import { selectAsset, resolveAssetContract } from '../internal/assetUtils.js'
import { withRetry, type RetryPolicy } from '../internal/retry.js'
import { prepareHttpRequestInit } from '../internal/http.js'
import { checkChargeChallenge, type Caip2Network } from './challenge.js'
import type { ModeSelectOptions } from './ModeRouter.js'

/**
 * Normalize `ModeSelectOptions.headers` (any HeadersInit form) into a plain
 * record. A custom `Authorization` header never overrides the charge
 * credential: the credential is spread after these, so it wins.
 */
function normalizeHeaders(headers: ModeSelectOptions['headers']): Record<string, string> {
  if (!headers) return {}
  if (headers instanceof Headers) {
    const record: Record<string, string> = {}
    headers.forEach((value, key) => {
      record[key] = value
    })
    return record
  }
  if (Array.isArray(headers)) {
    return Object.fromEntries(headers)
  }
  return { ...headers }
}

/**
 * Estimate network base fee in stroops from Horizon /fee_stats.
 */
export async function estimateBaseFee(
  horizonUrl: string,
  fetchFn: typeof fetch = fetch,
): Promise<number> {
  const url = `${horizonUrl.replace(/\/+$/, '')}/fee_stats`
  const res = await fetchFn(url)
  if (!res.ok) {
    throw new KikisAppNetworkError(`Failed to fetch fee stats from Horizon: HTTP ${res.status}`)
  }
  const stats = (await res.json()) as {
    last_ledger_base_fee?: string | number
    fee_charged?: {
      p90?: string | number
      mode?: string | number
      min?: string | number
      max?: string | number
    }
    max_fee?: {
      mode?: string | number
      p90?: string | number
    }
  }
  const feeCandidate =
    stats.fee_charged?.p90 ??
    stats.fee_charged?.mode ??
    stats.last_ledger_base_fee ??
    100
  return Number(feeCandidate)
}

export class MppChargeClient {
  private readonly retryPolicy?: RetryPolicy | undefined
  private readonly options?: MppChargeClientOptions | undefined

  constructor(
    private readonly keypair: Keypair | ClientStellarSigner,
    private readonly network: 'testnet' | 'mainnet',
    retryPolicyOrOptions?: RetryPolicy | MppChargeClientOptions,
    options?: MppChargeClientOptions,
  ) {
    if (
      retryPolicyOrOptions &&
      ('maxFeeStroops' in retryPolicyOrOptions ||
        'maxBaseFeeStroops' in retryPolicyOrOptions ||
        'dynamicFee' in retryPolicyOrOptions ||
        'horizonUrl' in retryPolicyOrOptions)
    ) {
      this.options = retryPolicyOrOptions as MppChargeClientOptions
      this.retryPolicy = undefined
    } else {
      this.retryPolicy = retryPolicyOrOptions as RetryPolicy | undefined
      this.options = options
    }
  }

  /** Replace signer (e.g. swap to Nulth ZK account payer before pay) */
  withSigner(signer: ClientStellarSigner | Keypair): MppChargeClient {
    return new MppChargeClient(
      signer,
      this.network,
      ...(this.retryPolicy !== undefined ? [this.retryPolicy] : []),
      ...(this.options !== undefined ? [this.options] : []),
    )
  }

  async pay(
    url: string,
    manifest: KikisAppManifest,
    options?: ModeSelectOptions & { endpoint?: string },
    endpoint?: string,
  ): Promise<PaymentResult> {
    const pricing = manifest.pricing['mpp-charge']
    if (!pricing) {
      throw new KikisAppManifestError('manifest.pricing.mpp-charge missing')
    }

    const caip2: Caip2Network =
      this.network === 'mainnet' ? 'stellar:pubnet' : 'stellar:testnet'

    const targetEndpoint =
      endpoint ??
      options?.endpoint ??
      (() => {
        try {
          return new URL(url).pathname
        } catch {
          return url
        }
      })()

    const selectedAsset = selectAsset(manifest, 'mpp-charge', targetEndpoint)
    const assetContract = resolveAssetContract(manifest, 'mpp-charge', targetEndpoint)
    const decimals = selectedAsset.decimals ?? 7

    const maxFeeCap = this.options?.maxFeeStroops ?? this.options?.maxBaseFeeStroops
    let calculatedFee = 100

    if (this.options?.dynamicFee) {
      const horizonUrl =
        this.options?.horizonUrl ??
        (this.network === 'testnet'
          ? 'https://horizon-testnet.stellar.org'
          : 'https://horizon.stellar.org')
      const estimated = await estimateBaseFee(horizonUrl, this.options?.fetchFn)
      if (maxFeeCap !== undefined && estimated > maxFeeCap) {
        throw new KikisAppFeeError(
          `Estimated base fee of ${estimated} stroops exceeds maxFeeStroops (${maxFeeCap})`,
          { fee: estimated, maxFee: maxFeeCap },
        )
      }
      calculatedFee = Math.max(100, estimated)
    } else if (maxFeeCap !== undefined) {
      calculatedFee = maxFeeCap
    }

    let txHash: string | null = null
    let signedAmount: string | undefined
    // The credential is created at most once per pay() call. Every retry after
    // the first reuses it, so the provider's idempotency store can replay the
    // cached settlement instead of charging a second time.
    let credential: string | undefined

    const signer = this.keypair as ClientStellarSigner | { publicKey?: () => string }
    const hasPublicKey = (s: unknown): s is { publicKey: () => string } =>
      typeof s === 'object' &&
      s !== null &&
      'publicKey' in s &&
      typeof (s as { publicKey?: unknown }).publicKey === 'function'
    const hasAddress = (s: unknown): s is { address: string } =>
      typeof s === 'object' &&
      s !== null &&
      'address' in s &&
      typeof (s as { address?: unknown }).address === 'string'
    const effectiveKeypair =
      this.keypair instanceof Keypair
        ? this.keypair
        : {
            publicKey: () => {
              if (hasPublicKey(signer)) return signer.publicKey()
              if (hasAddress(signer)) return signer.address
              throw new Error('MppChargeClient: signer has no address or publicKey')
            },
            ...this.keypair,
          } as unknown as Keypair

    const mppx = Mppx.create({
      polyfill: false,
      methods: [
        (stellar.charge as (opts: Record<string, unknown>) => any)({
          keypair: effectiveKeypair,
          mode: 'pull',
          // Custom Soroban RPC endpoint (#5): route all charge simulation /
          // submission to the configured RPC instead of the public default.
          ...(this.options?.rpcUrl !== undefined && { rpcUrl: this.options.rpcUrl }),
          fee: calculatedFee,
          baseFee: calculatedFee,
          maxFee: maxFeeCap ?? calculatedFee,
          feeEnvelope: {
            baseFee: calculatedFee,
            maxFee: maxFeeCap ?? calculatedFee,
          },
          onProgress(event: any) {
            if (event.type === 'paid') {
              txHash = event.hash
            }
          },
        }),
      ],
      onChallenge: async (challenge, { createCredential }) => {
        // Bind the unsigned challenge to the signed manifest before signing.
        const request = challenge.request
        const rejection = checkChargeChallenge(request, manifest, caip2, pricing.amount, targetEndpoint)
        if (rejection) throw rejection

        const amount = request['amount']
        if (typeof amount !== 'string') {
          throw new KikisAppPolicyRejectError('challenge_amount_invalid')
        }
        signedAmount = stroopsToAmount(BigInt(amount), decimals)
        credential ??= await createCredential()
        return credential
      },
    })

    const reqInit = prepareHttpRequestInit(options?.request)

    return withRetry(async (): Promise<PaymentResult> => {
      let response: Response
      const customHeaders = normalizeHeaders(options?.headers)
      const fetchInit: RequestInit = {
        ...(options?.method ? { method: options.method } : {}),
        ...(options?.body !== undefined ? { body: options.body } : {}),
      }
      try {
        response = credential
          ? await mppx.rawFetch(url, {
              ...reqInit,
              headers: { ...reqInit.headers, Authorization: credential },
            })
          : await mppx.fetch(url, reqInit)
      } catch (err) {
        throw wrapMppError(err, 'MPP charge request')
      }

      if (!response.ok) {
        if (response.status >= 500 || response.status === 429 || response.status === 503) {
          throw httpStatusToError(
            `MPP charge failed: HTTP ${response.status}`,
            response.status,
            response,
          )
        }
        throw new KikisAppManifestError(`MPP charge failed: HTTP ${response.status}`)
      }

      let data: unknown
      const responseType = options?.responseType ?? 'auto'
      const contentType = response.headers.get('content-type') ?? ''
      if (responseType === 'text' || (responseType === 'auto' && contentType.startsWith('text/'))) {
        data = await response.text()
      } else if (
        responseType === 'arrayBuffer' ||
        responseType === 'blob' ||
        (responseType === 'auto' &&
          (contentType.startsWith('image/') ||
            contentType.includes('application/octet-stream') ||
            contentType.includes('application/pdf')))
      ) {
        data = await response.arrayBuffer()
      } else {
        try {
          data = await response.json()
        } catch (cause) {
          throw new KikisAppManifestError(
            `Failed to parse JSON from response (HTTP ${response.status})`,
            { cause },
          )
        }
      }
      return {
        data,
        txHash,
        mode: 'mpp-charge',
        amount: signedAmount ?? pricing.amount,
        timestamp: Date.now(),
      }
    }, this.retryPolicy)
  }
}
