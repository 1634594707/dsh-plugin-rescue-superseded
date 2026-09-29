---
description: "第二轮评审:针对方案 v0.3 的 16 条优化项,按致命/重要/改进分级,每条附本轮实测的 file:line 证据与具体改法。"
kind: "working-material"
---

# 第二轮评审意见(v0.3 → v0.4)

评审对象:`proposal.md` v0.3 + `review/*` + `patches/*`。
本文只列**还能优化的地方**,已确认无误的部分不重复([findings.md](findings.md) 的 A–F 组依然成立)。

判定依据全部为本轮**重新读取源码**所得,不沿用既有结论:

| 核验项 | 结论 |
|---|---|
| `evaluatePluginCompatibility` 的 peer 过滤式 | `plugin-compatibility.ts:75` —— `name !== '@deepseek-ai/dsh' && !name.startsWith('@deepseek-ai/dsh-')` 即跳过 |
| `workspace:^ / ~ / *` 哨兵 | `plugin-compatibility.ts:76` 映射为 `runtimeVersion`,永不冲突 |
| 预检置 `disabled` | `compatibility-preflight.ts:112-118`(`deny()` 内 `row.disabled = true`) |
| 装 bundle 时的门禁 | `plugin-manager/src/index.ts:722-723` `selectBundle(true)` 内再次 `evaluatePluginCompatibility`,不符即 `ManagementFailure('incompatible-version')` |
| 禁用 bundle 的原语 | `@Remote setBundleEnabled(name, enabled)`(`plugin-manager/src/index.ts:443`),保留依赖、只摘 bundle 层、自带 `reload()` |
| "我的写入被更高层压过"的既有信号 | `setPluginEnabled` 返回 `'overridden'`(`plugin-manager/src/index.ts:433`) |
| `provide` 冲突抛错 | `vendor/cordis/src/reflect.ts:289-290` `if (this.store[key]) throw`;`provide` 返回 disposer 注册为 fiber effect(`:277-303`) |
| 状态迁移事件 | `vendor/cordis/src/fiber.ts:586` `this.context.emit('internal/status', this, oldState)` |
| 安装作用域包的来源 | `collectInstallationScopePackages` 从 installAnchor 起 BFS **dependencies + peerDependencies**(`app-boot/src/profile.ts:357-414`,注释明写 "Peer dependencies participate");profile 为 `nodeLinker: hoisted` + `autoInstallPeers: false`(`:225-235`) |
| dsh 包是否可达 | `apps/cli/package.json` 的 `dependencies` 含 `@deepseek-ai/dsh-app-boot`、`@deepseek-ai/dsh-plugin-manager`、`@deepseek-ai/cordis-plugin-include` |
| `cordis-plugin-include` 的声明位 | 在 `app-boot/package.json` 中是 **peerDependencies**(`workspace:~`),非 dependencies;该包自带 `js-yaml ^4.1.0`(`vendor/include/package.json:36-39`) |
| 相关包实名 | `@deepseek-ai/dsh-host-plugin-inventory`、`@deepseek-ai/dsh-cordis-host-runner`(均为 `@deepseek-ai/dsh-*` 前缀) |
| `allowBuilds` 批准流程 | `plugin-manager/src/build-approval.ts:18-48` |
| `readPluginInventory` 输出 | `plugin-inventory/src/index.ts:82-95`,含 `enabled` 与 `fiberPhase` |
| 层序与整值覆盖 | `docs/user/develop/basic/publish.md:120-131` |

---

## 一句话结论

**方案的机制层面已经很扎实(A–F 组的核验工作做得对),剩下的问题集中在三处:rescue 自身的存活能力、承诺强度与实现能力的对齐、以及若干口径未冻结。** 其中第 1 条是致命的 —— 按目前的 peer 清单写,rescue 会在 harness 升级后**先于被修插件失效**。

---

## 致命(P0)·不解决则产品在关键时刻不存在

### R1 · rescue 自己会被兼容预检禁用 —— 它在最该出现的时刻消失

§3.1 列出的四个 peer 里,`@deepseek-ai/dsh-app-boot` 与 `@deepseek-ai/dsh-plugin-manager` 都以 `@deepseek-ai/dsh-` 开头,而门禁的过滤式是 `plugin-compatibility.ts:75` —— **只跳过非该前缀的 peer**,这两个必然进判定。

后果链:

