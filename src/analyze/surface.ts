/**
 * 一个官方包在某版本下的公开面:子路径导出、具名导出、以及它 `provide` 的服务 key。
 *
 * 旧面直接读本机已装的 `node_modules`(零网络);新面用 `npm pack` 拉发布产物并按
 * `<cache>/<name>-<version>.json` 缓存。拉发布产物而不是读源码树,是因为用户装到的就是它 ——
 * 判据要对齐用户会遇到的东西。
 */

import { execSync } from 'node:child_process'
import fs from 'node:fs/promises'
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
 * 读一个本地包目录的公开面。
 *
 * @param name 包名
 * @param version 版本(取自 manifest,调用方核对)
 * @param dir 包根目录
 * @returns 公开面,含 `exports` 声明的子路径
 */
export async function readLocalSurface(name: string, version: string, dir: string): Promise<Surface> {
  const manifest = JSON.parse(await fs.readFile(path.join(dir, 'package.json'), 'utf8')) as { exports?: Record<string, unknown> }
  const files = new Map<string, string>()
  const walk = async (current: string): Promise<void> => {
    for (const entry of await fs.readdir(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name)
      if (entry.isDirectory()) await walk(full)
      else if (entry.name.endsWith('.js') || entry.name.endsWith('.d.ts')) files.set(full.replace(/\\/g, '/'), await fs.readFile(full, 'utf8'))
    }
  }
  await fs.access(dir)
  await walk(dir)
  const surface = surfaceFromFiles(files, name, version)
  return { ...surface, subpaths: Object.keys(manifest.exports ?? {}).sort() }
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
 * @param tarball `.tgz` 路径
 * @returns 包内 `lib` 下的 `.js` / `.d.ts` 文件名到内容
 */
async function readTarball(tarball: string): Promise<Map<string, string>> {
  const bytes = gunzipSync(await fs.readFile(tarball))
  const files = new Map<string, string>()
  let manifest: { exports?: Record<string, unknown> } | null = null
  let offset = 0
  while (offset + 512 <= bytes.length) {
    const header = bytes.subarray(offset, offset + 512)
    if (header.every((byte) => byte === 0)) break
    const name = tarField(header, 0, 100)
    const size = Number.parseInt(tarField(header, 124, 12) || '0', 8)
    const typeflag = String.fromCharCode(header[156] ?? 48)
    offset += 512
    const relative = name.split('/').slice(1).join('/')
    if ((typeflag === '0' || typeflag === '\0') && relative.startsWith('lib/') && (relative.endsWith('.js') || relative.endsWith('.d.ts'))) {
      files.set('/' + relative, bytes.subarray(offset, offset + size).toString('utf8'))
    }
    if ((typeflag === '0' || typeflag === '\0') && relative === 'package.json') {
      manifest = JSON.parse(bytes.subarray(offset, offset + size).toString('utf8')) as { exports?: Record<string, unknown> }
    }
    offset += Math.ceil(size / 512) * 512
  }
  if (manifest) files.set('/__exports__', JSON.stringify(Object.keys(manifest.exports ?? {}).sort()))
  return files
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
  const safe = `${name.replace(/[\/@]/g, '_')}-${version}.json`
  const cached = path.join(cacheDir, safe)
  try {
    return JSON.parse(await fs.readFile(cached, 'utf8')) as Surface
  } catch {
    // 缓存未命中才拉包:首次一个版本一次网络,之后全本地
  }
  await fs.mkdir(cacheDir, { recursive: true })
  const tmp = await fs.mkdtemp(path.join(cacheDir, 'pack-'))
  try {
    execSync(`npm pack ${JSON.stringify(`${name}@${version}`)} --pack-destination ${JSON.stringify(tmp)}`, { stdio: ['ignore', 'pipe', 'pipe'] })
    const tarball = (await fs.readdir(tmp)).find((entry) => entry.endsWith('.tgz'))
    if (!tarball) throw new Error(`npm pack produced no tarball for ${name}@${version}`)
    const files = await readTarball(path.join(tmp, tarball))
    const exportsMarker = files.get('/__exports__')
    files.delete('/__exports__')
    const surface = surfaceFromFiles(files, name, version)
    const full: Surface = { ...surface, subpaths: exportsMarker ? (JSON.parse(exportsMarker) as string[]) : [] }
    await fs.mkdir(cacheDir, { recursive: true })
    await fs.writeFile(cached, JSON.stringify(full))
    return full
  } finally {
    await fs.rm(tmp, { recursive: true, force: true })
  }
}
