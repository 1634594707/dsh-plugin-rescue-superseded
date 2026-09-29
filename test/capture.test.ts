/**
 * 症状解析:`capture` 的判据面。文本全部取自 2026-09-29 用 dsh `0.2.0-rc.1` 真启动的实测输出。
 */

import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { parseReport, parseStartupOutput, renderSymptoms, runCapture } from '../src/analyze/capture.ts'

/** 真启动实测到的输出:peer 已放行,但条目卡在等一个本 profile 没有的 provider。 */
const REAL_PENDING = [
  'dsh: warning: 1 entry did not activate',
  'ui-workspace-archive-manager (@michengai/dsh-archive-manager): pending (waiting for service: webServer)',
  '',
  'dsh: MISSING_CREDENTIAL: llm-deepseek: no API key for provider route "deepseek-official"',
  '',
].join('\n')

test('a pending entry becomes a symptom with the service it waits for', () => {
  const parsed = parseStartupOutput(REAL_PENDING)
  assert.equal(parsed.entries.length, 1)
  const [entry] = parsed.entries
  assert.equal(entry?.module, '@michengai/dsh-archive-manager')
  assert.equal(entry?.entryId, 'ui-workspace-archive-manager')
  assert.equal(entry?.state, 'pending')
  assert.deepEqual(entry?.missingServices, ['webServer'])
  assert.equal(parsed.reportPath, null, '可选条目未激活不写 startup 报告,这是实测出来的')
})

test('a hard failure with its own error line is captured too', () => {
  const parsed = parseStartupOutput('some-row (@a/b): failed - Cannot find package "@deepseek-ai/dsh-gone" imported from x.js\n')
  assert.equal(parsed.entries[0]?.state, 'failed')
  assert.match(String(parsed.entries[0]?.detail), /Cannot find package/)
})

test('the report table and the Full diagnostics path are both read', () => {
  const report = [
    'Plugins waiting for services (2):',
    '  Plugin                      Missing services',
    '  @community/foo-tools        fooLegacy',
    '  @community/bar-tools        barLegacy, bazKey',
    '',
  ].join('\n')
  const entries = parseReport(report)
  assert.deepEqual(entries.map((entry) => `${entry.module}:${entry.missingServices.join('+')}`), ['@community/foo-tools:fooLegacy', '@community/bar-tools:barLegacy+bazKey'])
  const withPath = parseStartupOutput(`@a/b (@x/y): pending (waiting for service: k)\nFull diagnostics: ${path.join('C:', 'tmp', 'startup-2026-09-29.log')}\n`)
  assert.equal(path.basename(String(withPath.reportPath)), 'startup-2026-09-29.log')
})

test('runCapture launches a command, applies the timeout, and says what it saw', async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-rescue-capture-'))
  const symptoms = await runCapture({
    home,
    profile: 'rehearsal',
    command: process.execPath,
    extraArgs: ['-e', 'console.log(process.argv[1])', 'ui-workspace-archive-manager (@michengai/dsh-archive-manager): pending (waiting for service: webServer)'],
    prompt: '',
    timeoutMs: 20_000,
  })
  assert.equal(symptoms.schema, 'rescue.symptoms/v1')
  assert.equal(symptoms.profile, 'rehearsal')
  assert.deepEqual(symptoms.entries.map((entry) => entry.missingServices[0]), ['webServer'])
  assert.equal(symptoms.exitCode, 0)
  assert.match(renderSymptoms(symptoms), /PENDING 等待服务:webServer/)
  fs.rmSync(home, { recursive: true, force: true })
})

test('a command that cannot start is reported, not swallowed', async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-rescue-capture-'))
  const symptoms = await runCapture({ home, profile: 'x', command: 'definitely-not-a-real-binary-xyz', extraArgs: [], prompt: '', timeoutMs: 5000 })
  assert.equal(symptoms.exitCode, null)
  assert.ok(symptoms.notes.some((note) => /起不动/.test(note)), `实际 notes:${symptoms.notes.join(' | ')}`)
  fs.rmSync(home, { recursive: true, force: true })
})
