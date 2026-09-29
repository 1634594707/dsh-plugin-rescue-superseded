/**
 * rescue 的状态文件 `rescue.state/v1`(§5.3、§5.3.1)。
 *
 * 状态文件记录**意图与还原所需的原值**,用户层的文件才是「当前配置」的唯一事实来源。
 * v1 不落任何未实现字段 —— 带着占位字段的快照会让还原静默丢东西。
 */

import type { FixKind } from '../matrix/schema.ts'

/** 状态文件的 schema 标识。 */
export const STATE_SCHEMA = 'rescue.state/v1'

/** 同一目标的自动尝试上限(§3.2):只在修复动作失败时计数,达上限降级为 F4。 */
export const MAX_FIX_ATTEMPTS = 3

/** 一个文件的并发检测材料(§5.3.1 第 4 条)。 */
export interface FileSnapshot {
  readonly path: string
  readonly mtimeMs: number
  readonly sha256: string
}

/** 还原所需的原值,按修法取值(§5.3 的表)。 */
export type BeforeValue =
  | { readonly kind: 'config-patch'; readonly rowText: string; readonly backupPath: string }
  | { readonly kind: 'allow'; readonly key: string; readonly priorEntry: string | null }
  | { readonly kind: 'patch'; readonly dependencies: Readonly<Record<string, string>>; readonly bundles: readonly string[] }
  | { readonly kind: 'manual' }

/** 已落盘但未过复检的意图(§5.3.1 第 1 条)。 */
export interface IntentRecord {
  readonly matrixId: string
  readonly plugin: string
  readonly harness: string
  readonly fixKind: FixKind
  readonly target: string
  readonly before: BeforeValue
  readonly touched: readonly FileSnapshot[]
  readonly startedAt: string
}

/** 一条已确认的修复。 */
export interface AppliedRecord {
  readonly matrixId: string
  readonly plugin: string
  readonly harness: string
  readonly fixKind: FixKind
  readonly target: string
  readonly before: BeforeValue
  readonly backupPaths: readonly string[]
  /** 目标文件是这次改动创建的吗?是的话撤销到空应当删掉它,而不是留一份 `{}` 的残留(§3.2「还原不留痕迹」)。 */
  readonly created: boolean
  readonly appliedAt: string
}

/** 忽略记录:同一 (插件, harness 版本) 不再重复提示(§5.6)。 */
export interface IgnoredNote {
  readonly plugin: string
  readonly harness: string
  readonly reason: string
  readonly notedAt: string
}

/** 状态文件全文。 */
export interface RescueState {
  readonly schema: string
  readonly intents: readonly IntentRecord[]
  readonly applied: readonly AppliedRecord[]
  readonly ignored: readonly IgnoredNote[]
  readonly failedAttempts: Readonly<Record<string, number>>
}

/** 读状态的结果:读到不认识的版本就只读不写。 */
export type StateLoad = { readonly mode: 'read-write'; readonly state: RescueState } | { readonly mode: 'read-only'; readonly reason: string; readonly state: RescueState }

/**
 * @returns 一份空状态,四个段都在,不等 M1 再补形状
 */
export function emptyState(): RescueState {
  return { schema: STATE_SCHEMA, intents: [], applied: [], ignored: [], failedAttempts: {} }
}

/**
 * 解析状态文件内容。
 *
 * @param raw 已 JSON.parse 的内容
 * @returns `read-only` 表示版本不认识,只报「请升级 rescue」,不得再写用户文件
 */
export function loadState(raw: unknown): StateLoad {
  const state = (raw ?? {}) as { schema?: unknown } & Omit<RescueState, 'schema'>
  const parsed: RescueState = {
    schema: typeof state.schema === 'string' ? state.schema : '',
    intents: Array.isArray(state.intents) ? state.intents : [],
    applied: Array.isArray(state.applied) ? state.applied : [],
    ignored: Array.isArray(state.ignored) ? state.ignored : [],
    failedAttempts: typeof state.failedAttempts === 'object' && state.failedAttempts !== null ? state.failedAttempts : {},
  }
  if (parsed.schema !== STATE_SCHEMA) {
    return { mode: 'read-only', reason: `unrecognised state schema "${parsed.schema || '<missing>'}" — upgrade @dsh-rescue/rescue before writing`, state: parsed }
  }
  return { mode: 'read-write', state: parsed }
}

/**
 * 尝试计数的键:插件 + harness 精确版本 + 修法。
 *
 * @param intent 一次修复的意图
 * @returns 计数键
 */
export function attemptKey(intent: Pick<IntentRecord, 'plugin' | 'harness' | 'fixKind'>): string {
  return `${intent.plugin}@${intent.harness}#${intent.fixKind}`
}

/**
 * 记一次修复失败。
 *
 * 诊断次数不计入,所以调用点只在修复动作失败时进来(§3.2)。
 *
 * @param state 当前状态
 * @param intent 失败的那次意图
 * @returns 计数加一后的状态,意图一并丢弃,等用户重试
 */
export function recordFixFailure(state: RescueState, intent: IntentRecord): RescueState {
  const key = attemptKey(intent)
  return { ...state, intents: state.intents.filter((item) => item.startedAt !== intent.startedAt || item.target !== intent.target), failedAttempts: { ...state.failedAttempts, [key]: (state.failedAttempts[key] ?? 0) + 1 } }
}

