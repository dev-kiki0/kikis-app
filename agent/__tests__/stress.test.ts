import assert from 'node:assert/strict'
import { test } from 'node:test'
import { sanitizeSecrets } from '../src/sanitize-secrets.js'

test('sanitizes testnet and dummy Stellar secret keys', () => {
  const testnetKey = `S${'A'.repeat(55)}`
  const dummyKey = `S${'Z'.repeat(55)}`
  const sanitized = sanitizeSecrets(`testnet=${testnetKey} dummy=${dummyKey}`)

  assert.equal(sanitized, 'testnet=S***... dummy=S***...')
  assert.ok(!sanitized.includes(testnetKey))
  assert.ok(!sanitized.includes(dummyKey))
})

test('does not redact strings that are not 56-character Stellar secrets', () => {
  const shortKey = `S${'A'.repeat(54)}`
  const extendedKey = `S${'A'.repeat(56)}`

  assert.equal(sanitizeSecrets(`${shortKey} ${extendedKey}`), `${shortKey} ${extendedKey}`)
})