const { invoke } = window.__TAURI__.core

const els = {
  profile: document.querySelector('#profile'),
  target: document.querySelector('#target'),
  refresh: document.querySelector('#refresh'),
  summary: document.querySelector('#summary'),
  body: document.querySelector('#findings tbody'),
  journal: document.querySelector('#journal'),
  log: document.querySelector('#log'),
}

const state = { doctor: null, status: null }

/**
 * @param {string} text 一行日志
 * @param {string} [kind] `err` 标红,`cmd` 标灰
 */
function log(text, kind) {
  const line = document.createElement('div')
  line.className = `entry${kind ? ` ${kind}` : ''}`
  line.textContent = text
  els.log.append(line)
  els.log.scrollTop = els.log.scrollHeight
}

/**
 * 包住一次调用:失败进日志,成功返回值。
 *
 * @param {string} label 动作名
 * @param {() => Promise<unknown>} call 实际调用
 * @returns {Promise<unknown>} 失败时为空
 */
async function call(label, call) {
  try {
    return await call()
  } catch (error) {
    log(`${label} 失败:${String(error)}`, 'err')
    return null
  }
}

/** @returns {Promise<void>} 拉 profile 列表 */
async function loadProfiles() {
  const data = await call('列 profile', () => invoke('profiles'))
  if (!data) return
  els.profile.innerHTML = ''
  for (const name of data.profiles) {
    const option = document.createElement('option')
    option.value = name
    option.textContent = name
    els.profile.append(option)
  }
  if (data.profiles.length === 0) log(`这个 home 下没有可用 profile:${data.home}`, 'err')
  log(`home ${data.home} · profile ${data.profiles.join(', ') || '无'}`, 'cmd')
}

/** @returns {Promise<void>} 体检 + journal */
async function refresh() {
  const profile = els.profile.value
  if (!profile) return
  const [doctor, status] = await Promise.all([
    call('体检', () => invoke('doctor', { profile })),
    call('读 journal', () => invoke('status', { profile })),
  ])
  state.doctor = doctor
  state.status = status
  renderSummary(doctor)
  renderRows(doctor)
  renderJournal(status)
}

/**
 * @param {any} doctor 体检结果
 */
function renderSummary(doctor) {
  if (!doctor) return
  const chips = [
    `runtime <b>${doctor.runtime.installed ?? '未识别'}</b>`,
    `对照 <b>${els.target.value}</b>`,
    `bundle <b>${doctor.counts.bundles}</b>(官方 runtime ${doctor.counts.runtime})`,
    `peer 全满足 <b>${doctor.counts.compatible}</b>`,
    `会被预检拦下 <b>${doctor.counts.blocked}</b>`,
    `已写豁免 <b>${doctor.counts.exempted}</b>`,
    `没装上 <b>${doctor.counts.missing}</b>`,
    doctor.matrixAvailable ? '矩阵可用' : '矩阵没用上:只报根因,不指认修法',
  ]
  els.summary.innerHTML = chips.map((chip) => `<span class="chip">${chip}</span>`).join('')
}

/**
 * @param {string} text 文案
 * @param {string} cls 按钮样式
 * @param {() => void} onClick 行为
 * @returns {HTMLButtonElement} 按钮
 */
function button(text, cls, onClick) {
  const element = document.createElement('button')
  element.type = 'button'
  element.className = cls
  element.textContent = text
  element.addEventListener('click', onClick)
  return element
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
    const preview = await call(`${label} 预览`, () => run(false))
    if (!preview) return
    log(`预览:${preview.message}`)
    const ok = button('确认执行', 'primary', () => {
      void (async () => {
        const done = await call(label, () => run(true))
        if (!done) return
        log(`${label}:${done.message}`)
        await refresh()
      })()
    })
    els.log.prepend(ok)
    els.log.prepend(document.createTextNode(' '))
  })()
}

/**
 * @param {any} doctor 体检结果
 */
