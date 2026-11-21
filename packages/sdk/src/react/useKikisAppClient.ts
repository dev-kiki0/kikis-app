import { useEffect, useMemo } from 'react'
import { Keypair } from '@stellar/stellar-sdk'
import { KikisAppClient, type KikisAppClientConfig } from '../client/KikisAppClient.js'

/**
 * Returns a memoized KikisAppClient. Re-creates when any config field that
 * affects client behavior changes. Memoizes the client instance itself to
 * prevent unnecessary recreations between renders.
 *
 * The client runs in the browser, so the wallet secret is visible to anyone who
 * loads the page. Never source it from a public environment variable or use a
 * funded key.
 *
 * @example
 * const THROWAWAY_TESTNET_SECRET = 'S...'
 * const client = useKikisAppClient({
 *   wallet: THROWAWAY_TESTNET_SECRET,
 *   network: 'testnet',
 *   spendCap: { daily: '1.00', asset: 'USDC' },
 * })
 */
export function useKikisAppClient(config: KikisAppClientConfig): KikisAppClient {
  const walletKey =
    typeof config.wallet === 'string' ? config.wallet : (config.wallet as Keypair).secret()

  // Build a comprehensive memo key from all config fields that affect client behavior.
  // The spend cap's endpointCaps is included in the key since changes to per-origin
  // caps must trigger a client recreate.
  const spendCapKey = config.spendCap
    ? `${config.spendCap.daily}|${config.spendCap.asset}|${config.spendCap.decimals ?? 7}|${JSON.stringify(config.spendCap.endpointCaps || {})}`
    : ''

  // All retry policy fields affect behavior; not just maxAttempts and baseDelayMs.
  const retryKey = config.retryPolicy
    ? JSON.stringify(config.retryPolicy)
    : ''

  const client = useMemo(
    () => new KikisAppClient(config),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      walletKey,
      config.network,
      spendCapKey,
      config.commitmentSecret,
      retryKey,
      config.spendStore,
      config.logger,
      config.rpcUrl,
      config.sorobanRpcUrl,
      config.baseFeeStroops,
      config.manifestTimeoutMs,
      config.expectedPayee,
      config.vault,
      config.horizonRpcUrl,
      config.rpcTimeoutMs,
    ],
  )

  // Dispose the commitment secret when the client instance is replaced or the
  // component unmounts, so the secret does not linger in the WeakMap.
  useEffect(() => () => client.dispose(), [client])

  return client
}
