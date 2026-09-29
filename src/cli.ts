#!/usr/bin/env node
/**
 * dsh-rescue:分析一个 profile 里社区插件为什么失效,并落一条可见、可还原的改动。
 *
 * 默认只读 —— `doctor` 与 `status` 不产生任何写入,`fix` / `undo` 必须显式点名;
 * 一切落盘都走 `.bak` + journal,还原靠备份而不是往返(§3.2、§5.3.1)。
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse as parseYaml } from 'yaml'

import { classify } from './analyze/classify.ts'
import { buildDiagnostic, renderDiagnostic } from './analyze/why.ts'
import { listProfiles, readProfile, resolveHome } from './analyze/profile.ts'
import { evaluateProfile } from './analyze/peers.ts'
import { assertMatrixDocument } from './matrix/schema.ts'
import type { MatrixDocument } from './matrix/schema.ts'
import { renderDiagnosisReport } from './report/render.ts'
import { emptyState, loadState, renderUndoNote } from './state/store.ts'
import type { RescueState } from './state/store.ts'
import { applyExemption, applyRowChange, undoApplied } from './fix/apply.ts'
import { writeFileAtomically } from './write/atomic.ts'

/** 解析后的命令行。 */
interface Parsed {
  readonly command: string
  readonly subject: string | null
  readonly positional: readonly string[]
  readonly flags: Readonly<Record<string, string | boolean>>
}

/** 认识的开关。不在这里的直接报错:安全开关(`--dry-run`)拼错时静默忽略,等于把写动作当成演练。 */
const FLAG_NAMES = new Set(['home', 'profile', 'runtime', 'config', 'disabled', 'dry-run', 'accept-risk', 'revoke', 'offline-only', 'help', 'to', 'json', 'cache'])

/**
 * @param name 去掉前缀的开关名
 * @returns camelCase 形式,供代码读取
 */
function camel(name: string): string {
  return name.replace(/-([a-z])/g, (_match, letter: string) => letter.toUpperCase())
}

/**
 * @param argv 参数(不含 node 与脚本)
 * @returns 命令、子命令、位置参数与开关
 * @throws 出现不认识的双横线开关时抛出
 */
export function parseArgv(argv: readonly string[]): Parsed {
  const flags: Record<string, string | boolean> = {}
  const positional: string[] = []
  for (let index = 0; index < argv.length; index++) {
    const token = argv[index] ?? ''
    if (!token.startsWith('--')) {
      positional.push(token)
      continue
    }
    const name = token.slice(2)
    if (!FLAG_NAMES.has(name)) throw new Error(`不认识开关 --${name}。开关拼错不能静默忽略(尤其 --dry-run),--help 看全部可用开关。`)
    const next = argv[index + 1]
    if (next !== undefined && !next.startsWith('--')) {
      flags[camel(name)] = next
      index++
    } else flags[camel(name)] = true
  }
  const command = positional.shift() ?? 'help'
  const second = positional[0]
  const subject = command === 'fix' && (second === 'exempt' || second === 'row') ? (positional.shift() as string) : null
  return { command, subject, positional, flags }
}

/**
 * @param url 模块相对 URL
 * @returns 矩阵文档;读不到或校验不过返回 null,并把原因打给用户(诊断不依赖矩阵,§5.1)
 */
function readMatrix(url: string): MatrixDocument | null {
  try {
    const raw = JSON.parse(fs.readFileSync(fileURLToPath(new URL(url, import.meta.url)), 'utf8')) as unknown
    assertMatrixDocument(raw)
    return raw as MatrixDocument
  } catch (error) {
    console.error(`矩阵没有用上(${error instanceof Error ? error.message : String(error)});诊断照常,只是不指认修法。`)
    return null
  }
}

/**
 * @param statePath journal 路径
 * @returns 现有状态;不存在则空状态
 * @throws 读到不认识的 schema 时抛出「只读不写」的原因
 */
function readState(statePath: string): RescueState {
  if (!fs.existsSync(statePath)) return emptyState()
  const loaded = loadState(JSON.parse(fs.readFileSync(statePath, 'utf8')) as unknown)
  if (loaded.mode === 'read-only') throw new Error(`${loaded.reason}(当前状态:${statePath})`)
  return loaded.state
}

