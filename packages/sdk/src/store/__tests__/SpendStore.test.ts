import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  InMemorySpendStore,
  type DailySpend,
  type SpendStore,
} from '../SpendStore.js'

describe('InMemorySpendStore', () => {
  it('returns null before anything is written', async () => {
    const store = new InMemorySpendStore({ warn: false })
    assert.equal(await store.read(), null)
  })

  it('round-trips a written accumulator', async () => {
    const store = new InMemorySpendStore({ warn: false })
    const state: DailySpend = {
      date: '2026-06-26',
      totalMicros: '5000000',
      endpoints: { 'https://api.example.com': '2000000' },
    }
    await store.write(state)
    assert.deepEqual(await store.read(), state)
  })

  it('does not alias internal state (defensive copy)', async () => {
    const store = new InMemorySpendStore({ warn: false })
    const state: DailySpend = {
      date: '2026-06-26',
      totalMicros: '5000000',
      endpoints: { 'https://api.example.com': '2000000' },
    }
    await store.write(state)

    // Mutating the caller's object must not affect stored state.
    state.totalMicros = '9990000000'
    state.endpoints['https://api.example.com'] = '9990000000'
    const read = await store.read()
    assert.equal(read?.totalMicros, '5000000')
    assert.equal(read?.endpoints['https://api.example.com'], '2000000')

    // Mutating the returned object must not affect stored state.
    read!.totalMicros = '1230000000'
    read!.endpoints['https://api.example.com'] = '1230000000'
    const reread = await store.read()
    assert.equal(reread?.totalMicros, '5000000')
    assert.equal(reread?.endpoints['https://api.example.com'], '2000000')
  })

  it('copies pending reservation entries at write and read boundaries', async () => {
    const store = new InMemorySpendStore({ warn: false })
    const state: DailySpend = {
      date: '2026-06-26',
      totalMicros: '5000000',
      endpoints: { 'https://api.example.com': '2000000' },
      pendingReserves: [
        {
          id: 'res-1',
          endpoint: 'https://api.example.com',
          amountMicros: '1000000',
          createdAt: '2026-06-26T00:00:00.000Z',
        },
      ],
    }
    await store.write(state)

    // Mutating the original array and its nested record must not affect stored state.
    state.pendingReserves!.push({
      id: 'res-2',
      endpoint: 'https://api.example.com',
      amountMicros: '2000000',
      createdAt: '2026-06-26T00:00:01.000Z',
    })
    state.pendingReserves![0]!.amountMicros = '9990000000'

    const read = await store.read()
    assert.equal(read?.pendingReserves?.length, 1)
    assert.equal(read?.pendingReserves?.[0]?.amountMicros, '1000000')

    // Mutating the returned array and its nested record must not affect stored state.
    read!.pendingReserves!.push({
      id: 'res-3',
      endpoint: 'https://api.example.com',
      amountMicros: '3000000',
      createdAt: '2026-06-26T00:00:02.000Z',
    })
    read!.pendingReserves![0]!.amountMicros = '1230000000'

    const reread = await store.read()
    assert.equal(reread?.pendingReserves?.length, 1)
    assert.equal(reread?.pendingReserves?.[0]?.amountMicros, '1000000')
  })

  it('round-trips state without pendingReserves', async () => {
    const store = new InMemorySpendStore({ warn: false })
    const state: DailySpend = {
      date: '2026-06-26',
      totalMicros: '5000000',
      endpoints: { 'https://api.example.com': '2000000' },
    }
    await store.write(state)
    const read = await store.read()
    assert.equal(read?.pendingReserves, undefined)
    assert.equal(read?.totalMicros, '5000000')
  })

  it('emits a non-durability warning by default', () => {
    const original = console.warn
    const messages: string[] = []
    console.warn = (msg: string) => messages.push(msg)
    try {
      new InMemorySpendStore()
    } finally {
      console.warn = original
    }
    assert.equal(messages.length, 1)
    assert.match(messages[0]!, /not durable/i)
  })

  it('stays silent when warn is false', () => {
    const original = console.warn
    let called = false
    console.warn = () => {
      called = true
    }
    try {
      new InMemorySpendStore({ warn: false })
    } finally {
      console.warn = original
    }
    assert.equal(called, false)
  })

  it('satisfies the SpendStore interface', () => {
    const store: SpendStore = new InMemorySpendStore({ warn: false })
    assert.equal(typeof store.read, 'function')
    assert.equal(typeof store.write, 'function')
  })
})
