import assert from 'node:assert/strict'
import test from 'node:test'

import { compareDiagnosis, renderDiagnosisReport } from '../src/report/render.ts'
import type { DiagnosisReportInput, PluginDiagnosis } from '../src/report/render.ts'

const foo: PluginDiagnosis = {
  plugin: '@community/foo-tools',
  version: '1.4.2',
  state: 'PENDING',
  rootCause: '等待服务 ctx.fooLegacy,当前树无提供者',
  failureId: 'service-key-removed',
  excluded: '同名服务存在于其他 isolate label —— 未命中',
  matrixId: 'BRK-2026-0142',
  confidence: 'verified',
  verifiedOn: '0.2.0-rc.1',
  fixes: [
    { kind: 'manual', label: 'F4 迁移指南', restartRequired: false, consent: 'none' },
    { kind: 'patch', label: '@dsh-rescue/patch-foo-legacy@^1.0.0', restartRequired: false, consent: 'strong' },
  ],
}

const bar: PluginDiagnosis = {
  plugin: '@community/bar-tools',
  version: '2.0.0',
  state: 'DISABLED',
  rootCause: '预检按 peer 范围拦截',
  failureId: 'false-block',
  matrixId: 'BRK-2026-0087',
  confidence: 'verified',
  verifiedOn: '0.2.0-rc.1',
  fixes: [{ kind: 'allow', label: '有依据豁免', restartRequired: false, consent: 'strong' }],
}

const observed: PluginDiagnosis = { plugin: '@community/unknown', version: '0.1.0', state: 'FAILED', rootCause: 'import 失败,无矩阵可比对' }

/**
 * @param {readonly PluginDiagnosis[]} plugins 诊断集合
 * @returns {DiagnosisReportInput} 在线报告上下文
 */
function online(plugins: readonly PluginDiagnosis[]): DiagnosisReportInput {
  return { profile: 'default', runtime: '0.2.0-rc.1', channel: 'rc', matrixAvailable: true, offlineCopy: '需要联网获取修复建议 —— 离线不是插件没坏', plugins }
}

test('the report is byte-identical across runs on the same profile', () => {
  const once = renderDiagnosisReport(online([foo, bar, observed]))
  const twice = renderDiagnosisReport(online([observed, bar, foo]))
  assert.equal(once, twice)
  assert.equal(compareDiagnosis(observed, foo), 1)
})

test('a matched record shows its evidence and the exclusion line', () => {
  const report = renderDiagnosisReport(online([foo]))
  assert.match(report, /BRK-2026-0142\(confidence: verified,verifiedOn 0\.2\.0-rc\.1\)/)
  assert.match(report, /排除: 同名服务存在于其他 isolate label/)
  assert.match(report, /→ 可热生效/)
})

test('no automatic fix is its own state, not a missing row', () => {
  const report = renderDiagnosisReport(online([{ ...bar, matrixId: 'BRK-2026-0099', fixes: [] }]))
  assert.match(report, /— 无可用自动修法/)
})

test('offline keeps the root cause and says the matrix is what is missing', () => {
  const report = renderDiagnosisReport({ ...online([foo]), matrixAvailable: false })
  assert.match(report, /等待服务 ctx\.fooLegacy/)
  assert.match(report, /需要联网获取修复建议 —— 离线不是插件没坏/)
  assert.ok(!report.includes('安装]'))
})

test('a restart-required patch is never advertised as hot', () => {
  const report = renderDiagnosisReport(online([{ ...foo, fixes: [{ ...foo.fixes![1]!, restartRequired: true }] }]))
  assert.match(report, /→ 需重启/)
})
