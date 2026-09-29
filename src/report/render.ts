/**
 * 诊断报告的确定性渲染(§5.2)。
 *
 * 候选插件、候选修法一律显式排序:同一份日志里同时提到多个包时取集合迭代的第一个,会让两次
 * 诊断给出不同文案,而「定位率」这类度量在不可复现的输出上无法计算(阶段 2 的验收项
 * 「同一 profile 连跑两次,报告逐字节相同」即由这里保证)。
 */

import type { Confidence, FixKind, MatrixChannel } from '../matrix/schema.ts'

/** 一个可执行的修法条目。 */
export interface FixOffer {
  readonly kind: FixKind
  readonly label: string
  readonly restartRequired: boolean
  readonly consent: 'none' | 'preview' | 'strong'
  /** `config-patch` 指向的补丁层行 id,给消费方(壳)直接发起改动用。 */
  readonly rowId?: string
}

/** 一个插件的诊断结论。 */
export interface PluginDiagnosis {
  readonly plugin: string
  readonly version: string
  readonly state: 'ACTIVE' | 'PENDING' | 'FAILED' | 'DISABLED'
  readonly rootCause: string
  readonly failureId?: string
  readonly excluded?: string
  readonly matrixId?: string
  readonly confidence?: Confidence
  readonly verifiedOn?: string
  readonly fixes?: readonly FixOffer[]
}

/** 一次报告的上下文。 */
export interface DiagnosisReportInput {
  readonly profile: string
  readonly runtime: string
  readonly channel: MatrixChannel
  readonly matrixAvailable: boolean
  readonly offlineCopy: string
  readonly plugins: readonly PluginDiagnosis[]
}

const MARK: Readonly<Record<PluginDiagnosis['state'], string>> = {
  ACTIVE: '✓ 已激活',
  PENDING: '✗ PENDING',
  FAILED: '✗ 加载失败',
  DISABLED: '✗ 被预检禁用',
}

/** 动作一律短写;被修的对象由 `FixOffer.label` 带出来,免得两处说同一件事。 */
const FIX_ACTION: Readonly<Record<FixKind, string>> = {
  allow: '[写入 compatibility.json]',
  'config-patch': '[按行 id 整值覆盖]',
  patch: '[安装]',
  manual: '[查看]',
}

/**
 * 报告内插件行的先后:矩阵记录 id 升序,无 id 的排最后,同 id 按包名与版本。
 *
 * @param a 一条诊断
 * @param b 另一条诊断
 * @returns 排序比较结果
 */
export function compareDiagnosis(a: PluginDiagnosis, b: PluginDiagnosis): number {
  const left = a.matrixId ?? ''
  const right = b.matrixId ?? ''
  if (!left !== !right) return left ? -1 : 1
  return left.localeCompare(right) || a.plugin.localeCompare(b.plugin) || a.version.localeCompare(b.version)
}

/**
 * 渲染报告全文。
 *
 * @param input 上下文与未排序的诊断集合
 * @returns 多行文本;矩阵取不到时「可用修复」一栏换成 `offlineCopy`,F4 仍然列出
 */
export function renderDiagnosisReport(input: DiagnosisReportInput): string {
  const lines: string[] = [`插件诊断报告(profile: ${input.profile},harness ${input.runtime},证据通道: ${input.channel})`]
  const ordered = [...input.plugins].sort(compareDiagnosis)
  for (const item of ordered) {
    lines.push(`  ${item.plugin} ${item.version}   ${MARK[item.state]}`)
    lines.push(`    根因: ${item.rootCause}${item.failureId ? ` —— ${item.failureId}` : ''}`)
    if (item.excluded !== undefined) lines.push(`    排除: ${item.excluded}`)
    if (item.matrixId !== undefined) {
      const evidence = item.confidence === undefined ? '' : `(confidence: ${item.confidence}${item.verifiedOn ? `,verifiedOn ${item.verifiedOn}` : ''})`
      lines.push(`    匹配矩阵: ${item.matrixId}${evidence}`)
    }
    if (!input.matrixAvailable) lines.push(`    可用修复: ${input.offlineCopy}`)
    else {
      const fixes = [...(item.fixes ?? [])].sort((a, b) => a.kind.localeCompare(b.kind) || a.label.localeCompare(b.label))
      if (fixes.length === 0) lines.push('    可用修复: — 无可用自动修法')
      else {
        fixes.forEach((fix, index) => {
          const prefix = index === 0 ? '    可用修复:' : '              |'
          const heat = fix.kind === 'patch' ? (fix.restartRequired ? ' → 需重启' : ' → 可热生效') : ''
          lines.push(`${prefix} ${fix.label} ${FIX_ACTION[fix.kind]}${heat}`)
        })
      }
    }
  }
  return `${lines.join('\n')}\n`
}
