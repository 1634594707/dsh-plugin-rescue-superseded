---
description: "dsh-plugin-rescue 方案的评审意见:事实修正、关键缺口、已有能力复用清单、章节改写建议与附录修订。"
kind: "working-material"
---

# 评审意见

每条断言的 `file:line` 证据见 [evidence.md](evidence.md)。分组:**A** 必须修正的事实性错误、**B** 方案缺失但必须补的内容、**C** 应复用而非重建的已有能力、**D** 章节改写建议、**E** 附录修订。**F** 是 v0.3 引入补丁模型与体积约束后新增的一组。

> 评审对象是方案 v0.1;结论已落在 v0.2(机制修正)与 v0.3(补丁模型 + 体积/易用性验收)。本文按原评审的分组保留,A–E 的措辞仍指 v0.1 原文。

---

## A. 必须修正的事实性错误

### A1 「PENDING 永远静默、用户连原因都看不到」不成立 ⚠️ 最严重

启动时 dsh **已经**打印缺失服务,客户端也已有同样的审计:

- `app-boot/src/index.ts:850-856` 计算未满足 key,`:881` 渲染成 `id (name): pending (waiting for services: a, b)`,`:899-905` 打成 `Plugins waiting for services (N)` 表格;`auditStartupEntries`(`:925`)是**公开导出**的,可选插件走 `:938` 的 stderr warning。
- `client/web/src/boot-client.ts:66-88` 同样逻辑,直接 throw。
- `apps/cli/reference/README.md:71-75` 把这套输出和 `$DSH_HOME/logs/startup-*.log` 写成了正式文档。
- `docs/cordis-tutorial/06-composition-and-hmr.md:61-83` 有一份 20 行手工配方:`ctx.registry.values()` → `runtime.fibers` → `fiber.state === FiberState.PENDING`。

配置重算时还会**重报**:`packages/boot/hmr/src/index.ts:229-233` 把 `reconcileProfilePatches` 的返回值逐条 warn。

真正静默的窗口只有两个,应照实写进方案:

1. **运行期提供者被释放** → 依赖方退回 PENDING,`vendor/cordis/src/reflect.ts:297-303` 只做刷新,没有任何审计钩子;
2. 不伴随配置重算的 PENDING(例如迟到的 provider 一直没来)。

**连带修正 D2 的定位**:不是"从零实现扫描",而是**把一次性检查变成持续观测**——订阅 `internal/status`(每次 fiber 状态迁移都发,`vendor/cordis/src/fiber.ts:586`)+ 补上未满足 key。这比原表述更准,也更站得住。

### A2 诊断面已有一等公民

`packages/host/plugin-inventory/src/index.ts:82-114` 的 `readPluginInventory(ctx)` 已公开导出,`PluginInventoryGateway` 提供 `pluginInventory/list` Remote,每个 entry 已带 **fiberPhase** + meta + agent preset 组合;`plugin-manager/src/index.ts:258` 已在消费,`ui-plugin-manager` 与 `ui-settings-plugin-inventory` 两个页面已在渲染。

它 README 自陈的缺口——"无层级归属、无变更能力、缺失 root fiber 一律报 `null`"(`plugin-inventory/README.md:103-105`)——**正好是 rescue 要补的那一格**。D2 应是在这个快照上加 `missingServices` 字段,由现成页面消费。这同时让 G5 的上游路径从"新增一个 doctor 包"变成"`pluginInventory` 加一个可加字段",后者现实得多。

### A3 「F0 用有依据的豁免替代盲目的 accept-risk」实现不了

- `profile-compatibility.ts:117-119`:`if (enabled && !acceptRisk) throw` —— 矩阵给的是**证据**,不是**同意**;`:121-123` 还要求 `runtimeVersion === current`。
- `compatibility.json` 结构是扁平的 `Record<string, string[]>`(`:42-45,78-91`),**没有位置放矩阵 id 或出处**;任一记录被判废即 `rewritable: false`(`:92`),授予/撤销会 `throw` 要求用户手工修复(`:128-130`)。
- 豁免是精确 `package@version` → 精确 dsh 版本,**插件升级与 dsh 升级都不继承**(`plugin-manager/README.md:65`)。`list_applied` 应显示为**将过期**,不是"已应用"。
- `:109` 明写 "Existing plugin instances are not reloaded by this operation" —— 落盘后必须走 `pluginManager.setVersionExemption`(自带 `reload()`),**不要直接改文件**。

