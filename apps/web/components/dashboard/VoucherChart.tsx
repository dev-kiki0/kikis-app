'use client'

import { useEffect, useState } from 'react'
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from 'recharts'
import { createClient } from '@/lib/supabase/client'
import type { Network } from '@/lib/types'

interface ChartPoint {
  minute: string
  label: string
  fullTime: string
  vouchers: number
}

interface VoucherChartProps {
  network: Network
}

function formatBucketLabel(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  return date.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function formatBucketFullTime(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  return date.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZoneName: 'short',
  })
}

export function VoucherChart({ network }: VoucherChartProps) {
  const [points, setPoints] = useState<ChartPoint[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false

    async function load() {
      setLoading(true)
      const supabase = createClient()
      const { data: rows, error } = await supabase
        .from('vouchers')
        .select('updated_at, voucher_count')
        .not('voucher_count', 'eq', 0)
        // Filter strictly by the active network so testnet and mainnet vouchers
        // are never mixed into the same chart. (#112)
        .eq('network', network)
        .order('updated_at', { ascending: false })
        .limit(500)

      if (cancelled) return

      if (error || !rows) {
        setPoints([])
        setLoading(false)
        return
      }

      const byMinute = new Map<string, number>()
      for (const row of rows as { updated_at: string; voucher_count: number }[]) {
        const minute = new Date(row.updated_at).toISOString().slice(0, 16)
        byMinute.set(minute, (byMinute.get(minute) ?? 0) + (row.voucher_count ?? 0))
      }

      let cumulative = 0
      const nextPoints: ChartPoint[] = Array.from(byMinute.entries())
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([iso, count]) => {
          cumulative += count
          return {
            minute: iso,
            label: formatBucketLabel(iso),
            fullTime: formatBucketFullTime(iso),
            vouchers: cumulative,
          }
        })

      setPoints(nextPoints)
      setLoading(false)
    }

    load()
    return () => {
      cancelled = true
    }
  }, [network])

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center text-sm text-[var(--text-muted)]">
        Loading chart…
      </div>
    )
  }

  if (points.length === 0) {
    return (
      <div className="flex h-64 items-center justify-center text-sm text-[var(--text-muted)]">
        No voucher activity yet.
      </div>
    )
  }

  return (
    <div className="h-64 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={points} margin={{ top: 8, right: 8, bottom: 0, left: -16 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
          <XAxis
            dataKey="label"
            tick={{ fill: 'var(--text-muted)', fontSize: 11 }}
            axisLine={false}
            tickLine={false}
          />
          <YAxis
            tick={{ fill: 'var(--text-muted)', fontSize: 11 }}
            axisLine={false}
            tickLine={false}
            allowDecimals={false}
          />
          <Tooltip
            contentStyle={{
              background: 'var(--surface)',
              border: '1px solid var(--border)',
              borderRadius: 8,
              fontSize: 12,
            }}
            labelFormatter={(_, payload) => {
              const point = payload?.[0]?.payload as ChartPoint | undefined
              return point?.fullTime ?? ''
            }}
            formatter={(value: number) => [value, 'Vouchers']}
          />
          <Line
            type="monotone"
            dataKey="vouchers"
            stroke="var(--accent)"
            strokeWidth={2}
            dot={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}
