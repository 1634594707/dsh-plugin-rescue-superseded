/**
 * 市场对照的判据:作者已修 ⇒ 升级,不生成补丁建议。缓存与离线退回也要有结论,不能静默。
 */

import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { assessPlugin, loadMarket, marketCacheDir, marketRows, renderMarket } from '../src/analyze/market.ts'
import type { PackageManifest } from '../src/analyze/surface.ts'

const RUNTIME = '0.2.0-rc.1'

/**
 * @param npm 包名
 * @param version 版本
 * @param ranges 该版本的 dsh peer 范围
 * @returns 一份 manifest
 */
function manifestOf(npm: string, version: string, ranges: Record<string, string>): PackageManifest {
  return { name: npm, version, peerDependencies: ranges }
}

/**
 * @param overrides 覆盖个别字段
 * @returns 一份市场索引响应
 */
function pluginsDoc(overrides: Record<string, unknown> = {}) {
  return {
    name: 'awesome-dsh-plugin',
    url: 'https://awesome-dsh-plugin.com/plugins.json',
    source: 'probe',
    updated: '2026-09-29',
    count: 2,
    plugins: [
      { name: 'fixed-one', owner: 'a', url: 'https://github.com/a/fixed-one', npm: '@a/fixed-one', version: '2.1.0', category: 'session', downloads: 4200, capabilityRedLines: ['fs-write'] },
      { name: 'broken-one', owner: 'b', url: 'https://github.com/b/broken-one', npm: '@b/broken-one', version: '1.0.0', category: 'ui', downloads: 12 },
    ],
    ...overrides,
  }
}

/**
 * @returns updates.json 响应:作者说明里写着适配 0.2.x
 */
function updatesDoc() {
  return {
    name: 'awesome-dsh-plugin-updates',
    updated: '2026-09-29',
    count: 1,
    updates: {
      'https://github.com/a/fixed-one': {
        release: { tag: 'v2.1.0', name: 'v2.1.0', publishedAt: '2026-09-28T13:26:50Z', url: 'https://github.com/a/fixed-one/releases/tag/v2.1.0', body: '## 2.1.0\n\n适配 DSH 0.2.x:三段 peer 范围上限原为 `<0.2.0-0`,`0.2.0-rc.1` 落在范围外,已放宽。' },
        commits: [],
        checkedAt: '2026-09-29',
      },
    },
  }
}

/**
 * @returns 一个临时缓存目录
 */
async function tempDir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'dsh-rescue-market-'))
}

test('the index is fetched once, cached, and reused while fresh', async () => {
  const dir = await tempDir()
  let calls = 0
  const fetcher = async (url: string) => {
    calls++
    return url.endsWith('plugins.json') ? pluginsDoc() : updatesDoc()
  }
  const first = await loadMarket({ cacheDir: dir, fetcher })
  assert.equal(first.byNpm.size, 2)
  assert.equal(first.fromCache, false)
  assert.equal(calls, 2)
  assert.ok(first.releases.get('https://github.com/a/fixed-one')?.body?.includes('适配 DSH 0.2.x'))

  const second = await loadMarket({ cacheDir: dir, fetcher })
  assert.equal(second.fromCache, true)
  assert.equal(calls, 2, '新鲜期内不该再打网络')
  assert.ok(second.notes.some((note) => /缓存/.test(note)))
  await fs.rm(dir, { recursive: true, force: true })
})

test('a failed fetch falls back to the cache and says so instead of pretending it is live', async () => {
  const dir = await tempDir()
  await loadMarket({ cacheDir: dir, fetcher: async (url) => (url.endsWith('plugins.json') ? pluginsDoc() : updatesDoc()) })
  const stale = await loadMarket({
    cacheDir: dir,
    ttlMs: -1,
    fetcher: async () => {
      throw new Error('HTTP 503')
    },
  })
  assert.equal(stale.fromCache, true)
  assert.ok(stale.notes.some((note) => /HTTP 503/.test(note)), `实际 notes:${stale.notes.join(' | ')}`)
  await fs.rm(dir, { recursive: true, force: true })
})

