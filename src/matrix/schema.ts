/**
 * `rescue.matrix/v2` 的单点可执行契约:受控词表与记录字段校验。
 *
 * 矩阵是数据声明而不是自由 YAML(方案 §5.1、附录 C):未列出的枚举值一律拒绝入库,
 * 否则矩阵退化成无法机器校验的散文。`@dsh-rescue/matrix` 只装数据,裁定在这里。
 */

/** 矩阵文档的 schema 标识;缓存键与拉取都按它断言版本。 */
export const MATRIX_SCHEMA = 'rescue.matrix/v2'

/** 诊断器编号:检测项,决定一条记录由谁产出。 */
export type Detector = 'D1' | 'D2' | 'D3' | 'D4' | 'D5' | 'D6'

/** 证据通道:rc 与 stable 分开取证,rc 运行时把 stable 证据降级(§5.1、Q10)。 */
export type MatrixChannel = 'stable' | 'rc'

/** 失效类别,与方案 §2 的表一一对应。 */
export type FailureId =
  | 'false-block'
  | 'peer-range-stale'
  | 'config-schema-changed'
  | 'config-expression-broken'
  | 'service-key-removed'
  | 'service-key-scope-mismatch'
  | 'service-api-changed'
  | 'event-contract-changed'
  | 'tool-api-changed'
  | 'include-file-denied'
  | 'bundle-skipped'
  | 'provider-disposed-runtime'
  | 'duplicate-package-instance'
  | 'import-failed'
  | 'cordis-core-changed'

/** 修法编号:`codemod`(F3)已按 Q5 砍掉,不进词表 —— 未知值拒绝入库本身就是防线。 */
export type FixKind = 'allow' | 'config-patch' | 'patch' | 'manual'

/** 证据强度三级。 */
export type Confidence = 'verified' | 'inferred' | 'reported'

/** 诊断指纹的键;同键多值表示命中其一。 */
export type DetectionKey =
  | 'pendingService'
  | 'failedService'
  | 'loadErrorCode'
  | 'fiberState'
  | 'entryId'
  | 'moduleName'
  | 'bundleName'
  | 'includePath'
  | 'unresolvedImport'
  | 'duplicateInstance'

/** 一个失效类别词条:由哪个检测器发现、能否自动修。 */
export interface FailureTerm {
  readonly id: FailureId
  readonly detector: readonly Detector[] | null
  readonly autoFixable: boolean
  readonly note?: string
}

/** 附录 C 的 `vocabulary.failure`,15 类。 */
export const FAILURE_VOCABULARY: readonly FailureTerm[] = [
  { id: 'false-block', detector: ['D1'], autoFixable: true },
  { id: 'peer-range-stale', detector: ['D1'], autoFixable: false, note: '豁免只解锁预检,不改变运行时行为' },
  { id: 'config-schema-changed', detector: ['D3'], autoFixable: true, note: '症状是 failed fiber,不是行被禁用' },
  { id: 'config-expression-broken', detector: ['D3'], autoFixable: false, note: '!!js 表达式引用已删服务,机器迁不动' },
  { id: 'service-key-removed', detector: ['D2'], autoFixable: true },
  { id: 'service-key-scope-mismatch', detector: ['D2'], autoFixable: false, note: '与 service-key-removed 症状相同,必须先排除' },
  { id: 'service-api-changed', detector: ['D4', 'D5'], autoFixable: true },
  { id: 'event-contract-changed', detector: ['D4'], autoFixable: true },
  { id: 'tool-api-changed', detector: ['D4', 'D5'], autoFixable: true },
  { id: 'include-file-denied', detector: ['D3'], autoFixable: true, note: '一个文件触到不兼容行 → 整份消失' },
  { id: 'bundle-skipped', detector: ['D3'], autoFixable: true, note: '贡献行全消失' },
  { id: 'provider-disposed-runtime', detector: ['D6'], autoFixable: true, note: '运行期释放 → 静默退回 PENDING' },
  { id: 'duplicate-package-instance', detector: ['D4'], autoFixable: false },
  { id: 'import-failed', detector: ['D3'], autoFixable: false },
  { id: 'cordis-core-changed', detector: null, autoFixable: false },
]

