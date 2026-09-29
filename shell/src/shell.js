const { invoke } = window.__TAURI__.core

/* ---------- 图标:全部是固定字面量,绝不把数据当标记解析 ---------- */
const ICONS = {
  store: 'M3 9.5 4.6 4h14.8L21 9.5M4.8 9.5h14.4V20H4.8zM9.5 20v-6h5v6',
  pulse: 'M3 12h3.6l2.6 6.5L15 5.5l2.4 6.5H21',
  clock: 'M12 3.2a8.8 8.8 0 1 0 .01 17.6A8.8 8.8 0 0 0 12 3.2M12 7.4V12l3.4 2.1',
  search: 'M10.8 3.8a7 7 0 1 0 0 14 7 7 0 0 0 0-14M15.9 15.9 21 21',
  refresh: 'M20.2 12a8.2 8.2 0 1 1-2.4-5.8M20.4 4.2v4.2h-4.2',
  play: 'M8.5 5.4 19 12 8.5 6.6z M8.5 5.4 19 12 8.5 18.6z',
  chevron: 'M6 14.5 12 8.5l6 6',
  copy: 'M9 8.6h9.4V19H9zM5 15.4V5h10',
  arrow: 'M4.5 12h13M13 7.2l4.8 4.8L13 16.8',
  alert: 'M12 4.2 20.4 19H3.6zM12 10v3.8M12 16.4v.4',
  check: 'M5 12.6 9.6 17 19 7.4',
}

/**
 * @param {string} name 图标名
 * @returns {HTMLElement} 图标容器
 */
