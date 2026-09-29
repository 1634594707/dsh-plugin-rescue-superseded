/**
 * 矩阵缓存的键与淘汰(§5.1、§3.1)。
 *
 * 键按 `generatedFor` 的 minor 段而不是 harness 精确版本:记录按区间匹配,harness 每打一个
 * patch 版本就产生新键,旧缓存被 retain 淘汰,拉回来的内容却几乎没变 —— 既浪费,又把真正
 * 需要的「上一份」挤掉。
 */

import type { MatrixChannel } from './schema.ts'

/**
 * 取 `generatedFor` 的 minor 段。
 *
 * @param version harness 精确版本或 rc 版本,如 `0.2.0-rc.1`
 * @returns `major.minor`,如 `0.2`;无法解析时原样返回,由调用方的断言暴露问题
 */
export function generatedForMinor(version: string): string {
  const match = /^(\d+)\.(\d+)/.exec(version.trim())
  return match ? `${match[1]}.${match[2]}` : version.trim()
}

/** 缓存键的输入。 */
export interface CacheKeyInput {
  readonly generatedFor: string
  readonly channel: MatrixChannel
  readonly matrixMajor: string | number
}

/**
 * @param input 矩阵的生成版本、通道与 major
 * @returns 形如 `0.2-rc-v1` 的缓存文件名后缀
 */
export function matrixCacheKey(input: CacheKeyInput): string {
  return `${generatedForMinor(input.generatedFor)}-${input.channel}-v${input.matrixMajor}`
}

/** 缓存目录里的一份矩阵。 */
export interface CacheEntry {
  readonly key: string
  readonly bytes: number
  readonly writtenAt: number
}

/** 一次写入的处置结果。 */
export type CacheDecision =
  | { readonly action: 'write'; readonly keep: readonly string[]; readonly evict: readonly string[] }
  | { readonly action: 'reject-oversize'; readonly keep: readonly string[]; readonly evict: readonly [] }

/** 淘汰计划的输入。 */
export interface CachePlanInput {
  readonly incoming: CacheEntry
  readonly existing: readonly CacheEntry[]
  readonly maxCacheBytes: number
  readonly retain: number
}

/**
 * 规划一次矩阵写入的保留与淘汰。
 *
 * 两条已定死的规则(§3.1):字节上限优先于份数 —— 宁可少留一份,不可突破预算;
 * 单份超预算时拒收并回退上一份 —— 不截断,截断会静默丢修法。
 *
 * @param input 待写入的一份、目录里已有的份数、字节上限与份数上限
 * @returns `reject-oversize` 时不写不动;`write` 时给出保留键集合与应删除的旧键
 */
export function planCacheWrite(input: CachePlanInput): CacheDecision {
  if (input.incoming.bytes > input.maxCacheBytes) {
    return { action: 'reject-oversize', keep: input.existing.map((entry) => entry.key), evict: [] }
  }
  const keep: string[] = [input.incoming.key]
  let used = input.incoming.bytes
  const byAge = [...input.existing].filter((entry) => entry.key !== input.incoming.key).sort((a, b) => b.writtenAt - a.writtenAt)
  for (const entry of byAge) {
    if (keep.length >= input.retain) break
    if (used + entry.bytes > input.maxCacheBytes) break
    keep.push(entry.key)
    used += entry.bytes
  }
  const kept = new Set(keep)
  return { action: 'write', keep, evict: input.existing.filter((entry) => !kept.has(entry.key)).map((entry) => entry.key) }
}
