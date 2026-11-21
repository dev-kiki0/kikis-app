/**
 * Tests for ProviderRegistry network derivation and the manifest↔payee
 * cross-check that closes the self-signed trust gap (issue #146).
 */

import assert from 'node:assert/strict'
import { after, before, describe, it } from 'node:test'
import { createServer } from 'node:http'
import { Keypair } from '@stellar/stellar-sdk'
import { ProviderRegistry, deriveNetwork, type ProviderRecord } from '../ProviderRegistry.js'
import { signManifest } from '../../manifest/sign.js'
import { KikisAppSignatureError } from '../../errors.js'
import type { KikisAppManifest } from '../../types.js'

const payeeKeypair = Keypair.random()
const attackerKeypair = Keypair.random()

const validManifest: KikisAppManifest = {
  'kikis-app': '1.0',
  name: 'Test Provider',
  description: 'Unit test provider',
  modes: ['x402'],
  network: 'testnet',
  asset: 'USDC',
  asset_contract: 'CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA',
  payee: payeeKeypair.publicKey(),
  pricing: { x402: { amount: '0.001', per: 'request' } },
  endpoints: { price: { method: 'GET', path: '/price' } },
  tags: ['test'],
}

const signedManifest = signManifest(validManifest, payeeKeypair.secret())

function recordFor(baseUrl: string, payee: string): ProviderRecord {
  return {
    name: 'Test',
    description: 'desc',
    base_url: baseUrl,
    modes: ['x402'],
    tags: ['test'],
    network: 'testnet',
    payee,
    source: 'onchain',
    verified: true,
  }
}

describe('deriveNetwork', () => {
  it('derives testnet from a horizon-testnet URL', () => {
    assert.equal(deriveNetwork('https://horizon-testnet.stellar.org'), 'testnet')
  })

  it('defaults to mainnet for production horizon', () => {
    assert.equal(deriveNetwork('https://horizon.stellar.org'), 'mainnet')
    assert.equal(deriveNetwork('https://example.com/unknown'), 'mainnet')
  })
})

describe('ProviderRegistry Supabase projection', () => {
  it('selects only the mapped provider columns and maps rows identically', async () => {
    const sampleRow = {
      name: 'Supabase Provider',
      description: 'from supabase',
      base_url: 'https://provider.example.com',
      modes: ['x402'],
      tags: ['test'],
      network: 'testnet',
      payee: payeeKeypair.publicKey(),
      verified: true,
      // Columns that must not be requested / relied upon.
      manifest: { 'kikis-app': '1.0' },
      created_at: '2024-01-01T00:00:00Z',
    }

    const selectCalls: string[] = []
    const builder = {
      select(columns: string) {
        selectCalls.push(columns)
        return builder
      },
      eq() {
        return builder
      },
      limit() {
        return builder
      },
      then(resolve: (value: { data: unknown[]; error: null }) => unknown) {
        return Promise.resolve({ data: [sampleRow], error: null }).then(resolve)
      },
    }

    const supabase = {
      from(table: string) {
        assert.equal(table, 'providers')
        return builder
      },
    }

    const registry = new ProviderRegistry({
      supabase: supabase as never,
      network: 'testnet',
    })

    const records = await registry.listProviders()

    assert.equal(selectCalls.length, 1)
    const selected = selectCalls[0]
    assert.notEqual(selected, '*')
    assert.ok(!selected.includes('manifest'))
    for (const column of [
      'name',
      'description',
      'base_url',
      'modes',
      'tags',
      'network',
      'payee',
      'verified',
    ]) {
      assert.ok(selected.includes(column), `expected projection to include ${column}`)
    }

    assert.deepEqual(records, [
      {
        name: 'Supabase Provider',
        description: 'from supabase',
        base_url: 'https://provider.example.com',
        modes: ['x402'],
        tags: ['test'],
        network: 'testnet',
        payee: payeeKeypair.publicKey(),
        source: 'supabase',
        verified: true,
      },
    ])
  })
})

describe('ProviderRegistry.fetchProviderManifest', () => {
  let server: ReturnType<typeof createServer>
  let baseUrl: string

  before(async () => {
    server = createServer((req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify(signedManifest))
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const addr = server.address()
    assert.ok(addr && typeof addr === 'object')
    baseUrl = `http://127.0.0.1:${addr.port}`
  })

  after(async () => {
    await new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve())),
    )
  })

  it('resolves the manifest when the record payee matches the manifest payee', async () => {
    const registry = new ProviderRegistry({
      onChain: { horizonUrl: 'https://horizon-testnet.stellar.org', knownAccounts: [] },
    })
    const manifest = await registry.fetchProviderManifest(recordFor(baseUrl, payeeKeypair.publicKey()))
    assert.equal(manifest.payee, payeeKeypair.publicKey())
  })

  it('throws KikisAppSignatureError when the record payee differs from the manifest payee', async () => {
    const registry = new ProviderRegistry({
      onChain: { horizonUrl: 'https://horizon-testnet.stellar.org', knownAccounts: [] },
    })
    // Record claims the attacker's account, but the served manifest is signed by
    // the attacker — the registry must refuse to bind them together.
    const record = recordFor(baseUrl, attackerKeypair.publicKey())
    await assert.rejects(
      () => registry.fetchProviderManifest(record),
      (err: unknown) =>
        err instanceof KikisAppSignatureError &&
        err.message.includes('does not match expected payee'),
    )
  })
})
