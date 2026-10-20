import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'
import { rpc } from '@stellar/stellar-sdk'
import { KikisAppSecurityError } from '../../errors.js'
import { verifyVaultContractWasm } from '../AgentVault.js'

const CONTRACT = 'CAX5IDLC2XHGQSEA2YN3LPLZ7EXLMRXYX3HFJGKFXS6B7OQXBKWO44LT'
const EXPECTED_HASH = '11'.repeat(32)

const serverPrototype = rpc.Server.prototype as unknown as {
  getContractData: typeof rpc.Server.prototype.getContractData
}
const originalGetContractData = serverPrototype.getContractData

function mockSorobanResponse(actualHash: string): void {
  serverPrototype.getContractData = (async () => ({
    val: {
      contractData: () => ({
        val: () => ({
          instance: () => ({
            executable: () => ({ wasmHash: () => Buffer.from(actualHash, 'hex') }),
          }),
        }),
      }),
    },
  })) as typeof serverPrototype.getContractData
}

afterEach(() => {
  serverPrototype.getContractData = originalGetContractData
})

test('verifyVaultContractWasm accepts the expected hash from Soroban RPC', async () => {
  mockSorobanResponse(EXPECTED_HASH)

  await assert.doesNotReject(
    verifyVaultContractWasm(CONTRACT, EXPECTED_HASH, { rpcUrl: 'http://localhost:8000' }),
  )
})

test('verifyVaultContractWasm rejects a tampered Wasm hash from Soroban RPC', async () => {
  mockSorobanResponse('22'.repeat(32))

  await assert.rejects(
    verifyVaultContractWasm(CONTRACT, EXPECTED_HASH, { rpcUrl: 'http://localhost:8000' }),
    (error: unknown) => error instanceof KikisAppSecurityError && /hash mismatch/.test(error.message),
  )
})