类别 2(`peer-range-stale`,真不兼容)只解锁预检、不改变运行时行为,应显式标为"无可自动修复",避免矩阵把用户推向必坏组合。

### A4 决策 1 在 peer 声明下会自我否定 ⚠️ 最隐蔽

`docs/user/develop/basic/publish.md:103` 教插件作者把需要共享实例的 dsh 包**同时**写进 peer 与 devDependencies。但对 shim 这会同时踩两个雷:

- `plugin-compatibility.ts:75-80` 只认 `@deepseek-ai/dsh-*` peer;旧范围不满足运行时 → `compatibility-preflight.ts:101-118` 直接 `disabled: true` 并打 `disabling profile plugin …`。**shim 在加载前被禁用,修复根本不生效。**
- 旧副本一旦出现在 peer 或被物理安装,解析会改走 shim 自己的祖先副本,正好丢掉决策 1 想要的单实例保证。

正确写法:**peer 声明一个始终包含当前运行时的宽范围**(如 `>=0.1.0 <0.3.0`),旧类型只放 `devDependencies`,且运行时不得物理安装旧包。机制来源是 profile 生成的 `pnpm-workspace.yaml`(`nodeLinker: hoisted` + `autoInstallPeers: false`,`app-boot/src/profile.ts:230-235`),缺失 peer 由 runtime resolution 兜底。

这条**反转了官方教程的建议**,不写清楚 shim 作者一定会照教程踩雷。

### A5 「F2 热生效、通常无需重启」有四个前置条件

行级热挂载是真的(`hmr/src/index.ts:214-236` 监听 → `:229-233` reconcile;`app-boot/src/index.ts:289` 就地 `entry.update`;`hmr/tests/profile.spec.ts:117-127` 有测试),但需同时满足:

1. HMR 已启用 —— **headless / sdk / acp 默认关闭**(`hmr/README.md:27`,base `cordis.patch.yml:27-32`);
2. 启动时算出的 `RuntimeResolution` **不会**因配置刷新重算,shim 必须当场可解析;
3. 该行通过兼容预检(见 A4);
4. 其自身 inject 可满足。

另两个精确事实:**新装**一个包是热的(`plugin-manager/src/index.ts:561` 的 `restart-required` 只在"该名字原本已是依赖"时触发,即版本替换);**版本替换**才真需要重启(`hmr/README.md:89`)。

shim 解挂本身也有限制(`reflect.ts:294-296,314-336`):异步、要求提供者已 ACTIVE、受 isolate label 过滤。更要紧的是 `:290` —— **key 已被注册时 `provide` 直接抛 `service "X" has been registered at <shim>`**。一个过期 shim 撞上官方新发布的真实提供者,结果不是静默 PENDING,而是 profile 起不来。这直接引出 B1。

### A6 「F1 是纯数据变更、最安全」不成立

- patch 是对行 `config` 的**整值覆盖**,不是深合并(`docs/user/develop/basic/publish.md:129-131`;`vendor/include/src/index.ts:120-123`)。
- Config 里存在 `!!js` 表达式(`vendor/include/src/index.ts:9-23`,标记 `{__jsExpr}`),运行时才求值(`vendor/loader/src/config/entry.ts:169`)。用普通 js-yaml 往返会毁掉它们;引用已删服务的表达式会抛错并让该行 failed(`app-boot/src/index.ts:830`)。这类值机器迁不动,必须跳过并交给用户。
- **patch 语言里没有 remove 操作**(`vendor/include/src/index.ts:57-141`)。"回滚即删 shim 行"实际是**重写用户自己的 `cordis.patch.yml`**,而它是带注释的模板(`app-boot/src/profile.ts:220-224`),还可能正被用户并发编辑。回滚策略须显式设计(建议按 id 置 `disabled: true` 覆盖而非删行)。
- 层优先级:bundles → profile patch → **`$DSH_HOME/cordis.patch.yml`** → `--patch`(`profile-context.ts:65-70`;`apps/cli/reference/README.md:9`)。落在 profile 层的修复**可能被 home 层或 `--patch` 静默压过**。§6 决策 2 说"一律落盘到 profile 层"时未考虑这一层。

