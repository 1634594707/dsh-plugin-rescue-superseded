/**
 * 扫插件自己的依赖声明:它从官方包里拿了哪些具名符号、声明了哪些服务 key。
 *
 * 这是「能不能提 PR」的关键一面 —— 补丁要指到具体符号,而不是"这个插件坏了"。
 * 扫的是发布产物 `lib`(用户实际加载的东西),不猜源码。
 */

import fs from 'node:fs/promises'
import path from 'node:path'

/** 一条 import:来源与拿到的具名符号。 */
export interface ImportFace {
  readonly specifier: string
  readonly symbols: readonly string[]
}

/** 一个插件的依赖面。 */
export interface PluginFace {
  readonly files: number
  readonly imports: readonly ImportFace[]
  readonly injects: readonly string[]
}

/**
 * @param text 文件内容
 * @param into 收集到的 specifier → 符号集
 * @param injects 收集到的服务 key
 */
function harvest(text: string, into: Map<string, Set<string>>, injects: Set<string>): void {
  for (const match of text.matchAll(/import\s*(?:type\s*)?\{([^}]*)\}\s*from\s*["']([^"']+)["']/g)) {
    const specifier = String(match[2])
    if (!specifier.startsWith('@deepseek-ai/')) continue
    const bucket = into.get(specifier) ?? new Set<string>()
    for (const part of String(match[1]).split(',')) {
      const original = part.trim().split(/\s+as\s+/)[0]?.trim()
      if (original && original !== '') bucket.add(original)
    }
    into.set(specifier, bucket)
  }
  for (const match of text.matchAll(/import\s*["'](@deepseek-ai\/[^"']+)["']/g)) {
    if (!into.has(String(match[1]))) into.set(String(match[1]), new Set<string>())
  }
  for (const match of text.matchAll(/(?:export\s+)?(?:const|let|var)\s+inject\s*=\s*\[([^\]]*)\]/g)) {
    for (const item of String(match[1]).split(',')) {
      const key = item.trim().replace(/^['"]|['"]$/g, '')
      if (key !== '') injects.add(key)
    }
  }
  for (const match of text.matchAll(/ctx\.inject\s*=\s*\[([^\]]*)\]/g)) {
    for (const item of String(match[1]).split(',')) {
      const key = item.trim().replace(/^['"]|['"]$/g, '')
      if (key !== '') injects.add(key)
    }
  }
}

/**
 * 读一个已安装插件的依赖面。
 *
 * @param dir 插件包根目录
 * @returns 文件数、按包归类的具名符号、声明的服务 key
 */
export async function readPluginFace(dir: string): Promise<PluginFace> {
  const into = new Map<string, Set<string>>()
  const injects = new Set<string>()
  let files = 0
  const walk = async (current: string): Promise<void> => {
    for (const entry of await fs.readdir(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name)
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules') continue
        await walk(full)
      } else if (entry.name.endsWith('.js')) {
        files++
        harvest(await fs.readFile(full, 'utf8'), into, injects)
      }
    }
  }
  await walk(dir)
  return {
    files,
    imports: [...into.entries()].map(([specifier, symbols]) => ({ specifier, symbols: [...symbols].sort() })).sort((a, b) => a.specifier.localeCompare(b.specifier)),
    injects: [...injects].sort(),
  }
}
