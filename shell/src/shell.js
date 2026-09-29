const { invoke } = window.__TAURI__.core

const els = {
  profile: document.querySelector('#profile'),
  target: document.querySelector('#target'),
  offline: document.querySelector('#offline'),
  refresh: document.querySelector('#refresh'),
  dsh: document.querySelector('#dsh'),
  allowLive: document.querySelector('#allowLive'),
  capture: document.querySelector('#capture'),
  verdict: document.querySelector('#verdict'),
  market: document.querySelector('#market'),
  summary: document.querySelector('#summary'),
  findings: document.querySelector('#findings'),
  journal: document.querySelector('#journal'),
  logBody: document.querySelector('#logBody'),
  logClear: document.querySelector('#logClear'),
}

const tabs = {
  market: { button: document.querySelector('#tab-market'), view: document.querySelector('#view-market') },
  doctor: { button: document.querySelector('#tab-doctor'), view: document.querySelector('#view-doctor') },
  journal: { button: document.querySelector('#tab-journal'), view: document.querySelector('#view-journal') },
}

const state = { doctor: null, market: null, status: null, view: 'market' }

/**
 * @param {string} tag 标签名
 * @param {string} [cls] class
 * @param {string|number} [text] 文本内容;一律走 textContent,第三方文本不当标记解析
 * @returns {HTMLElement} 新节点
 */
function el(tag, cls, text) {
  const node = document.createElement(tag)
  if (cls) node.className = cls
  if (text !== undefined) node.textContent = String(text)
  return node
}

/**
 * @param {string} text 文案
 * @param {string} [cls] 按钮样式
 * @param {() => void} onClick 行为
 * @returns {HTMLButtonElement} 按钮
 */
function button(text, cls, onClick) {
  const node = el('button', cls)
  node.type = 'button'
  node.textContent = text
  node.addEventListener('click', onClick)
  return node
}

/**
 * @param {HTMLElement} node 要清空的容器
 */
function clear(node) {
  node.replaceChildren()
}

/**
 * @param {string} text 一行日志
 * @param {string} [kind] `err` 标红,`cmd` 标灰
 */
function log(text, kind) {
  els.logBody.append(el('div', `entry${kind ? ` ${kind}` : ''}`, text))
  els.logBody.scrollTop = els.logBody.scrollHeight
}

/**
 * 包住一次调用:失败进日志,成功返回值。
 *
 * @param {string} label 动作名
 * @param {() => Promise<any>} call 实际调用
 * @returns {Promise<any>} 失败时为空
 */
async function guard(label, call) {
  try {
    return await call()
  } catch (error) {
    log(`${label} 失败:${String(error)}`, 'err')
    return null
  }
}

/**
 * @param {string} name `market` | `doctor` | `journal`
 */
function showView(name) {
  state.view = name
  for (const [key, tab] of Object.entries(tabs)) {
    const active = key === name
    tab.view.hidden = !active
    tab.button.setAttribute('aria-selected', String(active))
  }
}

/** @returns {Promise<void>} 拉 profile 列表 */
async function loadProfiles() {
  const data = await guard('列 profile', () => invoke('profiles'))
  if (!data) return
  clear(els.profile)
  for (const name of data.profiles) {
    const option = el('option')
    option.value = name
    option.textContent = name
    els.profile.append(option)
  }
  if (data.profiles.length === 0) log(`这个 home 下没有可用 profile:${data.home}`, 'err')
  log(`home ${data.home} · profile ${data.profiles.join(', ') || '无'}`, 'cmd')
}

/**
 * @param {string} command 要抄给用户/剪贴板的命令
 * @returns {HTMLElement} 可选中代码 + 复制按钮
 */
function commandRow(command) {
  const wrap = el('span', 'actions')
  wrap.append(el('code', 'command', command))
  wrap.append(
    button('复制', '', () => {
      void (async () => {
        try {
          await navigator.clipboard.writeText(command)
          log(`已复制:${command}`, 'cmd')
        } catch {
          log(`剪贴板用不了,手动抄:${command}`, 'err')
        }
      })()
    }),
  )
  return wrap
}

