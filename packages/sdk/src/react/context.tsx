import { createContext, useContext, useMemo, type ReactNode } from 'react'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { KikisAppClient } from '../client/KikisAppClient.js'

export interface KikisAppContextValue {
  client: KikisAppClient
  supabase?: SupabaseClient
}

const KikisAppContext = createContext<KikisAppContextValue | null>(null)

export interface KikisAppProviderProps extends KikisAppContextValue {
  children: ReactNode
}

/**
 * Wraps an app with KikisApp client + optional Supabase instance.
 * Child hooks (`usePay`, `useSession`, `useTxLog`) read from this context.
 *
 * @example
 * const client = useKikisAppClient({ wallet: secret, network: 'testnet' })
 * return <KikisAppProvider client={client} supabase={supabase}>{children}</KikisAppProvider>
 */
export function KikisAppProvider(props: KikisAppProviderProps) {
  const { children, client, supabase } = props
  const value: KikisAppContextValue = useMemo(
    () => (supabase ? { client, supabase } : { client }),
    [client, supabase],
  )
  return (
    <KikisAppContext.Provider value={value}>
      {children}
    </KikisAppContext.Provider>
  )
}

export function useKikisAppContext(): KikisAppContextValue {
  const ctx = useContext(KikisAppContext)
  if (!ctx) {
    throw new Error('useKikisAppContext must be used inside <KikisAppProvider>')
  }
  return ctx
}