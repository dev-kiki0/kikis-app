'use client'

import { useEffect, useState, useCallback } from 'react'
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts'
import type { TooltipContentProps } from 'recharts/types/component/Tooltip'
import { getSupabaseBrowserClient } from '@/lib/supabase'

interface ChartPoint {
  minute: string
  vouchers: number
}

function CustomTooltip(props: TooltipContentProps) {
  const { active, payload, label } = props
  if (!active || !payload?.length) return null
  return (
    <div className="rounded-lg border border-[var(--border-default)] bg-[var(--bg-overlay)] p-2 text-xs shadow-lg">
      <p className="text-[var(--text-muted)] mb-0.5">{String(label)}</p>
      <p className="font-mono text-[var(--text-primary)]">
        {payload[0]?.value as number} vouchers
      </p>
    </div>
  )
}

interface VoucherChartProps {
  /** The active network filter — only sessions on this network are included. */
  network: 'testnet' | 'mainnet'
}

export function VoucherChart({ network }: VoucherChartProps) {
  const [data, setData] = useState<ChartPoint[]>([])
  const [loadFailed, setLoadFailed] = useState(false)

  const fetchData = useCallback(async () => {
    const supabase = getSupabaseBrowserClient()
    const { data: rows, error } = await supabase
      .from('public_sessions')
      // Use updated_at so vouchers are attributed to the time they were
      // issued/updated rather than when the session was opened. A session opened
      // 2 h ago that issued 50 vouchers over the last 10 min would otherwise
      // cluster all 50 at the 2-hour-old bucket. (#112)
      .select('updated_at, voucher_count')
      .not('voucher_count', 'eq', 0)
      // Filter strictly by the active network so testnet and mainnet vouchers
      // are never mixed into the same chart. (#112)
      .eq('network', network)
      .order('updated_at', { ascending: false })
      .limit(500)

    if (error) {
      // Keep whatever is already on screen: a single failed poll must not wipe a
      // chart that had loaded.
      console.warn('[voucher-chart] failed to load public_sessions:', error.message)
      setLoadFailed(true)
      return
    }
    setLoadFailed(false)

    if (!rows || rows.length === 0) {
      setData([])
      return
    }

    // Group by minute using updated_at (voucher issuance time) instead of
    // opened_at (session creation time). (#112)
    const byMinute = new Map<string, number>()
    for (const row of rows as { updated_at: string; voucher_count: number }[]) {
      const minute = new Date(row.updated_at).toISOString().slice(0, 16)
      byMinute.set(minute, (byMinute.get(minute) ?? 0) + (row.voucher_count ?? 0))
    }

    let cumulative = 0
    const points: ChartPoint[] = Array.from(byMinute.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([iso, count]) => {
        cumulative += count
        const [, time] = iso.split('T')
        return { minute: time ?? iso, vouchers: cumulative }
      })

    setData(points)
  }, [network])

  useEffect(() => {
    const initialFetch = setTimeout(() => void fetchData(), 0)
    const interval = setInterval(() => void fetchData(), 30_000)
    return () => {
      clearTimeout(initialFetch)
      clearInterval(interval)
    }
  }, [fetchData])

  if (data.length === 0) {
    return (
      <div className="rounded-2xl border border-[var(--border-default)] bg-[var(--bg-surface)] p-5">
        <h2 className="text-sm font-semibold text-[var(--text-primary)] mb-6">
          Voucher Accumulation
        </h2>
        <div className="flex items-center justify-center h-40">
          {loadFailed ? (
            <p className="text-sm text-[var(--status-error)]">
              {"Couldn't load session data"}
            </p>
          ) : (
            <p className="text-sm text-[var(--text-muted)]">No session data yet</p>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="rounded-2xl border border-[var(--border-default)] bg-[var(--bg-surface)] p-5">
      <h2 className="text-sm font-semibold text-[var(--text-primary)] mb-6">
        Voucher Accumulation
      </h2>
      {loadFailed && (
        <p className="mb-3 text-xs text-[var(--status-error)]">
          {"Couldn't refresh session data. Showing the last loaded points."}
        </p>
      )}
      <ResponsiveContainer width="100%" height={200}>
        <AreaChart data={data} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
          <defs>
            <linearGradient id="accentFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="var(--accent)" stopOpacity={0.2} />
              <stop offset="95%" stopColor="var(--accent)" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid
            strokeDasharray="3 3"
            stroke="var(--border-default)"
            vertical={false}
          />
          <XAxis
            dataKey="minute"
            tick={{ fill: 'var(--text-muted)', fontSize: 11 }}
            axisLine={false}
            tickLine={false}
          />
          <YAxis
            tick={{ fill: 'var(--text-muted)', fontSize: 11 }}
            axisLine={false}
            tickLine={false}
          />
          <Tooltip content={(p) => <CustomTooltip {...p} />} />
          <Area
            type="monotone"
            dataKey="vouchers"
            stroke="var(--accent)"
            strokeWidth={2}
            fill="url(#accentFill)"
            dot={false}
            activeDot={{ r: 3, fill: 'var(--accent)' }}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  )
}
