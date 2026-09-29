import assert from 'node:assert/strict'
import test from 'node:test'

import { generatedForMinor, matrixCacheKey, planCacheWrite } from './cache.ts'
import type { CacheEntry } from './cache.ts'

const MAX = 307_200

/**
 * @param {string} key 缓存键
 * @param {number} bytes 字节
 * @param {number} writtenAt 落盘时间
 * @returns {CacheEntry} 一份缓存条目
 */
function entry(key: string, bytes: number, writtenAt: number): CacheEntry {
  return { key, bytes, writtenAt }
}

test('the cache key is generatedFor minor x channel x matrix major', () => {
  assert.equal(generatedForMinor('0.2.0-rc.1'), '0.2')
  assert.equal(matrixCacheKey({ generatedFor: '0.2.0-rc.1', channel: 'rc', matrixMajor: 1 }), '0.2-rc-v1')
  assert.equal(matrixCacheKey({ generatedFor: '0.2.1', channel: 'stable', matrixMajor: '2' }), '0.2-stable-v2')
})

test('a harness patch bump does not mint a new key', () => {
  assert.equal(
    matrixCacheKey({ generatedFor: '0.2.1', channel: 'rc', matrixMajor: 1 }),
    matrixCacheKey({ generatedFor: '0.2.0', channel: 'rc', matrixMajor: 1 }),
  )
})

test('an oversized matrix is rejected whole and keeps the previous copy', () => {
  const decision = planCacheWrite({ incoming: entry('0.2-rc-v1', MAX + 1, 3), existing: [entry('0.1-rc-v1', 1_000, 1)], maxCacheBytes: MAX, retain: 2 })
  assert.equal(decision.action, 'reject-oversize')
  assert.deepEqual(decision.keep, ['0.1-rc-v1'])
  assert.deepEqual(decision.evict, [])
})

test('the byte budget wins over the requested number of copies', () => {
  const decision = planCacheWrite({
    incoming: entry('0.2-rc-v1', 200_000, 3),
    existing: [entry('0.1-rc-v1', 120_000, 2), entry('0.0-rc-v1', 50_000, 1)],
    maxCacheBytes: MAX,
    retain: 2,
  })
  assert.equal(decision.action, 'write')
  assert.deepEqual(decision.keep, ['0.2-rc-v1'])
  assert.deepEqual(decision.evict, ['0.1-rc-v1', '0.0-rc-v1'])
})

test('within budget it keeps current and previous only, newest first', () => {
  const decision = planCacheWrite({
    incoming: entry('0.2-rc-v1', 10_000, 4),
    existing: [entry('0.1-rc-v1', 20_000, 1), entry('0.1.5-rc-v1', 15_000, 3), entry('0.0-rc-v1', 5_000, 2)],
    maxCacheBytes: MAX,
    retain: 2,
  })
  assert.deepEqual(decision.keep, ['0.2-rc-v1', '0.1.5-rc-v1'])
  assert.deepEqual(decision.evict, ['0.1-rc-v1', '0.0-rc-v1'])
})

test('re-fetching the same key does not evict the previous copy twice', () => {
  const decision = planCacheWrite({ incoming: entry('0.2-rc-v1', 1_000, 9), existing: [entry('0.2-rc-v1', 1_000, 1), entry('0.1-rc-v1', 1_000, 2)], maxCacheBytes: MAX, retain: 2 })
  assert.deepEqual(decision.keep, ['0.2-rc-v1', '0.1-rc-v1'])
  assert.deepEqual(decision.evict, [])
})
