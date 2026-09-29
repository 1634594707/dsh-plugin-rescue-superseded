/**
 * 落盘与还原的最小闭环:在临时 profile 上跑 fix 与 undo,判据是**重读后的内容**,不是「没报错」。
 */

import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { createHash } from 'node:crypto'

import { readProfile } from '../src/analyze/profile.ts'
import { main } from '../src/cli.ts'
import { applyExemption, applyRowChange, undoApplied } from '../src/fix/apply.ts'
import { emptyState } from '../src/state/store.ts'
import type { RescueState } from '../src/state/store.ts'

const RUNTIME = '0.1.7-rc.2'
const PLUGIN = '@someone/dsh-broken'

/**
 * 造一个能读的最小 dsh home:共享 runtime 在 `profiles/node_modules`,插件在 profile 自己的 node_modules。
 *
 * @returns 临时 home 绝对路径
 */
function makeHome(): string {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-rescue-home-'))
  const profiles = path.join(home, 'profiles')
  const profile = path.join(profiles, 'default')
  fs.mkdirSync(path.join(profile, 'node_modules', '@someone', 'dsh-broken'), { recursive: true })
  fs.mkdirSync(path.join(profiles, 'node_modules', '@deepseek-ai', 'dsh-app-boot'), { recursive: true })
  fs.mkdirSync(path.join(profiles, 'node_modules', '@deepseek-ai', 'dsh-session'), { recursive: true })
  fs.writeFileSync(path.join(profiles, 'node_modules', '@deepseek-ai', 'dsh-app-boot', 'package.json'), JSON.stringify({ name: '@deepseek-ai/dsh-app-boot', version: RUNTIME }))
  fs.writeFileSync(path.join(profiles, 'node_modules', '@deepseek-ai', 'dsh-session', 'package.json'), JSON.stringify({ name: '@deepseek-ai/dsh-session', version: RUNTIME }))
  fs.writeFileSync(path.join(profile, 'node_modules', '@someone', 'dsh-broken', 'package.json'), JSON.stringify({
    name: PLUGIN,
    version: '1.2.0',
    peerDependencies: { '@deepseek-ai/dsh-session': '>=0.1.0 <0.2.0', '@deepseek-ai/dsh-gone': '^0.1.0' },
  }))
  fs.writeFileSync(path.join(profile, 'package.json'), JSON.stringify({ name: 'profile', dsh: { profile: { bundles: [PLUGIN] } }, dependencies: { [PLUGIN]: '1.2.0' } }, null, 2))
  fs.writeFileSync(path.join(profile, 'cordis.patch.yml'), `# 用户自己的注释,改别人不该动它\n- id: dsh-broken\n  name: "${PLUGIN}"\n  disabled: true\n  config:\n    keep: 1\n- id: untouched\n  config:\n    deep:\n      value: 2\n`)
  return home
}

/**
 * @param file 路径
 * @returns 内容哈希
 */
function hashOf(file: string): string {
  return createHash('sha256').update(fs.readFileSync(file)).digest('hex')
}

test('reads runtime, peers and the patch layer out of a profile directory', () => {
  const home = makeHome()
  const snapshot = readProfile(home, 'default')
  assert.equal(snapshot.runtimeVersion, RUNTIME)
  assert.deepEqual(snapshot.bundles, [PLUGIN])
  assert.deepEqual(snapshot.patchRows.map((row) => row.id), ['dsh-broken', 'untouched'])
  assert.equal(snapshot.patchRows[0]?.disabled, true)
  assert.deepEqual(snapshot.exemptions, {})
  fs.rmSync(home, { recursive: true, force: true })
})

test('F0 writes an exact-version exemption, verifies it, and journals the prior value', async () => {
  const home = makeHome()
  const snapshot = readProfile(home, 'default')
  const result = await applyExemption(snapshot, `${PLUGIN}@1.2.0`, RUNTIME, true, true, emptyState(), { stamp: '2026-09-29T04:00:00.000Z' })
  const target = path.join(snapshot.dir, 'compatibility.json')
  assert.deepEqual(JSON.parse(fs.readFileSync(target, 'utf8')), { [`${PLUGIN}@1.2.0`]: [RUNTIME] })
  assert.match(result.message, /已为 .* 放行/)
  assert.equal(result.state.applied.length, 1)
  assert.equal(result.state.applied[0]?.before.kind, 'allow')
  assert.equal(result.state.applied[0]?.before.priorEntry, null, '原本不存在该条目要记成 null')
  fs.rmSync(home, { recursive: true, force: true })
})