/** 附录 C 的 `vocabulary.detection` 键表。 */
export const DETECTION_KEYS: readonly DetectionKey[] = [
  'pendingService',
  'failedService',
  'loadErrorCode',
  'fiberState',
  'entryId',
  'moduleName',
  'bundleName',
  'includePath',
  'unresolvedImport',
  'duplicateInstance',
]

/** 附录 C 的 `vocabulary.fixKind`:每种修法实际触碰的落盘面与确认强度。 */
export const FIX_KIND_CONTRACT: Readonly<Record<FixKind, { readonly writes: readonly string[]; readonly consent: 'none' | 'preview' | 'strong' }>> = {
  allow: { writes: ['compatibility.json'], consent: 'strong' },
  'config-patch': { writes: ['cordis.patch.yml'], consent: 'preview' },
  patch: { writes: ['package.json', 'dsh.profile.bundles'], consent: 'strong' },
  manual: { writes: [], consent: 'none' },
}

/** 附录 C 的 `vocabulary.confidence`:每一级必须携带的证据字段。 */
export const CONFIDENCE_EVIDENCE: Readonly<Record<Confidence, readonly string[]>> = {
  verified: ['runLogId', 'verifiedOn'],
  inferred: ['typesDiffRefs'],
  reported: ['reporter', 'reviewState'],
}

/** F2 补丁热生效的四个前置条件(§5.3);也是 §5.5 硬守卫的判定材料。 */
export interface PatchRequires {
  readonly hmrEnabled: boolean
  readonly moduleResolves: boolean
  readonly preflightPasses: boolean
  readonly injectSatisfiable: boolean
}

/** 一条矩阵记录;字段契约见附录 C 的 `record` 段。 */
export interface MatrixRecord {
  readonly id: string
  readonly state: 'works' | 'broken'
  readonly harness: string
  readonly plugin: { readonly name: string; readonly versions: string }
  readonly severity: 'low' | 'medium' | 'high'
  readonly confidence: Confidence
  readonly fix: { readonly kind: FixKind; readonly ref?: string; readonly addressing?: 'by-row-id'; readonly preserveExpressions?: boolean; readonly configMapping?: readonly { readonly from: string; readonly to: string | null }[] }
  readonly failure?: FailureId
  readonly detection?: Readonly<Partial<Record<DetectionKey, string>>>
  readonly requires?: PatchRequires
  readonly restartRequired?: boolean
  readonly runLogId?: string
  readonly verifiedOn?: string
  readonly typesDiffRefs?: readonly string[]
  readonly reporter?: string
  readonly reviewState?: 'unreviewed' | 'accepted' | 'rejected'
  readonly expiresAt?: string
  readonly retractedBy?: string
  readonly supersededBy?: string
  readonly notes?: readonly string[]
  readonly source: string
}

/** 一份矩阵文档:元数据 + 记录;`delivery` 只在矩阵作为远端包分发时才有,本地文件可以不带。 */
export interface MatrixDocument {
  readonly schema: typeof MATRIX_SCHEMA
  readonly delivery?: {
    readonly mode: 'pull-on-demand'
    readonly source: { readonly registry: 'npm'; readonly package: string }
    readonly verify: 'npm-provenance+schema-assert'
    readonly cacheDir: string
    readonly cacheKey: string
    readonly retain: readonly ('current' | 'previous')[]
    readonly maxCacheBytes: number
    readonly maxAgeDays: number
    readonly oversizePolicy: 'reject-and-keep-previous'
    readonly offline: { readonly degradeTo: readonly Detector[]; readonly lose: readonly string[]; readonly uiCopy: string; readonly offlineOnly: boolean }
  }
  readonly meta: {
    readonly generatedFor: string
    readonly updated: string
    readonly prerelease: { readonly matchesStable: boolean; readonly channels: readonly MatrixChannel[]; readonly onRcRuntime: 'downgrade-confidence' }
  }
  readonly records: readonly MatrixRecord[]
}

/** 校验失败:一次列出全部问题,不逐条抛,便于矩阵评审期一轮改完。 */
export class MatrixValidationError extends Error {
  readonly problems: readonly string[]