/**
 * 结论句由内核给(判据与文案同源);壳只决定它涂成什么颜色。
 *
 * @param {string} verdict 内核的机器可读结论
 * @returns {string} 徽标色调
 */
function toneOf(verdict) {
  if (verdict === 'author-fixed') return 'ok'
  return verdict === 'still-broken' ? 'bad' : 'warn'
}

/**
 * @param {any} market 市场对照结果
 * @param {any} doctor 本机诊断(只用来报"当前被拦几个")
 */
function renderVerdict(market, doctor) {
  clear(els.verdict)
  if (!market) {
    els.verdict.append(el('strong', '', '市场对照没跑起来:看下面的动作记录;本机诊断不依赖它。'))
    return
  }
  const counts = new Map()
  for (const row of market.rows) counts.set(row.verdict, (counts.get(row.verdict) ?? 0) + 1)
  const unconfirmed = (counts.get('upgrade-maybe') ?? 0) + (counts.get('unknown') ?? 0) + (counts.get('not-in-market') ?? 0)
  els.verdict.append(
    el('strong', '', `本机 ${market.rows.length} 个社区插件;当前被预检拦下 ${doctor?.counts?.blocked ?? '?'} 个。`),
    el(
      'span',
      'line',
      `对照 runtime ${market.runtime ?? '未识别'}(本机装 ${market.installedRuntime ?? '未识别'}):作者已修 ${counts.get('author-fixed') ?? 0} 个、仍未修 ${counts.get('still-broken') ?? 0} 个、未确认 ${unconfirmed} 个。顺序是硬的 —— 作者已修就升级,不给已修好的插件打补丁或提 PR。`,
    ),
  )
  const list = el('ul')
  for (const row of market.rows.filter((entry) => entry.verdict !== 'author-fixed')) list.append(el('li', '', `${row.plugin} ${row.installed} → ${row.marketVersion ?? '?'}:${row.headline}${row.evidence ? `;${row.evidence}` : ''}`))
  if (list.childNodes.length > 0) els.verdict.append(list)
  for (const note of market.marketNotes) els.verdict.append(el('span', 'line', `注:${note}`))
}

/**
 * @param {any} row 一条市场结论
 * @param {any} doctor 本机诊断(用来给"仍未修"的插件挂上动作)
 * @returns {HTMLElement} 卡片
 */
function marketCard(row, doctor) {
  const card = el('article', 'card')
  const head = el('div', 'card-head')
  head.append(el('span', 'name', row.plugin))
  const versions = el('span', 'versions')
  versions.append(el('span', '', `${row.installed} → `), el('span', 'to', row.marketVersion ?? '?'))
  head.append(versions)
  const badge = el('span', 'badge', row.headline)
  badge.dataset.tone = toneOf(row.verdict)
  head.append(badge, el('span', 'spacer'))
  head.append(el('span', 'spacer'))
  const meta = []
  if (row.downloads !== null) meta.push(`下载 ${row.downloads.toLocaleString('en-US')}`)
  if (row.category) meta.push(row.category)
  if (row.inMarket && row.release?.publishedAt) meta.push(`作者发布 ${row.release.publishedAt.slice(0, 10)}`)
  head.append(el('span', 'meta', meta.join(' · ')))
  card.append(head)

  if (row.evidence) card.append(el('span', 'line', `依据:${row.evidence}`))
  if (row.releaseNote) card.append(el('blockquote', 'quote', row.releaseNote))
  if (row.redLines?.length) card.append(el('span', 'redline', `能力红线:${row.redLines.join(', ')}`))

  const actions = el('div', 'actions')
  if (row.upgrade) actions.append(commandRow(row.upgrade))
  else if (row.verdict === 'author-fixed') actions.append(el('span', 'line', '不用动作:本机版本已覆盖当前 runtime。'))
  if (row.verdict !== 'author-fixed') {
    actions.append(
      button('看诊断', 'primary', () => {
        showView('doctor')
        void runWhy(row.plugin, doctor)
      }),
    )
  }
  card.append(actions)
  return card
}

