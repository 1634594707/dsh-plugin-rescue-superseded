/**
 * 渲染前过滤(§5.2)。
 *
 * doctor 不自写报告,读的是官方 `startup-*.log`,而该报告明示原始插件错误可能含配置值或
 * 凭据且**值不脱敏**(`apps/cli/reference/README.md:75`)。因此错误摘要在进入 Web 卡片、
 * 截图或 Q3 回填之前必须过一次这里的过滤,A7 的判据范围就是「渲染前」。
 */

/** 过滤结果。 */
export interface RedactedSummary {
  readonly text: string
  readonly removed: readonly string[]
  readonly truncated: boolean
}

/** 摘要的默认截断长度。 */
export const DEFAULT_SUMMARY_MAX_CHARS = 400

interface Pattern {
  readonly label: 'path' | 'credential'
  readonly pattern: RegExp
}

/** 顺序敏感:先按凭据形状摘,再摘路径,避免带 token 的路径只剩半个。 */
const PATTERNS: readonly Pattern[] = [
  { label: 'credential', pattern: /\b(?:api[_-]?key|apikey|access[_-]?token|refresh[_-]?token|client[_-]?secret|secret|password|passwd|token|authorization)\b\s*[:=]\s*(?:"[^"]*"|'[^']*'|[^\s,;\}"'()]+)/giu },
  { label: 'credential', pattern: /\bbearer\s+[a-z0-9._~+/-]{8,}/giu },
  { label: 'credential', pattern: /\bsk-[a-z0-9_-]{16,}/giu },
  { label: 'path', pattern: /[a-z]:[\\/][^\s"'<>|]{2,}/giu },
  { label: 'path', pattern: /\\\\[^\s"'<>|]{2,}/gu },
  { label: 'path', pattern: /(?:~|\/(?:home|Users|var|opt|usr|tmp|mnt|private))\/[^\s"'<>|]*/gu },
]

const REPLACEMENT: Readonly<Record<Pattern['label'], string>> = {
  path: '[path]',
  credential: '[credential]',
}

/**
 * 过滤一段错误摘要。
 *
 * @param input 原始错误文本
 * @param options `maxChars` 覆盖默认截断长度
 * @returns 可直接进卡片的文本、被剔除的原文清单(已排序,便于两次诊断给出同一份 A7 证据)、是否截断
 */
export function redactErrorSummary(input: string, options?: { maxChars?: number }): RedactedSummary {
  const maxChars = options?.maxChars ?? DEFAULT_SUMMARY_MAX_CHARS
  const removed = new Set<string>()
  let text = input
  for (const { label, pattern } of PATTERNS) {
    text = text.replace(pattern, (match) => {
      removed.add(match)
      return label === 'path' ? REPLACEMENT.path : REPLACEMENT.credential
    })
  }
  const truncated = text.length > maxChars
  if (truncated) text = `${text.slice(0, Math.max(0, maxChars - 1))}…`
  return { text, removed: [...removed].sort(), truncated }
}
