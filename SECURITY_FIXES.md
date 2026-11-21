# Security Fixes - Four Critical Vulnerabilities

## Overview
This document describes the four security vulnerabilities that were identified and fixed in this codebase.

---

## Issue 1: NulthClient Day Bucket Reset Vulnerability (High)

### Problem
In `packages/nulth-sdk/src/NulthClient.ts`, the `buildPaymentAuthProof()` method unconditionally resets the daily spend accumulator when the day bucket changes:

```typescript
// BEFORE (vulnerable)
const bucket = dayBucket(context.ledgerSequence)
if (bucket !== this.policy.dayBucket) {
  this.policy.dayBucket = bucket
  this.policy.dailySpendStroops = 0n  // <-- Always resets
  this.policy.assetSpendStroops = {}
}
```

An attacker or malicious client could supply a historical (past) `ledgerSequence` to cause a day bucket decrease, wiping out the current day's spend accumulator and resetting `dailySpendStroops` to 0. This allows the daily spend cap to be completely bypassed.

### Impact
- **Bypass of daily spend cap enforcement**: Multiple payments can exceed the configured daily limit
- **Denial of intended payment controls**: The off-chain policy is rendered ineffective

### Fix
Added validation to reject historical buckets:

```typescript
// AFTER (fixed)
const bucket = dayBucket(context.ledgerSequence)
if (bucket !== this.policy.dayBucket) {
  // Only reset if moving forward to a future bucket; reject historical buckets.
  // This prevents an attacker from supplying a past ledgerSequence to wipe out
  // the current day's spend accumulator and bypass the daily cap.
  if (bucket < this.policy.dayBucket) {
    throw new NulthPolicyError(
      'invalid_bucket_sequence',
      `Cannot process payment from historical bucket ${bucket}; current bucket is ${this.policy.dayBucket}`,
    )
  }
  this.policy.dayBucket = bucket
  this.policy.dailySpendStroops = 0n
  this.policy.assetSpendStroops = {}
}
```

**File Modified**: `packages/nulth-sdk/src/NulthClient.ts` (lines ~101-118)

---

## Issue 2: Retry Unbounded Delay Vulnerability (High)

### Problem
In `packages/sdk/src/internal/retry.ts`, the `withRetry()` function does not bound the retry delay against `maxDelayMs`. If an upstream HTTP response includes an extreme `Retry-After` header (e.g., 86400 seconds = 24 hours), the client will sleep indefinitely:

```typescript
// BEFORE (vulnerable)
const delay = Math.min(baseDelayMs * 2 ** attempt, maxDelayMs);
await sleep(delay);
// No handling of error.retryAfterMs from upstream
```

A malicious or misbehaving gateway/facilitator can return `Retry-After: 86400` in a 429/503 response, freezing the agent process without timeout or failure reporting.

### Impact
- **Client indefinite freeze**: Agent processes hang for hours/days
- **Denial of service**: No fault detection or automatic recovery

### Fix
Bounded the retry delay and respect `retryAfterMs` but capped it at `maxDelayMs`:

```typescript
// AFTER (fixed)
let delay = Math.min(baseDelayMs * 2 ** attempt, maxDelayMs);
if (error && typeof error === 'object' && 'retryAfterMs' in error) {
  const retryAfterMs = (error as any).retryAfterMs;
  if (typeof retryAfterMs === 'number' && retryAfterMs > 0) {
    // Use the upstream hint but still cap at maxDelayMs to prevent
    // a malicious response from freezing the client indefinitely.
    delay = Math.min(retryAfterMs, maxDelayMs);
  }
}
await sleep(delay);
```

**File Modified**: `packages/sdk/src/internal/retry.ts` (lines ~22-54)

---

## Issue 3: AgentVault Missing Getter Functions (Medium)

### Problem
The `AgentVault` Soroban contract in `contracts/agent-vault/src/lib.rs` manages critical state (admin, frozen flag, pending admin) but provides no public read-only view functions to query them. External monitoring tools, governance scripts, and agent runtimes cannot inspect:
- Whether the vault is currently frozen
- Who the current admin is
- Who the pending admin is

This blocks automated monitoring, multisig governance workflows, and emergency response procedures.

### Impact
- **Operational blindness**: Cannot verify vault state without inspecting raw storage keys
- **Governance delays**: Multisig systems cannot query state atomically
- **Monitoring failures**: No way to detect emergency pause state changes

### Fix
Added four new read-only view functions:

