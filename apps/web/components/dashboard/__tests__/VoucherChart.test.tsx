import { describe, it, expect } from 'vitest'

// Mirror of the bucket formatting logic in VoucherChart so we can verify that
// same-clock-time rows a day apart retain separate, identifiable labels.
function buildPoints(rows: { updated_at: string; voucher_count: number }[]) {
  const byMinute = new Map<string, number>()
  for (const row of rows) {
    const minute = new Date(row.updated_at).toISOString().slice(0, 16)
    byMinute.set(minute, (byMinute.get(minute) ?? 0) + (row.voucher_count ?? 0))
  }

  let cumulative = 0
  return Array.from(byMinute.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([iso, count]) => {
      cumulative += count
      return { minute: iso, vouchers: cumulative }
    })
}

describe('VoucherChart bucket labels', () => {
  it('keeps same clock time on different days as separate buckets', () => {
    const points = buildPoints([
      { updated_at: '2024-01-01T12:00:00.000Z', voucher_count: 2 },
      { updated_at: '2024-01-02T12:00:00.000Z', voucher_count: 3 },
    ])

    expect(points).toHaveLength(2)
    expect(points[0].minute).toBe('2024-01-01T12:00')
    expect(points[1].minute).toBe('2024-01-02T12:00')
    expect(points[0].minute).not.toBe(points[1].minute)
  })

  it('orders buckets chronologically by full timestamp', () => {
    const points = buildPoints([
      { updated_at: '2024-01-02T12:00:00.000Z', voucher_count: 1 },
      { updated_at: '2024-01-01T12:00:00.000Z', voucher_count: 1 },
      { updated_at: '2024-01-01T08:30:00.000Z', voucher_count: 1 },
    ])

    expect(points.map((p) => p.minute)).toEqual([
      '2024-01-01T08:30',
      '2024-01-01T12:00',
      '2024-01-02T12:00',
    ])
  })
})