/**
 * @param {any} doctor 体检结果
 */
function renderMarket(doctor) {
  clear(els.market)
  renderVerdict(state.market, doctor)
  if (!state.market) {
    els.market.append(el('div', 'empty', '市场索引没用上 —— 离线且无缓存时只会这样;本机诊断、豁免、PR 材料都不受影响。'))
    return
  }
  for (const row of state.market.rows) els.market.append(marketCard(row, doctor))
}

/**
 * @param {any} doctor 体检结果
 */
function renderChips(doctor) {
  clear(els.summary)
  if (!doctor) return
  const chips = [
    ['runtime', doctor.runtime.installed ?? '未识别'],
    ['bundle', `${doctor.counts.bundles}(官方 runtime ${doctor.counts.runtime})`],
    ['peer 全满足', doctor.counts.compatible],
    ['会被预检拦下', doctor.counts.blocked],
    ['已写豁免', doctor.counts.exempted],
    ['没装上', doctor.counts.missing],
    ['矩阵', doctor.matrixAvailable ? `${doctor.matrixRecords} 条记录` : '没用上:只报根因'],
  ]
  for (const [label, value] of chips) {
    const chip = el('span', 'chip')
    chip.append(document.createTextNode(`${label} `), el('b', '', value))
    els.summary.append(chip)
  }
}

/**
 * 两步写:先 --dry-run 预览,再由人点「确认执行」。
 *
 * @param {string} label 动作名
 * @param {(confirm: boolean) => Promise<any>} run 具体调用
 */
function twoStep(label, run) {
  void (async () => {
    log(`${label}:先做预览(不写盘)…`, 'cmd')
    const preview = await guard(`${label} 预览`, () => run(false))
    if (!preview) return
    log(`预览:${preview.message}`)
    const confirm = button('确认执行', 'primary', () => {
      void (async () => {
        const done = await guard(label, () => run(true))
        if (!done) return
        log(`${label}:${done.message}`)
        await refresh()
      })()
    })
    els.logBody.prepend(confirm)
    els.logBody.prepend(el('span', 'entry cmd', `${label} 已预览 —— `))
  })()
}

/**
 * @param {string} plugin 插件包名
 * @param {any} doctor 体检结果
 * @returns {Promise<void>} 面 diff 结果写进日志
 */
async function runWhy(plugin, doctor) {
  if (!doctor) return
  const bundle = await guard('面 diff', () => invoke('why', { profile: doctor.profile, plugin, target: els.target.value }))
  if (!bundle) return
  log(`面 diff ${plugin}@${bundle.plugin.version}:覆盖 ${bundle.surfaces.length} 个官方包;消失的依赖 ${bundle.gaps.filter((gap) => gap.status === 'removed').length} 处;peer 判定 ${bundle.peer.verdict}`)
  for (const note of bundle.notes) log(`  注:${note}`, 'cmd')
  for (const surface of bundle.surfaces) log(`  ${surface.specifier} ${surface.oldVersion}(${surface.oldSymbols})→ ${surface.newVersion}(${surface.newSymbols})`, 'cmd')
  for (const gap of bundle.gaps.filter((entry) => entry.status === 'removed')) log(`  新版没了:${gap.specifier} 的 ${gap.symbol}${gap.candidates.length ? `(候选:${gap.candidates.join(', ')})` : ''}`)
  for (const key of bundle.serviceKeys.filter((entry) => entry.status !== 'provided-both')) log(`  服务 key ${key.key}:${key.status === 'observed-pending' ? '真启动里确实没起来' : key.status === 'provided-old-only' ? '旧版有 provider,新版没找到' : '两版包里都没找到,未验证'}`, 'cmd')
  if (bundle.market) log(`  市场对照:${bundle.market.verdict === 'author-fixed' ? `作者已在 ${bundle.market.marketVersion} 修好 —— 升级即可,不必提 PR` : '作者最新版仍未覆盖当前 runtime'}`, 'cmd')
}

