import { describe, it, expect, vi } from 'vitest'
import { Connection, PublicKey } from '@solana/web3.js'
import { OnChainRegistry } from './OnChainRegistry'

function makeAccount(pubkey: string, data: Record<string, unknown>) {
  return {
    pubkey: new PublicKey(pubkey),
    account: {
      data: Buffer.from(JSON.stringify(data), 'utf-8'),
    },
  }
}

function makeRegistry(accounts: unknown[]) {
  const connection = {
    getProgramAccounts: vi.fn().mockResolvedValue(accounts),
  } as unknown as Connection
  return new OnChainRegistry(connection)
}

const VALID_PUBKEY = '11111111111111111111111111111111'

function encodeTags(value: unknown): string {
  return Buffer.from(JSON.stringify(value), 'utf-8').toString('base64')
}

describe('OnChainRegistry', () => {
  it('normalizes mixed JSON tag types to nonempty strings', async () => {
    const registry = makeRegistry([
      makeAccount(VALID_PUBKEY, {
        'kikis-app_endpoint': 'https://provider.example',
        'kikis-app_tags': encodeTags(['alpha', 42, { bad: true }, null, '  beta  ', '', '   ']),
      }),
    ])

    const providers = await registry.getProviders()

    expect(providers).toHaveLength(1)
    expect(providers[0]).toEqual({
      account: VALID_PUBKEY,
      endpoint: 'https://provider.example',
      tags: ['alpha', 'beta'],
    })
  })

  it('keeps valid tags from a JSON string array', async () => {
    const registry = makeRegistry([
      makeAccount(VALID_PUBKEY, {
        'kikis-app_endpoint': 'https://provider.example',
        'kikis-app_tags': encodeTags(['one', 'two']),
      }),
    ])

    const providers = await registry.getProviders()

    expect(providers[0].tags).toEqual(['one', 'two'])
  })

  it('keeps valid tags from comma-delimited strings', async () => {
    const registry = makeRegistry([
      makeAccount(VALID_PUBKEY, {
        'kikis-app_endpoint': 'https://provider.example',
        'kikis-app_tags': Buffer.from(' one, two ,, three ', 'utf-8').toString('base64'),
      }),
    ])

    const providers = await registry.getProviders()

    expect(providers[0].tags).toEqual(['one', 'two', 'three'])
  })

  it('does not drop a provider when tag metadata is malformed', async () => {
    const registry = makeRegistry([
      makeAccount(VALID_PUBKEY, {
        'kikis-app_endpoint': 'https://provider.example',
        'kikis-app_tags': encodeTags({ not: 'an array' }),
      }),
    ])

    const providers = await registry.getProviders()

    expect(providers).toHaveLength(1)
    expect(providers[0]).toEqual({
      account: VALID_PUBKEY,
      endpoint: 'https://provider.example',
      tags: [],
    })
  })
})
