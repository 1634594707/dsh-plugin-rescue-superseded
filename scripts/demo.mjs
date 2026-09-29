/**
 * 走一遍已落地的 kernel,看现在的实际效果。
 *
 * 演示用的是临时目录里的假 profile 与种子矩阵,**不是真实 dsh 安装**:D1/D2/D6 的宿主读取
 * (evaluatePluginCompatibility、internal/status 订阅、installBundle、setVersionExemption)
 * 还没接线,那些判据要装了 dsh 的 profile 才跑得动(roadmap 阶段 1)。
 */

import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { assertMatrixDocument, FIX_KIND_CONTRACT, harnessCovers, fixEligibility } from '../packages/rescue/src/matrix/schema.ts'
import { matrixCacheKey, planCacheWrite } from '../packages/rescue/src/matrix/cache.ts'
import { redactErrorSummary } from '../packages/rescue/src/report/redact.ts'
import { renderDiagnosisReport } from '../packages/rescue/src/report/render.ts'
import { attemptKey, beginIntent, confirmApplied, emptyState, isDegradedToManual, loadState, planRestore, recordFixFailure, renderUndoNote } from '../packages/rescue/src/state/store.ts'
import { snapshotFile, writeFileAtomically } from '../packages/rescue/src/write/atomic.ts'

/** @param {string} title 小标题 */
function section(title) {
  console.log(`\n\x1b[1m── ${title} ──\x1b[0m`)
}

const seed = JSON.parse(await fs.readFile(new URL('../packages/matrix/data/0.2-rc.json', import.meta.url), 'utf8'))
assertMatrixDocument(seed)

section('1. 矩阵按附录 C 校验通过')
console.log(`schema ${seed.schema} · ${seed.records.length} 条记录 · generatedFor ${seed.meta.generatedFor}`)
for (const record of seed.records) {
  const verdict = fixEligibility(record, '0.2.0-rc.1')
  console.log(`  ${record.id}  ${String(record.fix?.kind ?? '-').padEnd(13)} ${verdict.eligible ? '可自动修' : `不自动修(${verdict.reason})`}`)
}

section('2. 缓存:键与淘汰(字节上限优先、单份超限拒收)')
const key = matrixCacheKey({ generatedFor: '0.2.1', channel: 'rc', matrixMajor: 1 })
console.log(`harness 0.2.0 与 0.2.1 共用键:${matrixCacheKey({ generatedFor: '0.2.0', channel: 'rc', matrixMajor: 1 })} == ${key}`)
const oversize = planCacheWrite({ incoming: { key, bytes: 400_000, writtenAt: 9 }, existing: [{ key: '0.1-rc-v1', bytes: 50_000, writtenAt: 1 }], maxCacheBytes: 307_200, retain: 2 })
console.log(`  单份 400 KB → ${oversize.action}(保留 ${oversize.keep.join(',')},不截断)`)
const tight = planCacheWrite({ incoming: { key, bytes: 200_000, writtenAt: 9 }, existing: [{ key: '0.1-rc-v1', bytes: 150_000, writtenAt: 1 }], maxCacheBytes: 307_200, retain: 2 })
console.log(`  装不下两份 → ${tight.action},淘汰 ${tight.evict.join(',')}(字节上限赢过份数)`)

section('3. F1 整值覆盖:写盘 → 重读确认生效 → 还原逐字节等价')
const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-rescue-demo-'))
const profileFile = path.join(dir, 'cordis.patch.yml')
const original = '- id: multi-model-router\n  name: "@community/multi-model-router"\n  # 用户自己的注释\n  config:\n    routes:\n      - model: deepseek-flash\n'
await fs.writeFile(profileFile, original)
const before = await snapshotFile(profileFile)
const rowText = '  config:\n    routes:\n      - target: deepseek-flash\n'
const intent = {
  matrixId: 'BRK-2026-0119',
  plugin: '@community/multi-model-router',
  harness: '0.2.0-rc.1',
  fixKind: 'config-patch',
  target: profileFile,
  before: { kind: 'config-patch', rowText, backupPath: '' },
  touched: [before],
  startedAt: '2026-09-29T03:00:00.000Z',
}
let state = beginIntent(emptyState(), intent)
const written = await writeFileAtomically(profileFile, original.replace('      - model: deepseek-flash\n', rowText), { stamp: '2026-09-29T03:00:00.001Z' })
intent.before.backupPath = written.backupPath ?? ''
const after = await snapshotFile(profileFile)
const applied = confirmApplied(state, intent, [written.backupPath ?? ''], '2026-09-29T03:00:01.000Z')
const record = applied.applied[0]
assert.ok(written.backupPath)
assert.ok((await fs.readFile(profileFile, 'utf8')).includes('- target: deepseek-flash'), '写入未生效')
console.log(`  写前 mtime/hash 记入 intent:${attemptKey(intent)}`)
console.log(`  备份:${path.basename(written.backupPath)}`)
console.log(`  重读确认生效:是(§5.3.1 第 6 条:没报错不等于生效)`)
console.log(`  并发检测:写前重读同一文件 → ${after.sha256 === before.sha256 ? '误报' : '判定已被改动'}(hash 变了)`)

