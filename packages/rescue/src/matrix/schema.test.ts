import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import { assertMatrixDocument, fixEligibility, harnessCovers, MATRIX_SCHEMA, MatrixValidationError, FAILURE_VOCABULARY } from './schema.ts'
import type { MatrixDocument } from './schema.ts'

const seedPath = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../../matrix/data/0.2-rc.json')
const seedText = fs.readFileSync(seedPath, 'utf8')
const seed = JSON.parse(seedText) as MatrixDocument

/**
 * 改一份文档里的某条记录,用于反证。
 *
 * @param index 记录下标
 * @param changes 要覆盖的字段
 * @param deletes 要删掉的字段
 * @returns 未定型对象,正好走校验器的 `unknown` 入口
 */
function patched(index: number, changes: Record<string, unknown> = {}, deletes: readonly string[] = []): Record<string, unknown> {
  const doc = JSON.parse(seedText) as { records: Record<string, unknown>[] }
  const record = doc.records[index]
  if (!record) throw new Error(`seed has no record #${index}`)
  Object.assign(record, changes)
  for (const key of deletes) delete record[key]
  return doc
}

/**
 * @param raw 一份矩阵文档
 * @returns 校验问题清单
 */
function problemsFor(raw: unknown): string[] {
  try {
    assertMatrixDocument(raw)
    return []
  } catch (error) {
    assert.ok(error instanceof MatrixValidationError)
    return [...error.problems]
  }
}

test('ships a seed document that satisfies its own contract', () => {
  assert.equal(seed.schema, MATRIX_SCHEMA)
  assert.deepEqual(problemsFor(JSON.parse(seedText)), [])
  assert.equal(seed.records.length, 5)
})

test('rejects vocabulary drift instead of admitting prose', () => {
  assert.match(problemsFor(patched(1, { failure: 'service-key-removed-maybe' })).join('\n'), /not in the controlled vocabulary/)
  assert.match(problemsFor(patched(3, { fix: { kind: 'codemod', ref: '@dsh-rescue/patch-foo-legacy@^1.0.0' } })).join('\n'), /fix\.kind must be/)
  assert.match(problemsFor(patched(0, { reason: '自由文本' })).join('\n'), /unknown field "reason"/)
  assert.match(problemsFor(patched(3, { fix: { kind: 'patch', ref: '@dsh-rescue/patch-foo-legacy@^1.0.0', codemodTarget: 'src' } })).join('\n'), /unknown field "codemodTarget"/)
})

test('requires the evidence each confidence level promises', () => {
  assert.match(problemsFor(patched(1, {}, ['runLogId'])).join('\n'), /confidence "verified" requires runLogId/)
  assert.match(problemsFor(patched(1, { confidence: 'reported', reporter: 'forum user 42' })).join('\n'), /requires reviewState/)
  assert.match(problemsFor(patched(2, { confidence: 'inferred' }, ['typesDiffRefs'])).join('\n'), /requires typesDiffRefs/)
})

test('a patch record carries the four prerequisites and a restart verdict', () => {
  assert.match(problemsFor(patched(3, {}, ['requires'])).join('\n'), /requires the four prerequisites/)
  assert.match(problemsFor(patched(3, {}, ['restartRequired'])).join('\n'), /requires restartRequired/)
  assert.match(problemsFor(patched(3, { requires: { hmrEnabled: true, moduleResolves: true } })).join('\n'), /requires\.preflightPasses must be a boolean/)
  assert.match(problemsFor(patched(2, { requires: { hmrEnabled: true, moduleResolves: true, preflightPasses: true, injectSatisfiable: true } })).join('\n'), /requires only applies to fix\.kind patch/)
  assert.match(problemsFor(patched(2, { fix: { kind: 'config-patch', ref: 'x' } })).join('\n'), /fix\.ref only applies to fix\.kind patch/)
})

test('refuses an automatic fix for a category that is not auto-fixable', () => {
  const term = FAILURE_VOCABULARY.find((entry) => entry.id === 'peer-range-stale')
  assert.ok(term && !term.autoFixable)
  assert.match(problemsFor(patched(1, { failure: 'peer-range-stale' })).join('\n'), /not auto-fixable, so fix\.kind must be manual/)
  assert.match(problemsFor(patched(0, { fix: { kind: 'allow' } })).join('\n'), /works record offers no automatic fix/)
})

test('duplicate ids and empty record sets are rejected', () => {
  assert.match(problemsFor(patched(1, { id: 'BRK-2026-0142' })).join('\n'), /duplicate id/)
  assert.match(problemsFor(patched(0, { id: 'broken-format' })).join('\n'), /must match BRK-YYYY-NNNN/)
  assert.match(problemsFor({ ...JSON.parse(seedText), records: [] }).join('\n'), /records must be a non-empty array/)
})

test('an unknown schema version is refused, not downgraded', () => {
  assert.match(problemsFor({ ...JSON.parse(seedText), schema: 'rescue.matrix/v3' }).join('\n'), /unsupported schema/)
  assert.match(problemsFor({ ...JSON.parse(seedText), extra: 'x' }).join('\n'), /unknown field "extra"/)
})

test('the offline contract states what the user loses and what stays', () => {
  const doc = JSON.parse(seedText) as { delivery: { offline: unknown } }
  assert.match(problemsFor({ ...doc, delivery: { ...(doc.delivery as object), offline: { degradeTo: ['D1', 'D9'] } } }).join('\n'), /degradeTo must list detectors/)
  assert.match(problemsFor({ ...doc, delivery: { ...(doc.delivery as object), oversizePolicy: 'truncate' } }).join('\n'), /oversizePolicy must be reject-and-keep-previous/)
})

test('range covering follows the gate semantics the harness uses', () => {
  assert.equal(harnessCovers('0.2.0-rc.1', '>=0.2.0 <0.3.0'), true)
  assert.equal(harnessCovers('0.3.0', '>=0.2.0 <0.3.0'), false)
  assert.equal(harnessCovers('0.2.1', '>=0.2.0 <0.3.0'), true)
  assert.equal(harnessCovers('0.2.0', '0.2.0'), false)
  assert.equal(harnessCovers('weird', '>=0.2.0 <0.3.0'), false)
})

test('a superseded record sends the user to the upgrade instead of the patch', () => {
  const works = seed.records.find((item) => item.id === 'OK-2026-0004')
  assert.ok(works)
  assert.deepEqual(fixEligibility(works, '0.2.0-rc.1'), { eligible: false, reason: 'no-failure' })
  const superseded = seed.records.find((item) => item.id === 'BRK-2026-0155')
  assert.ok(superseded)
  assert.deepEqual(fixEligibility(superseded, '0.2.0-rc.1'), { eligible: false, reason: 'superseded' })
  const patch = seed.records.find((item) => item.id === 'BRK-2026-0142')
  assert.ok(patch)
  assert.deepEqual(fixEligibility(patch, '0.2.0-rc.1'), { eligible: true, reason: 'ok' })
  assert.equal(fixEligibility(patch, '0.9.0').reason, 'no-runtime-overlap')
  const allow = seed.records.find((item) => item.id === 'BRK-2026-0087')
  assert.ok(allow)
  assert.equal(fixEligibility(allow, '0.2.0-rc.1').eligible, true)
})
