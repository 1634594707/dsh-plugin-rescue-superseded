/**
 * PR 材料的判据:peer 追加或分支、真实消失的符号不猜映射、以及"工具不动别人仓库"这条边界。
 */

import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { peerDiff, proposePeers, repoSlug, writePrDraft } from '../src/fix/pr.ts'
import type { DiagnosticBundle } from '../src/analyze/why.ts'

const TARGET = '0.2.0-rc.1'

/**
 * @param overrides 覆盖诊断包的个别字段
 * @returns 一份最小可用的诊断包
 */
function bundle(overrides: Partial<DiagnosticBundle> = {}): DiagnosticBundle {
  return {
    schema: 'rescue.diagnostic/v1',
    generatedAt: '2026-09-29T07:00:00.000Z',
    profile: 'default',
    runtime: { installed: '0.1.7-rc.2', target: TARGET },
    plugin: { name: '@someone/dsh-broken', version: '1.2.0', files: 7 },
    peer: {
      verdict: 'blocked',
      ranges: { '@deepseek-ai/dsh-session': '0.1.0-rc.8 || 0.1.6-alpha.2', '@deepseek-ai/dsh-settings': '>=0.1.0' },
      gaps: ['@deepseek-ai/dsh-session 要 0.1.0-rc.8 || 0.1.6-alpha.2,已装 0.1.7-rc.2'],
    },
    serviceKeys: [{ key: 'webServer', status: 'found-nowhere' }],
    gaps: [],
    surfaces: [{ specifier: '@deepseek-ai/dsh-session', oldVersion: '0.1.7-rc.2', newVersion: TARGET, oldSymbols: 35, newSymbols: 36 }],
    notes: [],
    ...overrides,
  }
}

const PACKAGE_JSON = '{\n  "name": "@someone/dsh-broken",\n  "version": "1.2.0",\n  "peerDependencies": {\n    "@deepseek-ai/dsh-session": "0.1.0-rc.8 || 0.1.6-alpha.2",\n    "@deepseek-ai/dsh-settings": ">=0.1.0"\n  }\n}\n'

test('a failing peer gets an added or-branch, a passing peer is left alone', () => {
  const proposals = proposePeers({ '@deepseek-ai/dsh-session': '0.1.0-rc.8 || 0.1.6-alpha.2', '@deepseek-ai/dsh-settings': '>=0.1.0' }, TARGET, ['@deepseek-ai/dsh-session 要 x,已装 0.1.7-rc.2'])
  const session = proposals.find((item) => item.peer === '@deepseek-ai/dsh-session')
  const settings = proposals.find((item) => item.peer === '@deepseek-ai/dsh-settings')
  assert.ok(session?.proposed?.includes('|| >=0.2.0-0 <0.3.0'), '追加版本线,且下界带 -0 才放行 rc')
  assert.equal(settings?.proposed, null, '本来就满足的不许动')
})

test('the rc trap: a caret range would still be blocked, so the proposal carries a -0 lower bound', () => {
  const [proposal] = proposePeers({ '@deepseek-ai/dsh-x': '^0.1.0' }, TARGET, ['@deepseek-ai/dsh-x 要 ^0.1.0,已装 0.1.7-rc.2'])
  assert.ok(String(proposal?.proposed).includes('-0 <'), '实测 ^0.2.0 不放行 0.2.0-rc.1')
  assert.ok(!String(proposal?.proposed).includes('^0.2.0'))
})

test('an unparsable range goes to a human instead of being rewritten', () => {
  const [proposal] = proposePeers({ '@deepseek-ai/dsh-x': 'weird-thing' }, TARGET, ['@deepseek-ai/dsh-x 要 weird-thing,已装 0.1.7-rc.2'])
  assert.equal(proposal?.proposed, null)
  assert.match(String(proposal?.reason), /解析不了/)
})

test('the diff locates the exact peer line and shows both sides', () => {
  const proposals = proposePeers({ '@deepseek-ai/dsh-session': '0.1.0-rc.8 || 0.1.6-alpha.2' }, TARGET, ['@deepseek-ai/dsh-session 要 x,已装 0.1.7-rc.2'])
  const diff = peerDiff(PACKAGE_JSON, proposals)
  assert.match(diff, /^- .*0\.1\.0-rc\.8 \|\| 0\.1\.6-alpha\.2/m)
  assert.match(diff, /^\+ .* \|\| >=0\.2\.0-0 <0\.3\.0/m)
  assert.match(diff, /建议:@deepseek-ai\/dsh-session/)
})

test('a missing peer line in the manifest is reported, not silently skipped', () => {
  const proposals = proposePeers({ '@deepseek-ai/dsh-gone': '^0.1.0' }, TARGET, ['@deepseek-ai/dsh-gone 要 ^0.1.0,已装 0.1.7-rc.2'])
  assert.match(peerDiff(PACKAGE_JSON, proposals), /未能在 package\.json 里定位/)
})

test('removed symbols switch the draft from peer-widen to an adapter skeleton that refuses to guess', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-rescue-pr-'))
  const withGap = bundle({ gaps: [{ specifier: '@deepseek-ai/dsh-session', symbol: 'sessionDir', inOld: true, inNew: false, candidates: ['sessionPath'], status: 'removed' }] })
  const draft = await writePrDraft(withGap, PACKAGE_JSON, 'https://github.com/someone/dsh-broken', path.join(dir, 'draft'))
  assert.equal(draft.kind, 'needs-adapter')
  const skeleton = await fs.readFile(path.join(draft.dir, 'adapter-skeleton.js'), 'utf8')
  assert.match(skeleton, /TODO @deepseek-ai\/dsh-session 的 sessionDir \(候选:sessionPath\)/)
  assert.match(skeleton, /不替你实现/)
  assert.match(draft.ghCommand ?? '', /gh pr create --repo someone\/dsh-broken/)
  await fs.rm(dir, { recursive: true, force: true })
})

test('repository URLs of every npm shape reduce to owner/repo', () => {
  assert.equal(repoSlug('git+https://github.com/MichengAI/dsh-archive-manager.git'), 'MichengAI/dsh-archive-manager')
  assert.equal(repoSlug('git@github.com:o/r.git'), 'o/r')
  assert.equal(repoSlug('https://github.com/o/r'), 'o/r')
  assert.equal(repoSlug('https://gitlab.com/o/r'), null, '不是 GitHub 就不生成 gh 命令')
  assert.equal(repoSlug(null), null)
})

test('with nothing to widen, the draft still ships the diagnostic package and says so', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-rescue-pr-'))
  const clean = bundle({ peer: { verdict: 'compatible', ranges: { '@deepseek-ai/dsh-settings': '>=0.1.0' }, gaps: [] } })
  const draft = await writePrDraft(clean, PACKAGE_JSON, null, path.join(dir, 'draft'))
  assert.equal(draft.kind, 'no-action')
  assert.ok(draft.files.includes('diagnostic.json'))
  assert.equal(draft.ghCommand, null)
  assert.match(draft.notes.join(' '), /仓库地址/)
  await fs.rm(dir, { recursive: true, force: true })
})
