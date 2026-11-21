KikisApp's dashboard — a Next.js app that reads session, voucher and settlement data from Supabase.

## Getting Started

Needs Node 22 or newer.

```bash
pnpm install                                   # from the repo root
pnpm --filter @kikis-app/nulth-sdk build       # lib/dashboardMetrics.ts imports it
cp apps/web/.env.example apps/web/.env.local
pnpm --filter web dev
```

Open [http://localhost:3000/dashboard](http://localhost:3000/dashboard) with your browser to see the result. `.env.example` ships the public testnet Supabase project, so a plain copy gives a working dashboard with no further setup.

```bash
pnpm --filter web test
```

## Deploy

This app runs on Cloudflare Workers via the [OpenNext](https://opennext.js.org/cloudflare) adapter. Config lives in `wrangler.jsonc` and `open-next.config.ts`.

Run these from the repository root. `preview` and `deploy` are scripts in the `web` package, so they must be filtered to it — a bare `pnpm deploy` would hit pnpm's built-in `deploy` command instead.

```bash
pnpm --filter web preview   # build + run the Worker locally
pnpm --filter web deploy    # build + deploy to Cloudflare
```

Equivalently, `cd apps/web` first and run `pnpm preview` / `pnpm deploy` there.

`deploy` needs `CLOUDFLARE_API_TOKEN` in the environment.
