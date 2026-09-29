/**
 * 一个官方包在某版本下的公开面:子路径导出、具名导出、以及它 `provide` 的服务 key。
 *
 * 旧面直接读本机已装的 `node_modules`(零网络);新面用 `npm pack` 拉发布产物并按
 * `<cache>/<name>-<version>.json` 缓存。拉发布产物而不是读源码树,是因为用户装到的就是它 ——
 * 判据要对齐用户会遇到的东西。
 */

import { execSync } from 'node:child_process'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { gunzipSync } from 'node:zlib'

/** 一个包的公开面。 */
export interface Surface {
  readonly package: string
  readonly version: string
  readonly subpaths: readonly string[]
  readonly symbols: readonly string[]
  readonly providedKeys: readonly string[]
}

/** 发布产物里的 `package.json` 关键字段。 */
export interface PackageManifest {
  readonly name: string
  readonly version: string
  readonly peerDependencies?: Record<string, string>
  readonly dependencies?: Record<string, string>
  readonly repository?: unknown
}

/**
 * @param header 512 字节的 tar 头块
 * @param offset 字段起点
 * @param length 字段长度
 * @returns 去掉尾部 NUL 的字段文本
 */
function tarField(header: Buffer, offset: number, length: number): string {
  const slice = header.subarray(offset, offset + length)
  const end = slice.indexOf(0)
  return slice.subarray(0, end === -1 ? slice.length : end).toString('utf8').trim()
}

/**
 * 解开一个 npm tarball。
 *
 * 不借外部 `tar` 命令:Git Bash 的 GNU tar 把 `C:\path` 当成「远端主机:文件」,Windows 自带的
 * tar.exe 不认 `--force-local`,同一行命令在两个 runner 上给不出同一个结果。
 *
 * @param tarball `.tgz` 绝对路径
 * @returns 去掉 `package/` 前缀后的文件名到内容
 */
async function unpackTarball(tarball: string): Promise<Map<string, Buffer>> {
  const bytes = gunzipSync(await fs.readFile(tarball))
  const files = new Map<string, Buffer>()
  let offset = 0
  while (offset + 512 <= bytes.length) {
    const header = bytes.subarray(offset, offset + 512)
    if (header.every((byte) => byte === 0)) break
    const name = tarField(header, 0, 100)
    const size = Number.parseInt(tarField(header, 124, 12) || '0', 8)
    const typeflag = String.fromCharCode(header[156] ?? 48)
    offset += 512
    const relative = name.split('/').slice(1).join('/')
    if ((typeflag === '0' || typeflag === '\0') && relative !== '') files.set(relative, bytes.subarray(offset, offset + size))
    offset += Math.ceil(size / 512) * 512
  }
  return files
}

/**
 * @param name 包名
 * @param version 精确版本
 * @returns 解出的文件表,以及用完即弃的临时目录
 */
