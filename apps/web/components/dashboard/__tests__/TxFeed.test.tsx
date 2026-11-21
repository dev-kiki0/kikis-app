import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import TxFeed from '../TxFeed'

const mockFrom = vi.fn()

vi.mock('@/lib/supabase/client', () => ({
  getSupabaseBrowserClient: () => ({ from: mockFrom }),
}))

function makeQuery(result: { data: unknown[] | null; error: { message: string } | null }) {
  const query: Record<string, unknown> = {}
  query.select = vi.fn(() => query)
  query.order = vi.fn(() => query)
  query.lt = vi.fn(() => query)
  query.limit = vi.fn(() => Promise.resolve(result))
  return query
}

describe('TxFeed pagination', () => {
  beforeEach(() => {
    mockFrom.mockReset()
  })

  it('shows a retryable error on a failed page and appends rows once on retry', async () => {
    const firstPage = [
      { id: 'a', created_at: '2024-01-03T00:00:00Z' },
      { id: 'b', created_at: '2024-01-02T00:00:00Z' },
    ]
    const retryPage = [{ id: 'c', created_at: '2024-01-01T00:00:00Z' }]

    const initialQuery = makeQuery({ data: firstPage, error: null })
    const failedQuery = makeQuery({ data: null, error: { message: 'boom' } })
    const retryQuery = makeQuery({ data: retryPage, error: null })

    mockFrom
      .mockReturnValueOnce(initialQuery)
      .mockReturnValueOnce(failedQuery)
      .mockReturnValueOnce(retryQuery)

    render(<TxFeed />)

    await screen.findByText('a')
    expect(screen.getByText('b')).toBeTruthy()

    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Load More' }))

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('Could not load more transactions')
    // Existing rows are preserved on failure.
    expect(screen.getByText('a')).toBeTruthy()
    expect(screen.getByText('b')).toBeTruthy()

    await user.click(screen.getByRole('button', { name: 'Retry' }))

    await screen.findByText('c')
    await waitFor(() => {
      expect(screen.queryByRole('alert')).toBeNull()
    })

    // Retry reused the unchanged cursor from the first page.
    expect(failedQuery.lt).toHaveBeenCalledWith('created_at', '2024-01-02T00:00:00Z')
    expect(retryQuery.lt).toHaveBeenCalledWith('created_at', '2024-01-02T00:00:00Z')

    // Rows appended exactly once.
    expect(screen.getAllByText('c')).toHaveLength(1)
    expect(screen.getByText('a')).toBeTruthy()
    expect(screen.getByText('b')).toBeTruthy()
  })
})
