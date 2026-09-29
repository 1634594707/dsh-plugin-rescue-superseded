/**
 * `rescue.diagnostic/v1`:普通用户能产出、维护者能消费的诊断包。
 *
 * 目标是「一贴上去就能复现并定位」:profile 事实、peer 判定、插件依赖面,以及新旧两版官方包的公开面差异。
 * 判据全部来自文件;拿不准的标 `unknown`,不编原因。
 */

import path from 'node:path'

import { packageDir } from './profile.ts'
import { readPluginFace } from './imports.ts'
import { fetchSurface, readLocalSurface } from './surface.ts'
import type { ProfileSnapshot } from './profile.ts'
import type { Evaluation } from './peers.ts'

/** 一处对不上的具名依赖。 */
export interface DependencyGap {
  readonly specifier: string
  readonly symbol: string
  readonly inOld: boolean
  readonly inNew: boolean
  /** 改名候选,只是给人看的可能性,不作为结论。 */
  readonly candidates: readonly string[]
  readonly status: 'removed' | 'unknown'
}

/** 一个服务 key 的存在性判定。 */
export interface ServiceKeyStatus {
  readonly key: string
  readonly status: 'provided-both' | 'provided-old-only' | 'found-nowhere'
}

/** 一份诊断包。 */
export interface DiagnosticBundle {
  readonly schema: 'rescue.diagnostic/v1'
  readonly generatedAt: string
  readonly profile: string
  readonly runtime: { readonly installed: string | null; readonly target: string | null }
  readonly plugin: { readonly name: string; readonly version: string; readonly files: number }
  readonly peer: { readonly verdict: 'blocked' | 'exempted' | 'compatible' | 'unknown'; readonly ranges: Readonly<Record<string, string>>; readonly gaps: readonly string[] }
  readonly serviceKeys: readonly ServiceKeyStatus[]
  readonly gaps: readonly DependencyGap[]
  readonly surfaces: { readonly specifier: string; readonly oldVersion: string; readonly newVersion: string; readonly oldSymbols: number; readonly newSymbols: number }[]
  readonly notes: readonly string[]
}

/**
 * @param oldSymbols 旧版公开符号
 * @param newSymbols 新版公开符号
 * @param symbol 消失的符号
 * @returns 改名候选:新增加里同前缀或互为包含的前 5 个
 */
function candidatesFor(oldSymbols: readonly string[], newSymbols: readonly string[], symbol: string): string[] {
  const head = symbol.slice(0, 6)
  const added = newSymbols.filter((name) => !oldSymbols.includes(name))
  const dropped = oldSymbols.filter((name) => !newSymbols.includes(name))
  const byPrefix = added.filter((name) => name.startsWith(head))
  const byContain = added.filter((name) => name.includes(symbol) || symbol.includes(name))
  const related = dropped.filter((name) => name !== symbol && (symbol.includes(name) || name.includes(symbol)))
  return [...new Set([...byPrefix, ...byContain, ...related])].slice(0, 5)
}

/**
 * 生成一个插件的诊断包:面 diff 只在给了目标版本时做。
 *
 * @param snapshot profile 读取结果
 * @param evaluation peer 评估结果
 * @param plugin 插件包名
 * @param options `target` 目标官方版本、`cacheDir` 面缓存目录
 * @returns 诊断包
 * @throws 插件在 profile 里解析不到
 */
