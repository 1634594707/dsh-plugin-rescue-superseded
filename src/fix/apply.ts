/**
 * 落盘装备:意图先行 → `.bak` → `.tmp` + `rename` → 重读确认生效 → 才标 applied。
 *
 * 三条纪律直接来自方案 §5.3.1,少一条「可还原」就只是承诺:
 * ① 写之前把原值与文件快照记进 journal;② 写完**重读**确认那一行/那个键确实是预期值
 * (宿主 `applyEntryPatches` 匹配不到目标只 warn 后跳过,「没报错」不等于「生效」);
 * ③ 还原只认 `.bak`,逐字节等价由备份保证,不由 YAML/JSON 往返保证。
 */

import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { isMap, isSeq, parseDocument, type YAMLMap, type YAMLSeq } from 'yaml'

import { COMPATIBILITY_FILENAME, type ProfileSnapshot } from '../analyze/profile.ts'
import type { AppliedRecord, IntentRecord, RescueState } from '../state/store.ts'
import { beginIntent, confirmApplied, planRestore } from '../state/store.ts'
import { snapshotFile, writeFileAtomically } from '../write/atomic.ts'

/** 一次改动的结果。 */
export interface ChangeResult {
  readonly state: RescueState
  readonly message: string
  readonly target: string
  readonly backupPath: string | null
}

/** 改动的共同前置:目标文件的当前内容与「没变化」判定。 */
interface TargetPlan {
  readonly target: string
  readonly next: string
  readonly current: string | null
}

/**
 * @param left 一份豁免表
 * @param right 另一份
 * @returns 语义是否相同(键序与空白不参与判断)
 */
function sameJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}

function hashOf(content: string): string {
  return createHash('sha256').update(content).digest('hex')
}

/**
 * 写一个用户文件并核对生效。
 *
 * @param plan 目标与将要写入的完整内容
 * @param intent 已登记的意图(含 before)
 * @param state 当前状态
 * @param verify 重读后如何判断「确实生效」
 * @param stamp 固定则可用于复现
 * @param dryRun 只算不写
 * @returns journal 更新后的状态与一句人话
 * @throws 重读不符预期时抛出,并说明文件现在是什么状态、下一次启动会怎样、用户能做什么
 */
async function commit(plan: TargetPlan, intent: IntentRecord, state: RescueState, verify: () => void, stamp?: string, dryRun = false): Promise<ChangeResult> {
  if (plan.current === plan.next) return { state, message: '目标内容已经是预期值,未产生任何写入', target: plan.target, backupPath: null }
  const withIntent = beginIntent(state, intent)
  if (dryRun) return { state: withIntent, message: `dry-run:将写 ${plan.target}(未落盘)`, target: plan.target, backupPath: null }

  const touched = fs.existsSync(plan.target) ? [await snapshotFile(plan.target)] : []
  const written = await writeFileAtomically(plan.target, plan.next, { ...(stamp === undefined ? {} : { stamp }) })
  verify()
  const applied = confirmApplied(withIntent, { ...intent, touched }, written.backupPath === undefined ? [] : [written.backupPath], plan.current === null, intent.startedAt)
  return { state: applied, message: `已写入 ${path.basename(plan.target)}`, target: plan.target, backupPath: written.backupPath ?? null }
}

/**
 * F0:写或撤一条精确版本豁免。
 *
 * 语义与宿主一致:键是精确 `package@version`,值是允许的 dsh 精确版本数组;授予必须有显式
 * `acceptRisk`(§5.3),撤销不需要。
 *
 * @param snapshot profile
 * @param pluginVersion 精确 `name@version`
 * @param runtimeVersion 精确 runtime 版本
 * @param enabled 授予还是撤销
 * @param acceptRisk 用户是否已经明确认过风险
 * @param state 当前 journal
 * @param options `stamp` 固定时间戳,`dryRun` 只算不写
 * @returns 结果与更新后的 journal
 */