function icon(name) {
  const node = document.createElement('span')
  node.className = 'btn-icon'
  node.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="${ICONS[name] ?? ICONS.alert}"/></svg>`
  return node
}

for (const node of document.querySelectorAll('[data-icon]')) node.replaceWith(Object.assign(icon(node.dataset.icon), { className: `btn-icon ${node.className}` }))

/**
 * @param {string} tag 标签
 * @param {string} [cls] class
 * @param {string|number} [text] 文本;一律 textContent,第三方文本不当标记解析
 * @returns {HTMLElement} 节点
 */
function el(tag, cls, text) {
  const node = document.createElement(tag)
  if (cls) node.className = cls
  if (text !== undefined) node.textContent = String(text)
  return node
}

/**
 * @param {string} label 文案
 * @param {{ cls?: string, icon?: string, onClick?: () => void }} [options] 选项
 * @returns {HTMLButtonElement} 按钮
 */
function button(label, options = {}) {
  const node = el('button', `btn ${options.cls ?? ''}`.trim())
  node.type = 'button'
  if (options.icon) node.append(icon(options.icon))
  if (label) node.append(document.createTextNode(label))
  if (options.onClick) node.addEventListener('click', options.onClick)
  return node
}

const els = {
  profile: document.querySelector('#profile'),
  target: document.querySelector('#target'),
  offline: document.querySelector('#offline'),
  refresh: document.querySelector('#refresh'),
  search: document.querySelector('#search'),
  railHome: document.querySelector('#rail-home'),
  hero: document.querySelector('#hero'),
  filters: document.querySelector('#filters'),
  market: document.querySelector('#market'),
  summary: document.querySelector('#summary'),
  dsh: document.querySelector('#dsh'),
  allowLive: document.querySelector('#allowLive'),
  capture: document.querySelector('#capture'),
  findings: document.querySelector('#findings'),
  journal: document.querySelector('#journal'),
  drawer: document.querySelector('#drawer'),
  drawerToggle: document.querySelector('#drawerToggle'),
  logBody: document.querySelector('#logBody'),
  logCount: document.querySelector('#logCount'),
  logClear: document.querySelector('#logClear'),
  confirm: document.querySelector('#confirm'),
  confirmLabel: document.querySelector('#confirmLabel'),
  confirmPreview: document.querySelector('#confirmPreview'),
  confirmGo: document.querySelector('#confirmGo'),
  confirmCancel: document.querySelector('#confirmCancel'),
  toasts: document.querySelector('#toasts'),
  tallies: {
    market: document.querySelector('#tally-market'),
    doctor: document.querySelector('#tally-doctor'),
    journal: document.querySelector('#tally-journal'),
  },
}

const tabs = {
  market: document.querySelector('#tab-market'),
  doctor: document.querySelector('#tab-doctor'),
  journal: document.querySelector('#tab-journal'),
}

const views = {
  market: document.querySelector('#view-market'),
  doctor: document.querySelector('#view-doctor'),
  journal: document.querySelector('#view-journal'),
}

const state = { doctor: null, market: null, status: null, view: 'market', filter: 'all', query: '', pending: null, logLines: 0 }

const FILTERS = [
  { id: 'all', label: '全部', keep: () => true },
  { id: 'action', label: '需要动作', keep: (row) => row.verdict !== 'author-fixed' },
  { id: 'fixed', label: '作者已修', keep: (row) => row.verdict === 'author-fixed' },
  { id: 'blocked', label: '当前被拦', keep: (row) => row.blockedNow },
  { id: 'unsure', label: '未确认', keep: (row) => row.verdict === 'upgrade-maybe' || row.verdict === 'unknown' || row.verdict === 'not-in-market' },
]

/* ---------- 反馈面 ---------- */

/**
 * @param {string} text 一行日志
 * @param {string} [kind] `err` / `ok` / `cmd`
 */
function log(text, kind) {
  els.logBody.append(el('div', `log-line${kind ? ` ${kind}` : ''}`, text))
  els.logBody.scrollTop = els.logBody.scrollHeight
  state.logLines += 1
  els.logCount.textContent = String(state.logLines)
}

/**
 * 瞬时确认走 toast,需要留下的信息留在原地(日志/卡片)。
 *
 * @param {string} text 文案
 * @param {string} [tone] `ok` | `bad`
 */
function toast(text, tone) {
  const node = el('div', 'toast', text)
  if (tone) node.dataset.tone = tone
  node.prepend(icon(tone === 'bad' ? 'alert' : 'check'))
  els.toasts.append(node)
  setTimeout(() => node.remove(), 2600)
}

/**
 * @param {string} label 动作名
 * @param {() => Promise<any>} call 调用
 * @returns {Promise<any>} 失败时为空,并已写进日志
 */
async function guard(label, call) {
  try {
    return await call()
  } catch (error) {
    log(`${label} 失败:${String(error)}`, 'err')
    toast(`${label} 失败`, 'bad')
    return null
  }
}

/**
 * @param {string} command 命令
 */
async function copyCommand(command) {
  try {
    await navigator.clipboard.writeText(command)
    toast('已复制到剪贴板', 'ok')
  } catch {
    toast('剪贴板用不了,命令在框里手动抄', 'bad')
  }
}

/* ---------- 通用小块 ---------- */

/**
 * @param {string} text 包名
 * @returns {string} 两字母缩写当头像;先去掉 `dsh-` 前缀,否则满屏都是同一个 `ds`
 */
function monogram(text) {
  const bare = text.replace(/^@[^/]+\//, '').replace(/^dsh-/, '')
  return bare.slice(0, 2).toLowerCase()
}

/**
 * @param {string} name 包名
 * @returns {string} 去掉 scope 前缀的显示名
 */
function shortName(name) {
  return name.replace(/^@[^/]+\//, '')
}

/**
 * @param {number} value 下载量
 * @returns {string} 千分位文本
 */
function thousands(value) {
  return value.toLocaleString('en-US')
}

/**
 * @param {any} row 市场结论
 * @returns {string} 色调
 */
function toneOf(row) {
  if (row.verdict === 'author-fixed') return 'ok'
  if (row.verdict === 'still-broken') return row.blockedNow ? 'bad' : 'warn'
  return 'warn'
}

/**
 * @param {string} command 可抄的命令
 * @returns {HTMLElement} 代码块 + 复制按钮
 */
function commandBlock(command) {
  const box = el('div', 'cmd')
  const code = el('code', '', command)
  const copy = button('', { icon: 'copy', cls: 'btn-quiet', onClick: () => void copyCommand(command) })
  copy.style.border = '0'
  copy.style.borderRadius = '0'
  box.append(code, copy)
  return box
}

/**
 * @param {Array<[string, string|number]>} items 标签与值
 * @returns {HTMLElement} 事实行
 */
function factList(items) {
  const dl = el('dl', 'facts')
  for (const [label, value] of items) {
    const row = el('div')
    row.append(el('dt', '', label), el('dd', '', value))
    dl.append(row)
  }
  return dl
}

/**
 * @param {string} label 小标题
 * @param {string} text 正文
 * @returns {HTMLElement} 带标签的证据块
 */
function evidenceBlock(label, text) {
  const box = el('p', 'evidence')
  box.append(el('span', 'evidence-label', label), document.createTextNode(text))
  return box
}

/* ---------- 视图切换 ---------- */

/**
 * @param {string} name `market` | `doctor` | `journal`
 */
function showView(name) {
  state.view = name
  for (const key of Object.keys(tabs)) {
    const active = key === name
    views[key].hidden = !active
    tabs[key].setAttribute('aria-selected', String(active))
  }
}

/**
 * @param {string} key 页签
 * @param {string|number} value 计数
 * @param {string} [tone] 色调
 */
function setTally(key, value, tone) {
  const node = els.tallies[key]
  node.textContent = value === null || value === undefined || value === '' ? '' : String(value)
  if (tone) node.dataset.tone = tone
  else delete node.dataset.tone
}

/* ---------- 市场视图 ---------- */

/** @returns {any[]} 过滤与排序后的行 */
function visibleRows() {
  if (!state.market) return []
  const keep = FILTERS.find((filter) => filter.id === state.filter)?.keep ?? (() => true)
  const query = state.query.trim().toLowerCase()
  const rank = { 'still-broken': 0, 'upgrade-maybe': 1, unknown: 2, 'not-in-market': 3, 'author-fixed': 4 }
  return state.market.rows
    .filter((row) => keep(row) && (!query || row.plugin.toLowerCase().includes(query)))
    .sort((a, b) => Number(b.blockedNow) - Number(a.blockedNow) || rank[a.verdict] - rank[b.verdict] || (b.downloads ?? 0) - (a.downloads ?? 0))
}

/**
 * @param {any} market 市场结果
 * @param {any} doctor 本机诊断
 */
function renderHero(market, doctor) {
  els.hero.replaceChildren()
  if (!market) {
    const box = el('div', 'empty')
    box.append(el('h3', '', '市场对照没跑起来'), el('p', '', '离线且没有缓存时只会这样。本机诊断、豁免、PR 材料都不受影响;要现在补一份索引,取消「只用缓存」再点「重新查」。'))
    els.hero.append(box)
    return
  }
  const counts = new Map()
  for (const row of market.rows) counts.set(row.verdict, (counts.get(row.verdict) ?? 0) + 1)
  const unsure = (counts.get('upgrade-maybe') ?? 0) + (counts.get('unknown') ?? 0) + (counts.get('not-in-market') ?? 0)
  const total = market.rows.length || 1
  const fixed = counts.get('author-fixed') ?? 0
  const broken = counts.get('still-broken') ?? 0
  const blocked = doctor?.counts?.blocked ?? 0

  const lead = el('div', 'hero-lead')
  const count = el('div', 'hero-count')
  count.append(document.createTextNode(String(market.rows.length)), el('small', '', '个社区插件'))
  lead.append(count)
  const facts = el('div', 'hero-facts')
  for (const [label, value] of [['对照 runtime', market.runtime ?? '未识别'], ['本机 runtime', market.installedRuntime ?? '未识别'], ['当前被拦', blocked], ['索引来源', market.fromCache ? '缓存' : '实时']]) {
    const item = el('span')
    item.append(document.createTextNode(`${label} `), el('b', '', String(value)))
    facts.append(item)
  }
  lead.append(facts)

  const bar = el('div', 'hero-bar')
  for (const [tone, n] of [['ok', fixed], ['bad', broken], ['warn', unsure]]) {
    const seg = el('i')
    seg.dataset.tone = tone
    seg.style.width = `${(n / total) * 100}%`
    if (n > 0) bar.append(seg)
  }
  lead.append(bar)

  const legend = el('ul', 'hero-legend')
  for (const [tone, text] of [['ok', `作者已修 ${fixed}`], ['bad', `仍未修 ${broken}`], ['warn', `未确认 ${unsure}`]]) {
    const item = el('li')
    const dot = el('i', 'dot')
    dot.dataset.tone = tone
    item.append(dot, document.createTextNode(text))
    legend.append(item)
  }
  lead.append(legend)

  const side = el('div', 'hero-side')
  side.append(el('h3', '', '顺序是硬的'))
  side.append(el('p', '', '作者最新版已覆盖判定的 runtime ⇒ 升级,不给它打补丁、也不替它提 PR。仍不覆盖 ⇒ 明说升级不解决问题。'))
  const todo = market.rows.filter((row) => row.verdict !== 'author-fixed')
  if (todo.length > 0) {
    const list = el('ul', 'hero-todo')
    for (const row of todo.slice(0, 4)) {
      const item = el('li')
      const dot = el('i', 'dot')
      dot.dataset.tone = row.blockedNow ? 'bad' : 'warn'
      item.append(dot, el('b', '', shortName(row.plugin)), el('span', '', row.headline))
      list.append(item)
    }
    if (todo.length > 4) list.append(el('li', '', `另有 ${todo.length - 4} 个`))
    side.append(list)
  }
  for (const note of market.marketNotes) side.append(el('p', '', `注:${note}`))
  els.hero.append(lead, side)
}

function renderFilters() {
  els.filters.replaceChildren()
  if (!state.market) return
  for (const filter of FILTERS) {
    const n = state.market.rows.filter(filter.keep).length
    const chip = el('button', 'filter')
    chip.type = 'button'
    chip.setAttribute('aria-pressed', String(state.filter === filter.id))
    chip.append(document.createTextNode(filter.label), el('span', 'filter-count', String(n)))
    chip.addEventListener('click', () => {
      state.filter = filter.id
      renderMarket()
    })
    els.filters.append(chip)
  }
  els.filters.append(el('span', 'filters-spacer'))
  const rows = visibleRows()
  els.filters.append(el('span', 'filters-note', `${rows.length} / ${state.market.rows.length} 个${state.query ? ` · 匹配「${state.query}」` : ''}`))
}

/**
 * @param {any} row 市场结论
 * @returns {HTMLElement} 卡片
 */
function marketCard(row) {
  const card = el('article', 'card')
  card.dataset.tone = toneOf(row)

  const head = el('div', 'card-head')
  head.append(el('span', 'avatar', monogram(row.plugin)))
  const id = el('div', 'card-id')
  id.append(el('h3', '', row.plugin))
  const versions = el('p', 'versions')
  versions.append(document.createTextNode(row.installed), icon('arrow'), el('span', 'to', row.marketVersion ?? '?'))
  id.append(versions)
  const pill = el('span', 'pill', row.headline)
  pill.dataset.tone = toneOf(row)
  head.append(id, pill)
  card.append(head)

  const facts = []
  if (row.downloads !== null) facts.push(['下载', thousands(row.downloads)])
  if (row.category) facts.push(['分类', row.category])
  if (row.release?.publishedAt) facts.push(['作者发布', row.release.publishedAt.slice(0, 10)])
  if (row.release?.name || row.release?.tag) facts.push(['版本', row.release.name ?? row.release.tag])
  if (facts.length > 0) card.append(factList(facts))

  if (row.evidence) card.append(evidenceBlock('依据', row.evidence))
  if (row.releaseNote) {
    const quote = el('blockquote', 'quote', row.releaseNote)
    if (row.release?.url) quote.append(el('cite', '', row.release.url.replace('https://github.com', 'github.com')))
    card.append(quote)
  }
  if (row.redLines?.length) {
    const strip = el('div', 'strip')
    strip.dataset.tone = 'warn'
    strip.append(icon('alert'), document.createTextNode(`能力红线:${row.redLines.join(', ')}`))
    card.append(strip)
  }

  const actions = el('div', 'card-actions')
  if (row.upgrade) actions.append(commandBlock(row.upgrade))
  if (row.verdict !== 'author-fixed' || !row.upgrade) {
    actions.append(
      button('看诊断', {
        cls: row.verdict === 'author-fixed' ? 'btn-sm' : 'btn-primary btn-sm',
        onClick: () => {
          showView('doctor')
          void runWhy(row.plugin)
        },
      }),
    )
  }
  if (row.verdict === 'still-broken') actions.append(button('备 PR 材料', { cls: 'btn-sm', onClick: () => preparePr(row.plugin) }))
  card.append(actions)
  return card
}

function renderMarket() {
  renderFilters()
  const box = els.market
  box.replaceChildren()
  if (!state.market) return
  const rows = visibleRows()
  if (rows.length === 0) {
    box.append(el('div', 'empty', '这个筛选下没有插件:换个条件,或清掉搜索框。'))
    return
  }
  for (const row of rows) box.append(marketCard(row))
  setTally('market', state.market.rows.filter((row) => row.verdict !== 'author-fixed').length, state.market.rows.some((row) => row.blockedNow) ? 'bad' : 'ok')
}

/* ---------- 本机诊断视图 ---------- */

/**
 * @param {any} doctor 体检结果
 */
function renderFacts(doctor) {
  els.summary.replaceChildren()
  if (!doctor) return
  const items = [
    ['runtime', doctor.runtime.installed ?? '未识别', doctor.runtime.installed ? '' : 'warn'],
    ['bundle', doctor.counts.bundles, ''],
    ['官方 runtime', doctor.counts.runtime, ''],
    ['peer 全满足', doctor.counts.compatible, 'ok'],
    ['会被预检拦下', doctor.counts.blocked, doctor.counts.blocked ? 'bad' : ''],
    ['已写豁免', doctor.counts.exempted, ''],
    ['没装上', doctor.counts.missing, doctor.counts.missing ? 'warn' : ''],
    ['矩阵', doctor.matrixAvailable ? `${doctor.matrixRecords} 条` : '没用上', doctor.matrixAvailable ? '' : 'warn'],
  ]
  for (const [label, value, tone] of items) {
    const chip = el('div', 'fact')
    if (tone) chip.dataset.tone = tone
    chip.append(el('span', '', label), el('b', '', String(value)))
    els.summary.append(chip)
  }
}

/**
 * @param {any} item 一条诊断
 * @param {any} doctor 体检结果
 * @returns {HTMLElement} 卡片
 */
function findingCard(item, doctor) {
  const card = el('article', 'card')
  const suggestion = (doctor.suggestions ?? []).find((entry) => entry.plugin === item.plugin)
  card.dataset.tone = suggestion?.upgrade ? 'ok' : item.state === 'ACTIVE' ? 'ok' : 'bad'

  const head = el('div', 'card-head')
  head.append(el('span', 'avatar', monogram(item.plugin)))
  const id = el('div', 'card-id')
  id.append(el('h3', '', item.plugin), el('p', 'versions', item.version))
  const pill = el('span', 'pill', item.state)
  pill.dataset.tone = item.state === 'ACTIVE' ? 'ok' : item.state === 'PENDING' || item.state === 'FAILED' || item.state === 'DISABLED' ? 'bad' : 'warn'
  head.append(id, pill)
  card.append(head)

  card.append(evidenceBlock('根因', item.rootCause))
  if (item.excluded) card.append(evidenceBlock('已排除', item.excluded))
  if (suggestion?.market?.verdict === 'still-broken') {
    const strip = el('div', 'strip')
    strip.dataset.tone = 'warn'
    strip.append(icon('alert'), document.createTextNode(`作者最新版 ${suggestion.market.version ?? '?'} 仍不覆盖当前 runtime —— 升级不解决问题。`))
    card.append(strip)
  }

  const actions = el('div', 'card-actions')
  if (suggestion?.upgrade) {
    actions.append(commandBlock(suggestion.upgrade.command))
    actions.append(el('span', 'filters-note', `升级到 ${suggestion.upgrade.version ?? '?'} 就行,不用打补丁。`))
  } else {
    actions.append(button('面 diff', { cls: 'btn-sm', onClick: () => void runWhy(item.plugin) }))
    actions.append(button('生成 PR 材料', { cls: 'btn-sm', onClick: () => preparePr(item.plugin) }))
    if (suggestion && doctor.runtime.installed) {
      actions.append(
        button('写豁免', {
          cls: 'btn-danger btn-sm',
          onClick: () =>
            twoStep(`豁免 ${item.plugin}@${item.version}`, (confirm) => invoke('fix_exempt', { profile: doctor.profile, pluginVersion: `${item.plugin}@${item.version}`, runtime: doctor.runtime.installed, confirm })),
        }),
      )
    }
  }
  const rowId = (item.fixes ?? []).map((fix) => fix.rowId).find((id) => typeof id === 'string')
  if (rowId) actions.append(button(`解禁该行 ${rowId}`, { cls: 'btn-sm', onClick: () => twoStep(`行 ${rowId} 改为 disabled: false`, (confirm) => invoke('fix_row', { profile: doctor.profile, rowId, disabled: false, confirm })) }))
  card.append(actions)
  return card
}

/**
 * @param {any} doctor 体检结果
 */
function renderFindings(doctor) {
  els.findings.replaceChildren()
  if (!doctor) return
  if (doctor.diagnoses.length === 0) {
    const box = el('div', 'empty')
    if (doctor.runtime.installed) {
      box.append(el('h3', '', '这个 profile 里没有需要处理的插件'))
      box.append(el('p', '', '没发现会被预检拦下、被禁用或没装上的项。要按新的对照版本再看一遍,去插件市场页改「对照版本」。'))
    } else {
      box.append(el('h3', '', '这一栏算不出结论'))
      box.append(el('p', '', '本机 runtime 没识别出来(宿主从源码 checkout 跑时就是这样),peer 判定没有比较对象 —— 别把它当"没问题"。用下面「真启动采集症状」拿宿主的运行证据,或在插件市场页按对照版本判。'))
    }
    els.findings.append(box)
    setTally('doctor', '', '')
    return
  }
  for (const item of doctor.diagnoses) els.findings.append(findingCard(item, doctor))
  setTally('doctor', doctor.diagnoses.length, doctor.counts.blocked ? 'bad' : 'warn')
}

/**
 * @param {string} plugin 插件包名
 * @returns {Promise<void>} 面 diff 结果写进日志
 */
async function runWhy(plugin) {
  const doctor = state.doctor
  if (!doctor) return
  log(`面 diff ${plugin} → 对照 ${els.target.value.trim()}…`, 'cmd')
  const bundle = await guard('面 diff', () => invoke('why', { profile: doctor.profile, plugin, target: els.target.value.trim() }))
  if (!bundle) return
  log(`面 diff ${bundle.plugin.name}@${bundle.plugin.version}:覆盖 ${bundle.surfaces.length} 个官方包;消失的依赖 ${bundle.gaps.filter((gap) => gap.status === 'removed').length} 处;peer 判定 ${bundle.peer.verdict}`, 'ok')
  for (const note of bundle.notes) log(`注:${note}`, 'cmd')
  for (const surface of bundle.surfaces) log(`${surface.specifier} ${surface.oldVersion}(${surface.oldSymbols})→ ${surface.newVersion}(${surface.newSymbols})`, 'cmd')
  for (const gap of bundle.gaps.filter((entry) => entry.status === 'removed')) log(`新版没了:${gap.specifier} 的 ${gap.symbol}${gap.candidates.length ? `(候选:${gap.candidates.join(', ')})` : ''}`)
  for (const key of bundle.serviceKeys.filter((entry) => entry.status !== 'provided-both')) {
    log(`服务 key ${key.key}:${key.status === 'observed-pending' ? '真启动里确实没起来' : key.status === 'provided-old-only' ? '旧版有 provider,新版没找到' : '两版包里都没找到,未验证'}`, 'cmd')
  }
}

/**
 * @param {string} plugin 插件包名
 */
function preparePr(plugin) {
  void (async () => {
    const doctor = state.doctor
    if (!doctor) return
    const draft = await guard('PR 材料', () => invoke('pr_draft', { profile: doctor.profile, plugin, target: els.target.value.trim() }))
    if (!draft) return
    log(`PR 材料(${draft.kind})写在 ${draft.dir}`, 'ok')
    for (const file of draft.files) log(`  ${file}`, 'cmd')
    for (const note of draft.notes) log(`  注:${note}`, 'cmd')
    if (draft.ghCommand) log(`发不发由你:${draft.ghCommand}`)
    else log('没给 gh 命令:按上面的注,这次不该提 PR。', 'cmd')
  })()
}

/* ---------- 改动记录 ---------- */

/**
 * @param {any} status journal
 */
function renderJournal(status) {
  els.journal.replaceChildren()
  if (!status || status.applied.length === 0) {
    const box = el('div', 'empty')
    box.append(el('h3', '', '还没有本工具写下的改动'))
    box.append(el('p', '', '写动作会在 profile 的 .dsh-rescue/ 里留 journal、改前的 .bak 与 undo.md;还原只认这些记录,不猜原值。'))
    els.journal.append(box)
    setTally('journal', '', '')
    return
  }
  for (const record of status.applied) {
    const row = el('div', 'entry')
    row.append(el('span', 'entry-ordinal', String(record.ordinal)))
    const body = el('div', 'entry-body')
    const title = el('div', 'entry-title')
    title.append(el('span', 'tag', record.fixKind), el('b', '', record.plugin), el('span', '', '→'), el('code', '', record.target.split(/[\\/]/).pop()))
    body.append(title)
    body.append(el('p', 'entry-sub', record.backupPaths.length ? `备份 ${record.backupPaths.map((item) => item.split(/[\\/]/).pop()).join(', ')}` : '无备份:原本不存在这个文件,还原会删掉它'))
    row.append(body)
    row.append(button('还原', { cls: 'btn-danger btn-sm', onClick: () => twoStep(`还原第 ${record.ordinal} 条`, (confirm) => invoke('undo', { profile: els.profile.value, ordinal: record.ordinal, confirm })) }))
    els.journal.append(row)
  }
  setTally('journal', status.applied.length, 'warn')
}

/* ---------- 两步写 ---------- */

/**
 * 预览 → 由人点确认 → 才落盘。同一时刻只挂一个待确认动作。
 *
 * @param {string} label 动作名
 * @param {(confirm: boolean) => Promise<any>} run 具体调用
 */
function twoStep(label, run) {
  void (async () => {
    log(`${label}:先做预览(不写盘)…`, 'cmd')
    const preview = await guard(`${label} 预览`, () => run(false))
    if (!preview) return
    state.pending = { label, run }
    els.confirmLabel.textContent = label
    els.confirmPreview.textContent = preview.message
    els.confirm.hidden = false
    els.confirmGo.focus()
  })()
}

els.confirmGo.addEventListener('click', () => {
  const pending = state.pending
  els.confirm.hidden = true
  if (!pending) return
  state.pending = null
  void (async () => {
    const done = await guard(pending.label, () => pending.run(true))
    if (!done) return
    log(`${pending.label}:${done.message}`, 'ok')
    toast('已执行,正在复诊', 'ok')
    await refresh()
  })()
})

els.confirmCancel.addEventListener('click', () => {
  els.confirm.hidden = true
  if (state.pending) log(`${state.pending.label}:已取消,什么都没写。`, 'cmd')
  state.pending = null
})

/* ---------- 数据加载 ---------- */

/** @returns {Promise<void>} 拉 profile 列表 */
async function loadProfiles() {
  const data = await guard('列 profile', () => invoke('profiles'))
  if (!data) return
  els.profile.replaceChildren()
  for (const name of data.profiles) {
    const option = el('option')
    option.value = name
    option.textContent = name
    els.profile.append(option)
  }
  els.railHome.textContent = data.home
  els.railHome.title = data.home
  if (data.profiles.length === 0) log(`这个 home 下没有可用 profile:${data.home}`, 'err')
  log(`home ${data.home} · profile ${data.profiles.join(', ') || '无'}`, 'cmd')
}

/** @returns {Promise<void>} 市场 + 体检 + journal 一起刷新 */
async function refresh() {
  const profile = els.profile.value
  if (!profile) return
  const runtime = els.target.value.trim()
  const offline = els.offline.checked
  log(`重新查 profile ${profile}${runtime ? ` · 对照 ${runtime}` : ''}${offline ? ' · 只用缓存' : ''}…`, 'cmd')
  const [doctor, market, status] = await Promise.all([
    guard('体检', () => invoke('doctor', { profile })),
    guard('市场对照', () => invoke('market', { profile, runtime, offline })),
    guard('读 journal', () => invoke('status', { profile })),
  ])
  state.doctor = doctor
  state.market = market
  state.status = status
  renderFacts(doctor)
  renderFindings(doctor)
  renderJournal(status)
  renderHero(market, doctor)
  renderMarket()
  if (market) setTally('market', market.rows.filter((row) => row.verdict !== 'author-fixed').length, market.rows.some((row) => row.blockedNow) ? 'bad' : 'ok')
}

/* ---------- 事件 ---------- */

els.refresh.addEventListener('click', () => void refresh())
els.profile.addEventListener('change', () => void refresh())
els.target.addEventListener('change', () => void refresh())
els.offline.addEventListener('change', () => void refresh())
els.search.addEventListener('input', () => {
  state.query = els.search.value
  renderMarket()
})
for (const [name, node] of Object.entries(tabs)) node.addEventListener('click', () => showView(name))
els.drawerToggle.addEventListener('click', () => {
  const collapsed = els.drawer.dataset.collapsed === 'true'
  els.drawer.dataset.collapsed = String(!collapsed)
  els.drawerToggle.setAttribute('aria-expanded', String(collapsed))
})
els.logClear.addEventListener('click', () => {
  els.logBody.replaceChildren()
  state.logLines = 0
  els.logCount.textContent = ''
})

els.capture.addEventListener('click', () => {
  void (async () => {
    const profile = els.profile.value
    if (!profile) return
    if (!els.allowLive.checked) {
      log('真启动采集会启动一次 dsh(写 session 与日志)。没勾「允许在默认 home 真启动」,内核会拒绝 —— 先勾选,或把壳指到排演 home。', 'cmd')
    }
    log(`真启动采集 profile ${profile}${els.dsh.value.trim() ? ` · 入口 ${els.dsh.value.trim()}` : ''}…`, 'cmd')
    const symptoms = await guard('真启动采集', () => invoke('capture', { profile, dsh: els.dsh.value.trim() || null, timeoutSeconds: 120, allowLive: els.allowLive.checked }))
    if (!symptoms) return
    log(`症状 ${symptoms.schema}:未激活条目 ${symptoms.entries.length} 条,退出码 ${symptoms.exitCode ?? '无'}`, symptoms.entries.length ? 'err' : 'ok')
    const label = { pending: '等待服务', failed: '启动失败', skipped: '预检跳过' }
    for (const entry of symptoms.entries) {
      const line = el('div', 'log-line err')
      line.append(document.createTextNode(`  ${entry.module}${entry.entryId ? ` (${entry.entryId})` : ''} ${label[entry.state] ?? entry.state}`))
      if (entry.missingServices.length) line.append(document.createTextNode(`:${entry.missingServices.join(', ')}`))
      if (entry.detail) line.append(document.createTextNode(` ${entry.detail}`))
      els.logBody.append(line)
      state.logLines += 1
      els.logCount.textContent = String(state.logLines)
    }
    for (const note of symptoms.notes) log(`注:${note}`, 'cmd')
    els.drawer.dataset.collapsed = 'false'
  })()
})

showView('market')
await loadProfiles()
await refresh()
log('就绪。查市场、体检、读 journal 都只读;任何写动作都要先看预览再点确认。', 'ok')
