import assert from 'node:assert/strict'
import test from 'node:test'

import { DEFAULT_SUMMARY_MAX_CHARS, redactErrorSummary } from './redact.ts'

test('a windows path and an inline key never reach the card', () => {
  const raw = 'Cannot resolve C:\\Users\\alice\\AppData\\Roaming\\dsh\\profiles\\default\\node_modules\\@community\\foo\\lib\\index.js (api_key=sk-notarealkeyxxxxxxxx)'
  const result = redactErrorSummary(raw)
  assert.ok(!result.text.includes('alice'))
  assert.ok(!result.text.includes('sk-notarealkeyxxxxxxxx'))
  assert.match(result.text, /\[path\]/)
  assert.match(result.text, /\[credential\]\)/)
  assert.ok(result.removed.length >= 2)
})

test('posix homes, UNC shares and bearer tokens are all filtered', () => {
  for (const raw of [
    'failed at /home/bob/.dsh/profiles/default/cordis.patch.yml',
    'read from \\\\fileserver\\team\\dsh\\profile.json',
    'request rejected: Authorization: Bearer abcdefghijklmnop',
  ]) {
    const result = redactErrorSummary(raw)
    assert.ok(!raw.split(' ').some((token) => token.startsWith('/home/') && result.text.includes('/home/bob')), raw)
    assert.ok(result.removed.length > 0, raw)
  }
})

test('the removed list is sorted so two runs give one evidence trail', () => {
  const raw = 'key=secretA then /home/zed/x then key=secretB'
  const first = redactErrorSummary(raw)
  const second = redactErrorSummary(raw)
  assert.deepEqual(first.removed, [...first.removed].sort())
  assert.equal(first.text, second.text)
  assert.deepEqual(first.removed, second.removed)
})

test('long summaries truncate and say so', () => {
  const result = redactErrorSummary('x'.repeat(DEFAULT_SUMMARY_MAX_CHARS + 100))
  assert.equal(result.truncated, true)
  assert.equal(result.text.length, DEFAULT_SUMMARY_MAX_CHARS)
  assert.equal(redactErrorSummary('short note').truncated, false)
  assert.equal(redactErrorSummary('y'.repeat(200), { maxChars: 50 }).text.length, 50)
})