### A7 类别 3 的症状写错了

"Config 校验失败,入口行被禁用" —— 预检只对 **peer 冲突**置 `disabled`(`compatibility-preflight.ts:101-118`);Config 校验发生在 entry 初始化时的 `resolveConfig`(`vendor/loader/src/config/entry.ts:169`),表现为 **failed fiber**。另外 `--dump-config` / `--dump-config-schema`(`apps/cli/reference/README.md:51,54-68`)是现成的免启动检测器,带"哪个文件提供了这一行"的溯源注释,D3 应直接用。

---

## B. 方案完全缺失、但必须补的

**B1 · shim 过期守卫(最大风险,方案一字未提)**
每次启动前检查已装 shim:矩阵记录是否仍覆盖当前 runtime、目标 key 是否已被真实提供者占用。任一不满足就禁用/卸载。没有这条,一次 harness 升级就可能让所有历史 shim 同时变成启动失败源(见 A5 的 `reflect.ts:290`)。

**B2 · 矩阵缺"已验证可用"一侧与撤回规则**
`false-block` 的证据本来就是"实测兼容",应与 break 记录同表;记录需带 `verifiedOn`(精确 harness 版本)、`expiresAt`,以及"官方已修复版本"—— 命中时优先建议升级而不是打 shim。

**B3 · 预发布版本策略**
`getDshRuntimeVersion()` 读 app-boot 版本,`semver.satisfies(..., { includePrerelease: true })`(`plugin-compatibility.ts:77`)。矩阵的 `">=0.2.0 <0.3.0"` 会匹配 `0.2.0-rc.1` —— 方案自己的示例输出就是 rc.1。schema 须显式声明 rc 策略,verified 证据分通道记录。

**B4 · 失效类别缺 6 项**
- **native include 整份被否决**:`compatibility-preflight.ts:129-137,160-163`,一个 include 文件里只要触到一个不兼容插件,**整个文件的所有行一起消失**,stderr 只留一行。杀伤面最大的静默失效。
- **bundle 被 skip**:`app-boot/src/profile.ts:666-683` + `reportSkippedBundles`,该 bundle 贡献的全部行一起没了。
- **startup-only profile**(HMR 关),所有"热"结论都不成立。
- **isolate scope 不匹配**:服务存在但不在同一 label 下,症状与 `service-key-removed` 完全一样,检测器会误判。
- **import 失败无 fiber**:`app-boot/src/index.ts:836` 记为 `'failed to import'`,矩阵 `detection` 没有对应词表。
- **dsh 包被解析出第二份实例**:Desktop 决策明确记录了这个失效面(`.agents/notes/implemented/architecture/2026-09-08-desktop-bundled-runtime-and-external-plugins.md`),症状是状态分裂 / `instanceof` 失败,现有检测器一个都不覆盖。

**B5 · doctor 自己的启动顺序**
诊断一个自己没起来的插件是不可能的。需要两段式:**启动期**读 `$DSH_HOME/logs/startup-*.log`,**运行期**才是 in-process 服务;并说明 rescue 的 bundle 层必须排在被诊断插件之前,否则它自己会 PENDING。

**B6 · 不要另写一份诊断报告**
官方诊断日志明确警告"原始插件错误可能含配置或凭据,值不脱敏"(`apps/cli/reference/README.md:75`)。方案 §8 要写明自身脱敏姿态;更省事且更安全的默认是**读**已有报告,而不是生成第二份。

**B7 · 信任模型漏了 `allowBuilds`**
从 registry / git 装的包会跑 `prepare`,pnpm ≥10 要求用户在 `<profile>/pnpm-workspace.yaml` 放行,`dsh` 已经会指路(`apps/cli/src/plugin.ts:81-83`;`publish.md:159-179`)。这才是真正的"安装即在你机器上执行代码"时刻,§5.4 一次都没提。

**B8 · 批准通道应复用而非叠加**
`plugin_manager` 的每个动作已要求 `danger-full-access` 或逐次批准(`plugin-manager/README.md:31`),`setVersionExemption` 还要 `acceptRisk` 且"服务只检查确认与版本,不检查会话历史"(`:65`)。rescue 再造一套 = 两个同意面。要么复用,要么说明为何必须分开。

