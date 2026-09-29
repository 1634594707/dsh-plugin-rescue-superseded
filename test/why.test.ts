/**
 * 依赖面扫描与诊断包:全部用临时 fixture,不联网 —— 面 diff 的另一端需要 npm,归 `--to` 的实机验证。
 */

import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { readPluginFace } from '../src/analyze/imports.ts'
import { buildDiagnostic } from '../src/analyze/why.ts'
import { readProfile } from '../src/analyze/profile.ts'
import { evaluateProfile } from '../src/analyze/peers.ts'

/**
 * @returns 一个装着「钉死 peer 的插件 + 官方 runtime」的临时 home
 */
function makeHome(): string {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-rescue-why-'))
  const profiles = path.join(home, 'profiles')
  const profile = path.join(profiles, 'default')
  const plugin = path.join(profile, 'node_modules', '@someone', 'dsh-broken')
  fs.mkdirSync(path.join(plugin, 'lib'), { recursive: true })
  fs.mkdirSync(path.join(profiles, 'node_modules', '@deepseek-ai', 'dsh-session', 'lib'), { recursive: true })
  fs.writeFileSync(path.join(profiles, 'node_modules', '@deepseek-ai', 'dsh-session', 'package.json'), JSON.stringify({ name: '@deepseek-ai/dsh-session', version: '0.1.7-rc.2', exports: { '.': './lib/index.js' } }))
  fs.writeFileSync(path.join(profiles, 'node_modules', '@deepseek-ai', 'dsh-session', 'lib', 'index.js'), 'export const sessionDir = () => {}\nexport const defineSession = () => {}\n')
  fs.mkdirSync(path.join(profiles, 'node_modules', '@deepseek-ai', 'dsh-app-boot'), { recursive: true })
  fs.writeFileSync(path.join(profiles, 'node_modules', '@deepseek-ai', 'dsh-app-boot', 'package.json'), JSON.stringify({ name: '@deepseek-ai/dsh-app-boot', version: '0.1.7-rc.2' }))
  fs.writeFileSync(path.join(plugin, 'package.json'), JSON.stringify({ name: '@someone/dsh-broken', version: '1.2.0', peerDependencies: { '@deepseek-ai/dsh-session': '0.1.0-rc.8 || 0.1.6-alpha.2' } }))
  fs.writeFileSync(path.join(plugin, 'lib', 'index.js'), [
    'import { sessionDir, defineSession as makeSession } from "@deepseek-ai/dsh-session"',
    'import { notOurs } from "some-other-pkg"',
    'export const inject = ["webServer"]',
    'const inject = ["locale", "remote"]',
    'export function apply(ctx) { return ctx.inject(["uiWorkspace"], () => {}) }',
  ].join('\n'))
  fs.writeFileSync(path.join(profile, 'package.json'), JSON.stringify({ name: 'profile', dsh: { profile: { bundles: ['@someone/dsh-broken'] } }, dependencies: { '@someone/dsh-broken': '1.2.0' } }, null, 2))
  fs.writeFileSync(path.join(profile, 'cordis.patch.yml'), '- id: dsh-broken\n  name: "@someone/dsh-broken"\n')
  return home
}

test('collects only official specifiers, original symbol names, and every inject declaration', async () => {
  const home = makeHome()
  const face = await readPluginFace(path.join(home, 'profiles', 'default', 'node_modules', '@someone', 'dsh-broken'))
  assert.deepEqual(face.imports.map((entry) => entry.specifier), ['@deepseek-ai/dsh-session'])
  assert.deepEqual(face.imports[0]?.symbols, ['defineSession', 'sessionDir'], '`as` 别名要取原名')
  assert.deepEqual(face.injects, ['locale', 'remote', 'webServer'], '插件里多处 inject 都要收到')
  fs.rmSync(home, { recursive: true, force: true })
})

test('the diagnostic package states the peer verdict and refuses to invent a root cause without --to', async () => {
  const home = makeHome()
  const snapshot = readProfile(home, 'default')
  const evaluation = evaluateProfile(snapshot)
  assert.equal(evaluation.blocked.length, 1, 'fixture 插件的 peer 不覆盖已装 runtime')
  const bundle = await buildDiagnostic(snapshot, evaluation, '@someone/dsh-broken', {})
  assert.equal(bundle.schema, 'rescue.diagnostic/v1')
  assert.equal(bundle.peer.verdict, 'blocked')
  assert.match(bundle.peer.gaps[0] ?? '', /dsh-session 要 0\.1\.0-rc\.8 \|\| 0\.1\.6-alpha\.2,已装 0\.1\.7-rc\.2/)
  assert.deepEqual(bundle.gaps, [], '没给 --to 就不该编出版本间消失的符号')
  assert.match(bundle.notes.join(' '), /未给 --to/)
  assert.deepEqual(bundle.surfaces, [])
  fs.rmSync(home, { recursive: true, force: true })
})

test('an unknown plugin name says what did resolve instead of failing silently', async () => {
  const home = makeHome()
  const snapshot = readProfile(home, 'default')
  await assert.rejects(() => buildDiagnostic(snapshot, evaluateProfile(snapshot), '@someone/dsh-nope'), /里没解析到/)
  fs.rmSync(home, { recursive: true, force: true })
})
