/**
 * 按宿主的门禁语义算 peer:预检只看 `@deepseek-ai/dsh` 前缀的 peer,并带 `includePrerelease`
 * (`plugin-compatibility.ts:75,77`)。这条决定「会不会被拦」,和本机 profile 里的实际安装版本比对即可得出。
 */

import semver from 'semver'

import type { ProfileSnapshot } from './profile.ts'

/** 一条不满足的 peer。 */
export interface PeerGap {
  readonly plugin: string
  readonly version: string
  readonly peer: string
  readonly range: string
  readonly installed: string | null
}

/** 一个 bundle 的判定。 */
export interface BundleVerdict {
  readonly plugin: string
  readonly version: string
  readonly gaps: readonly PeerGap[]
  /** 声明了但整包没装上的 peer —— 放宽范围救不了它。 */
  readonly uninstalledPeers: readonly PeerGap[]
  /** peer 范围写法 semver 解析不了(常见于 `workspace:*` 这类没被替换干净的占位)。 */
  readonly unparsable: readonly PeerGap[]
}

/** 一次评估的全部结论。 */
export interface Evaluation {
  readonly runtimeVersion: string | null
  readonly blocked: readonly BundleVerdict[]
  readonly exempted: readonly BundleVerdict[]
  readonly compatible: readonly string[]
  readonly missingBundles: readonly string[]
  readonly runtimeBundles: readonly string[]
}

/**
 * @param name peer 包名
 * @returns 是否落在宿主门禁的管辖前缀内
 */
function isManagedPeer(name: string): boolean {
  return name === '@deepseek-ai/dsh' || name.startsWith('@deepseek-ai/dsh-')
}

/**
 * 评估一个 profile 里 `dsh.profile.bundles` 声明的每个 bundle。
 *
 * @param snapshot profile 读取结果
 * @returns 会被拦的、已写豁免放行的、peer 全满足的、以及声明了却没装上的
 */
export function evaluateProfile(snapshot: ProfileSnapshot): Evaluation {
  const runtimeVersion = snapshot.runtimeVersion
  const byName = new Map(snapshot.installed.map((entry) => [entry.name, entry]))
  const blocked: BundleVerdict[] = []
  const exempted: BundleVerdict[] = []
  const compatible: string[] = []
  const missingBundles: string[] = []
  const runtimeBundles: string[] = []

  for (const bundle of [...snapshot.bundles].sort()) {
    // 官方 runtime 自己不算被诊断对象:它的 peer 是 workspace 占位,判定归给安装面。
    if (bundle === '@deepseek-ai/dsh' || bundle.startsWith('@deepseek-ai/dsh-')) {
      runtimeBundles.push(bundle)
      continue
    }
    const installed = byName.get(bundle)
    if (!installed || runtimeVersion === null) {
      if (!installed) missingBundles.push(bundle)
      continue
    }
    const gaps: PeerGap[] = []
    const uninstalledPeers: PeerGap[] = []
    const unparsable: PeerGap[] = []
    for (const [peer, range] of Object.entries(installed.peerRanges).sort(([left], [right]) => left.localeCompare(right))) {
      if (!isManagedPeer(peer)) continue
      const peerVersion = snapshot.runtimePackages[peer] ?? null
      if (semver.validRange(range) === null) {
        unparsable.push({ plugin: installed.name, version: installed.version, peer, range, installed: peerVersion })
        continue
      }
      if (peerVersion !== null && semver.satisfies(peerVersion, range, { includePrerelease: true })) continue
      const gap: PeerGap = { plugin: installed.name, version: installed.version, peer, range, installed: peerVersion }
      if (peerVersion === null) uninstalledPeers.push(gap)
      else gaps.push(gap)
    }
    const verdict: BundleVerdict = { plugin: installed.name, version: installed.version, gaps, uninstalledPeers, unparsable }
    const granted = snapshot.exemptions[`${installed.name}@${installed.version}`] ?? []
    if (gaps.length === 0 && uninstalledPeers.length === 0 && unparsable.length === 0) compatible.push(installed.name)
    else if (granted.includes(runtimeVersion)) exempted.push(verdict)
    else blocked.push(verdict)
  }

  return { runtimeVersion, blocked, exempted, compatible, missingBundles, runtimeBundles }
}
