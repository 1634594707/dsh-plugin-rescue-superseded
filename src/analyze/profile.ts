/**
 * 读一个 dsh profile 的静态事实:装了哪些包、runtime 是哪个版本、补丁层与豁免文件现在长什么样。
 *
 * 这里不启动 dsh,也不 import 任何 `@deepseek-ai/dsh-*` 包 —— 读的是安装产物本身,所以工具在
 * 插件已经坏了、dsh 起不来的时候照样能跑(方案 §5.7 的「还原不能依赖它要救的运行时」)。
 */

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { parseDocument } from 'yaml'

/** 宿主写在 profile 目录里的豁免文件名(`profile-compatibility.ts:10`)。 */
export const COMPATIBILITY_FILENAME = 'compatibility.json'

/** 本工具自己的状态目录名。 */
export const STATE_DIRNAME = '.dsh-rescue'

/** 一个已解析到的安装包。 */
export interface InstalledPackage {
  readonly name: string
  readonly version: string
  readonly dir: string
  readonly peerRanges: Readonly<Record<string, string>>
}

/** profile 补丁层里的一行。 */
export interface PatchRow {
  readonly id: string
  readonly name?: string
  readonly disabled?: boolean
  readonly config?: unknown
}

/** 一个 profile 的全量读取结果。 */
export interface ProfileSnapshot {
  readonly home: string
  readonly profile: string
  readonly dir: string
  readonly bundles: readonly string[]
  readonly installed: readonly InstalledPackage[]
  readonly runtimeVersion: string | null
  readonly runtimePackages: Readonly<Record<string, string>>
  readonly patchRows: readonly PatchRow[]
  readonly patchPath: string | null
  readonly exemptions: Readonly<Record<string, readonly string[]>>
  readonly statePath: string
}

/**
 * @param explicit `--home` 给定的目录
 * @returns dsh home 的绝对路径:显式值 > `DSH_HOME` > `~/.dsh`
 */
export function resolveHome(explicit?: string): string {
  return path.resolve(explicit ?? process.env.DSH_HOME ?? path.join(os.homedir(), '.dsh'))
}

/**
 * @param home dsh home
 * @returns 该 home 下带 `package.json` 的 profile 名,字典序
 */
export function listProfiles(home: string): string[] {
  const base = path.join(home, 'profiles')
  if (!fs.existsSync(base)) return []
  return fs
    .readdirSync(base, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && fs.existsSync(path.join(base, entry.name, 'package.json')))
    .map((entry) => entry.name)
    .sort()
}

/**
 * @param dir 某一级 `node_modules`
 * @returns 该级里 `@deepseek-ai/dsh-*` 的包名到版本
 */
function scanRuntime(dir: string): Record<string, string> {
  const scope = path.join(dir, '@deepseek-ai')
  if (!fs.existsSync(scope)) return {}
  const found: Record<string, string> = {}
  for (const entry of fs.readdirSync(scope, { withFileTypes: true })) {
    // pnpm 把包链进 node_modules:目录与符号链接(junction)都要收,只判 isDirectory 会一份不漏。
    if (!entry.isDirectory() && !entry.isSymbolicLink()) continue
    if (!entry.name.startsWith('dsh-')) continue
    const manifest = readManifest(`@deepseek-ai/${entry.name}`, dir)
    if (manifest && !(entry.name in found)) found[`@deepseek-ai/${entry.name}`] = manifest.version
  }
  return found
}

/**
 * @param name 包名
 * @param root `node_modules` 目录
 * @returns 读得到的 manifest,读不到为空
 */
function readManifest(name: string, root: string): { version: string; peerDependencies?: Record<string, string> } | null {
  try {
    return JSON.parse(fs.readFileSync(path.join(root, name, 'package.json'), 'utf8')) as { version: string; peerDependencies?: Record<string, string> }
  } catch {
    return null
  }
}

/**
 * @param items 补丁层顶层节点
 * @returns 摊平后的行:`- insert:` 组里的行与其成员都按 id 取回
 */
function collectRows(items: unknown[]): PatchRow[] {
  const rows: PatchRow[] = []
  for (const item of items) {
    if (typeof item !== 'object' || item === null) continue
    const row = item as Record<string, unknown>
    if (Array.isArray(row.insert)) {
      rows.push(...collectRows(row.insert))
      continue
    }
    if (typeof row.id !== 'string') continue
    const entry: PatchRow = {
      id: row.id,
      ...(typeof row.name === 'string' ? { name: row.name } : {}),
      ...(typeof row.disabled === 'boolean' ? { disabled: row.disabled } : {}),
      ...(row.config !== undefined ? { config: row.config } : {}),
    }
    rows.push(entry)
  }
  return rows
}

