'use client'

import { useEffect, useState } from 'react'
import { getSupabaseBrowserClient } from '@/lib/supabase'
import type { TxLogEntry } from '@/lib/supabase'
import { TxHashLink } from '@/components/ui/TxHashLink'
import { getNetworkLabel } from '@/lib/network'

interface LiveFeedProps {
  initialEntries: TxLogEntry[]
}

function networkLabel(network: string | null | undefined): string {
  return getNetworkLabel(network)
}

export function LiveFeed({ initialEntries }: LiveFeedProps) {
  const [entries, setEntries] = useState<TxLogEntry[]>(initialEntries)

  useEffect(() => {
    let cancelled = false

    async function poll() {
      const requestId = ++latestRequest
      const supabase = getSupabaseBrowserClient()
      const { data, error } = await supabase
        .from('tx_log')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(5)

      if (cancelled) return
      if (error) {
        console.error('[live-feed] poll failed:', error.message)
        return
      }
      setEntries((data ?? []) as TxLogEntry[])
    }

    const interval = setInterval(poll, 10_000)
    return () => {
      cancelled = true
      clearInterval(interval)
    }
  }, [])

  return (
    <div className="rounded-2xl border border-[var(--border-default)] bg-[var(--bg-subtle)] p-6">
      <div className="flex items-center justify-between mb-4">
        <span className="text-xs font-medium text-[var(--text-muted)] uppercase tracking-wider">
          Live Feed
        </span>
      </div>

      {entries.length === 0 ? (
        <p className="text-sm text-[var(--text-muted)]">No transactions yet.</p>
      ) : (
        <ul className="space-y-3">
          {entries.map((entry) => (
            <li
              key={entry.id}
              className="flex items-center justify-between gap-3 text-sm"
            >
              <div className="flex items-center gap-2 min-w-0">
                <span className="shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider border border-[var(--border-default)] text-[var(--text-muted)]">
                  {networkLabel(entry.network)}
                </span>
                <span className="truncate text-[var(--text-secondary)]">
                  {entry.mode ?? 'payment'}
                </span>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {entry.amount != null && (
                  <span className="font-mono text-[var(--text-primary)]">
                    {entry.amount} USDC
                  </span>
                )}
                {entry.tx_hash && (
                  <TxHashLink hash={entry.tx_hash} network={entry.network} />
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