/**
 * @param statePath journal 路径
 * @param state 新状态
 */
async function writeState(statePath: string, state: RescueState): Promise<void> {
  fs.mkdirSync(path.dirname(statePath), { recursive: true })
  await writeFileAtomically(statePath, `${JSON.stringify(state, null, 2)}\n`)
}

/**
 * @param flags 命令行开关
 * @returns profile 名:`--profile` 或该 home 下唯一的那个,歧义时报错并列出候选
 */
function pickProfile(flags: Readonly<Record<string, string | boolean>>, home: string): string {
  const given = typeof flags.profile === 'string' ? flags.profile : null
  if (given) return given
  const available = listProfiles(home)
  if (available.length === 1 && available[0] !== undefined) return available[0]
  throw new Error(`用 --profile 指定一个 profile(可用:${available.join(', ') || '无'})`)
}

/**
 * @param argv 参数
 * @returns 进程退出码
 */
export async function main(argv: readonly string[]): Promise<number> {
  const parsed = parseArgv(argv)
  if (parsed.command === 'help' || parsed.flags.help === true) {
    console.log(`用法:
  dsh-rescue doctor [--home DIR] [--profile NAME]        分析(只读)
  dsh-rescue why <包名> [--to <官方版本>] [--json] [--cache DIR]
                                                         插件依赖面 × 新旧官方公开面 → 诊断包
  dsh-rescue fix exempt <pkg@version> --runtime VER --accept-risk
                                                         写一条精确版本豁免(F0)
  dsh-rescue fix row <行 id> [--disabled true|false] [--config FILE]
                                                         按行 id 整值覆盖补丁层(F1)
  dsh-rescue undo <序号>                                 从 .bak 逐字节还原
  dsh-rescue status                                      看 journal 里已应用与未完成的记录
所有 fix / undo 都支持 --dry-run(只算不写)。`)
    return 0
  }

  const home = resolveHome(typeof parsed.flags.home === 'string' ? parsed.flags.home : undefined)
  const snapshot = readProfile(home, pickProfile(parsed.flags, home))
  const offlineOnly = parsed.flags.offlineOnly === true

  if (parsed.command === 'doctor') {
    const matrix = offlineOnly ? null : readMatrix('../matrix.json')
    const evaluation = evaluateProfile(snapshot)
    const diagnoses = classify(snapshot, evaluation, matrix)
    const runtime = evaluation.runtimeVersion ?? '未识别(没找到 @deepseek-ai/dsh-app-boot)'
    console.log(renderDiagnosisReport({
      profile: snapshot.profile,
      runtime,
      channel: /-(alpha|beta|rc)\./.test(evaluation.runtimeVersion ?? '') ? 'rc' : 'stable',
      matrixAvailable: matrix !== null,
      offlineCopy: '矩阵没用上 —— 离线不是插件没坏',
      plugins: diagnoses,
    }))
    console.log(`profile:${snapshot.dir}`)
    console.log(`已装 bundle ${snapshot.bundles.length} 个(其中官方 runtime ${evaluation.runtimeBundles.length} 个,不参与兼容性判定):peer 全满足 ${evaluation.compatible.length} 个,会被拦 ${evaluation.blocked.length} 个,已放行 ${evaluation.exempted.length} 个,没装上 ${evaluation.missingBundles.length} 个。`)
    if (matrix === null) console.log('分类可用(来自文件事实),修法一栏需要矩阵或你显式批准。')
    const runtimeVersion = evaluation.runtimeVersion
    if (runtimeVersion !== null) for (const verdict of evaluation.blocked) console.log(`下一步:dsh-rescue fix exempt ${verdict.plugin}@${verdict.version} --runtime ${runtimeVersion} --accept-risk   (风险自负;正解是让作者放宽 ${verdict.gaps[0]?.peer ?? 'peer'})`)
    return 0
  }

  if (parsed.command === 'why') {
    const plugin = parsed.positional[0]
    if (!plugin) throw new Error('why 需要插件包名,例如:dsh-rescue why @michengai/dsh-archive-manager --to 0.2.0-rc.1')
    const target = typeof parsed.flags.to === 'string' ? parsed.flags.to : null
    const evaluation = evaluateProfile(snapshot)
    const bundle = await buildDiagnostic(snapshot, evaluation, plugin, { target, ...(typeof parsed.flags.cache === 'string' ? { cacheDir: path.resolve(parsed.flags.cache) } : {}) })
    if (parsed.flags.json === true) console.log(JSON.stringify(bundle, null, 2))
    else console.log(renderDiagnostic(bundle))
    console.log(`要给别人看:--json 存成文件(${plugin.replace(/^@/, '').replace(/[\/@]/g, '_')}.json),对方 doctor / why 都能在同一份数据上接着走。`)
    return 0
  }

  if (parsed.command === 'status') {
    const state = readState(snapshot.statePath)
    console.log(`journal:${snapshot.statePath}`)
    console.log(`已应用 ${state.applied.length} 条,未完成 ${state.intents.length} 条,忽略 ${state.ignored.length} 条,失败计数 ${Object.keys(state.failedAttempts).length} 项。`)
    state.applied.forEach((record, index) => console.log(`  ${index + 1}. ${record.fixKind} ${record.plugin} → ${path.basename(record.target)}${record.backupPaths.length ? ` · 备份 ${record.backupPaths.map((item) => path.basename(item)).join(',')}` : ' · 无备份'}`))
    for (const intent of state.intents) console.log(`  ! 上次修复未完成:${intent.fixKind} ${intent.plugin}(${intent.target})—— 继续用 fix 重跑,或 undo 还原`)
    return 0
  }

  if (parsed.command === 'undo') {
    const ordinal = Number(parsed.positional[0])
    if (!Number.isInteger(ordinal) || ordinal < 1) throw new Error('undo 需要 status 里的序号,例如:dsh-rescue undo 1')
    const state = readState(snapshot.statePath)
    const result = await undoApplied(state, ordinal, { ...(parsed.flags.dryRun === true ? { dryRun: true } : {}) })
    if (parsed.flags.dryRun !== true) await writeState(snapshot.statePath, result.state)
    console.log(result.message)
    return 0
  }

  if (parsed.command === 'fix') {
    const state = readState(snapshot.statePath)
    const options = { ...(parsed.flags.dryRun === true ? { dryRun: true } : {}) }
    let result
    if (parsed.subject === 'exempt') {
      const target = parsed.positional[0]
      const runtime = parsed.flags.runtime
      if (!target || typeof runtime !== 'string') throw new Error('fix exempt 需要 <package@version> 与 --runtime <精确版本>')
      result = await applyExemption(snapshot, target, runtime, parsed.flags.revoke !== true, parsed.flags.acceptRisk === true, state, options)
    } else if (parsed.subject === 'row') {
      const rowId = parsed.positional[0]
      if (!rowId) throw new Error('fix row 需要补丁层里的行 id,例如:dsh-rescue fix row ui-settings-general')
      const disabled = typeof parsed.flags.disabled === 'string' ? parsed.flags.disabled === 'true' : undefined
      const configFile = typeof parsed.flags.config === 'string' ? parsed.flags.config : null
      if (disabled === undefined && configFile === null) throw new Error('至少给 --disabled true|false 或 --config <文件>(config 是整值覆盖)')
      const config = configFile === null ? undefined : (parseYaml(fs.readFileSync(configFile, 'utf8')) as unknown)
      result = await applyRowChange(snapshot, rowId, { ...(disabled === undefined ? {} : { disabled }), ...(config === undefined ? {} : { config }) }, state, options)
    } else throw new Error('fix 的子命令是 exempt 或 row')

    if (parsed.flags.dryRun !== true) {
      await writeState(snapshot.statePath, result.state)
      if (result.state.applied.length > 0) await writeFileAtomically(path.join(path.dirname(snapshot.statePath), 'undo.md'), `${result.state.applied.map((record) => renderUndoNote(record)).join('')}\n`)
    }
    console.log(result.message)
    console.log('改动可见:补丁行在 profile 的 cordis.patch.yml,豁免在 compatibility.json;undo 靠 .bak。')
    return 0
  }

  throw new Error(`不认识的动作:${parsed.command}(试 --help)`)
}

if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main(process.argv.slice(2))
    .then((code) => process.exit(code))
    .catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : String(error))
      process.exit(1)
    })
}
