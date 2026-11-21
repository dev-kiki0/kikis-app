# Agent Vault Contract

The Agent Vault is a Soroban smart contract that holds USDC for an autonomous agent and enforces spending policy on every outbound payment. It is the on-chain enforcement layer for the agent treasury.

## Overview

- **Vault owner** deposits and withdraws USDC, and configures policy.
- **Agent** (a separate authorized address) can only move funds through `pay`, which is checked against the configured policy.
- **Payees** receive USDC directly from the vault.

All amounts are denominated in USDC stroops (`i128`).

## Policy

Every `pay` call is validated against the following policies, in order:

1. **Global Daily Cap** — total spend per day bucket must not exceed the configured daily cap.
2. **Lifetime Cap** — total lifetime spend must not exceed the configured lifetime cap.
3. **Per-Payee Cap** — total spend to a single payee must not exceed the configured per-payee cap.
4. **Allowlist** — if an allowlist is configured, the payee must be on it.

### Cap semantics and zero values

Daily and lifetime caps use **different** zero-value conventions. Operator tooling must not treat them interchangeably.

| Cap | Stored value | Meaning |
| --- | --- | --- |
| Daily cap (`CAP_KEY`) | unset | Unlimited (defaults to `i128::MAX`) |
| Daily cap (`CAP_KEY`) | `0` | **Literal zero** — no allowance for the day; any positive spend is rejected with `DailyCapExceeded` |
| Daily cap (`CAP_KEY`) | `N > 0` | At most `N` stroops per day bucket |
| Lifetime cap (`LIFETIME_CAP_KEY`) | unset or `0` | Unlimited (sentinel) |
| Lifetime cap (`LIFETIME_CAP_KEY`) | `N > 0` | At most `N` stroops over the vault's lifetime |

A stored daily cap of `0` is **not** an "unlimited" sentinel. `get_remaining_allowance` returns `0` in that case, and `record_spend` rejects any positive amount. To express "no daily cap", leave the daily cap unset (or set it to `i128::MAX`).

## Views

- `get_remaining_allowance()` — USDC still available under the global daily cap for the current day bucket, computed as `max(0, daily_cap - daily_spend)`. A stored daily cap of `0` yields `0` available allowance. Call `daily_cap()` directly to distinguish "no cap configured" from "cap exhausted".
- `daily_cap()` — the stored daily cap value.
- `lifetime_cap()` — the stored lifetime cap value.
- `get_daily_spend()` — total spend recorded in the current day bucket.

## Building and testing

```sh
cargo test --manifest-path contracts/agent-vault/Cargo.toml
```
