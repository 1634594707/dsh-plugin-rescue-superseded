/**
 * 插件市场对照:先问"作者修好了吗",再谈"要不要打补丁"。
 *
 * 数据源是 dshmarket 用的同一份索引(`awesome-dsh-plugin.com/plugins.json` 与 `updates.json`),
 * 索引里带 npm 名、市场版本、下载量、能力声明,以及按仓库 URL 归键的最新 release 说明。
 * 判据顺序是硬的:最新版 peer 已覆盖当前 runtime ⇒ 让用户升级,不给豁免也不备 PR 材料 ——
 * 替一个已被作者修好的插件打补丁,是在给社区制造重复劳动。
 */

import fs from 'node:fs/promises'
import path from 'node:path'
import semver from 'semver'

import type { PackageManifest } from './surface.ts'

/** 市场索引里的一个插件。 */
export interface MarketEntry {
  readonly name: string
  readonly owner?: string
  readonly url: string
  readonly page?: string
  readonly category?: string
  readonly description?: { readonly en?: string; readonly zh?: string }
  readonly npm?: string
  readonly version?: string
  readonly stars?: number
  readonly downloads?: number
  readonly capabilities?: readonly string[]
  readonly capabilityRedLines?: readonly string[]
}

/** 仓库最新 release。 */
export interface ReleaseInfo {
  readonly tag?: string
  readonly name?: string
  readonly publishedAt?: string
  readonly url?: string
  readonly body?: string
}

/** `plugins.json` 的顶层结构。 */
interface PluginsDocument {
  readonly plugins?: readonly MarketEntry[]
}

/** `updates.json` 的顶层结构,按仓库 URL 归键。 */
interface UpdatesDocument {
  readonly updates?: Record<string, { readonly release?: ReleaseInfo } | undefined>
}

/** 一次索引加载的结果,`cached` 表示这次没有出网。 */
interface Loaded<T> {
  readonly value: T
  readonly fetchedAt: string
  readonly cached: boolean
}

/** 两份索引的合并视图。 */
export interface MarketIndex {
  readonly byNpm: ReadonlyMap<string, MarketEntry>
  readonly releases: ReadonlyMap<string, ReleaseInfo>
  readonly fetchedAt: string | null
  readonly fromCache: boolean
  readonly notes: readonly string[]
}

/** 一个插件的对照结论。 */
export interface MarketVerdict {
  readonly plugin: string
  readonly installed: string
  readonly inMarket: boolean
  readonly marketVersion: string | null
  readonly updateAvailable: boolean
  /** 市场最新版的 dsh peer 是否覆盖当前 runtime。 */
  readonly upstreamCovers: boolean | null
  readonly release: ReleaseInfo | null
  /** 作者 release 说明里谈到版本兼容的那一句,没有就为空。 */
  readonly releaseNote: string | null
  readonly verdict: 'author-fixed' | 'upgrade-maybe' | 'still-broken' | 'not-in-market' | 'unknown'
  /** 给人看的一句话结论:同一个 `author-fixed`,插件当前被拦和完全正常不是一回事。 */
  readonly headline: string
  readonly evidence: string | null
  readonly downloads: number | null
  readonly category: string | null
  readonly redLines: readonly string[]
}

const PLUGINS_URL = 'https://awesome-dsh-plugin.com/plugins.json'
const UPDATES_URL = 'https://awesome-dsh-plugin.com/updates.json'
const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000

/** 拉索引用的注入点,测试里给假实现。 */
export type Fetcher = (url: string) => Promise<unknown>

/**
 * @param url 索引地址
 * @returns 解析后的 JSON
 */
const jsonFetcher: Fetcher = async (url) => {
  const response = await fetch(url, { signal: AbortSignal.timeout(60_000) })
  if (!response.ok) throw new Error(`${url} → HTTP ${response.status}`)
  return (await response.json()) as unknown
}

/**
 * @param dir 缓存目录
 * @returns 市场缓存目录
 */
export function marketCacheDir(dir: string): string {
  return path.join(dir, 'market')
}

/**
 * 读市场索引:缓存新鲜就用缓存,否则拉网络;网络失败退回缓存并说明。
 *
 * @param options `cacheDir` 缓存目录、`ttlMs` 新鲜期、`fetcher` 注入的取数实现、`offline` 只用缓存
 * @returns 合并视图
 */
