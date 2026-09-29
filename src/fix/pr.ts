/**
 * 把诊断包变成可以直接提的 PR 材料。
 *
 * 边界画在这里:**工具准备材料,人决定发不发**。这一步不 fork、不 push、不开 PR —— 往别人仓库里写
 * 东西得由有权限的人明确发起;`--open` 只打印出接下来要执行的 `gh` 命令。
 */

import fs from 'node:fs/promises'
import path from 'node:path'
import semver from 'semver'
import type { SemVer } from 'semver'

import type { DiagnosticBundle } from '../analyze/why.ts'

/** 一处 peer 提案。 */
export interface PeerProposal {
  readonly peer: string
  readonly current: string
  readonly proposed: string | null
  readonly reason: string
}

/** 一份 PR 草稿。 */
export interface PrDraft {
  readonly dir: string
  readonly files: readonly string[]
  readonly kind: 'peer-widen' | 'needs-adapter' | 'no-action'
  readonly proposals: readonly PeerProposal[]
  readonly repo: string | null
  readonly ghCommand: string | null
  readonly notes: readonly string[]
}

/**
 * @param version 目标官方版本
 * @returns 该版本线的上界:0.x 收 `0.(minor+1).0`,1+ 收 `(major+1).0.0`
 */
function upperFor(version: SemVer): string {
  return version.major === 0 ? `0.${version.minor + 1}.0` : `${version.major + 1}.0.0`
}

/**
 * 覆盖某版本线的建议范围。
 *
 * 实测(宿主同款 `includePrerelease: true`):`^0.2.0` 与 `>=0.2.0` 都**不放行** `0.2.0-rc.1`
 * —— 给作者写 `^0.2.0` 等于提一个仍然被拦的 PR。用 `>=0.2.0-0 <0.3.0` 才同时放行 rc 与 stable。
 *
 * @param target 目标官方版本
 * @returns 形如 `>=0.2.0-0 <0.3.0` 的范围,解析不了目标版本时为空
 */
export function lineRange(target: string): string | null {
  const version = semver.parse(target)
  if (!version) return null
  return `>=${version.major}.${version.minor}.0-0 <${upperFor(version)}`
}

/**
 * 逐条算 peer 提案:已满足的不动,不满足的**追加一个或分支**而不是改写原范围 ——
 * 原范围是作者已经验证过的区间,替作者收窄或改写是越权。
 *
 * @param ranges 插件现有的 dsh peer 范围
 * @param target 目标官方版本
 * @param installedNote 已装 runtime 描述
 * @returns 提案清单
 */
export function proposePeers(ranges: Readonly<Record<string, string>>, target: string | null, installedNote: readonly string[]): PeerProposal[] {
  if (target === null) {
    return Object.entries(ranges).map(([peer, current]) => ({ peer, current, proposed: null, reason: '没给 --to,无法判断该覆盖哪个版本' }))
  }
  const proposals: PeerProposal[] = []
  for (const [peer, current] of Object.entries(ranges)) {
    const failing = installedNote.some((line) => line.startsWith(`${peer} `))
    const unparsable = semver.validRange(current) === null
    if (!failing && !unparsable) proposals.push({ peer, current, proposed: null, reason: `${target} 已在原范围内,无需改动` })
    else if (unparsable) proposals.push({ peer, current, proposed: null, reason: '范围写法 semver 解析不了,得人工看原表达式' })
    else {
      const line = lineRange(target)
      const candidate = line === null ? null : `${current} || ${line}`
      const verified = candidate !== null && semver.satisfies(target, candidate, { includePrerelease: true })
      const fallback = line === null ? null : `>=${target} <${upperFor(semver.parse(target) as SemVer)}`
      const proposed = verified ? candidate : fallback !== null && semver.satisfies(target, `${current} || ${fallback}`, { includePrerelease: true }) ? `${current} || ${fallback}` : null
      proposals.push({
        peer,
        current,
        proposed,
        reason: proposed === null ? `拼不出能放行 ${target} 的范围,得人工定` : line !== null && proposed.endsWith(line) ? `原范围不含 ${target};追加版本线 ${line}(带 -0 下界才放行 rc 预发布)` : `原范围不含 ${target};追加 ${target} 本身`,
      })
    }
  }
  return proposals
}