1. rescue 声明 `@deepseek-ai/dsh-app-boot: "^0.2.0"`,用户升级到 0.3.0;
2. 启动时 `compatibility-preflight.ts:112-118` 把 rescue 自己的行置 `disabled: true`;
3. Plugins 页里"修复"分区**直接消失**,没有任何一行解释;
4. 更糟的是安装时也过不去:`selectBundle(name, true)` 内部再跑一次 `evaluatePluginCompatibility`,不符即抛 `ManagementFailure('incompatible-version')`(`plugin-manager/src/index.ts:722-723`)。

也就是说:**harness 一升级,修复工具比被修的插件先死**,而这恰恰是它唯一必须存在的场景。

补丁侧已经认识到这个陷阱(A1/A4、patches/README.md 硬性约束 1),但**本体侧没有同样的约束**,§3.1 只列出了 peer 名字,没写范围策略。

**改法(推荐从上到下)**:

1. **本体也不 import 任何 `@deepseek-ai/dsh-*` 包**。`pluginManager` / `profileContext` / `loader` / `hmr` 全部走 `inject` 拿服务 —— 与 [patches/README.md](../patches/README.md) 给补丁的建议同源("只通过 `inject` 声明拿服务"),这样根本不产生受门禁管辖的 peer。需要 `readPluginInventory` 时按 §5.2 已有的说法"自备一个同形状的读"(约 20 行),而不是 import `@deepseek-ai/dsh-host-plugin-inventory`(该名同样命中门禁);
2. peer 只保留 `@deepseek-ai/cordis` 与 `@deepseek-ai/cordis-plugin-include` —— 两者都不以 `@deepseek-ai/dsh-` 开头,`plugin-compatibility.ts:75` 直接 `continue`,**门禁完全不适用**。后者已确认在 installation scope 内(app-boot 的 peerDependencies 声明它,且 `collectInstallationScopePackages` 的 BFS 明写 "Peer dependencies participate");
3. 若确实必须声明 dsh-\* peer,范围用文档化的 `workspace:^`(`:76` 映射为当前 runtime,永不冲突)。**但 `workspace:` 协议对已安装包是否被 pnpm 拒绝需实测**(profile 是 `autoInstallPeers: false`),不要直接当结论用;
4. §5.6 补一条**自举诊断**:rescue 行自身 `disabled` 或 `fiberPhase !== 'active'` 时,Plugins 页给出一行"修复功能当前不可用(原因:…)"。判定材料现成 —— `readPluginInventory` 已在输出 `enabled` 与 `fiberPhase`(`plugin-inventory/src/index.ts:88-93`)。

**配套**:新增 M0 断言 A10(见文末)。

### R2 · §5.5 的"每次启动前守卫"在时序上不可能由 rescue 执行

§5.5 要求"每次启动前检查已装补丁的目标 key 是否已被真实提供者占用,不满足就禁用补丁"。但:

- rescue 是**普通插件**(§6 决策 4),它的 fiber 要等 profile 组合完成才可能 ACTIVE;
- 过期补丁的抛错发生在补丁自己 `apply()` 内的 `ctx.reflect.provide`(`reflect.ts:289-290`),那一步在树挂载途中,**早于 rescue 激活**;
- 抛错的结果是整个 profile 起不来(§9 已有此风险描述),rescue 那时还没机会说话。

**守卫跑在灾难之后。** 唯一能真正阻止这次抛错的时机,是**补丁自己的 `apply()` 开头**:先探测该 key 是否已有注册,有则不 provide。这与 patches/README.md 硬性约束 5("每个补丁必须在启动前自检并能自行禁用")一致,但**与 §5.5 把守卫写成 rescue 职责的措辞直接冲突** —— 实现者会照 §5.5 去实现,然后发现拦不住。

**改法**:把 §5.5 拆成两层并改写措辞。

| 层 | 执行者 | 时机 | 能力 |
|---|---|---|---|
| 硬守卫 | **补丁自身**(kit 提供 `assertNotProvided(key)` 原语) | `apply()` 开头,provide 之前 | 唯一能阻止 `reflect.ts:289` 抛错的时机 |
| 软巡检 | rescue | 启动后 | 发现"矩阵区间已不覆盖 / 官方已发布真提供者 / 存在疑似过期",报 `patch-stale` 并给三个选项 |

并明确写出一句:**rescue 无法阻止 provide 冲突抛错,它只能降低概率并在事后给出可操作的诊断。** §5.5 现有"任一不满足就禁用"的表述要改成"由补丁自行禁用;rescue 负责提示与记录"。