test('offline with no cache is an error, not an empty index', async () => {
  const dir = await tempDir()
  await assert.rejects(() => loadMarket({ cacheDir: dir, offline: true }), /离线且没有/)
  await fs.rm(dir, { recursive: true, force: true })
})

test('an author release that covers the runtime is reported as fixed, not patchable', async () => {
  const dir = await tempDir()
  const market = await loadMarket({ cacheDir: dir, fetcher: async (url) => (url.endsWith('plugins.json') ? pluginsDoc() : updatesDoc()) })
  const verdict = await assessPlugin({
    plugin: '@a/fixed-one',
    installed: '2.0.3',
    runtime: RUNTIME,
    market,
    blockedNow: true,
    manifest: async () => manifestOf('@a/fixed-one', '2.1.0', { '@deepseek-ai/dsh-session': '>=0.2.0-0 <0.3.0' }),
  })
  assert.equal(verdict.verdict, 'author-fixed')
  assert.equal(verdict.upstreamCovers, true)
  assert.equal(verdict.updateAvailable, true)
  assert.equal(verdict.marketVersion, '2.1.0')
  assert.match(String(verdict.evidence), /最新 2\.1\.0 的 peer 覆盖 0\.2\.0-rc\.1:session >=0\.2\.0-0 <0\.3\.0/)
  assert.match(String(verdict.releaseNote), /适配 DSH 0\.2\.x/)
  assert.equal(verdict.downloads, 4200)
  assert.deepEqual(verdict.redLines, ['fs-write'])
  assert.match(renderMarket(marketRows([verdict], 'desktop')), /作者已修:升级即可,不用打补丁/)
  assert.match(renderMarket(marketRows([verdict], 'desktop')), /命令:dsh plugin --profile desktop update @a\/fixed-one/)
  await fs.rm(dir, { recursive: true, force: true })
})

test('a latest release that still misses the runtime is reported as still broken', async () => {
  const dir = await tempDir()
  const market = await loadMarket({ cacheDir: dir, fetcher: async (url) => (url.endsWith('plugins.json') ? pluginsDoc() : updatesDoc()) })
  const verdict = await assessPlugin({
    plugin: '@a/fixed-one',
    installed: '2.0.3',
    runtime: RUNTIME,
    market,
    blockedNow: true,
    manifest: async () => manifestOf('@a/fixed-one', '2.1.0', { '@deepseek-ai/dsh-session': '^0.1.0' }),
  })
  assert.equal(verdict.verdict, 'still-broken')
  assert.equal(verdict.upstreamCovers, false)
  assert.match(String(verdict.evidence), /不含 0\.2\.0-rc\.1/)
  await fs.rm(dir, { recursive: true, force: true })
})

test('an unparsable upstream range is reported as unresolved, not as compatible', async () => {
  const dir = await tempDir()
  const market = await loadMarket({ cacheDir: dir, fetcher: async (url) => (url.endsWith('plugins.json') ? pluginsDoc() : updatesDoc()) })
  const verdict = await assessPlugin({
    plugin: '@a/fixed-one',
    installed: '2.0.3',
    runtime: RUNTIME,
    market,
    blockedNow: true,
    manifest: async () => manifestOf('@a/fixed-one', '2.1.0', { '@deepseek-ai/dsh-session': 'weird-thing' }),
  })
  assert.equal(verdict.upstreamCovers, null)
  assert.equal(verdict.verdict, 'upgrade-maybe')
  assert.match(String(verdict.evidence), /解析不了/)
  await fs.rm(dir, { recursive: true, force: true })
})