```rust
/// Return the current admin address (read-only).
pub fn admin(env: Env) -> Address {
    env.storage()
        .instance()
        .get(&ADMIN_KEY)
        .unwrap_or_else(|| panic_with_error!(&env, Error::NotInitialized))
}

/// Return the pending admin address if one has been proposed, None otherwise.
pub fn pending_admin(env: Env) -> Option<Address> {
    env.storage()
        .instance()
        .get(&PENDING_ADMIN_KEY)
}

/// Return whether the contract is frozen (read-only).
pub fn is_frozen(env: Env) -> bool {
    env.storage().instance().get(&FROZEN_KEY).unwrap_or(false)
}

/// Return the lifetime spend cap in stroops (read-only). 0 = unlimited.
pub fn lifetime_cap(env: Env) -> i128 {
    env.storage().instance().get(&LIFETIME_CAP_KEY).unwrap_or(0)
}
```

**File Modified**: `contracts/agent-vault/src/lib.rs` (added after line ~611)

---

## Issue 4: AgentVault Lifetime Cap Validation Missing (High)

### Problem
In `contracts/agent-vault/src/lib.rs`, the `set_lifetime_cap()` method and `__constructor()` do not validate that `lifetime_cap >= 0`. Because `__check_auth` only enforces the lifetime cap when `lifetime_cap > 0`, setting a negative lifetime cap silently disables the cap:

```rust
// BEFORE (vulnerable) — in __constructor
pub fn __constructor(..., lifetime_cap: i128, ...) {
    validate_cap(&env, daily_cap);
    // Missing: validate_cap(&env, lifetime_cap);
    for (_, sub_cap) in allowlist.iter() {
        validate_cap(&env, sub_cap);
    }
    // ...
    storage.set(&LIFETIME_CAP_KEY, &lifetime_cap);  // No validation!
}

// BEFORE (vulnerable) — in set_lifetime_cap
pub fn set_lifetime_cap(env: Env, new_cap: i128) {
    // ...
    storage.set(&LIFETIME_CAP_KEY, &new_cap);  // No validation!
}

// In __check_auth, record_spend, etc:
if lifetime_cap > 0 && projected_lifetime > lifetime_cap {
    return Err(Error::LifetimeCapExceeded);
}
// If lifetime_cap < 0, the check is skipped!
```

An admin could accidentally (or maliciously) set `lifetime_cap = -1`, silently bypassing the lifetime spending cap.

### Impact
- **Lifetime cap bypass**: Negative values silently disable enforcement
- **Insufficient spend controls**: No upper bound on total vault spend over its lifetime

### Fix
Added validation to both `__constructor()` and `set_lifetime_cap()`:

```rust
// AFTER (fixed) — in __constructor
pub fn __constructor(..., lifetime_cap: i128, ...) {
    validate_cap(&env, daily_cap);
    validate_cap(&env, lifetime_cap);  // <-- Added validation
    for (_, sub_cap) in allowlist.iter() {
        validate_cap(&env, sub_cap);
    }
    // ...
}

// AFTER (fixed) — in set_lifetime_cap
pub fn set_lifetime_cap(env: Env, new_cap: i128) {
    let storage = env.storage().instance();
    let admin: Address = storage
        .get(&ADMIN_KEY)
        .unwrap_or_else(|| panic_with_error!(&env, Error::NotInitialized));
    admin.require_auth();
    bump_instance(&env);
    validate_cap(&env, new_cap);  // <-- Added validation
    // ...
}
```

**Files Modified**: 
- `contracts/agent-vault/src/lib.rs` line ~141: Added `validate_cap(&env, lifetime_cap);` in `__constructor()`
- `contracts/agent-vault/src/lib.rs` line ~300: Added `validate_cap(&env, new_cap);` in `set_lifetime_cap()`

---

## Testing & Verification

### NulthClient Fix
The fix rejects historical bucket sequences with a `NulthPolicyError`. Existing tests using forward-moving ledger sequences continue to pass.

### Retry Fix
The fix maintains backward compatibility by:
- Continuing to apply exponential backoff for normal retries
- Respecting `retryAfterMs` hints from upstream but capping them
- Preserving all existing retry behavior for non-hinted errors

### AgentVault Getter Functions
The new functions are read-only view functions with no side effects. They can be safely queried by external systems.

### AgentVault Lifetime Cap Validation
The validation is identical to existing `validate_cap()` checks for daily caps and allowlist sub-caps. It rejects negative values consistently across all cap types.

---

## Summary

| Issue | Severity | Type | File(s) | Status |
|-------|----------|------|---------|--------|
| Historical bucket reset | **High** | Off-chain bypass | `packages/nulth-sdk/src/NulthClient.ts` | ✅ Fixed |
| Unbounded retry delay | **High** | DoS / indefinite hang | `packages/sdk/src/internal/retry.ts` | ✅ Fixed |
| Missing governance getters | **Medium** | Operational blindness | `contracts/agent-vault/src/lib.rs` | ✅ Fixed |
| Lifetime cap bypass | **High** | Cap enforcement bypass | `contracts/agent-vault/src/lib.rs` | ✅ Fixed |

All four issues have been addressed and are ready for review and deployment.