export async function loadMarket(options: { cacheDir: string; ttlMs?: number; fetcher?: Fetcher; offline?: boolean }): Promise<MarketIndex> {
  const cacheDir = marketCacheDir(options.cacheDir)
  const ttl = options.ttlMs ?? DEFAULT_TTL_MS
  const notes: string[] = []
  await fs.mkdir(cacheDir, { recursive: true })

  const readCache = async <T>(file: string): Promise<{ value: T; fetchedAt: string } | null> => {
    try {
      const raw = JSON.parse(await fs.readFile(path.join(cacheDir, file), 'utf8')) as { fetchedAt: string; value: T }
      return raw
    } catch {
      return null
    }
  }

  const fresh = (fetchedAt: string): boolean => Date.now() - Date.parse(fetchedAt) < ttl

  /**
   * @param file 缓存文件名
   * @param url 索引地址
   * @returns 解析后的索引值
   */
  async function load<T>(file: string, url: string): Promise<Loaded<T>> {
    const cached = await readCache<T>(file)
    if (cached && fresh(cached.fetchedAt)) return { value: cached.value, fetchedAt: cached.fetchedAt, cached: true }
    if (options.offline) {
      if (cached) return { value: cached.value, fetchedAt: cached.fetchedAt, cached: true }
      throw new Error(`离线且没有 ${file} 缓存`)
    }
    const fetcher = options.fetcher ?? jsonFetcher
    try {
      const value = (await fetcher(url)) as T
      const fetchedAt = new Date().toISOString()
      await fs.writeFile(path.join(cacheDir, file), JSON.stringify({ fetchedAt, value }))
      return { value, fetchedAt, cached: false }
    } catch (error) {
      if (cached) {
        notes.push(`${file} 拉取失败(${String(error)}),用了 ${cached.fetchedAt} 的缓存`)
        return { value: cached.value, fetchedAt: cached.fetchedAt, cached: true }
      }
      notes.push(`${file} 拉取失败且无缓存:${String(error)}`)
      throw error
    }
  }

  const [plugins, updates] = await Promise.all([
    load<PluginsDocument>('plugins.json', PLUGINS_URL),
    load<UpdatesDocument>('updates.json', UPDATES_URL).catch((): Loaded<UpdatesDocument> => ({ value: {}, fetchedAt: new Date(0).toISOString(), cached: true })),
  ])

  const byNpm = new Map<string, MarketEntry>()
  for (const entry of plugins.value.plugins ?? []) {
    if (typeof entry.npm === 'string' && !byNpm.has(entry.npm)) byNpm.set(entry.npm, entry)
  }
  const releases = new Map<string, ReleaseInfo>()
  for (const [url, item] of Object.entries(updates.value.updates ?? {})) {
    if (item?.release) releases.set(url, item.release)
  }
  if (plugins.cached) notes.push(`市场索引来自缓存(${plugins.fetchedAt})`)
  return { byNpm, releases, fetchedAt: plugins.fetchedAt, fromCache: plugins.cached, notes }
}

/**
 * @param verdict 对照结论
 * @param blockedNow 该插件此刻是否被预检拦下
 * @param updateAvailable 市场是否有可升级的新版
 * @returns 一句话结论;`author-fixed` 对"正坏着"和"好着"的插件是两件事
 */
function headlineFor(verdict: MarketVerdict['verdict'], blockedNow: boolean, updateAvailable: boolean): string {
  if (verdict === 'author-fixed') return blockedNow ? (updateAvailable ? '作者已修:升级即可,不用打补丁' : '作者已修:本机已是最新') : updateAvailable ? '当前正常;有新版可升' : '当前正常,且已是最新'
  if (verdict === 'still-broken') return blockedNow ? '作者未修:要补丁或豁免' : '当前正常,但对照版本下会被拦'
  if (verdict === 'not-in-market') return '不在市场索引:只按本机文件判'
  return updateAvailable ? '有新版,但未确认覆盖' : '未确认'
}

/**
 * @param profile 要升级的 profile 名
 * @param plugin 插件包名
 * @returns 用户可直接抄的升级命令;`dsh plugin` 的 `--profile` 是必需项,少了就是一条跑不通的命令
 */
