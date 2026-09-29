import assert from 'node:assert/strict'
import test from 'node:test'

import {
  attemptKey,
  beginIntent,
  confirmApplied,
  emptyState,
  isConcurrentEdit,
  isDegradedToManual,
  isIgnored,
  loadState,
  MAX_FIX_ATTEMPTS,
  planRestore,
  recordFixFailure,
  renderUndoNote,
  STATE_SCHEMA,
} from './store.ts'
import type { AppliedRecord, IntentRecord } from './store.ts'

const intent: IntentRecord = {
  matrixId: 'BRK-2026-0142',
  plugin: '@community/foo-tools',
  harness: '0.2.0-rc.1',
  fixKind: 'patch',
  target: '@dsh-rescue/patch-foo-legacy@^1.0.0',
  before: { kind: 'patch', dependencies: { '@community/foo-tools': '1.4.2' }, bundles: ['dsh-headless'] },
  touched: [{ path: '/p/package.json', mtimeMs: 1, sha256: 'aaa' }],
  startedAt: '2026-09-29T03:00:00.000Z',
}

test('a state file from an unknown schema is read-only', () => {
  const loaded = loadState({ schema: 'rescue.state/v0', applied: [intent], intents: [], ignored: [], failedAttempts: {} })
  assert.equal(loaded.mode, 'read-only')
  assert.ok(loaded.mode === 'read-only' && loaded.reason.includes('upgrade @dsh-rescue/rescue'))
  assert.equal(loadState({}).mode, 'read-only')
  assert.equal(loadState({ schema: STATE_SCHEMA }).mode, 'read-write')
})

test('v1 carries no field the implementation has not landed', () => {
  assert.deepEqual(Object.keys(emptyState()).sort(), ['applied', 'failedAttempts', 'ignored', 'intents', 'schema'])
  assert.equal(emptyState().schema, STATE_SCHEMA)
})

test('the intent is the record before the user file moves', () => {
  const withIntent = beginIntent(emptyState(), intent)
  assert.deepEqual(withIntent.intents, [intent])
  const applied = confirmApplied(withIntent, intent, ['/p/cordis.patch.yml.bak-20260929T030000Z'], '2026-09-29T03:00:05.000Z')
  assert.deepEqual(applied.intents, [])
  assert.equal(applied.applied.length, 1)
  assert.equal(applied.applied[0]?.matrixId, 'BRK-2026-0142')
})

test('diagnosis never spends the retry budget; failed fixes do', () => {
  assert.equal(attemptKey(intent), '@community/foo-tools@0.2.0-rc.1#patch')
  let state = emptyState()
  for (let i = 0; i < MAX_FIX_ATTEMPTS; i++) {
    const attempt = { ...intent, startedAt: `t${i}` }
    state = recordFixFailure(beginIntent(state, attempt), attempt)
  }
  assert.equal(state.intents.length, 0)
  assert.equal(state.failedAttempts[attemptKey(intent)], MAX_FIX_ATTEMPTS)
  assert.equal(isDegradedToManual(state, intent), true)
  assert.equal(isDegradedToManual(recordFixFailure(emptyState(), intent), intent), false)
})

test('a missing backup stops the restore instead of guessing the original', () => {
  const record: AppliedRecord = { matrixId: intent.matrixId, plugin: intent.plugin, harness: intent.harness, fixKind: 'config-patch', target: intent.target, before: { kind: 'config-patch', rowText: '- id: a\n', backupPath: '/b' }, backupPaths: ['/b'], appliedAt: 'now' }
  assert.deepEqual(planRestore(record, []), { action: 'backup-missing', missing: ['/b'] })
  assert.deepEqual(planRestore(record, ['/b']), { action: 'restore-backup', missing: [] })
  // F1 的逐字节等价只由 `.bak` 保证,结构化行文本不算备份
  assert.equal(planRestore({ ...record, backupPaths: [] }, []).action, 'backup-missing')
  // F0 与 F2 把原值记在 before 里,无备份也能写回
  assert.equal(planRestore({ ...record, before: { kind: 'allow', priorEntry: null }, backupPaths: [] }, []).action, 'restore-before')
  assert.equal(planRestore({ ...record, before: { kind: 'manual' }, backupPaths: [] }, []).action, 'restore-before')
})

test('concurrent edits are caught by mtime or content hash', () => {
  const expected = { path: '/p/cordis.patch.yml', mtimeMs: 10, sha256: 'aaa' }
  assert.equal(isConcurrentEdit(expected, { ...expected, mtimeMs: 11 }), true)
  assert.equal(isConcurrentEdit(expected, { ...expected, sha256: 'bbb' }), true)
  assert.equal(isConcurrentEdit(expected, expected), false)
})

test('ignored findings stay ignored for that plugin and harness only', () => {
  const state = { ...emptyState(), ignored: [{ plugin: '@community/foo-tools', harness: '0.2.0-rc.1', reason: 'user deferred', notedAt: 'now' }] }
  assert.equal(isIgnored(state, '@community/foo-tools', '0.2.0-rc.1'), true)
  assert.equal(isIgnored(state, '@community/foo-tools', '0.2.1'), false)
})

test('undo.md names the file, the original value and the manual step', () => {
  const applied: AppliedRecord = { matrixId: intent.matrixId, plugin: intent.plugin, harness: intent.harness, fixKind: 'patch', target: intent.target, before: intent.before, backupPaths: ['/b'], appliedAt: '2026-09-29T03:00:05.000Z' }
  const note = renderUndoNote(applied)
  assert.match(note, /安装前 dsh\.profile\.bundles: dsh-headless/)
  assert.match(note, /BRK-2026-0142/)
  assert.match(note, /手动还原/)
  assert.match(note, /不要猜测原值/)
  assert.match(renderUndoNote({ ...applied, before: { kind: 'allow', priorEntry: null } }), /原本不存在该条目/)
  assert.match(renderUndoNote({ ...applied, before: { kind: 'config-patch', rowText: '- id: a\n  config:\n    keep: 1\n', backupPath: '/b' } }), /被覆盖的行原文/)
})