async function pack(name: string, version: string): Promise<Map<string, Buffer>> {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-rescue-pack-'))
  try {
    execSync(`npm pack ${JSON.stringify(`${name}@${version}`)} --pack-destination ${JSON.stringify(tmp)}`, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
    const tarball = (await fs.readdir(tmp)).find((entry) => entry.endsWith('.tgz'))
    if (!tarball) throw new Error(`npm pack produced no tarball for ${name}@${version}`)
    return await unpackTarball(path.join(tmp, tarball))
  } finally {
    await fs.rm(tmp, { recursive: true, force: true })
  }
}

/**
 * @param text 一个 `.js` / `.d.ts` 文件的内容
 * @param into 收集到的符号集
 * @param keys 收集到的 provide key 集
 */
function harvest(text: string, into: Set<string>, keys: Set<string>): void {
  for (const match of text.matchAll(/^export\s+(?:declare\s+)?(?:async\s+)?(?:default\s+)?(?:function|class|const|let|var)\s+([A-Za-z0-9_$]+)/gm)) into.add(match[1] as string)
  for (const match of text.matchAll(/^export\s*\{([^}]*)\}/gm)) {
    for (const part of String(match[1]).split(',')) {
      const name = part.trim().split(/\s+as\s+/).pop()?.trim()
      if (name && name !== 'default' && name !== '') into.add(name)
    }
  }
  for (const match of text.matchAll(/(?:^|[^.\w])provide(?:Service|All)?\(\s*['"]([^'"]{2,})['"]/g)) keys.add(match[1] as string)
}

/**
 * @param files 文件路径到内容
 * @param name 包名
 * @param version 版本
 * @returns 汇总后的公开面
 */
export function surfaceFromFiles(files: Map<string, string>, name: string, version: string): Surface {
  const symbols = new Set<string>()
  const providedKeys = new Set<string>()
  for (const [file, text] of files) {
    if (!file.endsWith('.js') && !file.endsWith('.d.ts')) continue
    if (file.includes('/tests/') || file.endsWith('.map')) continue
    harvest(text, symbols, providedKeys)
  }
  return { package: name, version, subpaths: [], symbols: [...symbols].sort(), providedKeys: [...providedKeys].sort() }
}

/**
 * @param dir 起点目录
 * @returns 该目录下的 `.js` / `.d.ts` 文件内容
 */
async function readSourceTree(dir: string): Promise<Map<string, string>> {
  const files = new Map<string, string>()
  const walk = async (current: string): Promise<void> => {
    for (const entry of await fs.readdir(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name)
      if (entry.isDirectory()) await walk(full)
      else if (entry.name.endsWith('.js') || entry.name.endsWith('.d.ts')) files.set(full.replace(/\\/g, '/'), await fs.readFile(full, 'utf8'))
    }
  }
  await walk(dir)
  return files
}

/**
 * 读一个本地包目录的公开面。
 *
 * @param name 包名
 * @param version 版本(取自 manifest)
 * @param dir 包根目录
 * @returns 公开面,含 `exports` 声明的子路径
 */
export async function readLocalSurface(name: string, version: string, dir: string): Promise<Surface> {
  const manifest = JSON.parse(await fs.readFile(path.join(dir, 'package.json'), 'utf8')) as { exports?: Record<string, unknown> }
  const surface = surfaceFromFiles(await readSourceTree(path.join(dir, 'lib')), name, version)
  return { ...surface, subpaths: Object.keys(manifest.exports ?? {}).sort() }
}

/**
 * 取某版本官方包的公开面,带缓存。
 *
 * @param name 包名
 * @param version 精确版本
 * @param cacheDir 面缓存目录
 * @returns 公开面
 * @throws `npm pack` 失败(网络或版本不存在)
 */
export async function fetchSurface(name: string, version: string, cacheDir: string): Promise<Surface> {
  const cachedFile = path.join(cacheDir, `${name.replace(/[\/@]/g, '_')}-${version}.surface.json`)
  try {
    return JSON.parse(await fs.readFile(cachedFile, 'utf8')) as Surface
  } catch {
    // 缓存未命中才拉包:首次一个版本一次网络,之后全本地
  }
  await fs.mkdir(cacheDir, { recursive: true })
  const files = await pack(name, version)
  const text = new Map<string, string>()
  for (const [file, buffer] of files) {
    if (file.startsWith('lib/') && (file.endsWith('.js') || file.endsWith('.d.ts'))) text.set('/' + file, buffer.toString('utf8'))
  }
  const manifest = files.get('package.json')
  const surface = surfaceFromFiles(text, name, version)
  const full: Surface = { ...surface, subpaths: manifest ? Object.keys(((JSON.parse(manifest.toString('utf8')) as { exports?: Record<string, unknown> }).exports) ?? {}).sort() : [] }
  await fs.writeFile(cachedFile, JSON.stringify(full))
  return full
}

/**
 * 读某个发布版本的 `package.json`。
 *
 * @param name 包名
 * @param version 精确版本
 * @param cacheDir 缓存目录
 * @returns manifest;拉不到时为空(网络失败由调用方决定怎么说明)
 */
export async function fetchManifest(name: string, version: string, cacheDir: string): Promise<PackageManifest | null> {
  const cachedFile = path.join(cacheDir, `${name.replace(/[\/@]/g, '_')}-${version}.manifest.json`)
  try {
    return JSON.parse(await fs.readFile(cachedFile, 'utf8')) as PackageManifest
  } catch {
    // 未命中缓存才拉
  }
  try {
    const files = await pack(name, version)
    const manifest = files.get('package.json')
    if (!manifest) return null
    const parsed = JSON.parse(manifest.toString('utf8')) as PackageManifest
    await fs.mkdir(cacheDir, { recursive: true })
    await fs.writeFile(cachedFile, JSON.stringify(parsed))
    return parsed
  } catch {
    return null
  }
}
