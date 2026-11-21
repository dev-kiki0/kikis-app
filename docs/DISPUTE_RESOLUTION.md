# Dispute Resolution

This document covers what a production agent should do when an MPP session goes wrong. It maps four failure scenarios to the exact SDK call sequence and the expected on-chain outcome for each.

---

## Background: how the one-way channel settles

An MPP session uses a Soroban one-way-channel contract funded by the payer (agent). During the session the agent signs monotonically increasing ed25519 vouchers off-chain. Normal close: the agent calls `session.close()`, which sends the final voucher to the provider via `DELETE`; the provider submits a `settle_with_signature` transaction on-chain and returns `closeTxHash`.

If that normal path fails, the contract exposes a refund path:

1. Agent calls `request_refund` on-chain → channel moves to `in-refund-window`.
2. Provider has `refund_waiting_period_ledgers` (~24 h on mainnet, minimum 17 280 ledgers) to call `settle_with_signature` with any voucher it holds.
3. If the provider does not settle in time, the channel moves to `refundable`.
4. Agent calls `claim_refund` on-chain → full remaining balance returned.

The SDK surfaces this through `SessionHandle`:

```ts
interface SessionHandle {
  close(): Promise<SessionCloseResult>         // normal path
  requestRefund(): Promise<string>             // starts refund window
  settleWithLatestVoucher(): Promise<string>   // provider-side counter-settle
  getDisputeStatus(): Promise<DisputeStatus>   // 'open' | 'in-refund-window' | 'refundable' | 'settled'
}
```

---

## Scenario 1: provider goes offline at close

The agent finishes consuming the stream and calls `session.close()`. The provider's HTTP endpoint is unreachable — the `DELETE` request times out or returns a 5xx.

### What happens

`close()` retries the `DELETE` using the configured `RetryPolicy`. After exhausting retries it throws `KikisAppNetworkError` or `KikisAppChannelStateError`. The channel remains `open` on-chain; no funds have moved.

### Recovery sequence

```ts
import { KikisAppNetworkError, KikisAppChannelStateError } from '@kikis-app/kikis-app'

try {
  const result = await session.close()
  console.log('settled:', result.closeTxHash)
} catch (err) {
  if (
    err instanceof KikisAppNetworkError ||
    err instanceof KikisAppChannelStateError
  ) {
    console.warn('Provider unreachable — initiating on-chain refund dispute')

    // Step 1: open the refund window on-chain
    const refundTxHash = await session.requestRefund()
    console.log('refund window opened:', refundTxHash)

    // Step 2: poll for the refund window to expire (~24 h on mainnet)
    let status = await session.getDisputeStatus()
    while (status !== 'refundable' && status !== 'settled') {
      console.log('channel status:', status, '— waiting...')
      await sleep(60_000) // poll every minute
      status = await session.getDisputeStatus()
    }

    if (status === 'settled') {
      // Provider came back online and settled during the window — normal outcome
      console.log('Provider settled during refund window')
    } else {
      // Step 3: refund window expired without provider settlement — claim funds
      // Call claim_refund directly via the Stellar SDK (not yet wrapped in SessionHandle)
      console.log('Refund window expired — call claim_refund on the channel contract')
      // See "Calling claim_refund directly" below
    }
  }
}
```

### Expected on-chain outcome

| Path | What settles on-chain |
|---|---|
| Provider comes back within window | `settle_with_signature` tx from provider — provider receives owed amount, agent receives remainder |
| Window expires without provider settling | Agent calls `claim_refund` — full channel balance returned to agent |

### Time budget

`refund_waiting_period_ledgers` is set by the provider in the manifest. The minimum enforced by the SDK is **17 280 ledgers ≈ 24 hours** at 5 s/ledger. Never connect to a provider whose manifest sets this below 17 280 — the SDK will throw `KikisAppManifestError` during `openSession`.

---

## Scenario 2: provider rejects the final voucher

The agent calls `session.close()`. The provider's endpoint is reachable but returns a non-2xx response (e.g. `400 Bad Request` or `409 Conflict`) — the voucher signature is considered invalid or the cumulative amount does not match the provider's state.

### What happens

`close()` throws `KikisAppChannelStateError` with the message `Channel close failed: HTTP <status>`. Unlike network errors, 4xx responses are **not retried** by the SDK because they indicate a protocol disagreement, not a transient failure.

### Recovery sequence

```ts
import { KikisAppChannelStateError } from '@kikis-app/kikis-app'

try {
  const result = await session.close()
  console.log('settled:', result.closeTxHash)
} catch (err) {
  if (err instanceof KikisAppChannelStateError) {
    console.warn('Provider rejected close — checking dispute status')

    const status = await session.getDisputeStatus()

    if (status === 'settled') {
      // Provider already settled on-chain with a prior voucher — no action needed
      console.log('Channel already settled on-chain by provider')
      return
    }

    // The agent holds a valid signed voucher. If the provider is acting in bad
    // faith by refusing to accept it, the agent can settle unilaterally.
    console.log('Settling on-chain with latest signed voucher')
    const settleTxHash = await session.settleWithLatestVoucher()
    console.log('settled on-chain:', settleTxHash)
  }
}
```

### Expected on-chain outcome

`settleWithLatestVoucher()` calls `settle_with_signature` directly from the agent side using the highest voucher the agent has signed. The contract verifies the ed25519 signature and releases funds: provider receives the cumulative amount, agent receives the remainder.

> **Note:** `settleWithLatestVoucher()` can only be called while the channel is still `open`. If the provider has already called `settle_with_signature` on-chain (status `settled`), the contract will reject the duplicate and the call will throw `KikisAppDisputeError`.

---

## Scenario 3: channel timeout / refund window expiry

The agent opened a refund window (either as recovery from Scenario 1 or because the session was abandoned) and the `refund_waiting_period_ledgers` have elapsed without the provider settling.

### What happens

`getDisputeStatus()` returns `'refundable'`. The SDK does not automatically claim the refund — the agent must do it explicitly because claiming requires the agent's account to sign and submit an on-chain transaction.

### Recovery sequence

```ts
const status = await session.getDisputeStatus()

if (status === 'refundable') {
  console.log('Refund window expired — claiming refund from contract')

  // claim_refund is not yet wrapped in SessionHandle; call via Stellar SDK directly
  const { rpc, Contract, TransactionBuilder, BASE_FEE, Keypair, Networks } =
    await import('@stellar/stellar-sdk')

  const server = new rpc.Server('https://mainnet.sorobanrpc.com') // or testnet RPC
  const contract = new Contract(session.channelId)
  const agentKeypair = Keypair.fromSecret(process.env.AGENT_SECRET!)
  const networkPassphrase = Networks.PUBLIC // or Networks.TESTNET

  const account = await server.getAccount(agentKeypair.publicKey())
  const tx = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase,
  })
    .addOperation(contract.call('claim_refund'))
    .setTimeout(30)
    .build()

  const prepared = await server.prepareTransaction(tx)
  prepared.sign(agentKeypair)
  const result = await server.sendTransaction(prepared)

  console.log('Refund claimed, tx hash:', result.hash)
}
```

### Expected on-chain outcome

`claim_refund` transfers the full remaining channel balance back to the agent's funding address. The channel moves to `settled`. The provider receives nothing for unredeemed vouchers.

### Monitoring recommendation

For long-running production agents, poll `getDisputeStatus()` on a schedule (e.g. every 1 000 ledgers ≈ 

/* … truncated 6561 chars — edit only what you need near the top … */