**B9 · 类型 diff 管道的一半已经在仓库里**
`docs/persistence-changes/releases/README.md` 已有 26 个发布 tag、25 次相邻转换的类型快照。第一期直接复用,别自建 diff 工具 —— 能砍掉 §5.1 数据管道相当大一块。

**B10 · 建议砍掉 F3 codemod**
§9 自己承认"shim 成为新 bug 源",而 F3 一次引入 AST 迁移 + 本地构建 + 本地路径安装 + `allowBuilds` 四条新信任链,换来一个 shim 能覆盖的窄场景。改成"生成补丁交给作者"更划算。(对应 §10 Q5,答案是:砍。)

**B11 · 度量没有采集口径**
"诊断定位率 ≥80%""误修率 0"需绑到 `reconcileProfilePatches` 返回值和 rescue state 文件,否则不可验证。

**B12 · shim 作用域未定**
per-profile 装 N 份,还是 `$DSH_HOME` 一份?按层语义,home 层才是"机器本地共享偏好"的正位。这直接影响供应链面与 §10,应进问题列表。

**B13 · 一个明显更好的 F2 前置步骤**
`packages/extensions/cordis-host-runner/README.md:12,46,50`:host-only 定义**在本进程激活、重启即失**。用它做**试运行**(内存挂载 shim → 看坏插件是否解挂),通过了再落盘。既服务"修复后复检",又不污染用户文件,还能在矩阵不覆盖当前 runtime 时安全地给出"这条路走不通"。

---

## C. 该复用而不是重建的

| 方案要做的事 | 已有能力(可直接调用) |
|---|---|
| D1 peer 判定 | `evaluatePluginCompatibility`(`app-boot/src/index.ts:22` 公开导出) |
| D1 豁免状态 | `readProfileCompatibility` / `dsh plugin version-exemptions` |
| D2 PENDING + 缺失 key | `auditStartupEntries`(`app-boot/src/index.ts:925`,已导出) |
| D2 活体快照 | `readPluginInventory`(`plugin-inventory/src/index.ts:82`)+ 已渲染的页面 |
| **D2 持续观测** | **无 —— 唯一真空白** |
| D3 加载失败 | 预检 stderr + `startup-*.log` + `--dump-config` / `--dump-config-schema` |
| 修复后复检 | `reconcileProfilePatches`(`app-boot/src/index.ts:273-302`,已实现"前后失败对比 + 新增失败即抛") |
| 装 shim | `pluginManager.installBundle` → pnpm → `selectBundle` → `reload()`(`plugin-manager/src/index.ts:506,560-563,715-735`) |
| 写豁免 | `pluginManager.setVersionExemption`(自带 reload) |
| 内存试挂载 | `cordis-host-runner` 的 define/run/stop |
| Web 界面 | Plugins 页 + Settings 只读清单 + `plugins.bundle.config` / `plugins.row.config` 插槽 + `ctx.settingsScope` |
| agent tool 形态 | `plugin_manager` 工具族(`plugin-manager/src/tools.ts`) |
| D4 的运行时参照 | 应读 `RuntimeResolutionEntry`(name/packageDir/version),**不是** `cordis_inspect` 静态目录 |

按这张表,四层里真正的新增资产只剩**矩阵与分类**、**shim-kit**、**F1 config-mapping 引擎**三项,其余是薄组合。§8 的 M1 估时(3–4 周)应据此下调,而 M0 反而要**加长** —— 它现在验的是自己以为的机制,不是真实机制。

---

## D. 建议新增 / 改写的章节

- **§0 后加一节「本文与已有能力的关系」**:逐项标注"复用 / 新建 / 上游 PR"。这同时是 G5 可信度的来源。
- **§2 失效表**:修 A7 的类别 3,补 B4 的 6 类,并给 `detection` 加**受控词表**(目前是自由 YAML,无法机器校验)。
- **§5.2 D2 改写**为"持续观测 + 补齐未满足 key",新增 D6「运行期服务释放」;补两段式启动设计与"不自写报告"的取舍。
- **§5.3**:新增「落盘位置与层优先级」「回滚策略(patch 无 remove 语义)」「试运行后再落盘」三小节。
- **§5.4**:补 `allowBuilds`,并把批准收敛到 `plugin_manager` 既有通道。
- **§6 决策 1 改写**(A4);**决策 2 补层优先级**(A6)。
- **新增 §5.5「过期守卫与撤回」**(B1/B2)。
- **§8 M0 增 4 条硬断言**(见 [m0-assertions.md](m0-assertions.md));M1 范围收窄;度量绑定采集口径。
- **§9 风险**:补"过期 shim 变成启动失败源"与"dsh 包双实例"。
- **§10**:见 [open-questions.md](open-questions.md) 的 Q1–Q12。

