/**
 * rescue 自己的原子写(§5.3.1 第 2 / 3 条,Q17 表决为「本体自写、常量对齐宿主」)。
 *
 * 对齐的是 `vendor/include/src/index.ts` 的既有语义:`.tmp` + `rename`、只读预检、对
 * `EACCES / EBUSY / EPERM` 退避重试 10 次、间隔 `(retry + 1) × 50 ms`。rescue 不另起一套
 * 写盘策略,也不 import `@deepseek-ai/dsh-atomic-write` —— 那个前缀受兼容门禁管辖,会让本体
 * 在被修插件之前先失效(§0.1、断言 A10)。
 *
 * 与宿主的两处刻意不同:临时文件名带 stamp(宿主的 `filename + '.tmp'` 是固定名,两个写入者
 * 会撞同一个临时文件),以及落盘前先留 `.bak-<stamp>` 原件 —— 逐字节等价的还原靠它,不靠结构化往返。
 */

import { createHash } from 'node:crypto'
import { constants, promises as fs } from 'node:fs'
import path from 'node:path'

import type { FileSnapshot } from '../state/store.ts'

/** 与宿主 `WRITE_RETRY_LIMIT` 同值。 */
export const WRITE_RETRY_LIMIT = 10

/** 与宿主 `WRITE_RETRY_DELAY_MS` 同值;第 n 次重试等 `(n + 1) × 50 ms`。 */
export const WRITE_RETRY_DELAY_MS = 50

/** 与宿主 `retryableWriteError` 同集合。 */
export const RETRYABLE_WRITE_ERRORS: readonly string[] = ['EACCES', 'EBUSY', 'EPERM']

/** 同一文件最多留最近几份 `.bak`(§3.1 的保留策略)。 */
export const BACKUP_KEEP = 3

/** 目标文件只读:与宿主的 `cannot overwrite readonly config` 同判据。 */
export class ReadOnlyConfigError extends Error {
  /** @param filePath 写不了的绝对路径 */
  constructor(filePath: string) {
    super(`cannot overwrite readonly config: ${filePath}`)
    this.name = 'ReadOnlyConfigError'
  }
}

/** 改名在预算内没成功:调用方不得改状态文件、不得宣称已撤回(§5.5)。 */
export class RenameBlockedError extends Error {
  /** 留在盘上的临时文件,供人核对 */
  readonly tempPath: string
  /** 最后一次系统错误码 */
  readonly code: string

  /**
   * @param tempPath 未清理的临时文件路径
   * @param code 系统错误码
   * @param detail 原始错误信息
   */
  constructor(tempPath: string, code: string, detail: string) {
    super(`rename blocked (${code}) for ${tempPath}: ${detail}. 文件仍在原处,dsh 配置未被改写;请关闭占用该文件的程序(编辑器 / 同步网盘 / 杀毒软件)后重试`)
    this.name = 'RenameBlockedError'
    this.tempPath = tempPath
    this.code = code
  }
}

function errorCode(error: unknown): string {
  return typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string' ? error.code : ''
}

/**
 * @param iso 一个 ISO 时间戳
 * @returns 文件名安全的 stamp,可直接按字典序排新旧
 */
export function stampFor(iso: string): string {
  return iso.replace(/[-:]/g, '').replace(/\./g, '')
}

/**
 * @param filePath 目标文件绝对路径
 * @param stamp 本次写入的 stamp
 * @returns 改前备份路径
 */
export function backupPathFor(filePath: string, stamp: string): string {
  return `${filePath}.bak-${stamp}`
}

/**
 * @param filePath 目标文件绝对路径
 * @param stamp 本次写入的 stamp
 * @returns 临时文件路径;带 stamp 是为了避开宿主的固定 `.tmp` 名
 */
export function tempPathFor(filePath: string, stamp: string): string {
  return `${filePath}.tmp-${stamp}`
}

/**
 * @param retry 已重试次数,从 0 起
 * @returns 本次重试前应等待的毫秒数
 */
export function retryDelayMs(retry: number): number {
  return (retry + 1) * WRITE_RETRY_DELAY_MS
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms))
}

/** 本工具自己创建的备份名形状:`<文件>.bak-<stamp>`。别人的备份一律不碰。 */
const OWN_BACKUP = /^\.bak-\d{8}T\d{9}Z$/

/**
 * 列出某文件的既有备份,由新到旧。
 *
 * @param filePath 目标文件绝对路径
 * @returns 存在的备份路径,新者在前
 */
