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
import semver from 'semver'
import { parse as parseYaml } from 'yaml'

import { classify } from './analyze/classify.ts'
import { assessPlugin, loadMarket, marketRows, renderMarket, upgradeCommand } from './analyze/market.ts'
import type { MarketIndex } from './analyze/market.ts'
import { renderSymptoms, runCapture } from './analyze/capture.ts'
import { buildDiagnostic, renderDiagnostic } from './analyze/why.ts'
import { listProfiles, readProfile, resolveHome } from './analyze/profile.ts'
import { evaluateProfile } from './analyze/peers.ts'
import { fetchManifest } from './analyze/surface.ts'
import type { PackageManifest } from './analyze/surface.ts'
import { assertMatrixDocument } from './matrix/schema.ts'
import type { MatrixDocument } from './matrix/schema.ts'
import { renderDiagnosisReport } from './report/render.ts'
import { emptyState, loadState, renderUndoNote } from './state/store.ts'
import type { RescueState } from './state/store.ts'
import { applyExemption, applyRowChange, undoApplied } from './fix/apply.ts'
import { writePrDraft } from './fix/pr.ts'
import { writeFileAtomically } from './write/atomic.ts'

/** 解析后的命令行。 */
interface Parsed {
  readonly command: string
  readonly subject: string | null
  readonly positional: readonly string[]
  readonly flags: Readonly<Record<string, string | boolean>>
}

/** 认识的开关。不在这里的直接报错:安全开关(`--dry-run`)拼错时静默忽略,等于把写动作当成演练。 */
const FLAG_NAMES = new Set(['home', 'profile', 'runtime', 'config', 'disabled', 'dry-run', 'accept-risk', 'revoke', 'offline-only', 'offline', 'help', 'to', 'json', 'cache', 'out', 'dsh', 'timeout', 'allow-live', 'symptoms', 'prompt'])

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
 * @param flags 命令行开关
 * @param home dsh home
 * @returns 缓存面与 manifest 的目录(`--cache` 可换走)
 */
function cacheDirFor(flags: Readonly<Record<string, string | boolean>>, home: string): string {
  return typeof flags.cache === 'string' ? path.resolve(flags.cache) : path.join(home, '.dsh-rescue', 'cache')
}

/**
 * @param cacheDir 缓存目录
 * @returns 取某版本 package.json 的方法
 */
function manifestFetcher(cacheDir: string): (name: string, version: string) => Promise<PackageManifest | null> {
  return (name, version) => fetchManifest(name, version, cacheDir)
}

/**
 * @param flags 命令行开关
 * @param home dsh home
 * @returns 市场索引;拉不到且无缓存时为空(诊断不依赖它,§5.1 的分层)
 */
async function readMarket(flags: Readonly<Record<string, string | boolean>>, home: string): Promise<MarketIndex | null> {
  try {
    return await loadMarket({ cacheDir: path.join(home, '.dsh-rescue'), ...(flags.offline === true ? { offline: true } : {}) })
  } catch (error) {
    console.error(`市场索引没用上(${error instanceof Error ? error.message : String(error)});只按本机文件判,不报"作者已修"。`)
    return null
  }
}

/**
 * @param argv 参数
 * @returns 进程退出码
 */