**附带补一处缺失的原语**:§5.5 说"禁用(而非删除)补丁"但没点名怎么做。宿主已有现成的 —— `@Remote setBundleEnabled(name, false)`(`plugin-manager/src/index.ts:443`):保留已装依赖、只把 bundle 从 `dsh.profile.bundles` 摘除、自带 `reload()`,语义上就是"像禁用 mod 一样"。不点名,实现者会跑去重写用户的 `cordis.patch.yml`,那正好踩 A6(无 remove 操作 + 用户文件带注释)。

### R3 · "一键修复 = 第一次点击即批准"与信任模型倒挂

§5.6:一键修复"全程无二次弹窗(第一次点击即批准)"。§5.6 与 §5.4:F0 豁免**必须**显式勾选"我知道这可能崩溃或损坏数据"。

于是:

| 修法 | 实际做了什么 | 确认强度 |
|---|---|---|
| F0 allow | 在 `compatibility.json` 写一行 | **强确认(勾选风险)** |
| F2 补丁 | **装一个第三方包,并在本机执行它的代码** | **零确认** |

严重性与确认强度完全反了。

而且"无二次弹窗"在物理上不成立:F2 若装 git / tarball 源包会触发 `prepare`,pnpm ≥10 要求用户在 `<profile>/pnpm-workspace.yaml` 的 `allowBuilds` 放行,宿主还有一个专门的待批准流程(`plugin-manager/src/build-approval.ts:18-48`)。这一步**必然**是一次额外交互,§5.6 的流程里没有它的位置。

**改法**:

1. 把"一键"重新定义为**省掉导航与手工编辑,不省批准**;
2. 批准强度按 `fixKind` 分级:`allow` 与 `shim` 同为强确认(两者都可能"崩溃或损坏数据"),`config-patch` 可弱确认但**必须可预览要覆盖的整值**(因为 patch 是整值覆盖,用户要看清将复述的每一个键);
3. §5.6 的应用流程把 `allowBuilds` 写成显式第 3 步,并给出 UI 文案(例如"该补丁来源需要执行一次安装脚本,是否放行");
4. §3.2 的"恢复步数 ≤ 3 次点击"相应改为"≤ 3 次交互(含批准与放行)",否则验收标准本身在逼实现者省掉批准。

---

## 重要(P1)·不解决则承诺与实现会错位

### R4 · 试运行只能证伪,不能证实 —— A6 与 §5.3 过度承诺

§5.3 说试运行"既验证修法真的有效",A6 判据写"内存挂载后坏插件由 pending 转 active"。两条路径不等价:

1. **解析来源不同**:试运行走 `cordis-host-runner`(进程内、重启即失),落盘走 `installBundle` → pnpm → `selectBundle` → `reload()`。而 `RuntimeResolution` 在启动时算定、**不因配置刷新重算**(A5 第 2 条),两条路径的模块解析结果可以不同;
2. **isolate label 过滤**:`notify` 会比较 label(`reflect.ts:314`),host-runner 定义的插件若与待修插件不在同一 label,试运行**恒为"无效"**,会把一个可用补丁判成不可用(假阴性)。

**改法**:§5.3 措辞改为"试运行是**快速证伪**通道:能低成本排除明显走不通的修法;是否真的修好,以落盘后 `reconcileProfilePatches` 的结果为准"。A6 断言补两条判据:① 试运行必须与目标插件同 isolate label,否则结论无效;② 试运行失败**不得**作为"补丁无效"的结论,只作为"本路径未证成"。

### R5 · 层优先级与 Q8 的答案在方案内部自相矛盾

三处未裁决:§6 决策 2「一律落盘到 profile 层」 vs §10 Q8 推荐「home 层共享」 vs §5.3「写前读组合树,不能证明胜出就拒绝」。

按 `publish.md:120-131` 的层序(bundles → profile patch → `$DSH_HOME/cordis.patch.yml` → `--patch`,后层压前层):

- **F2 的补丁是装成 bundle 的**,`dsh.profile.bundles` 天然是 per-profile 作用域 —— "home 层共享一份"在 F2 上**不成立**;
- 只有 F1 的整值覆盖才存在"写哪一层"的选择,而它必须按行 id 寻址,行来自组合树。

**改法**:Q8 收敛为「F2 = bundle 层(per-profile,装包即作用域,不存在共享问题);F1 = profile 层」,并回答"多 profile 各装一份是否可接受"(可接受,补丁 ≤10 KB)。

**顺带一个 §5.3 可以省掉的实现**:判定"我的写入会不会被更高层压过"不必自己读组合树重算 —— `setPluginEnabled` 已经返回 `'overridden'`(`plugin-manager/src/index.ts:433`,条件为 `current?.enabled !== enabled && hmr 存在`)。直接消费这个信号即可,§5.3 的"读 `readProfilePatches` / `composeEntries` 自行判定"应改为"优先复用 `overridden`,仅在需要展示冲突来源时才读组合树"。

