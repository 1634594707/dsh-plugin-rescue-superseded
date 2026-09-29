/**
 * 体积门禁:方案 §3.1 的冻结口径,唯一口径。
 *
 * 本体 = `pnpm pack` 后 tarball 内 lib 目录下所有 `.js` + `cordis.patch.yml` 的字节和(`.d.ts` 不计)。
 * 量的是发布产物,不是工作区 —— 装进 profile 的就是这些字节。矩阵包无代码,按 §3.1 的缓存预算
 * 量它的数据;补丁按单包 10 KB 量。
 *
 * 两条反假绿:一个文件都没量到就报「没量到对象」,不报通过;还没有补丁包时如实写「无可测对象」,
 * 不把空集合当成满足 ≤10 KB。
 */

import { execSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { gunzipSync } from 'node:zlib'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

/**
 * 跑一条命令并返回 stdout。
 *
 * 走 shell 是因为 Windows 上的 pnpm 是 `.cmd` 垫片,CreateProcess 不能直接执行它(方案 §9 平台差异
 * 第 4 条踩过这条);参数都是脚本内的常量,引号只为兼容带空格的路径。
 *
 * @param {string} command 命令与已加引号的参数
 * @param {{ cwd?: string }} [options] 执行目录
 * @returns {string} stdout
 */
function run(command, options) {
  return execSync(command, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...options })
}

/**
 * @param {string} value 路径
 * @returns {string} 可直接拼进命令的引号形式
 */
function quote(value) {
  return `"${value.replace(/"/g, '\\"')}"`
}

/** 本体预算:100 KB。 */
const BODY_BUDGET = 102_400
/** 单补丁预算:10 KB。 */
const PATCH_BUDGET = 10_240
/** 矩阵缓存预算:300 KB(§3.1;数据包按数据字节计,不计代码)。 */
const MATRIX_BUDGET = 307_200

/** @typedef {'body' | 'patch' | 'matrix'} Kind */

/**
 * @param {string} dir 相对项目根的路径
 * @returns {string[]} 该目录下含 package.json 的子目录绝对路径
 */
function workspacePackages(dir) {
  const base = path.join(root, dir)
  if (!fs.existsSync(base)) return []
  return fs
    .readdirSync(base, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && fs.existsSync(path.join(base, entry.name, 'package.json')))
    .map((entry) => path.join(base, entry.name))
}

/**
 * @param {Buffer} header 512 字节的 tar 头块
 * @param {number} offset 字段起点
 * @param {number} length 字段长度
 * @returns {string} 去掉尾部 NUL 与空白的字段文本
 */
function field(header, offset, length) {
  const slice = header.subarray(offset, offset + length)
  const end = slice.indexOf(0)
  return slice.subarray(0, end === -1 ? slice.length : end).toString('utf8').trim()
}

/**
 * 数出 tarball 里每个普通文件的字节。
 *
 * 不借外部 `tar` 命令:Git Bash 的 GNU tar 把 `C:\path` 当成「远端主机:文件」,Windows 自带的
 * tar.exe 又不认 `--force-local`,同一行命令在两个 runner 上给不出同一个结果。口径要的是 tarball
 * 内的字节,就在这里读。
 *
 * @param {string} tarball `.tgz` 的绝对路径
 * @returns {Map<string, number>} 去掉包根前缀后的条目名到字节数
 */
function readTarball(tarball) {
  const bytes = gunzipSync(fs.readFileSync(tarball))
  /** @type {Map<string, number>} */
  const files = new Map()
  let prefix = ''
  let offset = 0
  while (offset + 512 <= bytes.length) {
    const header = bytes.subarray(offset, offset + 512)
    if (header.every((byte) => byte === 0)) break
    const name = field(header, 0, 100)
    const size = Number.parseInt(field(header, 124, 12) || '0', 8)
    const typeflag = String.fromCharCode(header[156] ?? 48)
    offset += 512
    if (!prefix && name.includes('/')) prefix = name.slice(0, name.indexOf('/') + 1)
    if (typeflag === '0' || typeflag === '\0') files.set(name.startsWith(prefix) ? name.slice(prefix.length) : name, size)
    offset += Math.ceil(size / 512) * 512
  }
  return files
}