/**
 * @param {string} plugin 插件包名
 * @param {any} doctor 体检结果
 */
function preparePr(plugin, doctor) {
  void (async () => {
    const draft = await guard('PR 材料', () => invoke('pr_draft', { profile: doctor.profile, plugin, target: els.target.value }))
    if (!draft) return
    log(`PR 材料(${draft.kind})写在 ${draft.dir}`)
    for (const file of draft.files) log(`  ${file}`, 'cmd')
    for (const note of draft.notes) log(`  注:${note}`, 'cmd')
    if (draft.ghCommand) log(`发不发由你:${draft.ghCommand}`)
    else log('没给 gh 命令:按上面的注,这次不该提 PR。', 'cmd')
  })()
}

/**
 * @param {any} item 一条诊断
 * @param {any} doctor 体检结果
 * @returns {HTMLElement} 卡片
 */
function findingCard(item, doctor) {
  const card = el('article', 'card')
  const suggestion = (doctor.suggestions ?? []).find((entry) => entry.plugin === item.plugin)

  const head = el('div', 'card-head')
  head.append(el('span', 'name', item.plugin), el('span', 'meta', item.version))
  const badge = el('span', 'badge', item.state)
  badge.dataset.tone = item.state === 'ACTIVE' ? 'ok' : item.state === 'PENDING' || item.state === 'FAILED' || item.state === 'DISABLED' ? 'bad' : 'warn'
  head.append(badge, el('span', 'spacer'))
  head.append(el('span', 'meta', suggestion?.upgrade ? '作者已修' : suggestion?.market?.verdict === 'still-broken' ? '作者未修' : '市场未对照'))
  card.append(head)

  const grid = el('dl', 'cause')
  grid.append(el('dt', '', '根因'), el('dd', '', item.rootCause))
  grid.append(el('dt', '', '已排除'), el('dd', '', item.excluded ?? '—'))
  card.append(grid)

  const actions = el('div', 'actions')
  if (suggestion?.upgrade) {
    actions.append(el('span', 'line', `不用打补丁:升级到 ${suggestion.upgrade.version ?? '?'} 就行。`), commandRow(suggestion.upgrade.command))
  } else {
    actions.append(button('面 diff', 'primary', () => void runWhy(item.plugin, doctor)))
    actions.append(button('生成 PR 材料', '', () => preparePr(item.plugin, doctor)))
    if (suggestion && doctor.runtime.installed) {
      actions.append(
        button('写豁免(风险自负)', 'danger', () =>
          twoStep(`豁免 ${item.plugin}@${item.version}`, (confirm) => invoke('fix_exempt', { profile: doctor.profile, pluginVersion: `${item.plugin}@${item.version}`, runtime: doctor.runtime.installed, confirm })),
        ),
      )
    }
    if (suggestion?.market?.verdict === 'still-broken') actions.append(el('span', 'line', `作者最新版 ${suggestion.market.version ?? '?'} 仍不覆盖当前 runtime —— 升级不解决问题。`))
  }
  const rowId = (item.fixes ?? []).map((fix) => fix.rowId).find((id) => typeof id === 'string')
  if (rowId) actions.append(button(`解禁该行 ${rowId}`, 'primary', () => twoStep(`行 ${rowId} 改为 disabled: false`, (confirm) => invoke('fix_row', { profile: doctor.profile, rowId, disabled: false, confirm }))))
  card.append(actions)
  return card
}

/**
 * @param {any} doctor 体检结果
 */