const restored = await writeFileAtomically(profileFile, original, { stamp: '2026-09-29T03:00:02.000Z' })
const backToOriginal = await fs.readFile(profileFile, 'utf8')
const plan = planRestore({ ...record, backupPaths: [written.backupPath] }, [written.backupPath])
console.log(`  还原判据:${plan.action};还原后与原文逐字节等价:${backToOriginal === original}`)
console.log(`  第二次写的备份:${path.basename(restored.backupPath)}`)

section('4. 备份缺失时不猜(§5.3.1 第 5 条)')
const missing = planRestore(record, [])
console.log(`  ${missing.action}${missing.missing.length ? ` —— 读不到:${path.basename(missing.missing[0])}` : ''}`)
console.log(renderUndoNote(record).split('\n').slice(0, 6).map((line) => `  ${line}`).join('\n'))

section('5. 状态文件版本不认识就只读不写')
const loaded = loadState({ schema: 'rescue.state/v0', applied: [record] })
console.log(`  mode=${loaded.mode} · ${loaded.reason}`)

section('6. 重试预算:只在修复失败时计数,三次后降级 F4')
let budget = emptyState()
for (let i = 1; i <= 3; i++) {
  const attempt = { ...intent, startedAt: `t${i}` }
  budget = recordFixFailure(beginIntent(budget, attempt), attempt)
  console.log(`  第 ${i} 次失败 → 计数 ${budget.failedAttempts[attemptKey(attempt)]} · 降级=${isDegradedToManual(budget, attempt)}`)
}

section('7. 诊断报告:确定性排序 + 离线只丢「分类与修法」')
const plugins = [
  {
    plugin: '@community/foo-tools',
    version: '1.4.2',
    state: 'PENDING',
    rootCause: '等待服务 ctx.fooLegacy,当前树无提供者',
    failureId: 'service-key-removed',
    excluded: '同名服务存在于其他 isolate label —— 未命中',
    matrixId: 'BRK-2026-0142',
    confidence: 'inferred',
    fixes: [
      { kind: 'manual', label: 'F4 迁移指南', restartRequired: false, consent: FIX_KIND_CONTRACT.manual.consent },
      { kind: 'patch', label: '@dsh-rescue/patch-foo-legacy@^1.0.0', restartRequired: false, consent: FIX_KIND_CONTRACT.patch.consent },
    ],
  },
  {
    plugin: '@community/quick-notify',
    version: '1.2.0',
    state: 'DISABLED',
    rootCause: '预检按 peer 范围拦截,矩阵确认该区间实测兼容',
    failureId: 'false-block',
    matrixId: 'BRK-2026-0087',
    confidence: 'verified',
    fixes: [{ kind: 'allow', label: 'F0 有依据豁免', restartRequired: false, consent: FIX_KIND_CONTRACT.allow.consent }],
  },
]
const base = { profile: 'default', runtime: '0.2.0-rc.1', channel: 'rc', offlineCopy: seed.delivery.offline.uiCopy }
const online = renderDiagnosisReport({ ...base, matrixAvailable: true, plugins })
console.log(online.split('\n').map((line) => `  ${line}`).join('\n'))
const shuffled = renderDiagnosisReport({ ...base, matrixAvailable: true, plugins: [...plugins].reverse() })
console.log(`  乱序输入两次输出是否逐字节相同:${online === shuffled}`)
const offline = renderDiagnosisReport({ ...base, matrixAvailable: false, plugins })
console.log(offline.split('\n').filter((line) => line.includes('可用修复')).map((line) => `  ${line.trim()}`).join('\n'))

section('8. 渲染前过滤(读官方 startup-*.log 之后、进卡片之前)')
const rawLine = 'Error: cannot resolve C:\\Users\\alice\\AppData\\Roaming\\dsh\\profiles\\default\\node_modules\\@community\\foo\\lib\\index.js (api_key=sk-notarealkeyxxxxxxxx)'
const filtered = redactErrorSummary(rawLine)
console.log(`  原文:${rawLine}`)
console.log(`  卡片:${filtered.text}`)
console.log(`  被剔除 ${filtered.removed.length} 项:${filtered.removed.map((item) => item.slice(0, 28)).join(' | ')}`)

section('9. 区间判定只认带比较符的写法(fail loud)')
console.log(`  ">=0.2.0 <0.3.0" 对 0.2.0-rc.1 → ${harnessCovers('0.2.0-rc.1', '>=0.2.0 <0.3.0')}`)
console.log(`  裸写 "0.2.0" → ${harnessCovers('0.2.0', '0.2.0')}(roadmap 不符项 g)`)

await fs.rm(dir, { recursive: true, force: true })
console.log('\n临时 profile 已清理。宿主耦合面(D1/D2/D6、installBundle、setVersionExemption)未接线,见 roadmap 阶段 1。')