  /**
   * @param problems 每条为「位置:原因」形式的文本
   */
  constructor(problems: readonly string[]) {
    super(`matrix rejected (${problems.length}): ${problems.join('; ')}`)
    this.name = 'MatrixValidationError'
    this.problems = problems
  }
}

const failureById = new Map<string, FailureTerm>(FAILURE_VOCABULARY.map((term) => [term.id, term]))
const detectionKeySet = new Set<string>(DETECTION_KEYS)
const detectorSet = new Set<string>(['D1', 'D2', 'D3', 'D4', 'D5', 'D6'])

const RECORD_FIELDS = new Set([
  'id', 'state', 'harness', 'plugin', 'failure', 'detection', 'severity', 'confidence', 'fix', 'requires',
  'restartRequired', 'runLogId', 'verifiedOn', 'typesDiffRefs', 'reporter', 'reviewState', 'expiresAt',
  'retractedBy', 'supersededBy', 'notes', 'source',
])
const DELIVERY_FIELDS = new Set(['mode', 'source', 'verify', 'cacheDir', 'cacheKey', 'retain', 'maxCacheBytes', 'maxAgeDays', 'oversizePolicy', 'offline'])
const META_FIELDS = new Set(['generatedFor', 'updated', 'prerelease'])
const DOCUMENT_FIELDS = new Set(['schema', 'delivery', 'meta', 'records'])

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function isBoolean(value: unknown): value is boolean {
  return typeof value === 'boolean'
}

function positiveInt(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0
}

function checkUnknownFields(source: Record<string, unknown>, allowed: ReadonlySet<string>, where: string, problems: string[]): void {
  for (const key of Object.keys(source)) {
    if (!allowed.has(key)) problems.push(`${where}: unknown field "${key}"`)
  }
}

function checkStringArray(value: unknown, where: string, problems: string[]): void {
  if (!Array.isArray(value) || value.some((item) => !isNonEmptyString(item))) problems.push(`${where}: expected a non-empty array of strings`)
}