function renderFindings(doctor) {
  clear(els.findings)
  if (!doctor) return
  if (doctor.diagnoses.length === 0) {
    els.findings.append(
      el(
        'div',
        'empty',
        doctor.runtime.installed
          ? '没有需要处理的插件:该 profile 里没发现会被预检拦下、被禁用或没装上的项。'
          : '这一栏算不出结论:本机 runtime 没识别出来(宿主从源码 checkout 跑时就是这样),peer 判定没有比较对象。别把它当"没问题" —— 用「真启动采集症状」拿宿主的运行证据,或在插件市场页按对照版本判。',
      ),
    )
    return
  }
  for (const item of doctor.diagnoses) els.findings.append(findingCard(item, doctor))
}

/**
 * @param {any} status journal
 */
function renderJournal(status) {
  clear(els.journal)
  if (!status || status.applied.length === 0) {
    els.journal.append(el('div', 'empty', '还没有本工具写下的改动。写动作会在 profile 的 .dsh-rescue/ 里留 journal、.bak 与 undo.md。'))
    return
  }
  for (const record of status.applied) {
    const card = el('article', 'card')
    const row = el('div', 'journal-row')
    row.append(el('span', '', `${record.ordinal}. ${record.fixKind} ${record.plugin} → ${record.target.split(/[\\/]/).pop()}${record.backupPaths.length ? ` · 备份 ${record.backupPaths.map((item) => item.split(/[\\/]/).pop()).join(', ')}` : ' · 无备份'}`))
    row.append(button('还原', 'danger', () => twoStep(`还原第 ${record.ordinal} 条`, (confirm) => invoke('undo', { profile: els.profile.value, ordinal: record.ordinal, confirm }))))
    card.append(row)
    els.journal.append(card)
  }
}

/** @returns {Promise<void>} 市场 + 体检 + journal 一起刷新 */
async function refresh() {
  const profile = els.profile.value
  if (!profile) return
  const runtime = els.target.value.trim()
  const offline = els.offline.checked
  const [doctor, market, status] = await Promise.all([
    guard('体检', () => invoke('doctor', { profile })),
    guard('市场对照', () => invoke('market', { profile, runtime, offline })),
    guard('读 journal', () => invoke('status', { profile })),
  ])
  state.doctor = doctor
  state.market = market
  state.status = status
  renderChips(doctor)
  renderFindings(doctor)
  renderJournal(status)
  renderMarket(doctor)
}

els.refresh.addEventListener('click', () => void refresh())
els.profile.addEventListener('change', () => void refresh())
els.target.addEventListener('change', () => void refresh())
els.offline.addEventListener('change', () => void refresh())
els.logClear.addEventListener('click', () => clear(els.logBody))
for (const [name, tab] of Object.entries(tabs)) tab.button.addEventListener('click', () => showView(name))
els.capture.addEventListener('click', () => {
  void (async () => {
    const profile = els.profile.value
    if (!profile) return
    log(`真启动采集:会启动一次 dsh(写 session 与日志)。${els.allowLive.checked ? '已允许默认 home。' : '未勾选"允许在默认 home 真启动",内核会拒绝 —— 请先用 --home 指排演 home。'}`, 'cmd')
    const symptoms = await guard('真启动采集', () => invoke('capture', { profile, dsh: els.dsh.value.trim() || null, timeoutSeconds: 120, allowLive: els.allowLive.checked }))
    if (!symptoms) return
    log(`症状 ${symptoms.schema}:未激活条目 ${symptoms.entries.length} 条,退出码 ${symptoms.exitCode ?? '无'}`)
    for (const entry of symptoms.entries) log(`  ${entry.module} ${entry.entryId ? `(${entry.entryId}) ` : ''}${{ pending: '等待服务', failed: '启动失败', skipped: '预检跳过' }[entry.state] ?? entry.state}${entry.missingServices.length ? `:${entry.missingServices.join(', ')}` : ''}${entry.detail ? ` ${entry.detail}` : ''}`, 'cmd')
    for (const note of symptoms.notes) log(`  注:${note}`, 'cmd')
  })()
})

showView('market')
await loadProfiles()
await refresh()
log('就绪。查市场、体检、读 journal 都只读;任何写动作都要先看预览再点确认。')