/**
 * @param state 当前状态
 * @param target 插件 + harness + 修法
 * @returns 已达上限,该项此后只给 F4
 */
export function isDegradedToManual(state: RescueState, target: Pick<IntentRecord, 'plugin' | 'harness' | 'fixKind'>): boolean {
  return (state.failedAttempts[attemptKey(target)] ?? 0) >= MAX_FIX_ATTEMPTS
}

/**
 * 落盘前的意图登记:先写 intent,再改用户文件。
 *
 * @param state 当前状态
 * @param intent 待执行的意图
 * @returns 追加了意图的状态
 */
export function beginIntent(state: RescueState, intent: IntentRecord): RescueState {
  return { ...state, intents: [...state.intents, intent] }
}

/**
 * 复检通过后把意图转成已应用记录。
 *
 * @param state 当前状态
 * @param intent 已完成的意图
 * @param backupPaths 本次改动的 `.bak-<stamp>` 原件
 * @param created 目标文件是否由这次改动创建
 * @param appliedAt 完成时间
 * @returns 意图出列、已应用记录入列的状态
 */
export function confirmApplied(state: RescueState, intent: IntentRecord, backupPaths: readonly string[], created: boolean, appliedAt: string): RescueState {
  const record: AppliedRecord = { matrixId: intent.matrixId, plugin: intent.plugin, harness: intent.harness, fixKind: intent.fixKind, target: intent.target, before: intent.before, backupPaths, created, appliedAt }
  return { ...state, intents: state.intents.filter((item) => item.startedAt !== intent.startedAt || item.target !== intent.target), applied: [...state.applied, record] }
}

/**
 * 还原的处置判定。
 *
 * 按 §5.3 的 `before` 表分派:`.bak` 在就读备份;F0/F2 的原值本身就在记录里,写回即可;
 * F1 的逐字节等价只由 `.bak` 保证,结构化行文本过 `entryListSchema` 往返会丢注释与 `!!js` 标记,
 * 所以备份缺失时不猜,直接报「无法还原:备份缺失」并把该记录标为需人工处理(§5.3.1 第 5 条)。
 *
 * @param record 一条已应用记录
 * @param readableBackups `backupPaths` 中当前可读的那些
 * @returns 判定结果与读不到的备份路径
 */
export function planRestore(record: AppliedRecord, readableBackups: readonly string[]): { readonly action: 'restore-backup' | 'restore-before' | 'backup-missing'; readonly missing: readonly string[] } {
  const missing = record.backupPaths.filter((item) => !readableBackups.includes(item))
  if (record.backupPaths.length > 0) return missing.length > 0 ? { action: 'backup-missing', missing } : { action: 'restore-backup', missing: [] }
  if (record.before.kind === 'config-patch') return { action: 'backup-missing', missing: record.backupPaths }
  return { action: 'restore-before', missing: [] }
}

/**
 * 并发编辑检测:apply 前记的 mtime + 哈希与写前的实际值不一致就中止。
 *
 * @param expected 意图里记下的快照
 * @param actual 写前重读的快照
 * @returns 文件已被用户改动时为真
 */
export function isConcurrentEdit(expected: FileSnapshot, actual: FileSnapshot): boolean {
  return expected.mtimeMs !== actual.mtimeMs || expected.sha256 !== actual.sha256
}

/**
 * @param state 当前状态
 * @param plugin 包名
 * @param harness harness 精确版本
 * @returns 该组合已被用户忽略
 */
export function isIgnored(state: RescueState, plugin: string, harness: string): boolean {
  return state.ignored.some((note) => note.plugin === plugin && note.harness === harness)
}

/**
 * 生成 `undo.md` 里的一条还原说明(§5.7:读者是一个打不开 Plugins 页的用户)。
 *
 * @param record 一条已应用记录
 * @returns 纯文本说明,含文件、原值与手工步骤
 */
export function renderUndoNote(record: AppliedRecord): string {
  const original = record.before.kind === 'config-patch'
    ? `被覆盖的行原文:\n    ${record.before.rowText}\n  备份: ${record.before.backupPath}`
    : record.before.kind === 'allow'
      ? `${record.before.key} 的原值: ${record.before.priorEntry ?? '(原本不存在该条目)'}`
      : record.before.kind === 'patch'
        ? `安装前 dependencies: ${JSON.stringify(record.before.dependencies)}\n  安装前 dsh.profile.bundles: ${record.before.bundles.join(', ') || '(空)'}`
        : '本条为迁移指南,无落盘变更,无需还原'
  return [
    `## ${record.plugin} @ ${record.harness} —— ${record.fixKind}`,
    `  矩阵记录: ${record.matrixId}`,
    `  目标: ${record.target}`,
    `  应用时间: ${record.appliedAt}`,
    `  ${original}`,
    '  手动还原: 先关闭 dsh,再用上述备份覆盖目标文件(或直接按原值改回),然后重启 dsh 确认插件状态。',
    '  备份缺失时不要猜测原值:重新运行诊断,该项会降级为迁移指南。',
    '',
  ].join('\n')
}