test('a plugin missing from the index or from npm says so instead of guessing', async () => {
  const dir = await tempDir()
  const market = await loadMarket({ cacheDir: dir, fetcher: async (url) => (url.endsWith('plugins.json') ? pluginsDoc() : updatesDoc()) })
  const absent = await assessPlugin({ plugin: '@zz/nope', installed: '1.0.0', runtime: RUNTIME, market, blockedNow: false })
  assert.equal(absent.verdict, 'not-in-market')
  assert.equal(absent.marketVersion, null)

  const noManifest = await assessPlugin({
    plugin: '@a/fixed-one',
    installed: '2.0.3',
    runtime: RUNTIME,
    market,
    blockedNow: true,
    manifest: async () => null,
  })
  assert.equal(noManifest.verdict, 'upgrade-maybe')
  assert.equal(noManifest.upstreamCovers, null)
  await fs.rm(dir, { recursive: true, force: true })
})

test('a plugin that is not currently blocked is not described as fixed', async () => {
  const dir = await tempDir()
  const market = await loadMarket({ cacheDir: dir, fetcher: async (url) => (url.endsWith('plugins.json') ? pluginsDoc() : updatesDoc()) })
  const healthy = await assessPlugin({
    plugin: '@a/fixed-one',
    installed: '2.0.3',
    runtime: RUNTIME,
    market,
    blockedNow: false,
    manifest: async () => manifestOf('@a/fixed-one', '2.1.0', { '@deepseek-ai/dsh-session': '>=0.2.0-0 <0.3.0' }),
  })
  assert.equal(healthy.verdict, 'author-fixed')
  assert.equal(healthy.headline, '当前正常;有新版可升')

  const wouldBreak = await assessPlugin({
    plugin: '@a/fixed-one',
    installed: '2.0.3',
    runtime: RUNTIME,
    market,
    blockedNow: false,
    manifest: async () => manifestOf('@a/fixed-one', '2.1.0', { '@deepseek-ai/dsh-session': '^0.1.0' }),
  })
  assert.equal(wouldBreak.headline, '当前正常,但对照版本下会被拦')

  const blocked = await assessPlugin({
    plugin: '@a/fixed-one',
    installed: '2.0.3',
    runtime: RUNTIME,
    market,
    blockedNow: true,
    manifest: async () => manifestOf('@a/fixed-one', '2.1.0', { '@deepseek-ai/dsh-session': '^0.1.0' }),
  })
  assert.equal(blocked.headline, '作者未修:要补丁或豁免')
  await fs.rm(dir, { recursive: true, force: true })
})

test("the author's note quotes the version-compatibility line, not the first UI changelog", async () => {
  const dir = await tempDir()
  const market = await loadMarket({
    cacheDir: dir,
    fetcher: async (url) => {
      if (url.endsWith('plugins.json')) return pluginsDoc()
      return {
        updates: {
          'https://github.com/a/fixed-one': {
            release: {
              tag: 'v2.1.0',
              publishedAt: '2026-09-28T13:26:50Z',
              body: '## 2.1.0\n\n[v2.0.3...v2.1.0](https://github.com/a/fixed-one/compare/v2.0.3...v2.1.0) · 12 commits\n- 电商配置区、结果区和生成前预览统一收紧字号与行高,标题层级更适配窄屏工作区。\n- 修复 `dsh-session` 在 0.2.0-rc.1 下被预检拦下的问题,peer 上限放宽到 <0.3.0。\n- README 重写。',
            },
          },
        },
      }
    },
  })
  const verdict = await assessPlugin({
    plugin: '@a/fixed-one',
    installed: '2.0.3',
    runtime: RUNTIME,
    market,
    blockedNow: true,
    manifest: async () => manifestOf('@a/fixed-one', '2.1.0', { '@deepseek-ai/dsh-session': '>=0.2.0-0 <0.3.0' }),
  })
  assert.match(String(verdict.releaseNote), /被预检拦下/, `实际取到:${String(verdict.releaseNote)}`)
  await fs.rm(dir, { recursive: true, force: true })
})

test('the cache lives under the rescue directory', async () => {
  assert.equal(marketCacheDir('/home/.dsh-rescue'), path.join('/home/.dsh-rescue', 'market'))
})
