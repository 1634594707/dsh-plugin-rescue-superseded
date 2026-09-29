/**
 * 把「文件里读到的事实」分成方案 §2 的失效类别,并附上矩阵里已验证的修法(如果有)。
 *
 * 分类只依据已经证明的东西:peer 范围与已装 runtime 的比较、bundle 是否装上、补丁层是否显式禁用。
 * 矩阵没有对应记录时就如实说「无已验证修法」—— 证据不唯一就不指认(§6 决策 3)。
 */

import { FIX_KIND_CONTRACT, harnessCovers } from '../matrix/schema.ts'
import type { MatrixDocument, MatrixRecord } from '../matrix/schema.ts'
import type { FixOffer, PluginDiagnosis } from '../report/render.ts'
import type { ProfileSnapshot } from './profile.ts'
import type { Evaluation } from './peers.ts'

/**
 * @param matrix 已校验的矩阵,可为空(读不到就是没有已知修法)
 * @param plugin 包名
 * @param runtime 当前 runtime 精确版本
 * @returns 覆盖该 runtime 且指向这个包的记录
 */
function matchRecord(matrix: MatrixDocument | null, plugin: string, runtime: string | null): MatrixRecord | undefined {
  if (!matrix || runtime === null) return undefined
  return matrix.records.find((record) => record.plugin.name === plugin && harnessCovers(runtime, record.harness))
}

/**
 * @param range 一条 peer 范围
 * @returns 折叠后的写法:`a || b || c` 收成 `a … c`,免得一行报告被七个版本号撑爆
 */
function foldRange(range: string): string {
  const parts = range.split('||').map((part) => part.trim()).filter((part) => part !== '')
  if (parts.length < 3) return range
  return `${parts[0]} … ${parts[parts.length - 1]}`
}

/**
 * @param plugin 包名
 * @param version 包版本
 * @param gaps 不满足的 peer
 * @param runtime 已装 runtime 版本
 * @returns 一行根因,最多点出两个 peer,其余给个数
 */
function describeGaps(plugin: string, version: string, gaps: readonly { peer: string; range: string; installed: string | null }[], runtime: string | null): string {
  const listed = gaps.slice(0, 2).map((gap) => `${gap.peer.replace('@deepseek-ai/dsh-', '')} 要 ${foldRange(gap.range)},已装 ${gap.installed ?? '未装'}`).join(';')
  const rest = gaps.length > 2 ? `;另 ${gaps.length - 2} 个同类` : ''
  return `${plugin}@${version} 的 peer 范围不覆盖本机 runtime ${runtime ?? '未识别'}:${listed}${rest}`
}

const ALLOW_OFFER: FixOffer = { kind: 'allow', label: 'F0 显式豁免该精确版本', restartRequired: false, consent: FIX_KIND_CONTRACT.allow.consent }
const GUIDE_OFFER: FixOffer = { kind: 'manual', label: 'F4 让作者放宽 peer 范围', restartRequired: false, consent: FIX_KIND_CONTRACT.manual.consent }

/**
 * @param snapshot profile 读取结果
 * @param evaluation peer 评估结果
 * @param matrix 矩阵
 * @returns 每个受影响插件一行的诊断,已按确定性顺序交给渲染层
 */
export function classify(snapshot: ProfileSnapshot, evaluation: Evaluation, matrix: MatrixDocument | null): PluginDiagnosis[] {
  const diagnoses: PluginDiagnosis[] = []

  for (const verdict of evaluation.blocked) {
    const record = matchRecord(matrix, verdict.plugin, evaluation.runtimeVersion)
    diagnoses.push({
      plugin: verdict.plugin,
      version: verdict.version,
      state: 'DISABLED',
      rootCause: describeGaps(verdict.plugin, verdict.version, verdict.gaps, evaluation.runtimeVersion),
      failureId: 'peer-range-stale',
      ...(verdict.uninstalledPeers.length > 0 ? { excluded: `放宽 peer 也救不了:${verdict.uninstalledPeers.map((gap) => gap.peer).join(', ')} 本机没装` } : {}),
      ...(verdict.unparsable.length > 0 ? { excluded: `${verdict.unparsable.length} 个 peer 范围写法解析不了(${verdict.unparsable.map((gap) => `${gap.peer}: ${gap.range}`).join(', ')})` } : {}),
      ...(record ? { matrixId: record.id, confidence: record.confidence, ...(record.verifiedOn ? { verifiedOn: record.verifiedOn } : {}) } : {}),
      fixes: [GUIDE_OFFER, ALLOW_OFFER],
    })
  }

  for (const verdict of evaluation.exempted) {
    diagnoses.push({
      plugin: verdict.plugin,
      version: verdict.version,
      state: 'ACTIVE',
      rootCause: `已写豁免并放行(豁免只解锁预检,不改变运行时行为)`,
      failureId: 'peer-range-stale',
    })
  }

  for (const bundle of evaluation.missingBundles) {
    diagnoses.push({ plugin: bundle, version: '未安装', state: 'FAILED', rootCause: `声明在 dsh.profile.bundles 里,但在 profile、profiles、home 三级 node_modules 都没解析到该包`, failureId: 'bundle-skipped' })
  }

  const installedNames = new Set(snapshot.installed.map((entry) => entry.name))
  for (const row of snapshot.patchRows) {
    if (row.disabled !== true) continue
    const targetsInstalled = row.name !== undefined && installedNames.has(row.name)
    diagnoses.push({
      plugin: row.name ?? row.id,
      version: targetsInstalled ? snapshot.installed.find((entry) => entry.name === row.name)?.version ?? '' : '(按行 id)',
      state: 'DISABLED',
      rootCause: `profile 补丁层的行 ${row.id} 被显式 disabled`,
      failureId: 'bundle-skipped',
      fixes: [{ kind: 'config-patch', label: '该行被 profile 显式禁用', restartRequired: false, consent: FIX_KIND_CONTRACT['config-patch'].consent, rowId: row.id }],
    })
  }

  return diagnoses
}
