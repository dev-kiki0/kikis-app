# @kikis-app/mcp-server

Model Context Protocol (MCP) server for KikisApp Stellar payments. Exposes KikisApp's payment functionality as standardized tools that LLM agents can use directly.

## Overview

This MCP server implements the thesis that base payment infrastructure should be built for machines, not humans. Instead of requiring every LLM agent to implement the full KikisApp SDK, agents can simply connect to this MCP server and use standardized tools:

- `pay_for_data(url, max_amount)` - Pay for a single data request
- `open_session(url)` - Open a sustained MPP session for streaming
- `stream_session(channel_id)` - Pull streamed data from an open session
- `close_session(channel_id)` - Settle and close an open session
- `check_balance()` - Check wallet balance
- `list_providers(tags)` - Discover available providers

## Installation

```bash
npm install -g @kikis-app/mcp-server
```

Or build from source:

```bash
cd packages/mcp-server
pnpm install
pnpm build
```

## Configuration

For security, it is highly recommended to store your secrets in an external `.env` file rather than inline in the Claude Desktop configuration.

Create a `.env` file (e.g., `~/.kikis-app/.env`):

```bash
# Required
STELLAR_SECRET="SDU5..."  # Use a dedicated low-balance testnet key for safety
STELLAR_NETWORK="testnet"  # or "mainnet"
KIKIS_APP_DAILY_CAP="1.00" # Required: Maximum daily spend in USDC

# Optional (for session mode)
COMMITMENT_SECRET="S..."  # Ed25519 secret for channel commitments

# Optional (for provider registry)
SUPABASE_URL="https://..."
# Note: Use the anon key (anon + public_read_providers RLS is sufficient). Do NOT use the service-role key.
SUPABASE_KEY="..."
```

### Environment Variables

| Variable | Required | Unit / Notes |
| --- | --- | --- |
| `STELLAR_SECRET` | Yes | Stellar secret key (`S...`). Use a dedicated low-balance testnet key for safety. |
| `STELLAR_NETWORK` | Yes | `testnet` or `mainnet`. |
| `KIKIS_APP_DAILY_CAP` | Yes | Maximum daily spend in **USDC**, as a decimal string (e.g. `"1.00"`). The server exits with status 1 at startup if this is unset. |
| `COMMITMENT_SECRET` | No | Ed25519 secret for channel commitments (session mode). |
| `SUPABASE_URL` | No | Provider registry URL. |
| `SUPABASE_KEY` | No | Provider registry anon key (not the service-role key). |

## Available Tools

### pay_for_data

Pay for a single data request from a KikisApp provider. Automatically selects the best payment mode.

**Parameters:**
- `url` (required): Full URL of the provider endpoint
- `max_amount` (required): Maximum USDC amount to pay
- `preferred_mode` (optional): Preferred payment mode (`x402`, `mpp-charge`, `mpp-session`)

**Returns:** Payment result with mode, amount, transaction hash, and response data

### open_session

Open a sustained MPP session for streaming data. Requires `COMMITMENT_SECRET`. KikisApp channels
are pre-deployed and funded out-of-band before the agent runs, so `initial_deposit` is a safety
check against the provider's `min_deposit`, not a fund transfer. Pass the returned `channel_id` to
`stream_session` and `close_session` — the channel's collateral cannot be settled otherwise.

**Parameters:**
- `url` (required): Full URL of the provider's streaming endpoint — include the stream route, not just the base URL. For Provider B this is `https://api-b.kikis-app.xyz/stream/orderbook` (see its manifest `endpoints.stream.path`). The URL is forwarded to the SDK as-is, so custom provider paths are preserved.
- `initial_deposit` (optional): Amount in USDC you intend the channel to be funded with

**Returns:** `channel_id` and open transaction hash

### stream_session

Pull the next batch of streamed responses from a session opened with `open_session`. Each message
sends a voucher and waits for the provider's response.

**Parameters:**
- `channel_id` (required): The `channel_id` returned by `open_session`
- `max_messages` (optional): Maximum number of messages to pull in this call (1 to 50, default 1)

**Returns:** The pulled messages. If a voucher fails partway through the batch (local spend cap
reached, provider 4xx/5xx), the call still returns `isError: true` with the messages that were
already paid for, plus `count` and `stats`, instead of discarding the batch.

### close_session

Close a session opened with `open_session`, settling the channel on-chain with the highest signed
voucher. Required to release the session's locked collateral.

**Parameters:**
- `channel_id` (required): The `channel_id` returned by `open_session`

**Returns:** Close transaction hash, total amount paid, and vouchers issued

### check_balance

Check the Stellar wallet balance for the configured account.

**Parameters:**
- `asset_code` (optional): Asset code to check (e.g., "USDC")
- `asset_issuer` (optional): Asset issuer address for non-native assets

**Returns:** Balance information for the specified asset

### list_providers

List available KikisApp providers from the registry. Requires Supabase credentials.

**Parameters:**
- `tags` (optional): Comma-separated tags for filtering (e.g., "price,stellar,dex")
- `network` (optional): Filter by network (`testnet` or `mainnet`)

**Returns:** List of matching providers with their capabilities

## Claude Desktop Configuration

Add this to your Claude Desktop config file:

**macOS:** `~/Library/Application Support/Claude/claude_desktop_config.json`
**Windows:** `%APPDATA%\Claude\claude_desktop_config.json`

```json
{
  "mcpServers": {
    "kikis-app": {
      "command": "node",
      "args": ["/path/to/@kikis-app/mcp-server/dist/index.js"],
      "env": {
        "KIKIS_APP_ENV_FILE": "/absolute/path/to/your/.env"
      }
    }
  }
}
```

If you prefer to supply the environment inline instead of via `KIKIS_APP_ENV_FILE`, `KIKIS_APP_DAILY_CAP` is still required — the server exits with status 1 at startup when it is unset:

```json
{
  "mcpServers": {
    "kikis-app": {
      "command": "node",
      "args": ["/path/to/@kikis-app/mcp-server/dist/index.js"],
      "env": {
        "STELLAR_SECRET": "S...",
        "STELLAR_NETWORK": "testnet",
        "KIKIS_APP_DAILY_CAP": "1.00",
        "COMMITMENT_SECRET": "S...",
        "SUPABASE_URL": "https://...",
        "SUPABASE_KEY": "..."
      }
    }
  }
}
```

## Example Usage

Once configured, you can ask Claude to:

> "Check my Stellar balance"
> "List providers that offer price data"
> "Pay for data from https://api-a.kikis-app.xyz/price with a max of 0.01 USDC"
> "Open a session with https://api-b.kikis-app.xyz/stream/orderbook for streaming orderbook data"
> "Pull the next few messages from that session"
> "Close the session and settle the channel"

## Development

```bash
# Install dependencies
pnpm install

# Build
pnpm build

# Watch mode
pnpm dev

# Type check
pnpm typecheck

# Run directly
pnpm start
```

## Architecture

The MCP server wraps the existing `@kikis-app/kikis-app` SDK and exposes its functionality through the Model Context Protocol. This allows any MCP-compatible LLM client (Claude Desktop, etc.) to interact with Stellar payments without implementing the SDK directly.

```
LLM Agent → MCP Protocol → @kikis-app/mcp-server → @kikis-app/kikis-app SDK → Stellar Network
```

## License

MIT