function checkRecord(record: Record<string, unknown>, index: number, seenIds: Set<string>, problems: string[]): void {
  const id = isNonEmptyString(record.id) ? record.id : `<record #${index}>`
  const where = `record ${id}`
  checkUnknownFields(record, RECORD_FIELDS, where, problems)

  if (!isNonEmptyString(record.id) || !/^(BRK|OK)-\d{4}-\d{4}$/.test(record.id)) problems.push(`${where}: id must match BRK-YYYY-NNNN or OK-YYYY-NNNN`)
  else if (seenIds.has(record.id)) problems.push(`${where}: duplicate id`)
  else seenIds.add(record.id)

  if (record.state !== 'works' && record.state !== 'broken') problems.push(`${where}: state must be works or broken`)
  if (!isNonEmptyString(record.harness)) problems.push(`${where}: harness range required`)
  if (!isNonEmptyString(record.source)) problems.push(`${where}: source required`)
  if (!['low', 'medium', 'high'].includes(String(record.severity))) problems.push(`${where}: severity must be low, medium or high`)

  const plugin = record.plugin
  if (!isRecord(plugin) || !isNonEmptyString(plugin.name) || !isNonEmptyString(plugin.versions)) problems.push(`${where}: plugin must be { name, versions }`)
  else checkUnknownFields(plugin, new Set(['name', 'versions']), `${where}.plugin`, problems)

  const confidence = record.confidence
  if (!['verified', 'inferred', 'reported'].includes(String(confidence))) problems.push(`${where}: confidence must be verified, inferred or reported`)
  else {
    for (const field of CONFIDENCE_EVIDENCE[confidence as Confidence]) {
      const value = record[field]
      const present = field === 'typesDiffRefs' ? Array.isArray(value) && value.length > 0 : isNonEmptyString(value)
      if (!present) problems.push(`${where}: confidence "${confidence}" requires ${field}`)
    }
    if (confidence === 'reported' && !['unreviewed', 'accepted', 'rejected'].includes(String(record.reviewState))) problems.push(`${where}: reviewState must be unreviewed, accepted or rejected`)
  }

  if (record.failure !== undefined) {
    const term = failureById.get(String(record.failure))
    if (!term) problems.push(`${where}: failure "${String(record.failure)}" is not in the controlled vocabulary`)
    else if (record.state === 'works') problems.push(`${where}: a works record must not carry failure`)
  } else if (record.state === 'broken') {
    problems.push(`${where}: a broken record must carry failure`)
  }

  if (record.detection !== undefined) {
    if (!isRecord(record.detection)) problems.push(`${where}: detection must be a key/value map`)
    else {
      for (const [key, value] of Object.entries(record.detection)) {
        if (!detectionKeySet.has(key)) problems.push(`${where}: detection key "${key}" is not in the controlled vocabulary`)
        if (!isNonEmptyString(value)) problems.push(`${where}: detection.${key} must be a non-empty string`)
      }
    }
  }

  const fix = record.fix
  if (record.state === 'works' && fix === undefined) return
  if (!isRecord(fix) || !['allow', 'config-patch', 'patch', 'manual'].includes(String(fix?.kind))) {
    problems.push(`${where}: fix.kind must be allow, config-patch, patch or manual`)
    return
  }
  if (record.state === 'works' && fix.kind !== 'manual') problems.push(`${where}: a works record offers no automatic fix`)
  checkUnknownFields(fix, new Set(['kind', 'ref', 'addressing', 'preserveExpressions', 'configMapping']), `${where}.fix`, problems)
  const kind = fix.kind as FixKind

  if (kind === 'patch') {
    if (!isNonEmptyString(fix.ref)) problems.push(`${where}: fix.kind patch requires fix.ref`)
    const requires = record.requires
    if (!isRecord(requires)) problems.push(`${where}: fix.kind patch requires the four prerequisites in requires`)
    else {
      checkUnknownFields(requires, new Set(['hmrEnabled', 'moduleResolves', 'preflightPasses', 'injectSatisfiable']), `${where}.requires`, problems)
      for (const key of ['hmrEnabled', 'moduleResolves', 'preflightPasses', 'injectSatisfiable']) {
        if (!isBoolean(requires[key])) problems.push(`${where}.requires.${key} must be a boolean`)
      }
    }
    if (!isBoolean(record.restartRequired)) problems.push(`${where}: fix.kind patch requires restartRequired`)
  } else {
    if (record.requires !== undefined) problems.push(`${where}: requires only applies to fix.kind patch`)
    if (fix.ref !== undefined) problems.push(`${where}: fix.ref only applies to fix.kind patch`)
  }

  if (kind === 'config-patch') {
    if (fix.addressing !== undefined && fix.addressing !== 'by-row-id') problems.push(`${where}: fix.addressing must be by-row-id (patch has no remove operation)`)
    if (fix.configMapping !== undefined) {
      if (!Array.isArray(fix.configMapping)) problems.push(`${where}: fix.configMapping must be an array`)
      else {
        fix.configMapping.forEach((entry, entryIndex) => {
          if (!isRecord(entry) || !isNonEmptyString(entry.from) || !(entry.to === null || isNonEmptyString(entry.to))) problems.push(`${where}: fix.configMapping[${entryIndex}] must be { from, to } with to nullable`)
        })
      }
    }
  } else if (fix.configMapping !== undefined || fix.addressing !== undefined) {
    problems.push(`${where}: configMapping and addressing only apply to fix.kind config-patch`)
  }

  if (fix.preserveExpressions !== undefined && !isBoolean(fix.preserveExpressions)) problems.push(`${where}: fix.preserveExpressions must be a boolean`)

  if (record.failure !== undefined) {
    const term = failureById.get(String(record.failure))
    if (term && kind !== 'manual' && !term.autoFixable) problems.push(`${where}: failure "${term.id}" is not auto-fixable, so fix.kind must be manual`)
  }
}

/**
 * 校验一份矩阵文档。
 *
 * 判据全部来自附录 C:未知枚举值、未知字段、重复 id、缺少该等级要求的证据字段、
 * `patch` 缺四前置条件、不可自动修的类别带了自动修法,任一项都计入问题列表。
 *
 * @param raw 解析后的矩阵文档(JSON 或 YAML 转出的对象)
 * @throws {MatrixValidationError} 存在任何问题时抛出,`problems` 列出全部偏离项
 */