export async function buildDiagnostic(snapshot: ProfileSnapshot, evaluation: Evaluation, plugin: string, options: { target?: string | null; cacheDir?: string } = {}): Promise<DiagnosticBundle> {
  const installed = snapshot.installed.find((entry) => entry.name === plugin)
  if (!installed) {
    const names = snapshot.installed.map((entry) => entry.name).join(', ')
    throw new Error(`profile ${snapshot.profile} 里没解析到 ${plugin}。已解析到的是:${names}`)
  }

  const face = await readPluginFace(installed.dir)
  const notes: string[] = []
  const gaps: DependencyGap[] = []
  const surfaces: DiagnosticBundle['surfaces'] = []
  const oldProvided = new Set<string>()
  const newProvided = new Set<string>()
  const cacheDir = options.cacheDir ?? path.join(snapshot.home, '.dsh-rescue', 'surfaces')

  const dshImports = face.imports.filter((entry) => entry.specifier.startsWith('@deepseek-ai/dsh'))
  for (const entry of dshImports) {
    const root = entry.specifier.split('/').slice(0, entry.specifier.startsWith('@') ? 2 : 1).join('/')
    const installedVersion = snapshot.runtimePackages[root]
    if (!installedVersion) {
      notes.push(`${root} 在本机 profile 里没装,旧面无从对照`)
      continue
    }
    const localDir = packageDir(snapshot, root)
    if (localDir === null) {
      notes.push(`${root} 版本已知 ${installedVersion} 但目录解析不到`)
      continue
    }
    const oldSurface = await readLocalSurface(root, installedVersion, localDir)
    for (const key of oldSurface.providedKeys) oldProvided.add(key)
    if (!options.target) continue
    const newSurface = await fetchSurface(root, options.target, cacheDir)
    for (const key of newSurface.providedKeys) newProvided.add(key)
    surfaces.push({ specifier: root, oldVersion: installedVersion, newVersion: options.target, oldSymbols: oldSurface.symbols.length, newSymbols: newSurface.symbols.length })

    for (const symbol of entry.symbols) {
      const inOld = oldSurface.symbols.includes(symbol)
      const inNew = newSurface.symbols.includes(symbol)
      if (inOld && inNew) continue
      gaps.push({ specifier: entry.specifier, symbol, inOld, inNew, candidates: inOld && !inNew ? candidatesFor(oldSurface.symbols, newSurface.symbols, symbol) : [], status: inOld && !inNew ? 'removed' : 'unknown' })
    }
    const subpath = entry.specifier.slice(root.length)
    if (subpath.startsWith('/') && newSurface.subpaths.length > 0 && !newSurface.subpaths.includes(subpath)) {
      gaps.push({ specifier: entry.specifier, symbol: `(子路径 ${subpath})`, inOld: true, inNew: false, candidates: newSurface.subpaths.filter((item) => item !== '.'), status: 'removed' })
    }
  }

  const serviceKeys: ServiceKeyStatus[] = face.injects.map((key) => ({
    key,
    status: oldProvided.has(key) && newProvided.has(key) ? 'provided-both' : oldProvided.has(key) ? 'provided-old-only' : 'found-nowhere',
  }))
  if (!options.target) notes.push('未给 --to:只报当前安装事实与 peer 判定,不做版本间面 diff')

  const blocked = evaluation.blocked.find((entry) => entry.plugin === plugin)
  const exempted = evaluation.exempted.find((entry) => entry.plugin === plugin)
  const peerRanges: Record<string, string> = {}
  const peerGaps: string[] = []
  for (const [peer, range] of Object.entries(installed.peerRanges)) {
    if (!peer.startsWith('@deepseek-ai/dsh')) continue
    peerRanges[peer] = range
    const at = snapshot.runtimePackages[peer] ?? null
    if (at === null || (blocked?.gaps ?? []).some((gap) => gap.peer === peer)) peerGaps.push(`${peer} 要 ${range},已装 ${at ?? '未装'}`)
  }

  return {
    schema: 'rescue.diagnostic/v1',
    generatedAt: new Date().toISOString(),
    profile: snapshot.profile,
    runtime: { installed: evaluation.runtimeVersion, target: options.target ?? null },
    plugin: { name: installed.name, version: installed.version, files: face.files },
    peer: {
      verdict: blocked ? 'blocked' : exempted ? 'exempted' : Object.keys(peerRanges).length === 0 ? 'unknown' : 'compatible',
      ranges: peerRanges,
      gaps: peerGaps,
    },
    serviceKeys,
    gaps: gaps.sort((a, b) => a.specifier.localeCompare(b.specifier) || a.symbol.localeCompare(b.symbol)),
    surfaces,
    notes,
  }
}

/**
 * 把诊断包渲染成给群里/issue 里看的文本。
 *
 * @param bundle 诊断包
 * @param report 已有的 profile 级诊断(可选)
 * @returns 多行文本
 */
export function renderDiagnostic(bundle: DiagnosticBundle, report: readonly string[] = []): string {
  const lines: string[] = [`诊断包 ${bundle.schema}(生成 ${bundle.generatedAt})`, `profile ${bundle.profile} · runtime ${bundle.runtime.installed ?? '未识别'} → 目标 ${bundle.runtime.target ?? '未指定'}`, `插件 ${bundle.plugin.name}@${bundle.plugin.version}(扫了 ${bundle.plugin.files} 个 js)`]
  if (report.length > 0) lines.push(...report)
  lines.push(`peer 判定:${bundle.peer.verdict}`)
  for (const gap of bundle.peer.gaps) lines.push(`  ${gap}`)
  if (bundle.surfaces.length > 0) {
    lines.push(`面 diff 覆盖 ${bundle.surfaces.length} 个官方包:`)
    for (const surface of bundle.surfaces) lines.push(`  ${surface.specifier} ${surface.oldVersion}(${surface.oldSymbols} 符号)→ ${surface.newVersion}(${surface.newSymbols} 符号)`)
  }
  const removed = bundle.gaps.filter((gap) => gap.status === 'removed')
  if (removed.length > 0) {
    lines.push(`新版里没了的依赖 ${removed.length} 处:`)
    for (const gap of removed) lines.push(`  ${gap.specifier} 的 ${gap.symbol}${gap.candidates.length ? `;候选:${gap.candidates.join(', ')}` : ''}`)
  }
  const unknown = bundle.gaps.filter((gap) => gap.status === 'unknown')
  if (unknown.length > 0) lines.push(`两版都找不到、需要人工确认 ${unknown.length} 处:${unknown.map((gap) => `${gap.specifier}#${gap.symbol}`).join(', ')}`)
  for (const key of bundle.serviceKeys) {
    if (key.status === 'provided-both') continue
    lines.push(key.status === 'provided-old-only' ? `服务 key ${key.key}:旧版有 provider,新版没找到` : `服务 key ${key.key}:两版包里都没找到 provider(可能由别的包提供,未验证)`)
  }
  for (const note of bundle.notes) lines.push(`注:${note}`)
  return `${lines.join('\n')}\n`
}
