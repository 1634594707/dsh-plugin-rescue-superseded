/**
 * manifest 门禁:§3.1 的两条红线 + §5.1 的「矩阵包无代码、无 install script」+ A10 的 manifest 半边。
 *
 * 兼容门禁的过滤式只管辖 `@deepseek-ai/dsh` / `@deepseek-ai/dsh-*` 前缀的 peer
 * (packages/boot/app-boot/src/plugin-compatibility.ts:75)。本体一旦声明这种 peer,harness
 * 一升级就会被预检置 disabled,修复工具比被修的插件先死 —— 所以这条守的是「工具还在不在」。
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

/** 本体与补丁允许的 peer(§3.1):两者都不落入门禁管辖范围。 */
const ALLOWED_PEERS = new Set(['@deepseek-ai/cordis', '@deepseek-ai/cordis-plugin-include'])
/** 会「安装即在你机器上执行代码」的钩子。 */
const LIFECYCLE_SCRIPTS = ['preinstall', 'install', 'postinstall', 'prepare', 'prepublish', 'prepublishOnly']

/**
 * @param {string} dir 相对项目根的路径
 * @returns {string[]} 含 package.json 的子目录
 */
function packagesIn(dir) {
  const base = path.join(root, dir)
  if (!fs.existsSync(base)) return []
  return fs
    .readdirSync(base, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && fs.existsSync(path.join(base, entry.name, 'package.json')))
    .map((entry) => path.join(base, entry.name))
}

const problems = []
const checked = []

for (const dir of [...packagesIn('packages'), ...packagesIn('patches')]) {
  const file = path.join(dir, 'package.json')
  const manifest = JSON.parse(fs.readFileSync(file, 'utf8'))
  const name = String(manifest.name ?? path.basename(dir))
  checked.push(name)

  const dependencies = manifest.dependencies
  if (dependencies !== undefined && Object.keys(dependencies).length > 0) {
    problems.push(`${name}: dependencies 必须为空(§3.1 红线),当前有 ${Object.keys(dependencies).join(', ')}`)
  }

  for (const peer of Object.keys(manifest.peerDependencies ?? {})) {
    if (!ALLOWED_PEERS.has(peer)) problems.push(`${name}: peer "${peer}" 不在允许清单内 —— dsh-* peer 会被兼容门禁管辖,让本体先于被修插件失效(A10)`)
  }

  for (const hook of LIFECYCLE_SCRIPTS) {
    if (manifest.scripts?.[hook]) problems.push(`${name}: 声明了 ${hook} 脚本 —— 安装即在用户机器上执行代码,补丁与矩阵一律禁止(§5.4)`)
  }

  if (name === '@dsh-rescue/matrix') {
    for (const codeDir of ['lib', 'src']) {
      if (fs.existsSync(path.join(dir, codeDir))) problems.push(`${name}: 含 ${codeDir}/ 目录,矩阵包必须无代码(§5.1)`)
    }
    const files = manifest.files ?? []
    if (files.some((entry) => String(entry).startsWith('lib'))) problems.push(`${name}: files 段发布了代码`)
  }

  const bundle = manifest.dsh?.bundle
  if (bundle) {
    const patch = typeof bundle === 'object' ? bundle.patch : undefined
    if (!patch || !fs.existsSync(path.join(dir, patch))) problems.push(`${name}: dsh.bundle.patch 指向不存在的文件`)
    const exportsMap = manifest.exports ?? {}
    if (typeof exportsMap !== 'object' || exportsMap['./package.json'] === undefined) problems.push(`${name}: bundle 包必须导出 ./package.json,宿主按它定位补丁层`)
  }
}

if (checked.length === 0) {
  console.error('manifest gate failed: 没找到任何 workspace 包 —— 不得按通过处理')
  process.exit(1)
}

if (problems.length > 0) {
  console.error(`manifest gate failed:\n  ${problems.join('\n  ')}`)
  process.exit(1)
}
console.log(`manifest gate passed: ${checked.length} 个包 dependencies 为空、peer 只含允许清单、无 install 钩子(${checked.join(', ')})`)
