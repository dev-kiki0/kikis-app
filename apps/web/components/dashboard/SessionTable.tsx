'use client'

import { useCallback, useEffect, useState } from 'react'
import { getSupabaseBrowserClient, isSupabaseConfigured, SESSION_COLUMNS, type Session } from '@/lib/supabase'
import { RelativeTime } from '@/components/shared/RelativeTime'
import { TxHashLink } from '@/components/shared/TxHashLink'
import { AddressDisplay } from '@/components/shared/AddressDisplay'

const PAGE_SIZE = 50

interface SessionTableProps {
  initialSessions?: Session[]
  pageSize?: number
  loadMore?: () => Promise<void>
}

export function SessionTable({ initialSessions = [], pageSize = PAGE_SIZE, loadMore: onLoadMore }: SessionTableProps) {
  const [sessions, setSessions] = useState<Session[]>(initialSessions)
  const [refreshFailed, setRefreshFailed] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [hasMore, setHasMore] = useState(initialSessions.length >= PAGE_SIZE)

  const refreshSessions = useCallback(async () => {
    const supabase = getSupabaseBrowserClient()
    if (!supabase) return

    const { data, error } = await supabase
      .from('public_sessions')
      .select(SESSION_COLUMNS)
      .order('opened_at', { ascending: false })
      .limit(pageSize)

    if (error) {
      // Keep the rows already on screen instead of blanking the table.
      console.warn('[sessions] failed to refresh public_sessions:', error.message)
      setRefreshFailed(true)
      return
    }
    setRefreshFailed(false)
    if (data) {
      setSessions(data as Session[])
      setHasMore(data.length >= pageSize)
    }
  }, [pageSize])

  const handleLoadMore = useCallback(async () => {
    if (loadingMore || !hasMore || !onLoadMore) return

    setLoadingMore(true)
    try {
      await onLoadMore()
    } finally {
      setLoadingMore(false)
    }
  }, [loadingMore, hasMore, onLoadMore])

  useEffect(() => {
    if (!isSupabaseConfigured()) return

    const supabase = getSupabaseBrowserClient()
    if (!supabase) return

    let cancelled = false

    async function load() {
      const { data, error } = await supabase
        .from('public_sessions')
        .select(SESSION_COLUMNS)
        .order('opened_at', { ascending: false })
        .limit(pageSize)

      if (cancelled) return

      if (error) {
        console.warn('[sessions] failed to load public_sessions:', error.message)
        setRefreshFailed(true)
      } else {
        setSessions((data ?? []) as Session[])
        setHasMore((data?.length ?? 0) >= pageSize)
        setRefreshFailed(false)
      }
    }

    void load()

    return () => {
      cancelled = true
    }
  }, [pageSize, isSupabaseConfigured])

  if (!isSupabaseConfigured()) {
    return (
      <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-400">
        Supabase not configured. Set <code className="font-mono">NEXT_PUBLIC_SUPABASE_URL</code> and{' '}
        <code className="font-mono">NEXT_PUBLIC_SUPABASE_ANON_KEY</code> in your <code className="font-mono">.env.local</code>.
      </div>
    )
  }

  if (sessions.length === 0) {
    return (
      <div className="rounded-lg border border-[var(--border-default)] bg-[var(--bg-surface)] px-4 py-12 text-center">
        <p className="text-sm text-[var(--text-muted)]">No sessions recorded yet.</p>
      </div>
    )
  }

  return (
    <div className="rounded-2xl border border-[var(--border-default)] bg-[var(--bg-surface)] overflow-hidden flex flex-col">
      <div className="px-5 py-4 border-b border-[var(--border-default)]">
        <h2 className="text-sm font-semibold text-[var(--text-primary)]">Sessions</h2>
        {refreshFailed && (
          <p className="mt-1 text-xs text-[var(--status-pending)]">Failed to refresh — showing cached data</p>
        )}
      </div>
      <div className="flex-1 overflow-x-auto">
        <table className="w-full text-left text-sm border-collapse">
          <thead>
            <tr className="border-b border-[var(--border-default)] text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-wider">
              <th className="px-4 py-3">Channel</th>
              <th className="px-4 py-3">Payer</th>
              <th className="px-4 py-3">Mode</th>
              <th className="px-4 py-3 text-right">Vouchers</th>
              <th className="px-4 py-3 text-right">Amount (USDC)</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Settlement</th>
              <th className="px-4 py-3 text-right">Opened</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--border-default)]">
            {sessions.map((session) => (
              <tr
                key={session.id}
                className="hover:bg-[var(--bg-subtle)] transition-colors"
              >
                <td className="px-4 py-3">
                  <AddressDisplay address={session.channel_id} network={session.network} accessibleLabel="channel" />
                </td>
                <td className="px-4 py-3">
                  <AddressDisplay address={session.payer} network={session.network} accessibleLabel="payer" />
                </td>
                <td className="px-4 py-3">
                  <span className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium bg-[var(--bg-subtle)] text-[var(--text-muted)]">
                    mpp-session
                  </span>
                </td>
                <td className="px-4 py-3 text-right font-mono text-xs text-[var(--text-primary)]">
                  {session.voucher_count}
                </td>
                <td className="px-4 py-3 text-right">
                  <span className={`number-lg font-mono text-[var(--text-primary)] ${session.status === 'open' ? 'text-[var(--status-success)]' : ''}`}>
                    {Number(session.cumulative_amount).toFixed(7)}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <span className="inline-flex items-center gap-1.5">
                    {session.status === 'open' && (
                      <span className="h-1.5 w-1.5 rounded-full bg-[var(--status-success)] animate-pulse" />
                    )}
                    <span className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium bg-[var(--bg-subtle)] text-[var(--text-primary)]">
                      {session.status}
                    </span>
                  </span>
                </td>
                <td className="px-4 py-3">
                  {session.settlement_tx_hash ? (
                    <TxHashLink
                      hash={session.settlement_tx_hash}
                      network={session.network}
                    />
                  ) : (
                    <span className="text-xs text-[var(--text-muted)]">—</span>
                  )}
                </td>
                <td className="px-4 py-3 text-right text-xs text-[var(--text-muted)]">
                  <RelativeTime date={session.opened_at} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {sessions.length > 0 && (
        <div className="flex items-center justify-center border-t border-[var(--border-default)] px-5 py-3">
          {hasMore ? (
            <button
              type="button"
              onClick={() => void handleLoadMore()}
              disabled={loadingMore}
              className="rounded-lg border border-[var(--border-default)] px-4 py-1.5 text-xs font-medium text-[var(--text-primary)] transition-colors hover:bg-[var(--bg-subtle)] disabled:cursor-not-allowed disabled:opacity-60"
            >
              {loadingMore ? 'Loading…' : 'Load More'}
            </button>
          ) : (
            <span className="text-xs text-[var(--text-muted)]">End of list</span>
          )}
        </div>
      )}
    </div>
  )
}
