import { useEffect, useMemo, useRef } from 'react'
import { KikisAppClient, type KikisAppClientConfig } from '../client/KikisAppClient.js'

export function useKikisAppClient(config: KikisAppClientConfig): KikisAppClient {
  const walletKey = typeof config.wallet === 'string' ? config.wallet : config.wallet.publicKey()
  const spendCapKey = config.spendCap ? JSON.stringify(config.spendCap) : ''
  const retryKey = config.retryPolicy ? JSON.stringify(config.retryPolicy) : ''

  const client = useMemo(
    () => new KikisAppClient(config),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [walletKey, config.network, spendCapKey, config.commitmentSecret, retryKey],
  )

  // Track the client instance whose ownership we currently hold. Disposing on
  // effect cleanup alone would release the secret during Strict Mode effect
  // replay (setup → cleanup → setup), leaving the still-mounted client unable
  // to open a session. Instead, dispose the previous instance only when the
  // memoized client is actually replaced, and dispose the final owned instance
  // on unmount.
  const ownedRef = useRef<KikisAppClient | null>(null)

  useEffect(() => {
    const previous = ownedRef.current
    ownedRef.current = client
    if (previous && previous !== client) {
      previous.dispose()
    }
  }, [client])

  useEffect(() => {
    return () => {
      const owned = ownedRef.current
      ownedRef.current = null
      if (owned) {
        owned.dispose()
      }
    }
  }, [])

  return client
}