export function assertMatrixDocument(raw: unknown): asserts raw is MatrixDocument {
  const problems: string[] = []
  if (!isRecord(raw)) throw new MatrixValidationError(['document must be an object'])
  checkUnknownFields(raw, DOCUMENT_FIELDS, 'document', problems)

  if (raw.schema !== MATRIX_SCHEMA) problems.push(`document: unsupported schema "${String(raw.schema)}", expected ${MATRIX_SCHEMA}`)

  const delivery = raw.delivery
  if (delivery !== undefined) {
    if (!isRecord(delivery)) problems.push('document: delivery section must be an object when present')
    else {
    checkUnknownFields(delivery, DELIVERY_FIELDS, 'delivery', problems)
    if (delivery.mode !== 'pull-on-demand') problems.push('delivery.mode must be pull-on-demand (the body ships no matrix, §3.1)')
    if (delivery.verify !== 'npm-provenance+schema-assert') problems.push('delivery.verify must be npm-provenance+schema-assert (a sha256 expectation from the same registry verifies nothing, §5.1)')
    const source = delivery.source
    if (!isRecord(source) || source.registry !== 'npm' || !isNonEmptyString(source.package)) problems.push('delivery.source must be { registry: npm, package }')
    if (!isNonEmptyString(delivery.cacheDir)) problems.push('delivery.cacheDir required')
    if (!isNonEmptyString(delivery.cacheKey)) problems.push('delivery.cacheKey required')
    if (!positiveInt(delivery.maxCacheBytes)) problems.push('delivery.maxCacheBytes must be a positive byte budget')
    if (!positiveInt(delivery.maxAgeDays)) problems.push('delivery.maxAgeDays must be a positive day count')
    if (delivery.oversizePolicy !== 'reject-and-keep-previous') problems.push('delivery.oversizePolicy must be reject-and-keep-previous (truncation silently drops fixes, §3.1)')
    if (!Array.isArray(delivery.retain) || delivery.retain.some((item) => !['current', 'previous'].includes(String(item)))) problems.push('delivery.retain must list current and/or previous')
    const offline = delivery.offline
    if (!isRecord(offline)) problems.push('delivery.offline required')
    else {
      checkUnknownFields(offline, new Set(['degradeTo', 'lose', 'uiCopy', 'offlineOnly']), 'delivery.offline', problems)
      if (!Array.isArray(offline.degradeTo) || offline.degradeTo.some((item) => !detectorSet.has(String(item)))) problems.push('delivery.offline.degradeTo must list detectors D1-D6')
      if (!Array.isArray(offline.lose) || offline.lose.some((item) => !['classification', 'fixes'].includes(String(item)))) problems.push('delivery.offline.lose must list classification and/or fixes')
      if (!isNonEmptyString(offline.uiCopy)) problems.push('delivery.offline.uiCopy required — the offline reason must be shown to the user')
      if (!isBoolean(offline.offlineOnly)) problems.push('delivery.offline.offlineOnly must be a boolean (§10 Q13)')
    }
  }
  }

  const meta = raw.meta
  if (!isRecord(meta)) problems.push('document: meta section required')
  else {
    checkUnknownFields(meta, META_FIELDS, 'meta', problems)
    if (!isNonEmptyString(meta.generatedFor)) problems.push('meta.generatedFor required — it is the cache key, not the harness exact version (§5.1)')
    if (!isNonEmptyString(meta.updated) || !/^\d{4}-\d{2}-\d{2}$/.test(meta.updated)) problems.push('meta.updated must be YYYY-MM-DD')
    const prerelease = meta.prerelease
    if (!isRecord(prerelease)) problems.push('meta.prerelease required (includePrerelease makes rc fall inside stable ranges, §5.1)')
    else {
      checkUnknownFields(prerelease, new Set(['matchesStable', 'channels', 'onRcRuntime']), 'meta.prerelease', problems)
      if (!isBoolean(prerelease.matchesStable)) problems.push('meta.prerelease.matchesStable must be a boolean')
      if (!Array.isArray(prerelease.channels) || prerelease.channels.some((item) => !['stable', 'rc'].includes(String(item)))) problems.push('meta.prerelease.channels must list stable and/or rc')
      if (prerelease.onRcRuntime !== 'downgrade-confidence') problems.push('meta.prerelease.onRcRuntime must be downgrade-confidence')
    }
  }

  const records = raw.records
  if (!Array.isArray(records)) problems.push('document: records must be an array')
  else {
    const seenIds = new Set<string>()
    records.forEach((record, index) => {
      if (!isRecord(record)) problems.push(`record #${index}: must be an object`)
      else checkRecord(record, index, seenIds, problems)
    })
    if (records.some((record) => isRecord(record) && record.notes !== undefined)) {
      records.forEach((record, index) => {
        if (isRecord(record) && record.notes !== undefined) checkStringArray(record.notes, `record #${index}.notes`, problems)
      })
    }
  }

  if (problems.length > 0) throw new MatrixValidationError(problems)
}

