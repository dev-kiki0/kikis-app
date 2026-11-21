import { defineConfig } from 'tsup'
import { entries } from './scripts/build-entries.js'

export default defineConfig({
  entry: Object.fromEntries(entries),
  format: ['cjs', 'esm'],
  dts: false,
  clean: false,
  splitting: false,
  sourcemap: false,
  treeshake: true,
  external: [
    '@cfworker/json-schema',
    '@kikis-app/nulth-sdk',
    '@stellar/mpp',
    '@stellar/stellar-sdk',
    '@supabase/supabase-js',
    '@x402/core',
    '@x402/stellar',
    'mppx',
    'react',
    'react-dom',
    'express',
    'fastify',
    'hono',
  ],
})