### R6 · 度量指标在默认配置下不可采集

§8 承诺"诊断定位率 ≥80%""修复命中率""误修率 0",但 Q3 推荐社区回填**默认关闭**。定位率与命中率的分子分母都来自跨用户样本 —— 默认关闭即永远拿不到。另外"误修率 0"是**设计约束**(拒绝应用 + 复检失败即回滚 + 冲突不自动择一)而非可统计指标,写成指标会误导。

**改法**:把指标分成两栏写清来源。

| 指标 | 来源 | 默认可得 |
|---|---|---|
| 应用次数 / 复检通过率 / 自动回滚次数 | 本地 rescue state 文件 | 是 |
| 误修率 | 设计约束(不可统计,只能由流程保证) | — |
| 诊断定位率 / 修复命中率 | 需 opt-in 回填 | 否,且须写明分母定义 |

### R7 · M1 的端到端验收修不了方案自己的头号例子

M1 范围明确"不含补丁(F2)",但 §1.2 的主痛点(PENDING / `service-key-removed`)、全文唯一完整样例 `BRK-2026-0142`、以及 [patches/example-foo-legacy.md](../patches/example-foo-legacy.md) 全部属于 F2,要等到 M2。M1 能演示的"一键修复"只有 F0 与 F1 —— 与摘要和 §5.6 反复用的 foo-tools 例子错位。

**改法(二选一,建议后者)**:① M1 明确改选类别 1(`false-block`)与类别 3(`config-schema-changed`)作为端到端场景,并把 foo-tools 的例子在 M1 章节里标注为"M2 演示";② 把"首个真实补丁"前移到 M1(样例补丁本体只有约 20 行,kit 与守卫可留 M2),这样"零 CLI + 一键修复 + 还原"这条主线在 M1 就有说服力。

### R8 · 体积口径未冻结,CI 门禁(Q14)会变成长期争论

§3.1 写"`pnpm pack` 后量 `lib/index.js`",A8 写"`pnpm pack` 后量 `lib/index.js` 字节数",但 §5.4 的本体含 **bundle 入口 + doctor + patcher** 三段 —— 量哪个文件?是否含 `cordis.patch.yml`?是否含 `.d.ts`?是否压缩?都没定义。单补丁的口径又是另一套(examples 用"安装后增量")。

**改法**:冻结一条命令作为唯一口径并写进 §3.1。建议:

```text
本体   = pnpm pack 后,tarball 内 lib/**/*.js + cordis.patch.yml 的字节和(.d.ts 不计)
单补丁 = 同上,另记 profile 内安装后增量作为参考值
```

并补两条 §3.1 缺失的规则:`maxCacheBytes: 307200` 与 `retain: [current, previous]` 冲突时谁优先;单份矩阵超限时是**拒收**还是**截断**(推荐拒收并回退到上一份,截断会静默丢修法)。

### R9 · 缓存键用 harness 精确版本,与矩阵的区间语义不匹配

`cacheKey: 'harness-exact × channel × matrix-major'`(matrix-v2.yaml:24)。但记录是按**区间**匹配的(`">=0.2.0 <0.3.0"`)。harness 打一个 patch(0.2.0 → 0.2.1)就是新 key → 旧缓存被 `retain: [current, previous]` 淘汰 → 拉回来的内容大概率与刚丢掉的完全相同。既浪费,又把真正需要的"上一份"挤掉。

**改法**:缓存键改为 `matrix.generatedFor`(minor 级)+ channel —— 记录里 `generatedFor: "0.2.0"` 已经承载了这个语义。

---

## 改进(P2)·不致命但会拖慢评审或损害体验