/** 一个 profile 解析包时用到的根目录,按优先级排列。 */
export function resolutionRoots(snapshot: ProfileSnapshot): string[] {
  return [path.join(snapshot.dir, 'node_modules'), path.join(snapshot.home, 'profiles', 'node_modules'), path.join(snapshot.home, 'node_modules')]
}

/**
 * @param snapshot profile 读取结果
 * @param name 包名
 * @returns 该包在三级 `node_modules` 里最先命中的包根目录,找不到为空
 */
export function packageDir(snapshot: ProfileSnapshot, name: string): string | null {
  for (const root of resolutionRoots(snapshot)) {
    if (fs.existsSync(path.join(root, name, 'package.json'))) return path.join(root, name)
  }
  return null
}

/**
 * 读一个 profile。
 *
 * @param home dsh home 绝对路径
 * @param profile profile 名
 * @returns 静态事实
 * @throws profile 目录或 `package.json` 不存在时抛出,并列出可用 profile
 */
export function readProfile(home: string, profile: string): ProfileSnapshot {
  const dir = path.join(home, 'profiles', profile)
  const manifestPath = path.join(dir, 'package.json')
  if (!fs.existsSync(manifestPath)) {
    const available = listProfiles(home)
    throw new Error(`找不到 profile:${dir}(可用:${available.length ? available.join(', ') : '无'})`)
  }
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as {
    dependencies?: Record<string, string>
    dsh?: { profile?: { bundles?: string[] } }
    bundles?: string[]
  }
  const roots = [path.join(dir, 'node_modules'), path.join(home, 'profiles', 'node_modules'), path.join(home, 'node_modules')]
  const bundles = manifest.dsh?.profile?.bundles ?? manifest.bundles ?? []

  const installed: InstalledPackage[] = []
  // 按 bundle 名直接解析,而不是只看 dependencies:共享 runtime 是链在上一级 node_modules 里的。
  for (const name of [...new Set([...bundles, ...Object.keys(manifest.dependencies ?? {})])].sort()) {
    for (const root of roots) {
      const found = readManifest(name, root)
      if (!found) continue
      installed.push({ name, version: found.version, dir: path.join(root, name), peerRanges: found.peerDependencies ?? {} })
      break
    }
  }

  const runtimePackages: Record<string, string> = {}
  for (const root of roots) {
    for (const [name, version] of Object.entries(scanRuntime(root))) {
      if (!(name in runtimePackages)) runtimePackages[name] = version
    }
  }

  const patchPath = fs.existsSync(path.join(dir, 'cordis.patch.yml')) ? path.join(dir, 'cordis.patch.yml') : null
  let patchRows: PatchRow[] = []
  if (patchPath) {
    const document = parseDocument(fs.readFileSync(patchPath, 'utf8'), { merge: true })
    const rows = document.toJS()
    if (document.errors.length === 0 && Array.isArray(rows)) patchRows = collectRows(rows)
  }

  const compatibilityPath = path.join(dir, COMPATIBILITY_FILENAME)
  let exemptions: Record<string, readonly string[]> = {}
  if (fs.existsSync(compatibilityPath)) {
    try {
      const raw = JSON.parse(fs.readFileSync(compatibilityPath, 'utf8')) as Record<string, unknown>
      for (const [key, value] of Object.entries(raw)) if (Array.isArray(value) && value.every((item) => typeof item === 'string')) exemptions[key] = value as string[]
    } catch {
      // 豁免文件读不动时按「什么都没放行」处理:这是宿主自己的姿态(`readProfileCompatibility` 同样拒绝回落),
      // 猜一份豁免等于替用户决定要不要冒崩溃风险。
      exemptions = {}
    }
  }

  const dshBoot = runtimePackages['@deepseek-ai/dsh-app-boot']
  return {
    home,
    profile,
    dir,
    bundles,
    installed,
    runtimeVersion: dshBoot ?? null,
    runtimePackages,
    patchRows,
    patchPath,
    exemptions,
    statePath: path.join(dir, STATE_DIRNAME, 'state.json'),
  }
}
