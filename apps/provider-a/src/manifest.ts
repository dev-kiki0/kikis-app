import type { KikisAppManifest } from '@kikis-app/kikis-app'
import {
  TESTNET_USDC_CONTRACT,
  USDC_ISSUERS,
  HORIZON_URLS,
  type Network,
} from '@kikis-app/stellar-network-constants'

export { TESTNET_USDC_CONTRACT, USDC_ISSUERS, HORIZON_URLS }
export type { Network }

export const X402_PRICE = '0.001'
export const MPP_CHARGE_PRICE = '0.0008'

export interface ManifestInput {
  network: Network
  payee: string
  assetContract: string
}

export function buildManifest({ network, payee, assetContract }: ManifestInput): KikisAppManifest {
  return {
    'kikis-app': '1.0',
    name: 'Stellar DEX Price Feed',
    description: 'Real-time USDC/XLM mid-price from Stellar DEX orderbook via Horizon',
    modes: ['x402', 'mpp-charge'],
    network,
    asset: 'USDC',
    asset_contract: assetContract,
    payee,
    pricing: {
      x402: {
        amount: X402_PRICE,
        per: 'request',
        facilitator: `https://channels.openzeppelin.com/x402${network === 'mainnet' ? '' : '/testnet'}`,
      },
      'mpp-charge': { amount: MPP_CHARGE_PRICE, per: 'request' },
    },
    endpoints: { price: { method: 'GET', path: '/price' } },
    tags: ['price', 'stellar', 'dex', 'orderbook', 'usdc'],
    regions: ['IAD', 'AMS'],
    latency_hints: { IAD: 14, AMS: 22 },
    categories: ['data/price/crypto'],
  }
}