/**
 * @param text 一份 JSON 文本
 * @returns 按行拆开的数组
 */
function linesOf(text: string): string[] {
  return text.split(/\r?\n/)
}

/**
 * 为改动的 peer 行生成带上下文的统一差异片段。
 *
 * @param oldText 安装里的 package.json 文本
 * @param proposals 带 proposed 的提案
 * @returns 差异文本;一行没改时为空串
 */
export function peerDiff(oldText: string, proposals: readonly PeerProposal[]): string {
  const changed = proposals.filter((item) => item.proposed !== null)
  if (changed.length === 0) return ''
  const oldLines = linesOf(oldText)
  const hunks: string[] = []
  for (const proposal of changed) {
    const needle = `"${proposal.peer}": "${proposal.current}"`
    const index = oldLines.findIndex((line) => line.trim().endsWith(needle) || line.trim() === `${needle},`)
    if (index === -1) {
      hunks.push(`  (未能在 package.json 里定位 ${needle.trim()} —— 作者的写法可能是多行或带空格,请人工核对)`)
      continue
    }
    const from = Math.max(0, index - 2)
    const to = Math.min(oldLines.length, index + 3)
    hunks.push(`@@ -${from + 1},${to - from} +${from + 1},${to - from} @@`)
    for (let line = from; line < to; line++) {
      if (line === index) {
        hunks.push(`- ${oldLines[line]}`)
        hunks.push(`+ ${String(oldLines[line]).replace(proposal.current, String(proposal.proposed))}`)
      } else hunks.push(`  ${oldLines[line]}`)
    }
  }
  return `${changed.map((item) => `建议:${item.peer}  ${item.current}  →  ${item.proposed}`).join('\n')}\n\n${hunks.join('\n')}\n`
}

/**
 * @param url 插件 manifest 里的仓库地址(`git+https://…git`、`git@github.com:o/r.git` 都可能出现)
 * @returns `owner/repo`,认不出归属时为空
 */
export function repoSlug(url: string | null): string | null {
  if (url === null) return null
  const cleaned = url.trim().replace(/^git\+/, '').replace(/^git@github\.com:/, 'https://github.com/').replace(/\.git$/, '')
  const match = /^https:\/\/github\.com\/([^/]+\/[^/]+)\/?$/.exec(cleaned)
  return match ? String(match[1]) : null
}

/**
 * 写一份 PR 草稿到磁盘。
 *
 * @param bundle 诊断包
 * @param packageJsonText 插件已装的 `package.json` 原文(作为 diff 的基准)
 * @param repo 作者仓库地址,拿不到就只出材料不出命令
 * @param outDir 输出目录
 * @returns 草稿清单
 */