/**
 * 一条记录当前能否自动修:类别可自动修、区间覆盖运行时、且未被官方修复取代。
 *
 * @param record 已通过校验的记录
 * @param runtimeVersion 当前 harness 精确版本
 * @returns `ok` 可挂修法;`no-failure` 是正向记录,本来就没东西要修;`superseded` 命中 supersededBy,优先建议升级(§10 Q11);其余给出原因
 */
export function fixEligibility(record: MatrixRecord, runtimeVersion: string): { readonly eligible: boolean; readonly reason: 'ok' | 'no-runtime-overlap' | 'superseded' | 'not-auto-fixable' | 'requires-unmet' | 'no-failure' } {
  if (record.state === 'works') return { eligible: false, reason: 'no-failure' }
  if (record.supersededBy !== undefined) return { eligible: false, reason: 'superseded' }
  const term = record.failure === undefined ? undefined : failureById.get(record.failure)
  if (record.fix.kind === 'manual') return { eligible: false, reason: 'not-auto-fixable' }
  if (term && !term.autoFixable) return { eligible: false, reason: 'not-auto-fixable' }
  if (record.fix.kind === 'patch') {
    const requires = record.requires
    if (requires && !(requires.hmrEnabled && requires.moduleResolves && requires.preflightPasses && requires.injectSatisfiable)) return { eligible: false, reason: 'requires-unmet' }
  }
  if (!harnessCovers(runtimeVersion, record.harness)) return { eligible: false, reason: 'no-runtime-overlap' }
  return { eligible: true, reason: 'ok' }
}

/**
 * 粗判运行时版本是否落在记录的区间内:只比较区间端点的 major.minor.patch 前缀。
 *
 * 门禁用的是 `semver.satisfies(..., { includePrerelease: true })`;这里不引第三方 semver,
 * 仅支持 `>=X <Y` 与 `>=X <=Y` 两种端点写法,其余形式一律判不覆盖(fail loud,交人工)。
 *
 * @param runtimeVersion harness 精确版本
 * @param range 记录里的 `harness` 区间
 * @returns 区间可解析且覆盖运行时时为真
 */
export function harnessCovers(runtimeVersion: string, range: string): boolean {
  const parts = range.trim().split(/\s+/)
  let lower: [number, number, number] | undefined
  let lowerInclusive = true
  let upper: [number, number, number] | undefined
  let upperInclusive = false
  for (const part of parts) {
    const match = /^(>=|<=|>|<)\s*(\d+)\.(\d+)\.(\d+)/.exec(part)
    if (!match) return false
    const version: [number, number, number] = [Number(match[2]), Number(match[3]), Number(match[4])]
    const operator = match[1]
    if (operator === '>=' || operator === '>') {
      lower = version
      lowerInclusive = operator === '>='
    } else {
      upper = version
      upperInclusive = operator === '<='
    }
  }
  const runtime = /^(\d+)\.(\d+)\.(\d+)/.exec(runtimeVersion)
  if (!runtime) return false
  const current: [number, number, number] = [Number(runtime[1]), Number(runtime[2]), Number(runtime[3])]
  const order = (a: [number, number, number], b: [number, number, number]): number => a[0] - b[0] || a[1] - b[1] || a[2] - b[2]
  if (lower && order(current, lower) < (lowerInclusive ? 0 : 1)) return false
  if (upper && order(current, upper) > (upperInclusive ? 0 : -1)) return false
  return Boolean(lower || upper)
}