export function upgradeCommand(profile: string, plugin: string): string {
  return `dsh plugin --profile ${profile} update ${plugin}`
}

/**
 * 对照一个已装插件。
 *
 * @param input 插件名、已装版本、判定用的 runtime、市场索引、该插件此刻是否被预检拦下;`manifest` 取市场最新版的 peer,不给就只报"有新版未确认"
 * @returns 结论;`author-fixed` 表示升级即可,不该再打补丁
 */
export async function assessPlugin(input: {
  readonly plugin: string
  readonly installed: string
  readonly runtime: string | null
  readonly market: MarketIndex
  /** 此刻是否被预检拦下:决定这句话是"作者已修,升级就行"还是"当前正常,有新版可升"。 */
  readonly blockedNow: boolean
  readonly manifest?: (name: string, version: string) => Promise<PackageManifest | null>
}): Promise<MarketVerdict> {
  /**
   * @param row 不含结论句的行
   * @returns 补上一句话结论的行
   */
  const finish = (row: Omit<MarketVerdict, 'headline'>): MarketVerdict => ({ ...row, headline: headlineFor(row.verdict, input.blockedNow, row.updateAvailable) })
  const entry = input.market.byNpm.get(input.plugin)
  const downloads = typeof entry?.downloads === 'number' ? entry.downloads : null
  const category = typeof entry?.category === 'string' ? entry.category : null
  const redLines = entry?.capabilityRedLines ?? []
  const base: Omit<MarketVerdict, 'verdict' | 'upstreamCovers' | 'updateAvailable' | 'marketVersion' | 'release' | 'releaseNote' | 'evidence' | 'headline'> = {
    plugin: input.plugin,
    installed: input.installed,
    inMarket: entry !== undefined,
    downloads,
    category,
    redLines,
  }
  if (!entry || typeof entry.version !== 'string') {
    return finish({ ...base, marketVersion: null, updateAvailable: false, upstreamCovers: null, release: null, releaseNote: null, verdict: 'not-in-market', evidence: null })
  }
  const release = typeof entry.url === 'string' ? input.market.releases.get(entry.url) ?? null : null
  const releaseNote = releaseEvidence(release)
  const comparableInstalled = semver.valid(input.installed) ?? semver.coerce(input.installed)?.version ?? null
  const updateAvailable = comparableInstalled !== null && semver.valid(entry.version) !== null ? semver.gt(entry.version, comparableInstalled) : false
  // 没给 runtime、也没给取 manifest 的方法,都只能停在"有新版但未确认"—— 不猜最新版覆盖不覆盖。
  if (input.runtime === null || input.manifest === undefined) {
    return finish({ ...base, marketVersion: entry.version, updateAvailable, upstreamCovers: null, release, releaseNote, verdict: updateAvailable ? 'upgrade-maybe' : 'unknown', evidence: null })
  }
  const manifest = await input.manifest(input.plugin, entry.version)
  if (manifest === null) {
    return finish({ ...base, marketVersion: entry.version, updateAvailable, upstreamCovers: null, release, releaseNote, verdict: updateAvailable ? 'upgrade-maybe' : 'unknown', evidence: null })
  }
  const uncovered: string[] = []
  const unresolved: string[] = []
  const covered: string[] = []
  for (const [peer, range] of Object.entries(manifest.peerDependencies ?? {})) {
    if (peer !== '@deepseek-ai/dsh' && !peer.startsWith('@deepseek-ai/dsh-')) continue
    const short = peer.replace('@deepseek-ai/dsh-', '')
    if (semver.validRange(range) === null) {
      unresolved.push(`${short} 的范围「${range}」解析不了`)
      continue
    }
    if (semver.satisfies(input.runtime, range, { includePrerelease: true })) covered.push(`${short} ${range}`)
    else uncovered.push(`${short} 要 ${range},不含 ${input.runtime}`)
  }
  const shared = { ...base, marketVersion: entry.version, updateAvailable, release, releaseNote }
  if (uncovered.length > 0) {
    // 最新版亲手写的范围就不覆盖判定的 runtime —— 说成"可以考虑升级"会指挥用户去做一件不解决问题的事。
    return finish({ ...shared, upstreamCovers: false, verdict: 'still-broken', evidence: uncovered[0] ?? null })
  }
  if (unresolved.length > 0) {
    return finish({ ...shared, upstreamCovers: null, verdict: updateAvailable ? 'upgrade-maybe' : 'unknown', evidence: unresolved[0] ?? null })
  }
  const upstreamCount = covered.length
  return finish({
    ...shared,
    upstreamCovers: true,
    verdict: 'author-fixed',
    // 十几个 peer 全列出来没人读;数量 + runtime 才是"升级就行"的那条信息。
    evidence:
      upstreamCount === 0
        ? `最新 ${entry.version} 不声明 dsh peer,该 runtime 不会被预检拦`
        : upstreamCount === 1
          ? `最新 ${entry.version} 的 peer 覆盖 ${input.runtime}:${covered[0] ?? ''}`
          : `最新 ${entry.version} 的 ${upstreamCount} 个 dsh peer 全部覆盖 ${input.runtime}`,
  })
}