function renderRows(doctor) {
  els.body.innerHTML = ''
  if (!doctor) return
  if (doctor.diagnoses.length === 0) {
    els.body.innerHTML = '<tr><td colspan="5" class="empty">没有需要处理的插件:该 profile 里没发现会被预检拦下、被禁用或没装上的项。</td></tr>'
    return
  }
  for (const item of doctor.diagnoses) {
    const row = document.createElement('tr')
    const actions = document.createElement('td')
    actions.className = 'actions'

    actions.append(
      button('面 diff', '', () => {
        void (async () => {
          const bundle = await call('面 diff', () => invoke('why', { profile: doctor.profile, plugin: item.plugin, target: els.target.value }))
          if (!bundle) return
          log(`面 diff ${item.plugin}@${item.version}:覆盖 ${bundle.surfaces.length} 个官方包;消失的依赖 ${bundle.gaps.filter((gap) => gap.status === 'removed').length} 处;peer 判定 ${bundle.peer.verdict}`)
          for (const surface of bundle.surfaces) log(`  ${surface.specifier} ${surface.oldVersion}(${surface.oldSymbols})→ ${surface.newVersion}(${surface.newSymbols})`, 'cmd')
          for (const gap of bundle.gaps.filter((entry) => entry.status === 'removed')) log(`  新版没了:${gap.specifier} 的 ${gap.symbol}${gap.candidates.length ? `(候选:${gap.candidates.join(', ')})` : ''}`)
          for (const key of bundle.serviceKeys.filter((entry) => entry.status !== 'provided-both')) log(`  服务 key ${key.key}:${key.status === 'provided-old-only' ? '旧版有 provider,新版没找到' : '两版包里都没找到,未验证'}`, 'cmd')
        })()
      }),
    )

    actions.append(
      button('生成 PR 材料', '', () => {
        void (async () => {
          const draft = await call('PR 材料', () => invoke('pr_draft', { profile: doctor.profile, plugin: item.plugin, target: els.target.value }))
          if (!draft) return
          log(`PR 材料(${draft.kind})写在 ${draft.dir}`)
          for (const file of draft.files) log(`  ${file}`, 'cmd')
          for (const note of draft.notes) log(`  注:${note}`, 'cmd')
          if (draft.ghCommand) log(`发不发由你:${draft.ghCommand}`)
        })()
      }),
    )

    const suggestion = (doctor.suggestions ?? []).find((entry) => entry.plugin === item.plugin)
    if (suggestion && doctor.runtime.installed) {
      actions.append(
        button('写豁免(风险自负)', 'danger', () =>
          twoStep(`豁免 ${item.plugin}@${item.version}`, (confirm) =>
            invoke('fix_exempt', { profile: doctor.profile, pluginVersion: `${item.plugin}@${item.version}`, runtime: doctor.runtime.installed, confirm }),
          ),
        ),
      )
    }
    const rowId = (item.fixes ?? []).map((fix) => fix.rowId).find((id) => typeof id === 'string')
    if (rowId) {
      actions.append(button(`解禁该行 ${rowId}`, 'primary', () => twoStep(`行 ${rowId} 改为 disabled: false`, (confirm) => invoke('fix_row', { profile: doctor.profile, rowId, disabled: false, confirm }))))
    }

    const stateClass = item.state === 'ACTIVE' ? 'state-ok' : item.state === 'PENDING' || item.state === 'FAILED' || item.state === 'DISABLED' ? 'state-bad' : 'state-warn'
    row.innerHTML = `<td class="name">${item.plugin}<small>${item.version}</small></td><td class="${stateClass}">${item.state}</td><td class="cause">${item.rootCause}</td><td class="cause">${item.excluded ?? '—'}</td>`
    row.append(actions)
    els.body.append(row)
  }
}

/**
 * @param {any} status journal
 */
function renderJournal(status) {
  els.journal.innerHTML = ''
  if (!status || status.applied.length === 0) {
    els.journal.innerHTML = '<div class="empty">还没有本工具写下的改动。写动作会在 profile 的 <code>.dsh-rescue/</code> 里留 journal、<code>.bak</code> 与 <code>undo.md</code>。</div>'
    return
  }
  for (const record of status.applied) {
    const line = document.createElement('div')
    line.className = 'journal-row'
    const text = document.createElement('span')
    text.innerHTML = `${record.ordinal}. <em>${record.fixKind}</em> ${record.plugin} → <em>${record.target.split(/[\\/]/).pop()}</em> ${record.backupPaths.length ? `· 备份 ${record.backupPaths.map((item) => item.split(/[\\/]/).pop()).join(', ')}` : '· 无备份'}`
    line.append(text)
    line.append(
      button('还原', 'danger', () => twoStep(`还原第 ${record.ordinal} 条`, (confirm) => invoke('undo', { profile: els.profile.value, ordinal: record.ordinal, confirm }))),
    )
    els.journal.append(line)
  }
}

els.refresh.addEventListener('click', () => void refresh())
els.profile.addEventListener('change', () => void refresh())
els.target.addEventListener('change', () => renderSummary(state.doctor))

await loadProfiles()
await refresh()
log('就绪。体检只读;任何写动作都要你先看预览再点确认。')