/**
 * 打包一个包并按 §3.1 口径量字节。
 *
 * @param {string} pkgDir 包目录绝对路径
 * @param {Kind} kind 计量对象
 * @returns {{ name: string, bytes: number, files: string[], codeFiles: number }}
 */
function measure(pkgDir, kind) {
  const manifest = JSON.parse(fs.readFileSync(path.join(pkgDir, 'package.json'), 'utf8'))
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-rescue-size-'))
  try {
    run(`pnpm pack --pack-destination ${quote(tmp)}`, { cwd: pkgDir })
    const tarball = fs.readdirSync(tmp).find((name) => name.endsWith('.tgz'))
    if (!tarball) throw new Error(`${manifest.name}: pnpm pack produced no tarball`)
    const entries = readTarball(path.join(tmp, tarball))
    const names = [...entries.keys()]
    /** @type {string[]} */
    let counted = []
    /** @type {string[]} */
    let code = []
    if (kind === 'matrix') counted = names.filter((name) => name.startsWith('data/') && name.endsWith('.json'))
    else {
      code = names.filter((name) => name.startsWith('lib/') && name.endsWith('.js') && !name.endsWith('.d.ts'))
      counted = [...code]
      if (names.includes('cordis.patch.yml')) counted.push('cordis.patch.yml')
    }
    const bytes = counted.reduce((total, name) => total + (entries.get(name) ?? 0), 0)
    return { name: String(manifest.name), bytes, files: counted.sort(), codeFiles: code.length }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true })
  }
}

const failures = []
/** @type {{ 类别: string, 包: string, 字节: number, 预算: number, 文件数: number }[]} */
const rows = []

/**
 * @param {string} pkgDir 包目录
 * @param {string} label 报告里的类别
 * @param {Kind} kind 计量对象
 * @param {number} budget 预算
 */
function check(pkgDir, label, kind, budget) {
  const measured = measure(pkgDir, kind)
  rows.push({ 类别: label, 包: measured.name, 字节: measured.bytes, 预算: budget, 文件数: measured.files.length })
  if (measured.files.length === 0) failures.push(`${measured.name}: 没量到任何文件(${label} 的口径是 ${kind === 'matrix' ? 'data 下的 .json' : 'lib 下的 .js + cordis.patch.yml'})—— 先跑 pnpm run build,空集合不得按通过处理`)
  else if (kind !== 'matrix' && measured.codeFiles === 0) failures.push(`${measured.name}: tarball 里只有 cordis.patch.yml、没有 lib 下的 .js —— 构建缺失或 files 段漏了代码,这一项不得按通过处理`)
  else if (kind !== 'matrix' && !measured.files.includes('cordis.patch.yml')) failures.push(`${measured.name}: 发布产物里没有 cordis.patch.yml —— §3.1 的口径把它计入本体,bundle 补丁层没被打进包`)
  else if (measured.bytes > budget) failures.push(`${measured.name}: ${measured.bytes} B 超 ${label} 预算 ${budget} B —— 先砍能力,再谈压缩,不允许靠引入依赖达成`)
  if (kind !== 'matrix' && !measured.files.includes('cordis.patch.yml')) failures.push(`${measured.name}: 发布产物里没有 cordis.patch.yml —— §3.1 的口径把它计入本体,bundle 补丁层没被打进包`)
}

for (const pkgDir of workspacePackages('packages')) {
  const manifest = JSON.parse(fs.readFileSync(path.join(pkgDir, 'package.json'), 'utf8'))
  if (manifest.dsh?.matrix) check(pkgDir, '矩阵缓存', 'matrix', MATRIX_BUDGET)
  else check(pkgDir, '本体', 'body', BODY_BUDGET)
}

const patchDirs = workspacePackages('patches').filter((dir) => String(JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')).name ?? '').startsWith('@dsh-rescue/patch-'))
if (patchDirs.length === 0) console.log('单补丁:暂无补丁包可测(A8 的 ≤10 KB 待 patches/ 下建包后生效)')
for (const dir of patchDirs) check(dir, '单补丁', 'patch', PATCH_BUDGET)

console.table(rows)

if (failures.length > 0) {
  console.error(`size gate failed:\n  ${failures.join('\n  ')}`)
  process.exit(1)
}
console.log(`size gate passed: 本体 ${BODY_BUDGET} B / 矩阵缓存 ${MATRIX_BUDGET} B / 单补丁 ${PATCH_BUDGET} B(§3.1 冻结口径)`)