## E. 附录修订

**补**:`packages/host/plugin-inventory/src/index.ts`、`packages/boot/hmr/src/index.ts` 与 `src/watch-config.ts`、`packages/client/web/src/boot-client.ts:66`、`packages/boot/app-boot/src/index.ts:273`(`reconcileProfilePatches`)、`packages/extensions/cordis-host-runner/`、`docs/user/develop/basic/publish.md`(bundle 作者指南 + peer/devDependency 规则)、`docs/cordis-tutorial/06-composition-and-hmr.md:61`(PENDING 手工配方)、`apps/cli/reference/README.md:71-75`(启动诊断)与 `:79-101`(插件管理)、`.agents/notes/implemented/architecture/2026-09-08-desktop-bundled-runtime-and-external-plugins.md`(双实例失效面)。

**修**:`vendor/include/src/index.ts` 的 patch 操作**没有 remove**,方案"删 shim 行"的表述须随之修改。

---

## F. v0.3:补丁模型与体积约束引入的新结论

方案在 v0.3 改为游戏 mod 补丁模型,并新增"本体要小、使用要方便"两条硬约束。核验源码后得到的结论:

### F1 体积能压住,杠杆已经写在 §C 里

本体真正要写的只有四段逻辑 —— 持续观测(D2)、指纹提取与分类、应用编排、过期守卫。其余全部走 §C 那一列的既有服务,**一个字节都不占**。最关键的一条:

- **YAML 往返不必自带库。** `entryListSchema` 来自 `@deepseek-ai/cordis-plugin-include`,该包是**公开发布的 vendored 成员**(`vendor/include/package.json` 的 `publishConfig.access: public`,`exports["."]` 指向 `lib/index.js`,`src/index.ts:23` 导出 `entryListSchema`)。rescue 把它当 peer 引用即可拿到宿主的 js-yaml 实例与 `!!js` 标记支持。这同时避免了 A6 提到的往返损坏。

### F2 补丁可以做到 10 KB 以内,因为它不复现被删掉的东西

补丁只用 `ctx.reflect.provide(name, value)`,它注册为 fiber effect 并返回 disposer(`vendor/cordis/src/reflect.ts:277-304`)。一个 key 桩就是"声明 `inject` 拿到新服务 → provide 旧名 → 委托"。**补丁可以完全不 import 任何 dsh 包**,因此 A4 的 peer 陷阱对这一类补丁根本不存在。

### F3 但"过期补丁"是 F2 唯一且不可忽略的风险

`reflect.ts:289-291` 在 key 已被注册时直接抛错。这是补丁模型引入的新失效面(游戏 mod 里的"mod 与游戏更新冲突"),v0.1 完全没考虑。已落为 proposal §5.5 的双重守卫(安装前 + 每次启动前)与 M0 断言 A4。

### F4 矩阵按需拉取会引入新的信任面,必须配离线降级

矩阵从"内置数据"变成"运行时拉取",信任面从"装包时审一次"变成"每次可能出网"。核验后确认:诊断的核心部分(D1/D2/D3/D6)**完全不读矩阵**,因此可以把矩阵严格限制在"分类 + 修法"两层。这条分层是 v0.3 能同时满足"小"与"离线可用"的原因,也是 M0 断言 A9 要验证的东西。

### F5 官方教程对补丁作者是错的

`docs/user/develop/basic/publish.md:103` 让插件作者把 dsh 包同时写进 peer 与 devDependencies。这对普通插件是对的(保证单实例),对补丁是错的(旧范围会被预检禁用,见 A4)。因此 [patches/README.md](../patches/README.md) 把"peer 声明宽范围"列为硬性约束第 1 条,并在样例里给出"根本不 import"的写法。