test('F0 refuses to grant without the risk acknowledgement', async () => {
  const home = makeHome()
  const snapshot = readProfile(home, 'default')
  await assert.rejects(() => applyExemption(snapshot, `${PLUGIN}@1.2.0`, RUNTIME, true, false, emptyState()), /--accept-risk/)
  assert.equal(fs.existsSync(path.join(snapshot.dir, 'compatibility.json')), false, '拒绝时不得留下半个文件')
  fs.rmSync(home, { recursive: true, force: true })
})

test('F1 overwrites the targeted row only and keeps the rest of the file byte-identical', async () => {
  const home = makeHome()
  const snapshot = readProfile(home, 'default')
  const target = path.join(snapshot.dir, 'cordis.patch.yml')
  const state: RescueState = emptyState()
  const result = await applyRowChange(snapshot, 'dsh-broken', { disabled: false, config: { keep: 2 } }, state, { stamp: '2026-09-29T04:00:01.000Z' })
  const written = fs.readFileSync(target, 'utf8')
  assert.match(written, /# 用户自己的注释,改别人不该动它/, '未被触碰的注释必须原样留着')
  assert.match(written, /keep: 2/)
  assert.doesNotMatch(written, /disabled: true/)
  assert.match(written, /value: 2/, '别人的行不该被动')
  assert.match(result.message, /已写入/)
  fs.rmSync(home, { recursive: true, force: true })
})

test('undo restores the exact bytes from the .bak, and refuses when the backup is gone', async () => {
  const home = makeHome()
  const snapshot = readProfile(home, 'default')
  const target = path.join(snapshot.dir, 'cordis.patch.yml')
  const original = fs.readFileSync(target, 'utf8')
  const changed = await applyRowChange(snapshot, 'dsh-broken', { disabled: false }, emptyState(), { stamp: '2026-09-29T04:00:02.000Z' })
  assert.notEqual(fs.readFileSync(target, 'utf8'), original)

  const undone = await undoApplied(changed.state, 1, { stamp: '2026-09-29T04:00:03.000Z' })
  assert.equal(fs.readFileSync(target, 'utf8'), original, '还原后逐字节等价')
  assert.equal(hashOf(target), hashOf(undone.target))
  assert.equal(undone.state.applied.length, 0, '还原后不留已应用记录')

  const stale = { ...changed.state, applied: changed.state.applied.map((record) => ({ ...record, backupPaths: [path.join(home, '没了.bak')] })) }
  await assert.rejects(() => undoApplied(stale, 1), /无法还原:备份缺失/)
  fs.rmSync(home, { recursive: true, force: true })
})

test('undo deletes a compatibility.json that this run created, leaving no residue', async () => {
  const home = makeHome()
  const snapshot = readProfile(home, 'default')
  const target = path.join(snapshot.dir, 'compatibility.json')
  assert.equal(fs.existsSync(target), false)
  const granted = await applyExemption(snapshot, `${PLUGIN}@1.2.0`, RUNTIME, true, true, emptyState(), { stamp: '2026-09-29T04:00:04.000Z' })
  assert.equal(granted.state.applied[0]?.created, true, '这次改动创建了文件,必须记下来')
  assert.equal(fs.existsSync(target), true)

  const undone = await undoApplied(granted.state, 1, { stamp: '2026-09-29T04:00:05.000Z' })
  assert.equal(fs.existsSync(target), false, '撤销到空应当删掉自己创建的文件,而不是留一份 {}')
  assert.match(undone.message, /没有留下空文件/)
  fs.rmSync(home, { recursive: true, force: true })
})

test('a journal from an unknown schema blocks every write path instead of guessing', async () => {
  const home = makeHome()
  const snapshot = readProfile(home, 'default')
  fs.mkdirSync(path.dirname(snapshot.statePath), { recursive: true })
  fs.writeFileSync(snapshot.statePath, JSON.stringify({ schema: 'rescue.state/v9' }))
  await assert.rejects(() => main(['undo', '1', '--home', home, '--profile', 'default']), /rescue\.state\/v9/)
  assert.match(fs.readFileSync(path.join(snapshot.dir, 'cordis.patch.yml'), 'utf8'), /disabled: true/, '只读姿态下不得改动用户的补丁层')
  fs.rmSync(home, { recursive: true, force: true })
})
