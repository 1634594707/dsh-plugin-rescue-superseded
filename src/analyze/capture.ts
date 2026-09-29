/**
 * 真启动一次,把"哪些插件没起来、在等什么服务"变成结构化症状。
 *
 * 为什么要它:静态分析能算出 peer 会不会拦,但**缺 provider** 这类只有跑起来才知道。
 * 实测校正过两件事 —— 未激活的可选条目只打警告、**不写 `startup-*.log`**,所以症状要从
 * CLI 的启动摘要里读;而 peer 放行了的插件仍可能卡在 `waiting for service: X`。
 */

import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

/** 一条未激活条目。 */
export interface SymptomEntry {
  readonly entryId: string
  readonly module: string
  readonly state: 'pending' | 'failed'
  readonly missingServices: readonly string[]
  readonly detail?: string
}

/** 一次启动采集到的症状。 */
export interface Symptoms {
  readonly schema: 'rescue.symptoms/v1'
  readonly capturedAt: string
  readonly profile: string
  readonly home: string
  readonly command: readonly string[]
  readonly exitCode: number | null
  readonly timedOut: boolean
  readonly entries: readonly SymptomEntry[]
  readonly reportPath: string | null
  readonly notes: readonly string[]
}

/**
 * @param output dsh 的 stdout + stderr 合并文本
 * @returns 解析出的未激活条目与诊断报告路径(若有)
 */
export function parseStartupOutput(output: string): { entries: SymptomEntry[]; reportPath: string | null } {
  const entries: SymptomEntry[] = []
  const seen = new Set<string>()
  const add = (entry: SymptomEntry): void => {
    const key = `${entry.entryId}#${entry.module}#${entry.state}`
    if (seen.has(key)) return
    seen.add(key)
    entries.push(entry)
  }

  // `ui-workspace-archive-manager (@michengai/dsh-archive-manager): pending (waiting for service: webServer)`
  for (const match of output.matchAll(/^(\S+)\s+\((@?[^)]+)\):\s*pending\s+\(waiting for services?:([^)]*)\)/gim)) {
    const services = String(match[3]).split(',').map((item) => item.trim().replace(/^for\s+/, '')).filter((item) => item !== '')
    add({ entryId: String(match[1]), module: String(match[2]), state: 'pending', missingServices: services })
  }
  // 启动审计里不带 waiting 括号的 pending 行
  for (const match of output.matchAll(/^(\S+)\s+\((@?[^)]+)\):\s*pending\s*$/gim)) {
    add({ entryId: String(match[1]), module: String(match[2]), state: 'pending', missingServices: [] })
  }
  for (const match of output.matchAll(/^(\S+)\s+\((@?[^)]+)\):\s*(?:failed|error)\s*-?\s*(.*)$/gim)) {
    const detail = String(match[3] ?? '').trim()
    add({ entryId: String(match[1]), module: String(match[2]), state: 'failed', missingServices: [], ...(detail === '' ? {} : { detail }) })
  }
  // 表格式:`Plugin    Missing services` 之下的 `@scope/pkg    key1, key2`
  const table = /^(\S.*?)\s{2,}([A-Za-z][\w:.,-]*(?:,\s*[A-Za-z][\w:.,-]*)+)\s*$/gm
  for (const match of output.matchAll(table)) {
    const left = String(match[1]).trim()
    if (!left.includes('/') && !left.startsWith('@')) continue
    if (left.includes('(')) continue
    const services = String(match[2]).split(',').map((item) => item.trim()).filter((item) => item !== '')
    add({ entryId: left, module: left, state: 'pending', missingServices: services })
  }

  const report = /Full diagnostics:\s*(\S+\.log)/i.exec(output)
  return { entries, reportPath: report ? String(report[1]) : null }
}

/**
 * @param text 报告全文
 * @returns 报告里 `Plugins waiting for services` 段的条目
 */
export function parseReport(text: string): SymptomEntry[] {
  const entries: SymptomEntry[] = []
  let inside = false
  for (const line of text.split(/\r?\n/)) {
    if (/Plugins waiting for services/i.test(line)) {
      inside = true
      continue
    }
    if (inside && line.trim() === '') {
      inside = false
      continue
    }
    if (!inside) continue
    const match = /^\s*(\S+)\s{2,}(.+)$/.exec(line)
    if (!match) continue
    const left = String(match[1])
    // 表头 `Plugin    Missing services` 也是一行两列,不能当成条目
    if (left.toLowerCase() === 'plugin') continue
    entries.push({
      entryId: String(match[1]),
      module: String(match[1]),
      state: 'pending',
      missingServices: String(match[2]).split(',').map((item) => item.trim()).filter((item) => item !== ''),
    })
  }
  return entries
}

/** 一次采集的输入。 */
export interface CaptureInput {
  readonly home: string
  readonly profile: string
  readonly command: string
  /** 排在 prompt 之前的参数(通常是脚本路径) */
  readonly extraArgs: readonly string[]
  /** 传给 dsh 的占位提示词;只为让它走完启动流程,不是要它答题 */
  readonly prompt: string
  readonly timeoutMs: number
}

