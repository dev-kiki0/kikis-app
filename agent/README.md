# KikisApp Reference Agent

Autonomous reference agent demonstrating multi-mode micropayments (`x402`, `mpp-charge`, and `mpp-session`) over the Stellar network using `@kikis-app/kikis-app`.

## Overview

The agent executes the full autonomous payment workflow:
1. **Initialize**: Derive agent keypair, check Horizon USDC balance & trustline.
2. **x402 Discrete Query**: Execute forced `x402` micropayment against Provider A `/price`.
3. **MPP Charge Query**: Execute natural mode selection (`mpp-charge`) against Provider A `/price`.
4. **MPP Session Streaming**: Stream 50 SSE events from Provider B `/stream/orderbook` via 50 off-chain vouchers, then settle on-chain with the `close` transaction. The payment channel is **pre-deployed and funded before the agent runs** (see [Prerequisites](#prerequisites)), so the demo does not issue an `open` transaction.
5. **Policy Rejection**: Demonstrate local pre-payment spend cap enforcement without broadcasting any transaction to Stellar Horizon.

## Prerequisites

Channel provisioning is a **prerequisite**, not part of the demo run. Before starting the agent, the `mpp-session` channel with Provider B must already be deployed and funded on-chain. Because the channel is pre-deployed, the session handle returned by the SDK reports `openTxHash: null` — the client never issues the channel-open transaction and therefore has no hash for it.

## Expected Transaction Output

During a run, the demo emits only the settlement transaction for the streaming session. The reference runner's session logs look like:

```
[mpp-session] channel: C... (pre-deployed)
[mpp-session] openTxHash: null
[mpp-session] vouchers: 50 off-chain
[mpp-session] closeTxHash: <close/settle transaction hash>
```

- `openTxHash: null` — the channel was provisioned before the agent ran; no open transaction is broadcast by the demo.
- `closeTxHash` — the on-chain `close`/settle transaction emitted by the demo session.

## Environment Variables

| Variable | Default | Description |
| --- | --- | --- |
| `AGENT_SECRET` | Required | Stellar secret key (starts with `S...`) |
| `STELLAR_NETWORK` | `testnet` | Stellar network (`testnet` or `mainnet`) |
| `PROVIDER_A_URL` | `http://localhost:3001` | URL for discrete price provider |
| `PROVIDER_B_URL` | `http://localhost:3002` | URL for streaming orderbook provider |
| `AGENT_DAILY_CAP_USDC` | `0.002` | Daily spending cap in USDC |
| `AGENT_SPEND_STORE_PATH` | `~/.kikis-app/spend.json` | Path to persistent file spend store |
| `COMMITMENT_SECRET` | Optional | Ed25519 commitment secret key for `mpp-session` (required for the full demo) |

## Commitment Key

`COMMITMENT_SECRET` is an Ed25519 secret key used to sign off-chain vouchers for `mpp-session` streaming.

- **Discrete-only usage** (`x402` / `mpp-charge`): the commitment secret is not needed. You can run the discrete steps without setting it.
- **Full demo**: step 4 opens a streaming session, and the SDK requires a commitment secret at session initialization. Without it, the demo reaches an SDK initialization error (`commitmentSecret is required ... for mpp-session mode`) at the `mpp-session` step.

When running the full demo, set `COMMITMENT_SECRET` to a key whose corresponding commitment public key is configured on the provider side. Use non-production keys for local testing, and never commit a real key or print its value.

## Spend Cap & Store Durability

> [!WARNING]
> **Production Safety Warning**:
> By default, initializing `KikisAppClient` without a `spendStore` parameter uses `InMemorySpendStore`.
> An in-memory spend cap resets to zero on every process restart, OOM kill, or container redeploy, which allows spend limits to be bypassed across runs.
>
> **Do not rely on an in-memory spend cap in production.**
> Always pass a durable `SpendStore` (such as `FileSpendStore` pointing to disk, Redis, or SQL) via `spendStore` in `KikisAppClientConfig`:
>
> ```typescript
> import { KikisAppClient, FileSpendStore } from '@kikis-app/kikis-app'
>
> const client = new KikisAppClient({
>   wallet: keypair,
>   network: 'testnet',
>   spendCap: { daily: '10.0', asset: 'USDC' },
>   spendStore: new FileSpendStore('~/.kikis-app/spend.json'),
> })
> ```

## Running the Agent

```bash
pnpm --filter agent dev
```
