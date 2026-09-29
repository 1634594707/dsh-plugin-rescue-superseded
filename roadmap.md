---
description: "dsh-plugin-rescue 的唯一任务路线图:按阶段收口条件推进,含 M0 十三条断言与三项可行性的验证方法、判据与降级路径,以及放弃清单与顺延顺序。机制口径以 proposal.md 为准,本文不重述设计。"
kind: "roadmap"
---

# dsh-plugin-rescue 任务路线图

> **部分作废(2026-09-29)**:项目已收窄为 `README.md` 的小 CLI。仍然有效的是「前提核验记录」(承重 `file:line` 已在 HEAD 上核过)与阶段 0 的四条表决;阶段 1 的 A1–A9、A11–A15 里凡依赖插件入口/热生效/装包的部分**不再是当前路线**,只有写盘装备(A5 并发编辑、A13 中断、A14 写完重读)与 `pnpm pack` 类体积口径继续适用。新增的实机判据见 README「四条不变量」。

本文件是**唯一**的推进清单;机制、口径、验收标准都在 [proposal.md](proposal.md) 里,本文只写"做什么、怎么算过、过不了怎么办"。条目引用方案章节时不再复述其内容。

## 怎么读这份清单

- **按收口条件推进,不按日历推进**。每个阶段有一组"收口条件",全部满足才进下一阶段;条件不满足就停在该阶段并记录原因。
- **前重后轻**:排在前面的条目决定"产品在关键时刻是否存在",排在后面的只是能力多寡。期限被压缩时,从每个阶段的**末尾**砍起,不砍开头的存活类断言。
- **卡住就跳过并记录**:单条断言卡住超过半天,先跳到下一条,把卡点写成一条书面结论("不可行 + 观察到的现象 + 替代路径"),不允许停在原地磨。
- **每条断言的产出是结论不是代码**:可运行 demo、或一段带 `file:line` 的书面判定。写"待实测"不算完成。
- 打勾前必须已经填上**实测数字或结论**——不允许勾上但正文没写结果。
- **前提核验不等于断言通过**:`file:line` 级别的代码事实可以在当前 HEAD 上读出来(见[前提核验记录](#前提核验记录head-4878cdabd8)),但它只证明"断言的前提是真的";A1–A15 的**行为**判据仍要跑真实 profile。任何以"代码看起来会这样"结尾的条目都不算通过。
- 前提核验发现与方案不符时,**回头改 `proposal.md`**,不改核验记录来掩盖;改完在核验记录里留一行"已回写 §N"。

---

## 阶段 0 · 定稿表决(阻塞 v1.0)

方案 v0.4 已合入两轮评审共 32 条改动。四类只有人能定的事情已在 2026-09-29 由项目所有者表决,结论逐条落在下面;**定完才动骨架,所以骨架的每个名字都按表决结果写**。

- [x] **Q13 运行时出网**:**默认出网、可切 `offlineOnly`**。落点已建:`packages/rescue/cordis.patch.yml` 的 `rescue-doctor.config.matrix.offlineOnly: false`,离线文案取矩阵的 `delivery.offline.uiCopy`
- [x] **Q7 命名与 npm scope**:**独立 scope `@dsh-rescue/*`**。本体 `@dsh-rescue/rescue`、矩阵 `@dsh-rescue/matrix`、补丁 `@dsh-rescue/patch-<key>`;改名见下节
- [x] **Q14 体积门禁**:**写进 CI**。`.github/workflows/ci.yml` 依次跑 `check:manifest` → `build` → `test` → `check:size`,runner 矩阵含 ubuntu 与 windows(§9 要求 A5 的改名/占用在 Windows 实测)
- [x] **Q17 原子写来源**:**本体自写、常量对齐宿主**。实现 `packages/rescue/src/write/atomic.ts`,`WRITE_RETRY_LIMIT = 10`、`WRITE_RETRY_DELAY_MS = 50`、可重试码 `EACCES/EBUSY/EPERM`,临时名带 stamp 以避开宿主固定的 `filename + '.tmp'`;未 import 任何 `@deepseek-ai/dsh-*` 包,A10 的 manifest 半边由 `check:manifest` 守
- [ ] **Q1 / Q6 / Q8 / Q5 复述确认**:方案已按推荐写入(混合落点、M1 就做 UI、F2=bundle 层 / F1=profile 层、F3 砍),仍待评审确认无异议
- [ ] **Q15 / Q16 表决**:仍待决(§5.6 自举诊断 + §5.7 逃生舱的降级形态;§8 度量哪些只在 opt-in 后有数据)
- [ ] 把 `roadmap.md` 与 `proposal.md` 的交叉引用过一遍:方案里的 S1–S3 / A1–A15 编号、`§N.M` 引用、附录锚点在改名后仍然有效

**收口条件**:上述表决全部有书面结论,且 §10 里没有仍标着"未裁决"的行。Q1 / Q6 / Q8 / Q5 的无异议确认与 Q15 / Q16 仍未回,其余四条已回。

### 改名类机械任务(Q7 定完立刻做,不要拖)

- [x] 按 Q7 结果一次性替换示例包名与术语:`dsh-rescue-patch-*` / `dsh-rescue-shim-*` → `@dsh-rescue/patch-*`,`kind: shim` → `kind: patch`,`shim-kit` → `补丁 kit`,`shim-stale` → `patch-stale`。实测:`grep -rn "dsh-rescue-shim\|kind: shim\|shim-kit\|shim-stale" proposal.md patches/` 命中 **0** 处(2026-09-29)。`proposal.md` §4 与 §5.3 里的 `dsh-rescue-matrix` / `dsh-rescue-patcher` 是**组件名**而不是发布名,保留;`review/` 是历史材料,按原措辞冻结

### 骨架落地时发现的两处口径不符

| # | 发现 | 现在的处置 | 待决 |
|---|---|---|---|
| f | **附录 B 的示例记录不满足附录 C 自己的证据规则**:`confidence: verified` 需要 `runLogId` + `verifiedOn`(附录 C 的 `vocabulary.confidence`),而附录 B 的 5 条记录**都没有 `runLogId`**;其中 BRK-2026-0119 / 0142 / 0155 的 `source` 写的是 types-diff 与 issue,按词表属 `inferred` | 种子数据 `packages/matrix/data/0.2-rc.json` 按词表落:两条「本地实测 2026-09-20」记 `verified` + `runLogId: "local-2026-09-20"`,三条 types-diff 记 `inferred` + `typesDiffRefs`。校验器按附录 C 逐字实现,不为迁就示例放宽 | **附录 B 是否照此回写**。不回写的话,`assertMatrixDocument(附录B)` 判不合格,矩阵评审没有可执行的判据 |
| g | **`harness` 区间的裸写法没有定义**:附录 B 用 `">=0.2.0 <0.3.0"` 这样的比较符串,词表只写"区间";`"1.0.0 - 2.1.0"`(`plugin.versions` 里出现)这类 npm 风格范围没有比较符 | `harnessCovers()` 只认带 `>= > <= <` 的端点写法,解析不了的一律判**不覆盖**(fail loud,交人工),不引第三方 semver | M1 要不要把区间判定交给宿主已有的 `semver`(`@deepseek-ai/cordis` 的依赖,不算新增运行时依赖)—— 影响 A1 的判据写法 |

术语残留已核完,结果在下面的核验记录第 9 行 —— 该项不再是待办。

---

## 前提核验记录(HEAD `4878cdabd8`)

2026-09-29 执行。对象是 M0 断言与 §5 / 附录全部 `file:line` 承重引用。**每条的判定来自命令输出,不来自记忆。**

| # | 核验项 | 判定 | 实测位置 |
|---|---|---|---|
| 1 | 门禁只管辖 `@deepseek-ai/dsh-*` peer;`includePrerelease: true` | **成立** | `plugin-compatibility.ts:75` 逐字为 `if (name !== '@deepseek-ai/dsh' && !name.startsWith('@deepseek-ai/dsh-')) continue`;`:77` 带 `{ includePrerelease: true }` |
| 2 | 预检把不兼容行置 `disabled` | **成立** | `compatibility-preflight.ts:115` `row.disabled = true`,由 `deny()` 在 `:125`/`:135` 调用 |
| 3 | `reconcileProfilePatches` / `auditStartupEntries` / `evaluatePluginCompatibility` 公开导出 | **成立** | `app-boot/src/index.ts:273`、`:925`、`:22`;启动表格文案在 `:901`(`Plugins waiting for services (N)`) |
| 4 | `'overridden'` 信号与 `setBundleEnabled` 原语 | **成立** | `plugin-manager/src/index.ts:433`(条件为 `current?.enabled !== enabled && hmr` 存在)、`:443`;`selectBundle` 在 `:715`,安装期再跑一次门禁在 `:723` 与 `:547` |
| 5 | `provide` 冲突抛错、`notify` 按 label 过滤、`internal/status` 每次迁移都发 | **成立** | `reflect.ts:290` 抛 `service "…" has been registered at <…>`;`:314` 的 `filter` 比较 isolate label;`fiber.ts:586` `emit('internal/status', …)` |
| 6 | 枚举面与 fiber 公开面 | **成立** | `registry.ts:275-276` `values()`、`:140` `fibers: DisposableList<Fiber>`;`fiber.ts:194` `public state`、`:225` `public inject` |
| 7 | patch 语言**没有 remove** | **成立(前提未被推翻)** | `vendor/include/src/index.ts:130-141` 的 `PatchOptions` 只有 `id / insert / name / config / group / disabled / inject / intercept / isolate` + 索引签名;覆盖在 `:120-123`(`target[key] = value`,跳过 `id`);`:9-23` 定义 `!!js` 标量,`:23` 导出 `entryListSchema` |
| 8 | 类型快照数量(S2 / §5.1 的"26 个 tag、25 次相邻转换") | **数字成立,口径要写明** | `ls docs/persistence-changes/releases/` 共 **108** 个文件,其中 `*.schema.json` **26** 个、`*.md` **54** 个、`*.i18n.yaml` **27** 个。相邻转换 = 26 − 1 = **25** |
| 9 | 术语残留 | **已清** | `shim` 在 `proposal.md` 中出现 **2** 次,两处都在附录 C 的"术语统一"说明行内(作历史名引用);`patch-stale` 5 处、`patch-stale` 1 处(同样只在说明行) |
| 10 | 层序 bundles → profile patch → home patch → `--patch` | **成立** | `profile-context.ts:65-70` 的拼装顺序即 layers → profile patches → home patches → overlays;`publish.md:129` 原文 "Later layers win per row, and a patch replaces a row's entire `config` value rather than deep-merging keys" |
| 11 | 其余引用行号 | **成立** | `profile.ts:233-234`(`nodeLinker: hoisted` / `autoInstallPeers: false`)、`profile.ts:731`(`composeEntries`)、`resolver.ts:709`(`installRuntimeInterception`)、`entry.ts:169`(`resolveConfig`)、`profile-compatibility.ts:45/99/109/117`、`build-approval.ts:18-22`、`plugin-inventory/src/index.ts:82/92-93`、`hmr/README.md:27/89`、`cordis-host-runner/README.md:12/46/50`、`publish.md:103`、CLI `version-exemptions` / `allow-version --accept-risk`(`apps/cli/src/plugin.ts:13/20`) |

### 核验中发现的五处不符,已回写 `proposal.md`

| # | 发现 | 回写位置 |
|---|---|---|
| a | **导出名写错**:方案写 `readProfileCompatibility`,实际是 `readProfileVersionExemptions`(`profile-compatibility.ts:99`) | §0.1 表、附录 A.1 |
| b | **宿主已有一份原子写**:`vendor/include/src/index.ts:289-308` 写 `<file>.tmp` → `rename`,对 `EACCES/EBUSY/EPERM`(`:38-41`)退避重试 **10 次 / `(retry+1)×50 ms`**(`:35-36`),装载时 `access(W_OK)` 探只读(`:204-211`)、只读则抛 `cannot overwrite readonly config`(`:290-292`)。另有独立包 `@deepseek-ai/dsh-atomic-write`(`packages/util/atomic-write`)导出 `writeFileAtomic:79` / `withFileLock:235` | §5.3.1 第 2 条重写;新待决 **Q17** |
| c | **半截 YAML 的两个时机后果不同,且都比原描述严重**:冷启动只有 `ENOENT` 才回落 `initial`,其余解析错误一律抛(`:245-259` 注释要求 fail loud);热重载 `refresh()`(`:279-287`)读不了就 warn 并**保留上一棵树**;`read()`(`:225-232`)注明空/截断文件 parse 成 `undefined` 而非报错 | §5.3.1 第 2 条的"为什么"整段重写;A13 判据改写;**新增 A15** |
| d | **patch 匹配不到只 warn + skip,不抛错**:行不存在(`:110-113`)、`insert` 目标非 group(`:86-89`)、缺 id(`:104-107`)、**带 `name` 而行已被改名**(`:115-118`)四种都会整条跳过。⇒ "写入没报错"永远不等于"生效";而 `name` 可以当免费的防错锁用 | §5.3.1 新增第 6 条;**新增 A14**;A5 判据补一条 |
| e | **headless 的 HMR 不是永久关闭**:`hmr/README.md:27` 原文 "Headless, SDK and ACP bundles disable that entry in YAML; **a later profile patch can enable it**" | **已回写** §5.3 的 F2 条目 —— 写明"可能存在 F1 打开 HMR 再热生效的组合修法,但**仅文档依据、未实测**,裁定前一律只报 `restartRequired`";实机判据见阶段 1 的 A3 附带项 |

**这一节的地位**:它是 M0 的仪表校验。若某条断言实机结果与上表冲突,**以实机为准并更新本节**,而不是反过来。

### 参考实现侧(HEAD `21dbac0ccd`,同 dsh 基线)

`proposal.md` 引用桌面版时统一用 `desktop:` 前缀。缩写约定(本表与方案共用):

| 写法 | 展开 |
|---|---|
| `desktop:<文件>.rs`、`desktop:recovery/<文件>.rs` | `src-tauri/src/service/plugin/` 下 |
| `desktop:bridge/<文件>.rs`、`desktop:profile/<文件>.rs` | `src-tauri/src/` 下 |
| `desktop:src/i18n/...`、`desktop:test/...` | 仓库根下的前端与测试 |

| # | 核验项(方案的承重依据) | 判定 | 实测位置 |
|---|---|---|---|
| 1 | 归因的唯一证据闸门:`owners.len() == 1`,判不出返回空集合 | **成立** | `desktop:recovery/ownership.rs` 内 `owners.len() == 1` 出现 **5** 次;`:226` 与 `:305` 均 `return Vec::new()` |
| 2 | 反面教材 `patch_entry_targets` 按"任意顶层键或值"匹配 | **成立** | `desktop:recovery/uninstall.rs:152-161`,注释原文"顶层 id 字段或任意字段值等于该包名";实现遍历条目的键值对,任一键**或**任一值等于包名即判定命中(`k.as_str() == Some(id)` 与 `v.as_str() == Some(id)` 取或) |
| 3 | 安全档案是宿主级常量、契约不含用户插件与补丁层 | **成立** | `desktop:profile/mod.rs:59` `pub const SAFE_PROFILE: &str = "safe"`;`desktop:safe.rs:3` 原文"只加载 web 模板核心 bundles、不带任何用户插件/补丁层";`:17-19` 卸载必须在服务未启动时调用 |
| 4 | 恢复路径离线、不依赖 node / pnpm / 窗口 | **成立,但**引用错位已修 | 引号里那句"即使插件产物已损坏也能移除"在 **`desktop:safe.rs:16-17`**,不在 `recovery/mod.rs`;`recovery/mod.rs:12`(本模块离线、精准)、`:159-160`(`uninstall`)支撑同一结论。**方案 §5.7 原引 `recovery/mod.rs:12,160` 属于跨文件错引,已改为双处引** |
| 5 | 破坏性自愈用改名隔离、绝不删除 | **成立** | `desktop:patch_guard.rs:13` 与 `:33`(`<原文件名>.broken-<UTC 时间戳>`,内容原样保留);`desktop:patch_entries.rs:12,60,136`(改写补丁层前先 `<原名>.bak-<时间戳>`) |
| 6 | 隔离有失败项就禁止切档案与重启 | **成立** | `desktop:patch_guard.rs:63` `has_failures()`;`desktop:bridge/lifecycle.rs:375-377` 为真时 `return Err(...)`,注释 `:362-363` 给的理由与方案引用一致 |
| 7 | 同目录 tmp + rename 的必要性论证(半截 YAML) | **成立** | `desktop:patch_entries.rs:407-420`:注释明写 `fs::write` 截断会"多报一个语法错误",同目录 `rename` 在 Windows(`MOVEFILE_REPLACE_EXISTING`)与 Unix 均为原子替换 |
| 8 | `includeConfig` 恒 false、`patches` v1 为空(反例) | **成立** | `desktop:snapshot.rs:93-94`(字段与"v1 为空"注释)、`:369`、`:404`、`:448` 三处 `include_config: false` |
| 9 | best-effort 签名撒谎(反例) | **成立** | `desktop:verify.rs` 内 `return Ok(())` **6** 处,函数 `ensure_preset_plugins` 无任何 `Err` 返回路径 |
| 10 | 重试上限 3 次 + 计数语义缺陷 | **成立** | `desktop:src/store/modules/recovery/types.ts:26` `MAX_RECOVERY_ATTEMPTS = 3`;`store.ts:112-122` 逐项 `catch` 后照常 `clear()` + `restart()`(§5.6 引用的"两种失败语义并存") |
| 11 | 损坏备份被显示成可用(反例) | **成立** | `desktop:snapshot.rs:458-474`:`read_manifest(&path).ok()` 失败时 `created` 回落 `now_timestamp()` 且仍 `exists: true` |
| 12 | Windows 五坑(§9 的每条出处) | **成立** | `snapshot.rs:253-259`(fsync 需 read+write,`ERROR_ACCESS_DENIED os error 5`)、`verify.rs:193-196`(只取 `.exe`)、`verify.rs:214-216,235-241`(黑窗与 `Send` 约束)、`recovery/uninstall.rs:75-80`(junction 双判定)、`test/patch-layer.test.ts:51-52`(真实样本 `Access is denied. (os error 5)`) |
| 13 | 隔离失败的定向文案 | **成立** | `desktop:src/i18n/locales/zh-CN.json:107`,§5.5 已改为**逐字引用**(此前是意译,不算证据) |

**发现并已修的两处引用缺陷**:①#4 的跨文件错引;②#13 的意译冒名引用。都回写进了 `proposal.md`,不是只记在这里。

---

## 阶段 1 · M0 断言(15 条 + 3 项可行性)

M0 的交付物是"每条有可运行 demo 或书面结论(含不可行结论与替代路径)"。**顺序按"失败会推翻多少后续工作"排**,不按编号。前提的代码事实已在[前提核验记录](#前提核验记录head-4878cdabd8)确认,本节全部是**行为**判据。

### 1.1 先做:三条决定"这个产品在关键时刻是否存在"

- [ ] **A10 · 本体 peer 组合不触发兼容门禁**(§0.1)
  - 方法:三个 profile(dsh `0.2.0-rc.1` / 假装 `0.3.0` / headless)各装一次 rescue
  - 判据:Plugins 页均出现"修复"分区,stderr 无 `disabling profile plugin …`
  - 不可行时:立即改为"本体不 import 任何 `@deepseek-ai/dsh-*` 包,服务全走 `inject`",并把 `workspace:^` 是否被 pnpm 接受作为独立子项实测
- [ ] **A12 · 逃生舱可用**(§5.7)
  - 方法:把 rescue 直接禁用或从 profile 删除,然后用一条不依赖它的命令还原一次已应用的 F1/F2
  - 判据:还原后用户配置逐字节等价(§3.2),且 `undo.md` 与 `.bak` 在 rescue 不在场时仍可被消费
  - 不可行时:§3.2 的"还原 ≤ 2 击"与"逐字节等价"必须降级为"rescue 在场时",并把该降级写进 §9 风险表——**不接受口头保留**
- [ ] **A11 · 补丁能自行避免 `provide` 冲突抛错**(§5.5)
  - 方法:在真实提供者已占用目标 key 的 profile 上启动带补丁的树
  - 判据:不抛错、补丁自行禁用、rescue 启动后报 `patch-stale`
  - 不可行时:守卫只剩"启动后巡检",**§5.5 的"启动前"这一层必须从方案里删除**,并把 §9 该条风险等级上调

### 1.2 次做:让"可还原"与"能加载"成为事实(§5.3.1 六条 / §0.1,缺任一条则 §3.2 不成立)

- [ ] **A5 · 回滚在真实 profile 上可逆**
  - 方法:在装有用户自定义注释与 `!!js` 表达式的 profile 上执行一次 F1 应用与回滚
  - 判据:注释不丢、`!!js` 标记不丢、用户并发编辑不被覆盖(mtime + 哈希比对生效)、`.bak` 可还原且逐字节等价
  - **补一条(核验发现 d)**:还原后必须**重读文件**确认目标行的值确实回到原值,而不是只看"写入没报错"——`applyEntryPatches` 对匹配不到的补丁只 warn 后跳过
  - **必须在 Windows 上跑一遍**(§9 平台差异):文件被占用时应当**先按宿主语义退避重试**(10 次 / `(retry+1)×50 ms`),重试用尽才硬失败并报专用错误码;不允许静默
  - 不可行时:回滚改为按 id 置 `disabled: true`(`PatchOptions:136` 确有此字段,类型 `boolean | null`,`null` 可显式清除),并接受"文件里会留下 rescue 写过的行"——该代价要写进 §5.3
- [ ] **A13 · 中断语义**
  - 方法:`apply` 进行到一半时 kill 进程,分别覆盖"已写 `.bak` 未写用户文件"与"已写用户文件未标 applied"两个切点
  - 判据(**按核验发现 c 改写**):用户 `cordis.patch.yml` **不留半截文件**。依据不是"多报一个语法错误"那么轻:冷启动时除 `ENOENT` 外的解析错误一律抛、profile 直接起不来;而热重载会 warn 后**静默沿用上一棵树**——同一个半截状态在两个时机的表现完全不同,两者都是不可接受的
  - 下次启动能检出未完成的 `intent` 并提供"继续 / 还原"
  - 不可行时:取消"意图先行",改为每次只做一个写入面并把多面修复拆成串行可重入步骤,§5.3.1 第 1 条相应改写
- [ ] **A14 · 写入生效校验(新,由核验发现 d)**
  - 断言:rescue 判定 F1 成功与否的依据是**重读文件后的行值**,不是写入未抛错
  - 方法:构造四种"匹配不到就跳过"的场景 —— 目标行不存在、`insert` 目标不是 group、缺 id、补丁带 `name` 而行已被用户改名 —— 各执行一次 F1
  - 判据:四种都**不报成功**、都在卡片上给出人话;同时验证带上 `name` 时用户改过行名的行确实**没有被覆盖**(免费的防错锁)
  - 不可行时:rescue 不得宣称"逐字节等价还原",§3.2 该行降级为"写入原子、生效不保证"
- [ ] **A15 · 复检读到的是新树(新,由核验发现 c)**
  - 断言:`refresh()` 读不了文件时会 warn 并"keeping the running tree",因此**复检可能拿到改造前的树**
  - 方法:让补丁层的改写触发一次 reload,同时使 loader 侧处于"读取失败"路径(只读文件 / 故意留下解析错误),观察 `reconcileProfilePatches` 返回的是新树还是旧树
  - 判据:复检必须显式确认"这一层的补丁确实被重放",否则 §5.3 复检的①②两条判据都可能建立在旧树上;拿到旧树时必须报失败而不是报成功
  - 不可行时:复检改为读文件内容 + 独立解析(`--dump-config`)对照,并在 §5.3 写明多付一次解析的成本
- [ ] **A1 · 补丁的 peer 范围必须宽到能通过预检**
  - 方法:照 `docs/user/develop/basic/publish.md:103` 写一个旧范围进 peer 的补丁,装进 profile,启动
  - 判据:出现 `disabling profile plugin …` ⇒ 断言成立,证明 §6 决策 1 的反转建议是必需的
  - 不可行时(即不出现该行):说明门禁行为与读码结论不符,**回头修 §0.1 与 §6 决策 1 的依据段落**,不要带着错误前提继续

### 1.3 再做:能力与口径

- [ ] **A2 · 旧类型副本不破坏单实例**:在补丁里对某 dsh 服务类做 `instanceof`,与宿主持有的实例比对引用。不通过 ⇒ 补丁不得 import 任何 dsh 包的值,只能 `ctx.get(name)` 拿服务,能力降级但仍可修 PENDING
- [ ] **A4 · 注册冲突的抛错与规避**:先让补丁占用 key,再挂一个同样注册该 key 的插件;必须抛出 `service "X" has been registered at …`,且与 A11 的规避手段一并验证
- [ ] **A3 · 热生效四前置条件**:分别在 `web` 与 `headless` profile 跑一遍;`web` 生效、`headless` 不生效且报 `restartRequired`。若 headless 也生效或 web 不生效 ⇒ M1 的"分钟级恢复"承诺要收窄
- [ ] **A3 附带 · headless 可以用一条 F1 换来热生效(新,由核验发现 e,方案尚未回写)**:`hmr/README.md:27` 原文是 "Headless, SDK and ACP bundles disable that entry in YAML; **a later profile patch can enable it**"。因此 `requires.hmrEnabled` 为 false 不是永久状态
  - 判据:在 headless profile 上用一条 F1 覆盖打开 `hmr` 项,确认①该行确实被后层覆盖生效②覆盖后 F2 补丁可热生效③关闭 HMR 的原有语义不被破坏(注释:"Disabling or omitting HMR applies changes on restart")
  - 通过后回写 `proposal.md` §5.3 的 F2 条目与 §5.6:对 headless 用户给出"启用 HMR 后即可立即生效,否则需重启"这一**可选前置修复**,而不是只报 `restartRequired`
- [ ] **A6 · 试运行通道可用**:用 `cordis-host-runner` 的 host-only 定义内存挂载补丁。**判据按 §5.3 的两条**:必须与目标插件同 isolate label 否则结论无效;试运行失败**不得**当作"补丁无效"
- [ ] **A9 · 离线降级分层未被破坏**:`offlineOnly: true` 或拔网线跑一个已知失效 profile。判据:报告仍给出"哪个插件、什么状态、缺哪些服务",修法一栏标"需要联网获取修复建议";若整份报告失败 ⇒ D1/D2/D3 里混进了读矩阵的代码,**先拆开再进 M1**
- [ ] **A8 · 体积基线**:搭只含 doctor + patcher 编排层的空壳包(`manifest` 只写 `@deepseek-ai/cordis` 与 `@deepseek-ai/cordis-plugin-include` 两个 peer),按 §3.1 口径量;再用附录 E 的样例补丁量单补丁。**判据**:本体 ≤ 100 KB、单补丁 ≤ 10 KB、`dependencies` 段为空。超预算 ⇒ 先砍能力再谈压缩,**不允许靠引入依赖达成**
  - 实测 2026-09-29(本体半):`pnpm run check:size` 报 `@dsh-rescue/rescue` **42 418 B / 7 个文件**,预算 102 400 B;`@dsh-rescue/matrix` 数据 **4 452 B**,预算 307 200 B。`dependencies` 段为空、peer 无 `dsh-*` 由 `check:manifest` 守(两处反证已跑:加 `dsh-*` peer + `postinstall` ⇒ 红;删 `lib` ⇒ 红;删 `cordis.patch.yml` ⇒ 红)。
  - 未过半:量的是**已落地的纯逻辑 kernel**(矩阵校验、缓存淘汰、渲染前过滤、确定性渲染、状态与 journal、原子写),doctor / patcher 的宿主耦合面(D1 复用、D2 `internal/status` 订阅、`installBundle`、`setVersionExemption`)一行未写 —— 那些要真实 profile 才跑得动,归 A1–A6 / A9 的实机项。单补丁 ≤ 10 KB 待 `patches/` 下按附录 E 建 `@dsh-rescue/patch-foo-legacy` 包后量。
- [ ] **A7 · 脱敏姿态**:确认读官方 `startup-*.log` 时 §5.2 渲染前过滤能拦住路径与凭据模式;给出被过滤项的清单,并确认截图 / 回填两条外流路径都走同一个过滤器

### 1.4 缩减为"对齐验证"的三项原有可行性

- [ ] **S1**:不重做枚举,只验证 rescue 的 `internal/status` 订阅输出与 `auditStartupEntries`、`readPluginInventory` **三者对齐**(同一 profile、同一时刻、同一集合)
- [ ] **S2**:先评估 `docs/persistence-changes/releases/` 的既有类型快照能否直接映射到附录 C 的 `vocabulary.failure`;能则自建 diff 管道不排期。**数量口径(实测)**:该目录 108 个文件 = `*.schema.json` **26**(快照,相邻转换 25 次)+ `*.md` **54** + `*.i18n.yaml` **27**。写"26 个快照"时必须带上"来自 `*.schema.json` 计数"
- [ ] **S3**:端到端"补丁行生成 → HMR 热应用 → PENDING 解挂"跑通,作为 A1–A4 的载体,不单独作为结论

**收口条件**:15 条断言(A1–A15)+ A3 附带 + 3 项可行性全部有书面结论;**任何一条以"待实测"或"代码看起来会这样"结尾都不算过**。不可行的条目必须已经在 `proposal.md` 里改成了对应的降级(删承诺 / 降范围 / 上调风险等级),而不是只记在本文。

---

## 阶段 2 · M1(可演示的主线)

范围见 §8:doctor(D1/D2/D3/D6)+ 矩阵 v2 首批记录 + 按需拉取与缓存 + F0/F1 + 首个真实补丁(F2 手工版) + 一键修复/还原 UI + `state.json` v1 + 逃生舱命令与 `undo.md`。kit、守卫两层化、批量还原、agent tools 都留给 M2。

- [ ] `state.json` 的 `schema: rescue.state/v1` 落地,含 `before` / `attempts` / 忽略记录;**v1 不写任何未实现字段**
- [ ] §5.3.1 的**六条**写盘装备全部落地:①意图先行 journal ②`.bak-<stamp>` + `.tmp` + `rename` **并对齐宿主的重试常量(10 次、`(retry+1)×50 ms`、`EACCES/EBUSY/EPERM`)与 `access(W_OK)` 只读预检** ③单实例锁 + 与宿主固定 `.tmp` 文件名的冲突避让 ④mtime + 哈希并发检测 ⑤回滚幂等且备份缺失不猜 ⑥写完**重读确认行值**。**依赖 Q17 的表决结果**(选 b 就要重做 A10)
- [ ] doctor:D2 持续观测 + 未满足 key(harness 侧唯一真空白);D1/D3/D6 按 §5.2 复用既有服务
- [ ] D5 的包名白名单与"归因不唯一就不指认插件"(§5.2、§6 决策 3)
- [ ] 诊断输出排序确定性(§5.2):同一 profile 连跑两次,报告逐字节相同
- [ ] 矩阵拉取 + 缓存淘汰(字节上限优先)+ 单份超限拒收并回退上一份
- [ ] F0 走 `setVersionExemption`、F1 按行 id **且带原 `name`** 精确覆盖(改名即不覆盖,A14 的防错锁)、F2 装包**不碰 lockfile**
- [ ] 复检两条判据都实现(无新增失败 **且** 原症状消失)**且** 通过 A15(确认读到的是重放后的新树,不是 `refresh()` 保留的旧树);UI 上"已修复"只在全部条件成立时出现
- [ ] §5.6 三种卡片形态 + 批准分级(含 `allowBuilds` 作为显式一步)+ 冲突的"选 A / 选 B"出口
- [ ] 重试计数与降级(§5.6):失败 3 次后该项只给 F4
- [ ] 自举诊断一行(§5.6)+ 逃生舱命令与 `undo.md` 生成(§5.7)
- [ ] **端到端验收场景固定为 foo-tools(`BRK-2026-0142`)**:升级 → 诊断 → 批准 → 修复 → 恢复 → 还原后逐字节等价
- [ ] 离线断言复跑:拔网线状态下 M1 的 UI 仍能出诊断(与 A9 同源,但走真实 UI 路径)

**收口条件**:§8 的 M1 六条验收逐条有证据(截图或日志),且**A10 / A12 / A13 / A14 / A15 的实测在 M1 的产物上重跑一次仍通过**——不是只信 M0 时的结论。

---

## 阶段 3 · M2(工程化与批量)

- [ ] 补丁 kit:`assertNotProvided(key)` 原语与受控桥接原语(禁用裸 `prepend: true`)
- [ ] 守卫两层化落地:硬守卫进 kit、软巡检进 rescue,并按 A11 的实测结果复核 §5.5 措辞
- [ ] 禁用走 `setBundleEnabled(name, false)`,不改写用户 `cordis.patch.yml`
- [ ] 批量还原:逐项报告失败、失败项单独标出、"存在但不可读"作为独立状态(§5.6)
- [ ] agent tool 五动作:`diagnose | propose_fixes | apply_fix | rollback | list_applied`
- [ ] 矩阵生产管道:先复用既有类型快照产出候选清单,harness 发版自动开 PR
- [ ] 每个补丁的新旧两版行为测试(附录 D 硬性约束 7)与"还原版"测试(附录 E.7)

**收口条件**:一个真实案例经 kit 挂载、守卫在真提供者占用 key 时自行禁用、单补丁 ≤ 10 KB、一次 harness 升级的候选清单自动产出。

---

## 阶段 4 · M3(增强与上游)

- [ ] D4 API 面比对(参照物是 `RuntimeResolutionEntry.packageDir` 的真实 `exports`,不是 `cordis_inspect`)
- [ ] D5 增强 + 类别 13 双实例检测
- [ ] 上游 PR:给 `pluginInventory` 加 `missingServices` 字段 + `internal/status` 订阅器(按 §10 Q1 的"加字段而非建包")
- [ ] Q3 回填:采集端类型约束(只允许三元组)先落地,再谈开关

**收口条件**:上游 PR 有评审结论(允许是"拒绝",但必须是结论)。

---

## 明确放弃清单(一期不做)

砍掉是决定,不是遗漏;每一项都写明"放弃了什么 + 用户端怎么兜"。

| 放弃 | 兜底 |
|---|---|
| F3 codemod / AST 迁移 | 生成可提交的补丁交给作者;rescue 不持有构建链(§10 Q5) |
| 修改 harness core / 特权启动钩子 | 一期零 core 改动;逃生舱靠自包含 `undo.md` + `.bak` + 一条不依赖 rescue 的命令(§5.7) |
| `cordis-core-changed`(框架自身 API 变化) | 划为一期非目标;发生时按 §9 评估 resolver 包表层重定向,二期再议 |
| 内置矩阵 / npm 矩阵种子 | 按需拉取 + 本地缓存;**完全离线用户首次只有根因没有修法**,这句话已写在 §5.1 |
| 自动降级 / 崩溃计数器 | 自动动作只有"复检失败即自动还原",且受 3 次上限约束(§5.6) |
| 删 `pnpm-lock.yaml` 来"清干净" | F2 不碰 lockfile;需要时是 profile 级操作,单独取得显式同意(§5.3) |
| 静默兜底、"没有报错就算修好" | 复检必须两条判据都过才标 applied(§5.3) |
| 自建 diff 管道、自建诊断报告文件 | 复用 `docs/persistence-changes/releases/` 与官方 `startup-*.log`(S2、§5.2) |
| 复用宿主的 `@deepseek-ai/dsh-atomic-write` 实现 | 对齐它的常量与错误码自己写约 15 行(Q17 的 a);多付的是漂移风险,换来的是 §3.1 的 0 新增依赖与 A10 的存活 |

## 有余量时的顺延顺序(严格按此先后)

```text
1  批量还原 + 失败可见性(M2 的 3.4)—— 多个已应用修复是常态,先让它可信
2  agent tools(M2 的 3.5)—— 让脚本与 agent 能驱动,UI 之外多一条路
3  矩阵生产管道自动化(M2 的 3.6)—— 先靠人工入库首批记录,再谈自动化
4  A3 附带的产品化:把"打开 HMR 后本补丁可热生效"做成一条可选前置修复(§5.3 / §5.6)
5  D4 / D5 增强 + 类别 13(M3)—— 覆盖面扩大,但不解主线缺口
6  上游 PR(M3 的 4.3)+ 顺带提"把 `dsh-atomic-write` 移出 `dsh-` 前缀"(Q17 的 c)—— 收益最大但周期不受本项目控制
7  Q3 社区回填(4.4)—— 依赖脱敏约束先落地
8  多 profile 体验(共享展示、跨 profile 复制修复决定)—— 目前无任何验收,最后做
```

## 期限被压缩时的砍法(从每个阶段的末尾往前砍)

- **阶段 1 内**:先砍 A8 的精确计量(给一个粗数即可)、A7 的清单完备性、S2、**A3 附带(headless 开 HMR)**。**绝不砍 A10 / A11 / A12 / A13 / A14 / A15 / A5** —— 它们决定产品在关键时刻是否存在、以及"可还原"这句话是否真话。
- **阶段 2 内**:先砍 D6(运行期释放检测)、重试降级的 UI 精致度、自举诊断的文案。**绝不砍 `state.json` 的 `before` / `.bak` / tmp+rename / 写完重读确认 / 复检第二条判据 / 逃生舱命令**。
- **阶段 3 整体可推迟到 M1 之后任意时间**;kit 可以晚做,**硬守卫不能晚做** —— 没有硬守卫时过期补丁会把 profile 变成起不来,而 M1 已经会装出第一个真实补丁。
- 卡住超过半天的条目:写结论、跳过、继续下一条。**卡在某一条上耗掉整个阶段是最差结果**。