/**
 * 见到这些行就可以收手:启动审计已经打完了,再等下去只是一次模型请求。
 *
 * `MISSING_CREDENTIAL` 不在其中 —— 那种情况下 dsh 自己会退出,拿它当掐断信号会给采集加竞态
 * (实测:掐早了会读到空输出)。
 */
const STOP_PATTERNS: readonly RegExp[] = [/did not activate/i, /Plugins waiting for services/i, /Full diagnostics:/i]

/**
 * 启动一次 dsh 并采集症状。
 *
 * @param input 启动参数
 * @returns 症状结构;命令起不来时以 note 说明,不假装成功
 */
export async function runCapture(input: CaptureInput): Promise<Symptoms> {
  const notes: string[] = []
  // `--profile` 必须排在提示词之前:反过来 dsh 会报 "select a profile only once"(实测)
  const argv = [...input.extraArgs, '--profile', input.profile, input.prompt]
  const command = [input.command, ...argv]
  const started = await new Promise<{ code: number | null; output: string; timedOut: boolean }>((resolve) => {
    let output = ''
    let timedOut = false
    let settled = false
    let grace: NodeJS.Timeout | undefined
    let child: ReturnType<typeof spawn>
    try {
      // 把 home 传下去:不传的话 dsh 会去默认 home,排演就变成动用户的真 profile
      child = spawn(input.command, argv, { stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, DSH_HOME: input.home } })
    } catch (error) {
      notes.push(`起不动 ${input.command}:${String(error)}`)
      resolve({ code: null, output: '', timedOut: false })
      return
    }
    const stop = (code: number | null): void => {
      if (settled) return
      settled = true
      clearTimeout(hard)
      if (grace !== undefined) clearTimeout(grace)
      resolve({ code, output, timedOut })
    }
    const hard = setTimeout(() => {
      timedOut = true
      child.kill('SIGINT')
    }, input.timeoutMs)
    const onData = (chunk: Buffer): void => {
      output += chunk.toString('utf8')
      // 启动审计打完就停:多等只会换来一次模型请求
      if (grace === undefined && STOP_PATTERNS.some((pattern) => pattern.test(output))) {
        grace = setTimeout(() => child.kill('SIGINT'), 1500)
      }
    }
    child.stdout?.on('data', onData)
    child.stderr?.on('data', onData)
    child.on('error', (error: Error) => {
      notes.push(`起不动 ${input.command}:${error.message}`)
      stop(null)
    })
    child.on('close', (code) => stop(code))
  })

  const parsed = parseStartupOutput(started.output)
  const entries = [...parsed.entries]
  let reportPath = parsed.reportPath
  if (reportPath === null) {
    const logs = path.join(input.home, 'logs')
    if (fs.existsSync(logs)) {
      const newest = fs.readdirSync(logs).filter((name) => name.startsWith('startup-')).sort().pop()
      if (newest) reportPath = path.join(logs, newest)
    }
  }
  if (reportPath !== null && fs.existsSync(reportPath)) {
    const known = new Set(entries.map((entry) => `${entry.module}#${entry.state}`))
    for (const entry of parseReport(fs.readFileSync(reportPath, 'utf8'))) {
      if (!known.has(`${entry.module}#${entry.state}`)) entries.push(entry)
    }
  } else if (reportPath !== null) {
    notes.push(`报告路径来自输出但文件读不到:${reportPath}`)
  }
  if (started.timedOut) notes.push(`超过 ${Math.round(input.timeoutMs / 1000)}s 未退出,已 SIGINT;下面的条目取自它在此之前打印的内容`)
  if (entries.length === 0 && started.output.includes('MISSING_CREDENTIAL')) notes.push('组合已加载但缺 API key:未激活条目为空表示这次启动没有插件被卡住')
  if (entries.length === 0 && started.output.trim() === '') notes.push('启动没有任何输出:先确认命令与 profile 名')

  return {
    schema: 'rescue.symptoms/v1',
    capturedAt: new Date().toISOString(),
    profile: input.profile,
    home: input.home,
    command,
    exitCode: started.code,
    timedOut: started.timedOut,
    entries: entries.sort((a, b) => a.module.localeCompare(b.module) || a.state.localeCompare(b.state)),
    reportPath,
    notes,
  }
}

/**
 * @param symptoms 采集结果
 * @returns 给人看的文本
 */
export function renderSymptoms(symptoms: Symptoms): string {
  const lines = [`症状 ${symptoms.schema}(profile ${symptoms.profile},退出码 ${symptoms.exitCode ?? '无'}${symptoms.timedOut ? ',超时中断' : ''})`]
  if (symptoms.entries.length === 0) lines.push('  没有未激活条目:这次启动没有插件被卡住')
  for (const entry of symptoms.entries) {
    lines.push(`  ${entry.module} ${entry.entryId ? `(${entry.entryId})` : ''} ${entry.state === 'pending' ? 'PENDING' : 'FAILED'}${entry.missingServices.length ? ` 等待服务:${entry.missingServices.join(', ')}` : ''}${entry.detail ? ` 摘要:${entry.detail}` : ''}`)
  }
  if (symptoms.reportPath) lines.push(`  官方报告:${symptoms.reportPath}`)
  for (const note of symptoms.notes) lines.push(`  注:${note}`)
  return `${lines.join('\n')}\n`
}