export async function applyExemption(
  snapshot: ProfileSnapshot,
  pluginVersion: string,
  runtimeVersion: string,
  enabled: boolean,
  acceptRisk: boolean,
  state: RescueState,
  options?: { stamp?: string; dryRun?: boolean },
): Promise<ChangeResult> {
  const target = path.join(snapshot.dir, COMPATIBILITY_FILENAME)
  if (enabled && !acceptRisk) throw new Error('放行不兼容插件可能导致崩溃或数据丢失。确认风险后加 --accept-risk。')
  const separator = pluginVersion.lastIndexOf('@')
  if (separator <= 0 || /[\s^~*>|,<]/.test(pluginVersion.slice(separator + 1)) || /\s/.test(pluginVersion.slice(0, separator))) {
    throw new Error(`需要精确的 package-name@version(不是安装范围),收到:${pluginVersion}`)
  }

  const current = fs.existsSync(target) ? fs.readFileSync(target, 'utf8') : null
  const table: Record<string, string[]> = current === null ? {} : (JSON.parse(current) as Record<string, string[]>)
  const prior = table[pluginVersion] ?? null
  const next: Record<string, string[]> = { ...table }
  const remaining = (prior ?? []).filter((item) => item !== runtimeVersion)
  if (enabled) next[pluginVersion] = [...remaining, runtimeVersion].sort()
  else if (remaining.length > 0) next[pluginVersion] = remaining.sort()
  else delete next[pluginVersion]

  const serialized = `${JSON.stringify(Object.fromEntries(Object.entries(next).sort(([left], [right]) => left.localeCompare(right))), null, 2)}\n`
  const intent: IntentRecord = {
    matrixId: '',
    plugin: pluginVersion.slice(0, separator),
    harness: runtimeVersion,
    fixKind: 'allow',
    target,
    before: { kind: 'allow', key: pluginVersion, priorEntry: prior === null ? null : prior.join(',') },
    touched: [],
    startedAt: options?.stamp ?? new Date().toISOString(),
  }
  const result = await commit({ target, next: serialized, current }, intent, state, () => {
    const reread = JSON.parse(fs.readFileSync(target, 'utf8')) as Record<string, string[]>
    const granted = reread[pluginVersion] ?? []
    if (enabled ? !granted.includes(runtimeVersion) : granted.includes(runtimeVersion)) throw new Error(`重读 ${COMPATIBILITY_FILENAME} 后发现该豁免没有落上;文件现在仍是磁盘上的内容,下一次启动按它裁定。请重试或手工编辑该文件。`)
  }, options?.stamp, options?.dryRun ?? false)
  return { ...result, message: enabled ? `已为 ${pluginVersion} 放行 dsh ${runtimeVersion}(重启后生效)` : `已撤销 ${pluginVersion} 对 dsh ${runtimeVersion} 的放行` }
}

/**
 * 在补丁层里按 id 找到一行。
 *
 * @param document 已解析的 `cordis.patch.yml`
 * @param rowId 行 id
 * @returns 找到的节点,找不到为空
 */
function findRow(document: ReturnType<typeof parseDocument>, rowId: string): YAMLMap | null {
  const root = document.contents
  if (!isSeq(root)) return null
  const walk = (seq: YAMLSeq): YAMLMap | null => {
    for (const item of seq.items) {
      if (!isMap(item)) continue
      if (item.get('id') === rowId) return item
      const inserted = item.get('insert')
      if (isSeq(inserted)) {
        const nested = walk(inserted)
        if (nested) return nested
      }
    }
    return null
  }
  return walk(root)
}

/**
 * F1:按行 id 整值覆盖 `config`,或改 `disabled`。
 *
 * patch 语言没有 remove,所以这里是**覆盖**而不是删行;未被触碰的节点由 `yaml` 的 Document API
 * 原样保留(注释、空行、flow 风格),整份文件的逐字节还原靠 `.bak`。
 *
 * @param snapshot profile
 * @param rowId 行 id
 * @param change 新的完整 config(整值替换)或 disabled 取值
 * @param state 当前 journal
 * @param options `stamp`、`dryRun`
 * @returns 结果与更新后的 journal
 * @throws 补丁层不存在、找不到该 id、或重读确认失败
 */
export async function applyRowChange(
  snapshot: ProfileSnapshot,
  rowId: string,
  change: { config?: unknown; disabled?: boolean },
  state: RescueState,
  options?: { stamp?: string; dryRun?: boolean },
): Promise<ChangeResult> {
  const target = snapshot.patchPath
  if (target === null) throw new Error(`这个 profile 没有 cordis.patch.yml,无法按行覆盖:${snapshot.dir}`)
  const current = fs.readFileSync(target, 'utf8')
  const document = parseDocument(current, { merge: true, keepSourceTokens: true })
  if (document.errors.length > 0) throw new Error(`补丁层现在解析不过(${document.errors[0]?.message}),先修好它再改行 ${rowId};rescue 不会替你重写这份文件`)
  const row = findRow(document, rowId)
  if (!row) throw new Error(`补丁层里没有 id 为 ${rowId} 的行。按 id 精确命中是防错锁:行被改过名就不会覆盖。`)

  const originalRow = row.toString()
  if (change.disabled !== undefined) {
    if (change.disabled) row.set('disabled', true)
    else row.delete('disabled')
  }
  if (change.config !== undefined) row.set('config', document.createNode(change.config, { flow: false }))
  const next = document.toString()

  const intent: IntentRecord = {
    matrixId: '',
    plugin: typeof row.get('name') === 'string' ? String(row.get('name')) : rowId,
    harness: snapshot.runtimeVersion ?? '',
    fixKind: 'config-patch',
    target,
    before: { kind: 'config-patch', rowText: originalRow, backupPath: '' },
    touched: [],
    startedAt: options?.stamp ?? new Date().toISOString(),
  }
  return commit(
    { target, next, current },
    intent,
    state,
    () => {
      const reread = parseDocument(fs.readFileSync(target, 'utf8'))
      const row2 = findRow(reread, rowId)
      if (!row2) throw new Error(`重读后发现行 ${rowId} 整条不见了 —— 写入没有按预期落上,文件现在处于改写后的状态,请先用 undo 还原`)
      if (change.disabled === false && row2.get('disabled') !== undefined) throw new Error(`重读发现 ${rowId} 仍带 disabled:行存在但意图没落上,请用 undo 还原`)
      if (change.config !== undefined && !sameJson(row2.get('config'), change.config)) throw new Error(`重读发现 ${rowId} 的 config 不是预期值(patch 是整值覆盖,漏写的键不会被合并):${JSON.stringify(row2.get('config'))}`)
    },
    options?.stamp,
    options?.dryRun ?? false,
  )
}