export async function listBackupPaths(filePath: string): Promise<string[]> {
  const dir = path.dirname(filePath)
  const base = path.basename(filePath)
  const names = await fs.readdir(dir)
  return names
    .filter((name) => name.startsWith(base) && OWN_BACKUP.test(name.slice(base.length)))
    .sort()
    .reverse()
    .map((name) => path.join(dir, name))
}

/**
 * 按保留策略淘汰本工具留下的旧备份。
 *
 * 只匹配 `.bak-<stamp>` 这种由 `stampFor` 生成的名字:用户或桌面壳自己命名的备份
 * (例如 `.bak-plugin-manager`、`.bak-1790252723757`)不是本工具的对象,按字典序排会把它们
 * 误判成"最旧"删掉 —— 那份备份的来历我们无法重建。
 *
 * @param filePath 目标文件绝对路径
 * @param keep 保留几份,默认 3
 * @returns 被删除的路径列表
 */
export async function pruneBackups(filePath: string, keep: number = BACKUP_KEEP): Promise<string[]> {
  const backups = await listBackupPaths(filePath)
  const doomed = backups.slice(Math.max(0, keep))
  for (const item of doomed) await fs.rm(item, { force: true })
  return doomed
}

/** 一次成功写入的产物。 */
export interface AtomicWriteResult {
  readonly filePath: string
  readonly tempPath: string
  readonly backupPath?: string
  readonly pruned: readonly string[]
}

/**
 * 写一个用户文件:只读预检 → `.bak-<stamp>` → `.tmp-<stamp>` → `rename`,带宿主同套退避重试。
 *
 * @param filePath 目标文件绝对路径
 * @param content 完整新内容;调用方负责已经按 id 复述过原行的每个键
 * @param options `stamp` 用于可复现的测试,`keep` 覆盖备份份数
 * @returns 落盘结果,含备份与被淘汰的旧备份
 * @throws {ReadOnlyConfigError} 目标存在但不可写
 * @throws {RenameBlockedError} 重试预算内改名仍未成功;此时目标文件与状态文件都没被动过
 */
export async function writeFileAtomically(filePath: string, content: string, options?: { stamp?: string; keep?: number }): Promise<AtomicWriteResult> {
  const stamp = stampFor(options?.stamp ?? new Date().toISOString())
  const tempPath = tempPathFor(filePath, stamp)
  let existing: string | undefined
  try {
    await fs.access(filePath, constants.W_OK)
    existing = filePath
  } catch (error) {
    if (errorCode(error) !== 'ENOENT') throw new ReadOnlyConfigError(filePath)
  }
  let backupPath: string | undefined
  let pruned: readonly string[] = []
  if (existing !== undefined) {
    backupPath = backupPathFor(filePath, stamp)
    await fs.copyFile(existing, backupPath)
    pruned = await pruneBackups(filePath, options?.keep)
  }

  let lastError = ''
  for (let retry = 0; retry <= WRITE_RETRY_LIMIT; retry++) {
    if (retry > 0) await sleep(retryDelayMs(retry - 1))
    await fs.writeFile(tempPath, content, 'utf8')
    try {
      await fs.rename(tempPath, filePath)
      return backupPath === undefined
        ? { filePath, tempPath, pruned }
        : { filePath, tempPath, backupPath, pruned }
    } catch (error) {
      const code = errorCode(error)
      if (!RETRYABLE_WRITE_ERRORS.includes(code)) {
        await fs.rm(tempPath, { force: true })
        throw new RenameBlockedError(tempPath, code || 'RENAME_FAILED', String(error))
      }
      lastError = String(error)
    }
  }
  throw new RenameBlockedError(tempPath, 'EAGAIN', `exhausted ${WRITE_RETRY_LIMIT} retries: ${lastError}`)
}

/**
 * 取一个文件的并发检测材料。
 *
 * @param filePath 目标文件绝对路径
 * @returns mtime 与内容哈希;完整性校验按内容哈希,条目数 + 字节数的双计数挡不住等长替换(§5.3.1)
 */
export async function snapshotFile(filePath: string): Promise<FileSnapshot> {
  const [stat, body] = await Promise.all([fs.stat(filePath), fs.readFile(filePath)])
  return { path: filePath, mtimeMs: stat.mtimeMs, sha256: createHash('sha256').update(body).digest('hex') }
}