/** 只有真正谈到版本兼容的行才配当证据:关键词与版本号同句出现,安装命令与流水账不算。 */
const COMPAT_LINE = /(适配|兼容|覆盖|放宽|收紧|下限|上限|要求|可用在|可以用在|\bpeer\b|compatib|\bdsh\b|\bharness\b)[^\n]{0,40}?\d+\.\d+|dsh\s*\d+\.\d+|\d+\.\d+[^\n]{0,30}(适配|兼容|peer|覆盖)/i
const NOT_EVIDENCE = /--profile|\badd\s+@|\$ (npm|pnpm|dsh)|安装命令|\/compare\/|commits?$|\d+ commits/

/**
 * @param release 最新 release
 * @returns 作者说明里第一条版本兼容陈述;没有就说没有
 */
function releaseEvidence(release: ReleaseInfo | null): string | null {
  if (!release?.body) return null
  const line = release.body
    .split(/\r?\n/)
    .map((item) => item.trim())
    .find((item) => item.length > 8 && COMPAT_LINE.test(item) && !NOT_EVIDENCE.test(item))
  return line ? line.replace(/^([#>\s]|[-*]\s)*/, '').replace(/\*\*/g, '').slice(0, 200) : null
}

/** 一行市场结论:对照结果 + 该 profile 里可直接抄的升级命令。 */
export interface MarketRow extends MarketVerdict {
  /** 有可升级版本时给出 `dsh plugin --profile … update …`;没有可升级版本为空。 */
  readonly upgrade: string | null
}

/**
 * @param verdicts 对照结论
 * @param profile 本机 profile 名
 * @returns 带升级命令的行,文本与界面共用同一份命令串
 */
export function marketRows(verdicts: readonly MarketVerdict[], profile: string): MarketRow[] {
  return verdicts.map((verdict) => ({ ...verdict, upgrade: verdict.updateAvailable ? upgradeCommand(profile, verdict.plugin) : null }))
}

/**
 * @param verdicts 对照结论
 * @param header 判定口径说明(哪个 runtime),缺省不印
 * @returns 给人看的表格文本
 */
export function renderMarket(verdicts: readonly MarketRow[], header?: string): string {
  const lines = [header ? `插件市场对照(${header})` : '插件市场对照']
  for (const verdict of [...verdicts].sort((a, b) => a.plugin.localeCompare(b.plugin))) {
    lines.push(`  ${verdict.plugin} ${verdict.installed} → ${verdict.marketVersion ?? '?'}  ${verdict.headline}${verdict.downloads !== null ? ` · 下载 ${verdict.downloads}` : ''}`)
    if (verdict.evidence) lines.push(`      依据:${verdict.evidence}`)
    if (verdict.upgrade) lines.push(`      命令:${verdict.upgrade}`)
    if (verdict.releaseNote) lines.push(`      作者说:${verdict.releaseNote}`)
    if (verdict.release?.publishedAt) lines.push(`      作者发布:${verdict.release.name ?? verdict.release.tag} @ ${verdict.release.publishedAt}`)
    if (verdict.redLines.length > 0) lines.push(`      能力红线:${verdict.redLines.join(', ')}`)
  }
  return `${lines.join('\n')}\n`
}