export async function writePrDraft(bundle: DiagnosticBundle, packageJsonText: string, repo: string | null, outDir: string): Promise<PrDraft> {
  const notes: string[] = []
  const removed = bundle.gaps.filter((gap) => gap.status === 'removed')
  const proposals = proposePeers(bundle.peer.ranges, bundle.runtime.target, bundle.peer.gaps)

  const kind: PrDraft['kind'] = removed.length > 0 ? 'needs-adapter' : proposals.some((item) => item.proposed !== null) ? 'peer-widen' : 'no-action'
  if (kind === 'no-action' && bundle.runtime.target === null) notes.push('没给 --to:只出诊断包,不提改动建议')

  await fs.mkdir(outDir, { recursive: true })
  const files: string[] = []
  const write = async (name: string, content: string): Promise<void> => {
    await fs.writeFile(path.join(outDir, name), content)
    files.push(name)
  }

  const slug = bundle.plugin.name.replace(/^@/, '').replace(/[\/@]/g, '_')
  await write('diagnostic.json', `${JSON.stringify(bundle, null, 2)}\n`)

  const diff = peerDiff(packageJsonText, proposals)
  if (diff !== '') await write('peer-dependencies.diff', diff)

  if (removed.length > 0) {
    const missingKeys = bundle.serviceKeys.filter((item) => item.status !== 'provided-both').map((item) => item.key)
    await write(
      'adapter-skeleton.js',
      [
        '// 适配包骨架:符号在新版公开面里没了,新语义无法从包里读出来,所以这里**不替你实现**。',
        '// 需要人工确认每个符号的新对应,再填实。删掉这个注释前请不要发布。',
        `export const name = 'dsh-rescue-patch-${slug}'`,
        `export const inject = [${missingKeys.map((key) => JSON.stringify(key)).join(', ')}]`,
        'export function apply(ctx) {',
        ...removed.map((gap) => `  // TODO ${gap.specifier} 的 ${gap.symbol} ${gap.candidates.length ? `(候选:${gap.candidates.join(', ')})` : '(无候选)'} —— 确认新 API 后再 provide`),
        '  return () => {}',
        '}',
        '',
      ].join('\n'),
    )
    notes.push('存在新版里消失的符号:已出适配骨架,不出 peer-only PR —— 猜映射会把静默失效变成崩溃')
  }

  const body = [
    `## 症状`,
    '',
    `- ${bundle.plugin.name}@${bundle.plugin.version} 在 dsh ${bundle.runtime.installed ?? '未识别'} 下**被预检拦下**(peer 判定:${bundle.peer.verdict})。`,
    ...(bundle.peer.gaps.length > 0 ? bundle.peer.gaps.map((line) => `  - ${line}`) : []),
    ...(bundle.runtime.target ? [`- 对照目标版本 ${bundle.runtime.target} 做了公开面 diff。`] : []),
    '',
    '## 诊断',
    '',
    removed.length > 0
      ? `- 有 ${removed.length} 个它 import 的具名符号在 ${bundle.runtime.target ?? '目标版本'} 的公开面里找不到了:`
      : `- 它 import 的具名符号在 ${bundle.runtime.target ?? '目标版本'} 的公开面里**都还在**(${bundle.surfaces.map((surface) => `${surface.specifier} ${surface.oldSymbols}→${surface.newSymbols}`).join(', ') || '未做面 diff'}),所以这不是 API 变更,是 peer 范围过窄。`,
    ...removed.map((gap) => `  - ${gap.specifier} 的 \`${gap.symbol}\`${gap.candidates.length ? `,候选:${gap.candidates.join(', ')}` : ''}`),
    '',
    '## 建议改动',
    '',
    proposals.some((item) => item.proposed !== null) ? '```diff\n' + diff + '```' : '无需改动 peer。',
    '',
    '## 怎么复现与验证',
    '',
    '```sh',
    'dsh-rescue doctor --profile <你的 profile>',
    `dsh-rescue why ${bundle.plugin.name} --to ${bundle.runtime.target ?? '<官方版本>'} --json`,
    '```',
    '',
    '(工具尚未发布到 npm;仓库内用 `node lib/cli.js …` 代替 `dsh-rescue …`。)',
    '',
    `附件:${files.join(', ')}(其中 \`diagnostic.json\` 是 ${bundle.schema})`,
    '',
    `生成:${bundle.generatedAt}`,
    '',
  ].join('\n')
  await write('PR.md', body)

  const repoName = repoSlug(repo)
  const ghCommand = repoName === null ? null : `gh pr create --repo ${repoName} --title "fix: 放宽 dsh peer 范围以兼容 ${bundle.runtime.target ?? '新版'}" --body-file ${path.join(outDir, 'PR.md')}`
  if (repoName === null) notes.push('package.json 里没有可认的 GitHub 仓库地址,未生成 gh 命令')

  return { dir: outDir, files, kind, proposals, repo, ghCommand, notes }
}