export async function main(argv: readonly string[]): Promise<number> {
  const parsed = parseArgv(argv)
  if (parsed.command === 'help' || parsed.flags.help === true) {
    console.log(`用法:
  dsh-rescue profiles [--json]                           列出该 home 下的 profile
  dsh-rescue doctor [--home DIR] [--profile NAME] [--json]
                                                         分析(只读)
  dsh-rescue market [--runtime VER] [--json] [--offline]
                                                         已装插件 × 市场索引:作者修好了就升级,别打补丁
  dsh-rescue capture [--dsh PATH] [--prompt TEXT] [--timeout 秒] [--allow-live] [--json]
                                                         真启动一次,采集未激活条目与缺失服务
  dsh-rescue why <包名> [--to <官方版本>] [--symptoms 文件] [--json] [--cache DIR]
                                                         插件依赖面 × 新旧官方公开面 → 诊断包
  dsh-rescue pr <包名> --to <官方版本> [--out DIR] [--json]
                                                         诊断包 → PR 材料(diff + 正文),不 fork 不 push
  dsh-rescue fix exempt <pkg@version> --runtime VER --accept-risk
                                                         写一条精确版本豁免(F0)
  dsh-rescue fix row <行 id> [--disabled true|false] [--config FILE]
                                                         按行 id 整值覆盖补丁层(F1)
  dsh-rescue undo <序号>                                 从 .bak 逐字节还原
  dsh-rescue status [--json]                             看 journal 里已应用与未完成的记录
fix / undo 都支持 --dry-run(只算不写);带 --json 时 stdout 只有 JSON,提示走 stderr。`)
    return 0
  }

  // --runtime 只在 market 与 fix exempt 上有意义:别的命令收下它却什么都不做,等于把"对照新版本"的意图悄悄丢掉。
  if (parsed.flags.runtime !== undefined && parsed.command !== 'market' && !(parsed.command === 'fix' && parsed.subject === 'exempt')) {
    throw new Error(`${parsed.command} 不用 --runtime。本机 runtime 从已装包算出;要问"官方出新版本后作者跟上没",用 dsh-rescue market --runtime <精确版本>。`)
  }

  const home = resolveHome(typeof parsed.flags.home === 'string' ? parsed.flags.home : undefined)

  if (parsed.command === 'profiles') {
    const names = listProfiles(home)
    if (parsed.flags.json === true) console.log(JSON.stringify({ home, profiles: names }))
    else console.log(`home:${home}\n${names.length ? names.join('\n') : '(没有带 package.json 的 profile)'}`)
    return 0
  }

  // 除 profiles 外都要先定位到一个 profile
  const snapshot = readProfile(home, pickProfile(parsed.flags, home))
  const offlineOnly = parsed.flags.offlineOnly === true
  const cacheDir = cacheDirFor(parsed.flags, home)
  // --offline 时连 manifest 也不出网:判不动就停在"有新版但未确认",不猜作者修没修。
  const assessOptions = parsed.flags.offline === true ? {} : { manifest: manifestFetcher(cacheDir) }

  if (parsed.command === 'doctor') {
    const matrix = offlineOnly ? null : readMatrix('../matrix.json')
    const market = await readMarket(parsed.flags, home)
    const evaluation = evaluateProfile(snapshot)
    const diagnoses = classify(snapshot, evaluation, matrix)
    const runtimeVersion = evaluation.runtimeVersion
    const verdicts = market && runtimeVersion ? await Promise.all(evaluation.blocked.map((entry) => assessPlugin({ plugin: entry.plugin, installed: entry.version, runtime: runtimeVersion, market, blockedNow: true, ...assessOptions }))) : []
    const byPlugin = new Map(verdicts.map((verdict) => [verdict.plugin, verdict]))
    const suggestions = runtimeVersion === null ? [] : evaluation.blocked.map((entry) => {
      const upstream = byPlugin.get(entry.plugin)
      return {
        plugin: entry.plugin,
        version: entry.version,
        upgrade:
          upstream?.verdict === 'author-fixed'
            ? { version: upstream.marketVersion, evidence: upstream.evidence, publishedAt: upstream.release?.publishedAt ?? null, note: upstream.releaseNote, command: upgradeCommand(snapshot.profile, entry.plugin) }
            : null,
        // 作者状态直接决定这一条是"升级"还是"要动手修",前端与文本都得同源显示。
        market: upstream ? { verdict: upstream.verdict, version: upstream.marketVersion, updateAvailable: upstream.updateAvailable } : null,
        command: `dsh-rescue fix exempt ${entry.plugin}@${entry.version} --runtime ${runtimeVersion} --accept-risk`,
        rootFix: `让作者放宽 ${entry.gaps[0]?.peer ?? 'peer 范围'}`,
      }
    })
    if (parsed.flags.json === true) {
      console.log(JSON.stringify({
        profile: snapshot.profile,
        profileDir: snapshot.dir,
        runtime: { installed: runtimeVersion, channel: /-(alpha|beta|rc)\./.test(runtimeVersion ?? '') ? 'rc' : 'stable' },
        matrixAvailable: matrix !== null,
        matrixRecords: matrix?.records.length ?? 0,
        counts: {
          bundles: snapshot.bundles.length,
          runtime: evaluation.runtimeBundles.length,
          compatible: evaluation.compatible.length,
          blocked: evaluation.blocked.length,
          exempted: evaluation.exempted.length,
          missing: evaluation.missingBundles.length,
        },
        diagnoses,
        suggestions,
        marketVerdicts: verdicts,
      }, null, 2))
      return 0
    }
    console.log(renderDiagnosisReport({
      profile: snapshot.profile,
      runtime: runtimeVersion ?? '未识别(没找到 @deepseek-ai/dsh-app-boot)',
      channel: /-(alpha|beta|rc)\./.test(runtimeVersion ?? '') ? 'rc' : 'stable',
      matrixAvailable: matrix !== null,
      offlineCopy: '矩阵没用上 —— 离线不是插件没坏',
      plugins: diagnoses,
    }))
    console.log(`profile:${snapshot.dir}`)
    console.log(`已装 bundle ${snapshot.bundles.length} 个(其中官方 runtime ${evaluation.runtimeBundles.length} 个,不参与兼容性判定):peer 全满足 ${evaluation.compatible.length} 个,会被拦 ${evaluation.blocked.length} 个,已放行 ${evaluation.exempted.length} 个,没装上 ${evaluation.missingBundles.length} 个。`)
    if (matrix === null) console.log('矩阵没用上(分类可用,修法一栏需要矩阵或你显式批准)。')
    else if (matrix.records.length === 0) console.log(`矩阵已加载但 0 条记录:只报根因,不指认修法。`)
    for (const suggestion of suggestions) {
      if (suggestion.upgrade) {
        console.log(`下一步:升级 ${suggestion.plugin} → ${suggestion.upgrade.version ?? '?'}(作者已修${suggestion.upgrade.publishedAt ? `,${suggestion.upgrade.publishedAt}` : ''}${suggestion.upgrade.evidence ? `;${suggestion.upgrade.evidence}` : ''})—— 不需要补丁或豁免`)
        console.log(`  ${suggestion.upgrade.command}`)
      } else {
        if (suggestion.market?.verdict === 'still-broken') console.log(`作者未修:最新 ${suggestion.market.version ?? '?'} 的 peer 仍不覆盖当前 runtime,升级不解决问题。`)
        if (suggestion.market?.verdict === 'upgrade-maybe') console.log(`市场有新版 ${suggestion.market.version ?? '?'},但新版 peer 是否覆盖还没确认 —— 可先试升级,再回来复诊。`)
        console.log(`下一步:${suggestion.command}   (风险自负;正解是${suggestion.rootFix})`)
      }
    }
    return 0
  }

  if (parsed.command === 'market') {
    const market = await readMarket(parsed.flags, home)
    if (market === null) return 1
    const evaluation = evaluateProfile(snapshot)
    const installedRuntime = evaluation.runtimeVersion
    // --runtime 让"官方又发新版了,作者跟上没跟上"可以提前问,不必真把本机升上去。
    const override = typeof parsed.flags.runtime === 'string' ? parsed.flags.runtime : null
    if (override !== null && semver.valid(override) === null) throw new Error(`--runtime 要一个精确版本号(例如 0.2.0-rc.1),收到 ${override}`)
    const runtime = override ?? installedRuntime
    const targets = snapshot.installed.filter((entry) => !entry.name.startsWith('@deepseek-ai/dsh') && entry.name !== '@deepseek-ai/cordis')
    const blockedNames = new Set(evaluation.blocked.map((entry) => entry.plugin))
    const verdicts = await Promise.all(targets.map((entry) => assessPlugin({ plugin: entry.name, installed: entry.version, runtime, market, blockedNow: blockedNames.has(entry.name), ...assessOptions })))
    const rows = marketRows(verdicts, snapshot.profile)
    if (parsed.flags.json === true) console.log(JSON.stringify({ profile: snapshot.profile, runtime, installedRuntime, marketNotes: market.notes, rows }, null, 2))
    else {
      for (const note of market.notes) console.log(`注:${note}`)
      console.log(renderMarket(rows, runtime === installedRuntime ? `本机 runtime ${runtime ?? '未识别'}` : `runtime ${runtime} · 本机装 ${installedRuntime ?? '未识别'}`))
    }
    return 0
  }

  if (parsed.command === 'capture') {
    const liveHome = resolveHome()
    if (path.resolve(home) === path.resolve(liveHome) && parsed.flags.allowLive !== true) {
      throw new Error(`capture 会真的启动一次 dsh(它会写 session、日志,可能还会装包)。要动默认 home 请加 --allow-live;建议用 --home DIR 指一个排演 home。`)
    }
    const prompt = typeof parsed.flags.prompt === 'string' ? parsed.flags.prompt : 'hi'
    const timeoutSeconds = typeof parsed.flags.timeout === 'string' ? Number(parsed.flags.timeout) : 120
    if (!Number.isFinite(timeoutSeconds) || timeoutSeconds <= 0) throw new Error('--timeout 要的是正整数秒')
    const given = typeof parsed.flags.dsh === 'string' ? path.resolve(parsed.flags.dsh) : 'dsh'
    const isScript = /\.(?:c|m)?js$/.test(given)
    if (isScript && !fs.existsSync(given)) throw new Error(`--dsh 指向的文件不存在:${given}(源码仓里先跑 pnpm run build,才有 apps/cli/lib/bin.js)`)
    const symptoms = await runCapture({
      home,
      profile: snapshot.profile,
      command: isScript ? process.execPath : given,
      extraArgs: isScript ? [given] : [],
      prompt,
      timeoutMs: Math.round(timeoutSeconds * 1000),
    })
    if (parsed.flags.json === true) console.log(JSON.stringify(symptoms, null, 2))
    else {
      console.log(renderSymptoms(symptoms))
      console.log(`喂给 why:dsh-rescue why <包名> --to <版本> --symptoms <这份 JSON 的文件>`)
    }
    return 0
  }

  if (parsed.command === 'why') {
    const plugin = parsed.positional[0]
    if (!plugin) throw new Error('why 需要插件包名,例如:dsh-rescue why @michengai/dsh-archive-manager --to 0.2.0-rc.1')
    const target = typeof parsed.flags.to === 'string' ? parsed.flags.to : null
    const symptomsPath = typeof parsed.flags.symptoms === 'string' ? path.resolve(parsed.flags.symptoms) : null
    const symptoms = symptomsPath === null ? null : (JSON.parse(fs.readFileSync(symptomsPath, 'utf8')) as { entries: readonly { module: string; missingServices: readonly string[] }[] })
    const evaluation = evaluateProfile(snapshot)
    const bundle = await buildDiagnostic(snapshot, evaluation, plugin, { target, symptoms, cacheDir, market: await readMarket(parsed.flags, home) })
    if (parsed.flags.json === true) console.log(JSON.stringify(bundle, null, 2))
    else {
      console.log(renderDiagnostic(bundle))
      console.log(`要给别人看:${plugin.replace(/^@/, '').replace(/[\/@]/g, '_')}.json —— 用 --json 存盘,对方 doctor / why 都能在同一份数据上接着走。`)
    }
    return 0
  }

  if (parsed.command === 'pr') {
    const plugin = parsed.positional[0]
    if (!plugin) throw new Error('pr 需要插件包名,例如:dsh-rescue pr @michengai/dsh-archive-manager --to 0.2.0-rc.1')
    const target = typeof parsed.flags.to === 'string' ? parsed.flags.to : null
    const evaluation = evaluateProfile(snapshot)
    const bundle = await buildDiagnostic(snapshot, evaluation, plugin, { target, cacheDir, market: await readMarket(parsed.flags, home) })
    const installed = snapshot.installed.find((entry) => entry.name === plugin)
    if (!installed) throw new Error(`解析不到 ${plugin}`)
    const packageJson = await fs.promises.readFile(path.join(installed.dir, 'package.json'), 'utf8')
    const repository = (JSON.parse(packageJson) as { repository?: unknown }).repository
    const repo = typeof repository === 'string' ? repository : repository && typeof repository === 'object' && 'url' in repository ? String((repository as { url: unknown }).url) : null
    const outDir = path.resolve(typeof parsed.flags.out === 'string' ? parsed.flags.out : path.join('pr-out', plugin.replace(/^@/, '').replace(/[\/@]/g, '_')))
    const draft = await writePrDraft(bundle, packageJson, repo, outDir)
    if (parsed.flags.json === true) {
      console.log(JSON.stringify({ ...draft, diagnostic: bundle }, null, 2))
      return 0
    }
    console.log(`PR 草稿类别:${draft.kind};写在 ${draft.dir}`)
    for (const file of draft.files) console.log(`  ${file}`)
    if (draft.kind !== 'no-action') for (const proposal of draft.proposals.filter((item) => item.proposed !== null)) console.log(`  peer ${proposal.peer}: ${proposal.current} → ${proposal.proposed}`)
    for (const note of draft.notes) console.log(`  注:${note}`)
    console.log(draft.ghCommand === null ? '没给 gh 命令:按上面的注,这次不该提 PR。' : `材料备好了,发不发由你:\n  ${draft.ghCommand}`)
    console.log('工具不 fork、不 push、不开 PR:往别人仓库里写东西必须由有权限的人明确发起。')
    return 0
  }

  if (parsed.command === 'status') {
    const state = readState(snapshot.statePath)
    if (parsed.flags.json === true) {
      console.log(JSON.stringify({
        journal: snapshot.statePath,
        counts: { applied: state.applied.length, unfinished: state.intents.length, ignored: state.ignored.length },
        applied: state.applied.map((record, index) => ({ ordinal: index + 1, ...record })),
        unfinished: state.intents,
        failedAttempts: state.failedAttempts,
      }, null, 2))
      return 0
    }
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
    if (parsed.flags.json === true) console.log(JSON.stringify({ message: result.message, target: result.target, dryRun: parsed.flags.dryRun === true, remainingApplied: result.state.applied.length }))
    else console.log(result.message)
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
    if (parsed.flags.json === true) {
      console.log(JSON.stringify({ message: result.message, target: result.target, backupPath: result.backupPath, dryRun: parsed.flags.dryRun === true, applied: result.state.applied.length }, null, 2))
      return 0
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