| # | 问题 | 建议 |
|---|---|---|
| R10 | `delivery.verify: sha256`(matrix-v2.yaml:22)无法落地:期望值只能来自同一个 npm registry,等于没验;npm 本身已有 tarball integrity | 改为"npm provenance 校验 + 包内 `schema` 版本断言";或明确 sha256 来自仓库 release 上的独立签名文件 |
| R11 | 命名三套并存:Q7 推荐 `@dsh-rescue/*`,但 matrix 用 `@dsh-rescue/matrix`、样例补丁用 `dsh-rescue-shim-foo-legacy`、§5.4 目录用 `packages/rescue` | 统一:npm 包名 `@dsh-rescue/<name>`,补丁包 `@dsh-rescue/shim-<key>` |
| R12 | 冲突"由人裁决"在 UI 上没有出口:Q12 与 patches/README.md 都说"报出两个 id",但 §5.6 的卡片只有 [一键修复][查看迁移指南][忽略] —— 冲突即死路 | 拒绝**自动**择一,但提供"选 A / 选 B"两个可见选项(仍是人的裁决) |
| R13 | 缺第三类卡片形态:类别 2 / 13 / 14 / `cordis-core-changed` 在矩阵里是 `autoFixable: false`,§5.6 却只有"失效 / 已修复"两态 | 增加"不建议自动修复"态,措辞写死(如"放行也不会工作,需作者适配"),不提供一键按钮 |
| R14 | §5.2 决定读官方 `startup-*.log`(明示不脱敏),§5.6 却要把根因渲染进 Web UI 卡片,用户截图 / Q3 回填会带走 | 补一条"展示前过滤"约束:error message 截断 + 路径/凭据模式过滤;卡片标注"可能含敏感信息"。A7 断言的范围相应从"是否自写文件"扩到"渲染前" |
| R15 | 缺 rescue 自身失效的自举问题(与 R1 相关但不重叠:这里指 PENDING / import 失败,而非被门禁禁用) | 新增 **Q15**:rescue 自身不可用时如何降级;技术上可用 `readPluginInventory` 输出的 rescue 行 `fiberPhase`(含 `null`)判定 |
| R16 | out-of-tree 却 peer 依赖内部公开包(`dsh-app-boot` 等),上游 0.3 改 API 面即崩;方案无支持窗口与跟版策略 | 写明支持窗口(如"当前 stable 与上一个 minor")、跟版 SLA、以及上游 API 变化时的降级路径(诊断侧退化为只读,修复侧停用并明示) |
| R17 | Q2 推荐"不保留 npm 种子"与 G6 的离线可用性有张力:完全离线的用户**首次**拿不到任何修法,只有 F4 | 要么接受并把这句话写进 §5.1 的离线降级表(明确"离线用户首次只有根因没有修法"),要么保留一个随本体发布的最小种子 |
| R18 | §0.1 表里"D2 持续观测 = 新增(**唯一真空白**)"与同表的"矩阵与失效分类 新增 / 补丁 kit 新增 / F1 引擎 新增"并列,读起来自相矛盾 | 改为"harness 侧唯一真空白",避免与"本项目的新增资产"混淆 |

---

## 建议新增的 M0 断言

| 编号 | 断言 | 判据 | 不可行时 |
|---|---|---|---|
| **A10** | rescue 本体的 peer 组合不会触发兼容门禁 | 三个 profile(dsh 0.2.0-rc.1 / 假装 0.3.0 / headless)各装一次 rescue,Plugins 页均出现"修复"分区,stderr 无 `disabling profile plugin` | 立即改为"不 import 任何 `@deepseek-ai/dsh-*` 包,服务全走 `inject`"(R1 改法 1);并把 `workspace:^` 是否被 pnpm 接受作为独立子项实测 |
| **A11** | 补丁能自行避免 `provide` 冲突抛错 | 在已有真实提供者占用该 key 的 profile 上启动带补丁的树:不抛错、补丁自禁用、rescue 报 `patch-stale` | 守卫只能做在"启动后巡检",§5.5 的"启动前"承诺必须删除,§9 风险等级上调 |

## 建议新增的待决问题

- **Q15(由 R15)**:rescue 自身失效(被禁用 / PENDING / import 失败)时,是否有兜底提示?推荐:有,复用 `readPluginInventory` 的 `fiberPhase`。
- **Q16(由 R6)**:三个成功指标里,哪些只在 opt-in 后才有数据?推荐:定位率与命中率标注为 opt-in 后才生效,M1/M2 只承诺本地可算的三项。

---

## 优先级建议

```text
先做(阻塞 v0.4 定稿):R1 R2 R3
再做(阻塞 M0 清单):R4 R5 R7 R8  + A10 A11
然后(阻塞 M1 验收):R6 R9 R12 R13 R17
最后(打磨):R10 R11 R14 R15 R16 R18
```

> 我的判断不一定对。R1、R2 的机制结论是本轮读源码得到的(`plugin-compatibility.ts:75-77`、`reflect.ts:277-303`、`plugin-manager/src/index.ts:443,722-723,433`),但**没有实机跑过**;`workspace:^` 在已安装包上的 pnpm 行为、以及 host-runner 的 isolate label 行为,都只能由 M0 实测裁定。若你手上有实测结果与本文冲突,以实测为准。
