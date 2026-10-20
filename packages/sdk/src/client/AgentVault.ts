import { rpc, StrKey, xdr } from '@stellar/stellar-sdk'
import { KikisAppSecurityError } from '../errors.js'

export interface VaultWasmVerificationOptions {
  network?: 'testnet' | 'mainnet'
  rpcUrl?: string
  rpcTimeoutMs?: number
}

/** Verify a Soroban vault instance's executable Wasm hash against a trusted pin. */
export async function verifyVaultContractWasm(
  contractAddress: string,
  expectedWasmHash: string,
  options: VaultWasmVerificationOptions = {},
): Promise<void> {
  const expected = expectedWasmHash.replace(/^0x/i, '').toLowerCase()
  if (!/^[0-9a-f]{64}$/.test(expected)) {
    throw new KikisAppSecurityError('Expected vault Wasm hash must be a 32-byte hexadecimal SHA-256 hash')
  }

  if (!StrKey.isValidContract(contractAddress)) {
    throw new KikisAppSecurityError(`Invalid vault contract address: ${contractAddress}`)
  }

  const rpcUrl = options.rpcUrl ??
    (options.network === 'mainnet' ? 'https://soroban.stellar.org' : 'https://soroban-testnet.stellar.org')
  const timeoutMs = options.rpcTimeoutMs ?? 10_000
  const server = new rpc.Server(rpcUrl, { allowHttp: rpcUrl.startsWith('http://') })
  let timer: ReturnType<typeof setTimeout> | undefined

  try {
    const response = await Promise.race([
      server.getContractData(
        contractAddress,
        xdr.ScVal.scvLedgerKeyContractInstance(),
        rpc.Durability.Persistent,
      ),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`Soroban RPC request timed out after ${timeoutMs}ms`)), timeoutMs)
        const maybeTimer = timer as unknown as { unref?: () => void }
        maybeTimer.unref?.()
      }),
    ])
    if (!response.val) {
      throw new KikisAppSecurityError(`No contract instance found at ${contractAddress}`)
    }

    const executable = response.val.contractData().val().instance().executable()
    const wasmHash = executable.wasmHash()
    const actual = Array.from(wasmHash, (byte) => byte.toString(16).padStart(2, '0')).join('')
    if (actual !== expected) {
      throw new KikisAppSecurityError(
        `Vault Wasm hash mismatch at ${contractAddress}: expected ${expected}, received ${actual}`,
      )
    }
  } catch (cause) {
    if (cause instanceof KikisAppSecurityError) throw cause
    throw new KikisAppSecurityError(`Could not verify vault Wasm at ${contractAddress}`, { cause })
  } finally {
    if (timer) clearTimeout(timer)
  }
}