/**
 * @param record 已应用记录
 * @param readable 现在真能读到的备份路径
 * @returns 预览文案 —— 与下面的 commit 分支走同一条判定,免得"预览说还原、执行是删除"
 */
function describeRestore(record: AppliedRecord, readable: readonly string[]): string {
  if (readable[0] !== undefined) return `dry-run:将从备份 ${path.basename(readable[0])} 逐字节还原 ${path.basename(record.target)}`
  if (record.before.kind !== 'allow') return `dry-run:这条记录(${record.fixKind})没有可写回的原值,请用备份 ${record.backupPaths.join(', ') || '无'} 人工还原`
  const table = fs.existsSync(record.target) ? (JSON.parse(fs.readFileSync(record.target, 'utf8')) as Record<string, string[]>) : {}
  if (record.before.priorEntry === null) delete table[record.before.key]
  else table[record.before.key] = record.before.priorEntry.split(',')
  if (record.created && Object.keys(table).length === 0) return `dry-run:将删掉这次创建的 ${path.basename(record.target)},不留空文件`
  return `dry-run:将在 ${path.basename(record.target)} 里把 ${record.before.key} 恢复成 ${record.before.priorEntry === null ? '「不存在」' : record.before.priorEntry},其余记录保留`
}

/**
 * 还原一条已应用记录。
 *
 * @param state 当前 journal
 * @param ordinal `status` 里显示的序号,从 1 起
 * @param options `stamp`、`dryRun`
 * @returns 还原结果
 * @throws 备份缺失或还原后哈希不符
 */
export async function undoApplied(state: RescueState, ordinal: number, options?: { stamp?: string; dryRun?: boolean }): Promise<ChangeResult> {
  const record = state.applied[ordinal - 1]
  if (!record) throw new Error(`没有第 ${ordinal} 条已应用记录(共 ${state.applied.length} 条)。先看 status。`)
  const readable = record.backupPaths.filter((item) => fs.existsSync(item))
  const plan = planRestore(record, readable)
  if (plan.action === 'backup-missing') {
    const missing = plan.missing.length > 0 ? plan.missing.join(', ') : '该记录没有登记备份'
    throw new Error(`无法还原:备份缺失(${missing})。不猜原值 —— 该项请人工处理,重跑 doctor 会把它降级为迁移指南。`)
  }
  if (options?.dryRun) return { state, message: describeRestore(record, readable), target: record.target, backupPath: readable[0] ?? null }

  if (plan.action === 'restore-backup' && readable[0] !== undefined) {
    const expected = hashOf(fs.readFileSync(readable[0], 'utf8'))
    const written = await writeFileAtomically(record.target, fs.readFileSync(readable[0], 'utf8'), { ...(options?.stamp === undefined ? {} : { stamp: options.stamp }) })
    if (hashOf(fs.readFileSync(record.target, 'utf8')) !== expected) throw new Error(`还原后哈希与备份不一致:${record.target};请人工核对 ${written.backupPath ?? readable[0]}`)
    return { state: { ...state, applied: state.applied.filter((item) => item !== record) }, message: `已从备份逐字节还原 ${path.basename(record.target)}`, target: record.target, backupPath: written.backupPath ?? null }
  }

  if (record.before.kind !== 'allow') throw new Error(`这条记录(${record.fixKind})没有可写回的原值,请用备份 ${record.backupPaths.join(', ') || '无'} 人工还原。`)
  const key = record.before.key
  const prior = record.before.priorEntry
  const tablePath = record.target
  const table = fs.existsSync(tablePath) ? (JSON.parse(fs.readFileSync(tablePath, 'utf8')) as Record<string, string[]>) : {}
  if (prior === null) delete table[key]
  else table[key] = prior.split(',')
  if (record.created && Object.keys(table).length === 0) {
    fs.rmSync(tablePath, { force: true })
    return { state: { ...state, applied: state.applied.filter((item) => item !== record) }, message: `已删除这次创建的 ${path.basename(tablePath)},没有留下空文件`, target: tablePath, backupPath: null }
  }
  const serialized = `${JSON.stringify(table, null, 2)}\n`
  await writeFileAtomically(tablePath, serialized, { ...(options?.stamp === undefined ? {} : { stamp: options.stamp }) })
  if (prior === null) {
    const reread = JSON.parse(fs.readFileSync(tablePath, 'utf8')) as Record<string, string[]>
    if (key in reread) throw new Error(`重读发现 ${key} 仍在 ${path.basename(tablePath)} 里,撤销没有落上;文件保持现状,下一次启动仍会放行它。`)
  }
  return { state: { ...state, applied: state.applied.filter((item) => item !== record) }, message: `已按记录里的原值撤销放行(${key})`, target: tablePath, backupPath: null }
}
