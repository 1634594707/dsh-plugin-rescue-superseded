# dsh-plugin-rescue:社区插件兼容修复系统 · 方案文档

> **未采纳(2026-09-29)**:本文是平台化草案。项目当前形态是 `README.md` 里的小 CLI —— 静态分析 + F0/F1 落盘 + 可还原。本文里仍然成立的是 §0.1(复用宿主能力)、§3.1 的原子写与备份口径、§5.3.1 的六条写盘装备、附录 C 的受控词表;其余(矩阵按需拉取与缓存淘汰、GUI 分区与卡片、agent tool、bundle 形态的本体、逃生舱命令)**未实现,不作为当前判据**。

| | |
|---|---|
| 版本 | v0.4(草稿,待评审) |
| 日期 | 2026-09-29 |
| 状态 | 待评审 —— 重点看 [§10 待决问题](#10-待决问题评审重点) 与 [§5.7 逃生舱](#57-逃生舱还原能力不能依赖它自己要救的运行时) |
| 范围 | out-of-tree 社区项目,第一期不修改 deepseek-harness 仓库代码 |
| 模型 | 参照游戏 mod 补丁:本体不打补丁、补丁旁挂、按需分发、一键装卸还原;补丁规格见 [附录 D](#附录-d补丁规格),完整样例见 [附录 E](#附录-e补丁样例dsh-rescuepatch-foo-legacy) |
| 预算 | rescue ≤ 100 KB,单补丁 ≤ 10 KB,矩阵缓存 ≤ 300 KB,新增运行时依赖 0(见 [§3.1](#31-体积预算验收标准)) |
| 参考实现 | 桌面版 `deepseek-harness-desktop` 的插件恢复模式已上线且基线相同(dsh `0.2.0-rc.1`),§5.3 / §5.5 / §5.6 / §5.7 的机制与之对照,引用写作 `desktop:` 前缀(缩写表与逐条核验见 [roadmap.md](roadmap.md) 的「前提核验记录」) |
| 修订 | v0.2 依源码核验修正 A 组七处与源码不符的机制断言、补 B 组缺口;v0.3 改为补丁模型,新增体积与易用性验收、矩阵按需拉取与离线降级、用户交互规格;**v0.4 合入两轮评审共 32 条:本体不 import dsh-\* 包、守卫拆硬/软两层、批准强度分级、还原改成有备份 / 原子写 / 可中断的机制、新增 §5.7 逃生舱与 §5.3.1 写盘语义、层优先级与作用域收敛为 F2 = bundle / F1 = profile、度量按来源分栏** |

## 0. 摘要

deepseek-harness 官方更新后社区插件失效,当前只有"拦截"没有"修复":peer 依赖门禁会把不满足版本范围的插件挡在加载前,被拦的插件用户只能用 `allow-version --accept-risk` 裸放行或等作者更新。另一类失效(inject 的服务 key 被删除)表现为永远 PENDING 的挂起——启动审计确实会打印缺失的服务名,但只在启动与配置重算时各报一次(`app-boot/src/index.ts:899-905`),运行期提供者被释放等情形没有任何报告。

本方案提出 `dsh-plugin-rescue`:一个以 dsh bundle 形态安装的**补丁管理器**,由四层组成——**兼容矩阵**(失效知识库)、**诊断器**(定位根因)、**补丁执行器**(分级修复)、**交付与信任**(显式批准、可回滚)。全部能力走文档化扩展点,第一期零 core 改动。

v0.3 的模型来自游戏 mod 补丁,带来两条硬约束:

- **体积**。补丁是差异不是重写,本体只写增量。dsh 侧的状态读取、复检、装包、写豁免**已经全部存在**(见 §0.1),rescue 不重造,因此能压到百 KB 量级;
- **易用**。用户不该理解 `cordis.patch.yml`。诊断零 CLI、总是自动跑;修复是一键;还原像禁用 mod 一样干净。

v0.4 补第三条,因为它决定前两条在关键时刻是否还成立:

- **可还原是机制,不是承诺**。"逐字节等价"要求改前备份、原子写、意图先行的状态记录;"零 CLI"要求一条**不依赖 rescue 能否加载**的还原路径 —— rescue 是普通插件,它写坏的 profile 会让它自己加载不了(§5.7)。

一处结构性结论:**harness 侧的诊断增量只有两处** —— 持续观测与未满足 key。其余复用既有服务,上游路径也随之收窄为给既有服务加字段,而不是新增一个 doctor 包。

### 0.1 本文与已有能力的关系

本项目不重造仓库里已经存在的能力。下表逐项标注,后续每一节都按此边界叙述。

| 方案要做的事 | 已有能力 | 关系 |
|---|---|---|
| D1 peer 判定 | `evaluatePluginCompatibility`(`app-boot/src/index.ts:22` 公开导出) | 复用(不占体积) |
| D1 豁免状态 | `readProfileVersionExemptions`(`profile-compatibility.ts:99`) / `dsh plugin version-exemptions` | 复用 |
| D2 PENDING 与未满足 key | `auditStartupEntries`(`app-boot/src/index.ts:925`)、`readPluginInventory`(`plugin-inventory/src/index.ts:82`) | 复用 |
| **D2 持续观测** | 无 | **新增(harness 侧唯一真空白)** |
| D2 活体快照的展示 | `pluginInventory/list` Remote + Plugins 页 + Settings 只读清单 | 复用(加字段) |
| D3 加载失败 | 预检 stderr、`$DSH_HOME/logs/startup-*.log`、`--dump-config` / `--dump-config-schema` | 复用 |
| 修复后复检 | `reconcileProfilePatches`(`app-boot/src/index.ts:273-302`) | 复用 |
| 装补丁 | `pluginManager.installBundle` → pnpm → `selectBundle` → `reload()`(`plugin-manager/src/index.ts:506,560-563,715-735`) | 复用 |
| 写豁免 | `pluginManager.setVersionExemption`(自带 `reload()`) | 复用 |
| 试运行(不落盘验证) | `cordis-host-runner` 的 define/run/stop | 复用 |
| YAML 读写(含 `!!js` 标记) | `entryListSchema`(`@deepseek-ai/cordis-plugin-include`;`vendor/include/package.json` 的 `publishConfig.access: public`) | **peer 白嫖,不打包** |
| 矩阵与失效分类 | 无 | **新增** |
| 补丁 kit 与受控桥接原语 | 无 | **新增** |
| F1 config-mapping 引擎 | 无 | **新增** |
| D4 API 面比对 | `RuntimeResolutionEntry`(name/packageDir/version);`cordis_inspect` 是**静态目录**,不是运行实例自省 | 新增(参照物换掉) |

**复用能力的取得方式(v0.4 起为硬约束)**:本体**不 import 任何 `@deepseek-ai/dsh-*` 包**。兼容门禁的过滤式只管辖以 `@deepseek-ai/dsh-` 开头的 peer(`plugin-compatibility.ts:75`),因此声明这类 peer 会让 rescue 在 harness 升级时**先于被修插件失效** —— 预检把它自己置 `disabled`(`compatibility-preflight.ts:112-118`),Plugins 页的"修复"分区直接消失,连安装也过不去(`plugin-manager/src/index.ts:722-723` 的 `selectBundle(name, true)` 会重跑一次评估)。上表的"复用"一律经 `ctx.inject` 取服务(`pluginManager` / `profileContext` / `loader` / `hmr`),需要 `readPluginInventory` 的输出时自备一个同形状的读(约 20 行)。允许的 peer 只剩 `@deepseek-ai/cordis` 与 `@deepseek-ai/cordis-plugin-include`,两者都不落入门禁管辖范围。对应 M0 断言 A10(见 [roadmap.md](roadmap.md))。

### 0.2 补丁模型

游戏 mod 补丁的形态,以及每条在本方案里对应的机制:

| mod 世界的做法 | 本方案 | 为什么 |
|---|---|---|
| 本体文件只读,补丁旁挂 | 不改 harness、不改用户配置的原意,只加旁挂层 | 决策 4:no privileged core to patch |
| 补丁是差异,不是重写 | 补丁只把旧名字重新指回新名字,不复现被删掉的实现 | ≤ 10 KB 可行 |
| 按需分发,只下当前版本要的那几份 | 矩阵按 `getDshRuntimeVersion()` 的精确版本 + 通道拉取,只缓存当前与最近一份 | 本体不内置矩阵 |
| 兼容性矩阵是核心资产 | 失效知识库是项目唯一抄不走的东西 | 同 |
| 一键装 / 卸 / 还原 | 见 §5.6 | 易用性 |
| 冲突报错,不猜 | 两个补丁补同一 key → 拒绝应用并报出两个 id | 误修率为 0 |
| 官方补丁 / 社区补丁 / 测试补丁分级 | `confidence: verified / inferred / reported` | 同 |

一个直接后果:**本体不做判断之外的任何事**。矩阵只提供两样东西 —— 把观察到的状态**分类**成失效类别,以及给出**修法**。分类之外的诊断(D1/D2/D3)全部本地完成,因此离线时诊断照常可用,只是没有"属于哪类、有没有修法"这一层(见 §5.1 的离线降级)。

## 1. 背景与问题定义

### 1.1 现状:有拦截、无修复

加载链路(详见附录 A 代码索引):

1. `cordis.yml` 与各补丁层由 `@deepseek-ai/cordis-plugin-include` 解析为入口列表;
2. `@deepseek-ai/cordis-plugin-loader` 逐项 import 并挂载插件;
3. `packages/boot/app-boot` 的运行时拦截层(`installRuntimeInterception`)把所有插件对 harness 包的 bare import 统一路由到安装内唯一的实例表,保证全部插件共享同一个 `@deepseek-ai/cordis`;
4. 挂载前由 `compatibility-preflight` 与 `evaluatePluginCompatibility()` 做版本门禁。

现有兼容机制只有门禁与豁免:

- 插件 `peerDependencies` 中声明的 `@deepseek-ai/dsh-*` 范围不满足运行时版本 → `pluginCompatibilityWarning`,预检直接禁用对应行;
- per-profile `compatibility.json` 可记录精确豁免,经 `dsh plugin allow-version --accept-risk` 或 PluginManager 授予,本质是"用户自担风险强行放行";
- 没有任何机制告诉用户**插件为什么坏、坏在哪、有没有替代修法**。

### 1.2 用户痛点

- **报告有缺口**:inject 的服务不存在时插件停在 PENDING。启动时 dsh 会打印 `Plugins waiting for services (N)` 并列出缺失的 key(`app-boot/src/index.ts:899-905`),配置重算时会再报一次(`hmr/src/index.ts:229-233`);但运行期提供者被释放(`reflect.ts:297-303`)与不伴随配置重算的 PENDING 没有任何报告,官方教程也只能靠 `setTimeout` 轮询兜底(`docs/cordis-tutorial/06-composition-and-hmr.md:61-83`)。**缺的是持续观测与根因归类,不是第一次诊断。**
- **裸放行**:`allow-version` 只是绕过门禁,插件可能照常坏,且用户无从判断"实际是否兼容";
- **等待成本**:只能等插件作者适配新版;没有社区侧的临时修复通道;
- **知识流失**:每次踩坑的经验散落在 issue 里,下一个用户重新踩一遍。

## 2. 失效模式分析

官方升级导致社区插件失效,可归为十四类。**每一类的检测手段和修复手段完全不同**,这个映射是整个系统设计的骨架:

| # | 失效类别 | 典型症状 | 检测器 | 修复手段 | 优先级 |
|---|---|---|---|---|---|
| 1 | `false-block`(版本门禁假阳性) | 预检禁用,实际兼容 | D1 + 矩阵 | F0 allow(有依据地豁免) | P0 |
| 2 | `peer-range-stale`(真不兼容但可低成本绕过) | 预检禁用 | D1 | **无自动修复**(见下) | P0 |
| 3 | `config-schema-changed` | Config 校验失败,行为 **failed fiber**(不是行被禁用) | D3 | F1 config-patch | P0 |
| 4 | `config-expression-broken` | `!!js` 表达式引用已删服务,该行 failed | D3 | 无(机器迁不动,交用户) | P1 |
| 5 | `service-key-removed` | 停在 PENDING,启动时有报告 | D2 | **补丁:key 桩** | P1 |
| 6 | `service-key-scope-mismatch` | 症状同 5,但服务存在于其他 isolate label | D2 | 无(必须先排除再下补丁) | P1 |
| 7 | `service-api-changed` | 服务存在,方法签名/行为变化,运行时报错 | D4 + D5 | **补丁:调用适配** | P1 |
| 8 | `event-contract-changed` | 事件改名或 payload 变化,监听失效 | D4 | **补丁:事件桥接** | P2 |
| 9 | `tool-api-changed` | `defineTool` 等注册 API 变化 | D4 + D5 | **补丁:调用适配** | P2 |
| 10 | `include-file-denied` | 一个 include 文件触到不兼容插件,**整份文件所有行一起消失**,stderr 只留一行 | D3 | F0/F1 | P1 |
| 11 | `bundle-skipped` | bundle 不兼容或不可读,`skippedBundles` 打印一行,贡献行全消失 | D3 | F0/F1 | P1 |
| 12 | `provider-disposed-runtime` | 运行期提供者被释放,依赖方静默退回 PENDING | D6 | **补丁:key 桩** | P1 |
| 13 | `duplicate-package-instance` | dsh 包被解析出第二份实例,状态分裂 / `instanceof` 失败 | D4 | 无 | P2 |
| 14 | `import-failed` | 无 fiber,归类为 `failed to import` | D3 | 无 | P2 |
| — | `cordis-core-changed` | Cordis 框架自身 API 变化,大面积失效 | — | **一期非目标**(见 §9) | — |

关于类别 2:豁免**只解锁预检,不改变运行时行为**。真不兼容的插件放行后照常坏。矩阵必须把这类标为 `autoFixable: false`,诊断器对它的措辞是"无可自动修复"。

关于类别 3 与 4 的区分:Config 校验发生在 entry 初始化时的 `resolveConfig`(`vendor/loader/src/config/entry.ts:169`),表现为 **failed fiber**;预检的 `disabled: true` 只用于 **peer 冲突**(`compatibility-preflight.ts:101-118`)。两者症状不同,修法也不同。

`detection` 使用受控词表而非自由 YAML,未知值拒绝入库(见 §5.1 与 [附录 C](#附录-c矩阵-schema-与受控词表) 的 `vocabulary.detection`)。

无矩阵记录时,统一回退到 F4 manual(给出迁移指南与根因说明)—— **这也是离线时的默认行为**。

## 3. 目标与非目标

### 目标

- **G1 诊断**:用户在任意失效场景下能看到"哪个插件、什么根因、属于哪类失效、有没有修复";
- **G2 修复**:P0/P1 类失效提供可落地补丁,常见场景从"等作者"变为"分钟级恢复";
- **G3 可信**:一切修复显式批准、落盘可见、可回滚、可审计;绝不静默掩盖;
- **G4 可持续**:矩阵数据有半自动化生产管道,不依赖纯手工维护;
- **G5 可上游**:诊断侧的增量是一处加字段 + 一个状态订阅器,便于将来向上游 PR;
- **G6 小**:本体与补丁的体积有硬预算,见 §3.1;
- **G7 好用**:诊断零 CLI,修复一键,还原干净,见 §3.2。

### 非目标

- 不修改 harness core(第一期);不改 agent-loop;
- 不解决 `@deepseek-ai/cordis` 框架自身 API 变化(失效类别 `cordis-core-changed`,见 §9);
- 不做静默兜底或自动降级——所有修复都在诊断之后、经用户批准;
- 不替代 pnpm/PluginManager 的包管理职责,只在其上叠加修复语义;
- **不重造宿主已有的能力**——状态读取、复检、装包、写豁免一律走既有服务。

### 3.1 体积预算(验收标准)

| 预算项 | 目标 | 保障手段 | 验收 |
|---|---|---|---|
| rescue 本体 | ≤ 100 KB | 纯逻辑,零新增运行时依赖;需要的宿主能力全走 `inject` 取服务 | 按下方冻结口径量;CI 里作为门禁(Q14) |
| 本体依赖树 | 0 个新增 `dependencies` | 允许的 peer 只有 `@deepseek-ai/cordis` 与 `@deepseek-ai/cordis-plugin-include` —— 两者都不以 `@deepseek-ai/dsh-` 开头,不受兼容门禁管辖(§0.1) | 包 manifest 检查:`dependencies` 段为空,且 `peerDependencies` 无 `dsh-*` |
| 单个补丁 | ≤ 10 KB | 补丁只把旧名字重新指回新名字 | 每个补丁在 [roadmap.md](roadmap.md) A8 量 |
| 矩阵缓存 | ≤ 300 KB | 只缓存当前与上一份 | 缓存目录大小上限,超出即淘汰旧份 |
| 矩阵生产 | 离线 | 生产管道不随本体发布 | 发布流水线,不属于运行时 |
| 改前备份(`.bak`) | 不计入本体预算 | 每条 applied 记录一份,落在 profile 目录 | **保留策略**:还原成功后删除;同一文件至多留最近 3 份,超出即淘汰最旧 |

**体积口径(v0.4 冻结,唯一口径)**:

```text
本体     = pnpm pack 后,tarball 内 lib/**/*.js + cordis.patch.yml 的字节和(.d.ts 不计)
单补丁   = 同上口径,另记 profile 内安装后增量作为参考值
```

明确禁止的增重项:不内置矩阵;不自带 diff 引擎(生产在离线管道);不带 AST/codemod(F3 已砍);不自带 YAML 库(`entryListSchema` 从 `@deepseek-ai/cordis-plugin-include` 以 peer 取得 —— 该包是公开发布的 vendored member)。

**缓存淘汰的两条未定义规则,一并定死**:`maxCacheBytes: 307200` 与 `retain: [current, previous]` 冲突时**以字节上限优先**(宁可少留一份,不可突破预算);单份矩阵超过上限时**拒收并回退到上一份**,不截断 —— 截断会静默丢修法。

体积最大的杠杆是 §0.1 那一列"复用":这些东西已经在宿主里,一个字节都不占。

### 3.2 易用性验收标准

| 项 | 目标 | 验收 |
|---|---|---|
| 零 CLI(**日常路径**) | 装完 rescue 后自动开始诊断 | 全新 profile 装上 rescue,不敲任何命令,Plugins 页出现"修复"分区。**例外**:逃生舱是一条不依赖 rescue 的命令(§5.7)—— 恢复能力不能依赖它要救的运行时 |
| 恢复步数 | ≤ 3 次**交互**(含批准与 `allowBuilds` 放行) | 从看到失效到插件恢复,交互数 ≤ 3。写成"点击"会在验收上逼实现者省掉批准,故计量单位是交互 |
| 还原步数 | ≤ 2 次点击,且无残留 | 还原后用户配置文件与还原前**逐字节等价**(rescue 自己的状态文件除外)。等价性由改前 `.bak` 保证,**不是**由结构化往返保证(§5.3.1) |
| 失败可读 | 一句人话 + 一个"查看详情"入口 + **一个可执行的下一步** | 任何失败路径都不要求用户打开日志文件或 `cordis.patch.yml`;文案必须说清"文件现在是什么状态、下次启动会怎样、用户能做什么" |
| 批量失败不静默 | 逐项报告 | 一次处理多个已应用修复时,任一项失败不得宣称整体成功,失败项在卡片上单独标出;"存在但不可读 / 不可还原"是独立状态,不得回落成"可用"或干脆不显示 |
| 重试有上限 | 同一目标最多自动尝试 3 次 | 计数键为 `(插件, harness 精确版本, fixKind)`,**只在修复动作失败时** +1(诊断次数不计入);达 3 次后该项降级为 F4 只给指南,并写明"已尝试 3 次" |
| 离线可用 | 断网时诊断仍出结果 | 拔网线后诊断照常;缺的是"分类 + 修法",并明确说明原因 |
| 默认只读 | 诊断自动,动手要人点 | 未点击时不产生任何落盘变更;不引入任何"连续失败 N 次自动降级"的机制 |

## 4. 总体架构

```text
                  ┌──────────────────────────────────────────────────┐
                  │               dsh profile(用户)                  │
                  │                                                  │
  dsh bundle ───► │  ┌────────────┐  ┌────────────┐   ┌───────────┐  │
  dsh-rescue      │  │ 社区插件 A  │  │ 社区插件 B  │   │  rescue   │  │
  (安装,本体小)   │  └─────┬──────┘  └────────────┘   └─────┬─────┘  │
                  │        │ PENDING 挂起                    │        │
                  │        ▼                                ▼        │
                  │  ┌──────────────────────────────────────────────┐│
                  │  │           dsh-rescue-doctor(服务)             ││
                  │  │ D1 peer 评估 · D2 PENDING 持续观测 · D3 加载  ││
                  │  │ 失败 · D4 API 面比对 · D5 运行时错误 · D6 释放 ││
                  │  └──────────┬────────────────────────┬──────────┘│
                  └─────────────┼────────────────────────┼───────────┘
                                ▼                        ▼
        ┌───────────────────────────────────┐  ┌──────────────────────────┐
        │  dsh-rescue-matrix(数据,按需拉取) │─►│   dsh-rescue-patcher     │
        │  分类 + 修法 + 可用记录 + 过期规则 │  │  F0 allow · F1 覆盖      │
        │  本地缓存 ≤300KB · 离线降级        │  │  补丁:key 桩/调用适配/   │
        └───────────────────────────────────┘  │  事件桥接 · F4 指南      │
                                               └───────────┬──────────────┘
                                                           ▼
                                         profile 层落盘(全部可见可回滚):
                                         cordis.patch.yml / compatibility.json
                                         / 已安装补丁包 / 状态与审计文件
```

四层职责:

- **矩阵(知识)**:回答"这类失效有没有已知的修法";是纯数据包,按需拉取并本地缓存;
- **诊断器(感知)**:在 harness 进程内运行的服务,产出每个插件的状态与根因分类;
- **补丁执行器(执行)**:把矩阵里的修法变成 profile 层的具体变更;
- **交付与信任(治理)**:批准、落盘、回滚、审计,对齐现有 `accept-risk` 信任语义。

诊断器的启动期与运行期是两段式(见 §5.2),因为**一个自身处于 PENDING 的插件无法报告自己**。

## 5. 详细设计

### 5.1 兼容矩阵 `dsh-rescue-matrix`

**定位**:项目的核心资产。代码会过时,这份"哪个版本区间坏了什么、怎么修"的数据是别人抄不走的部分。

**分发:按需拉取 + 本地缓存**(v0.3 新增)。本体不内置矩阵,以保体积:

```text
缓存键 = 矩阵的 generatedFor(minor 级)× 通道(rc | stable) × 矩阵 major
缓存位置 = $DSH_HOME/plugin-rescue/matrix/<key>.json
只保留当前与上一份;字节上限优先于份数
```

缓存键**不用 harness 精确版本**(v0.4 改):记录是按区间匹配的(`">=0.2.0 <0.3.0"`),harness 打一个 patch 版本(0.2.0 → 0.2.1)就产生新 key,旧缓存被 `retain` 淘汰,拉回来的内容与刚丢掉的大概率完全相同 —— 既浪费,又把真正需要的"上一份"挤掉。记录里的 `generatedFor` 已承载这个语义。矩阵完整性校验用 **npm provenance + 包内 `schema` 版本断言**,不用 `delivery.verify: sha256`(期望值只能来自同一个 registry,等于没验;npm 自身已有 tarball integrity)。

**离线降级是设计的一部分,不是异常路径**:

| 能做 | 需要矩阵 |
|---|---|
| 观察每个插件的状态、缺失的 inject key、导入失败、预检拒绝、复检前后差异 | — |
| 把观察到的状态**分类**成 §2 的失效类别 | 需要 |
| 给出**修法**与前置条件 | 需要 |

因此断网时诊断照常出结果,只是缺"属于哪类、有没有修法",并明确告诉用户是矩阵没取到而不是插件没问题。F4(指南)始终可用。

**一处必须写死的取舍(v0.4)**:Q2 决定不保留 npm 矩阵种子,因此**完全离线的用户首次拿不到任何修法,只有 F4**。这不是可以事后补偿的状态 —— 要么接受并把这句话摆在离线文案里(本节即为此),要么改 Q2 留一份随本体发布的最小种子。不要留第三种"看起来支持离线"的表述。

**记录模型**:`rescue.matrix/v2`,完整字段契约与受控词表见 [附录 C](#附录-c矩阵-schema-与受控词表),完整示例见 [附录 B](#附录-b矩阵记录完整示例)。v2 相对 v1 补入四项:

- **`state: works | broken`(双向记录)**。`false-block` 的证据本身就是"实测兼容",没有正向记录就无法证明一个豁免是有依据的;
- **过期与撤回**:`expiresAt`、`retractedBy`、`supersededBy`。命中 `supersededBy` 时优先建议升级而不是挂补丁 —— 这既是信任问题也是可用性问题(见 §5.5);
- **预发布策略**:`meta.prerelease`。`getDshRuntimeVersion()` 读的是 app-boot 版本,而门禁用 `semver.satisfies(..., { includePrerelease: true })`(`plugin-compatibility.ts:77`),所以 `">=0.2.0 <0.3.0"` **会**匹配 `0.2.0-rc.1`。rc 与 stable 分通道取证,rc 运行时把 stable 证据降级为 `inferred`;
- **受控词表**:`failure` / `detection` / `fixKind` / `confidence` 四张表,未知值拒绝入库。v1 的自由 YAML 无法机器校验,矩阵会退化成散文。

其余关键设计点:

- **`fix.kind: allow` 把裸放行变成有依据的决定**。矩阵确认"该插件在该区间实际兼容"后,F0 附矩阵出处生成豁免申请。**但矩阵提供的是证据,不是同意**:`setProfileVersionExemption` 在 `acceptRisk` 非真时直接抛错(`profile-compatibility.ts:117-119`),因此走 `pluginManager.setVersionExemption`(自带 `reload()`),**不直接改文件**;
- **`confidence` 三级**:`verified`(实测通过,需 `runLogId` + `verifiedOn`)、`inferred`(类型 diff 推断)、`reported`(社区上报未复核,带 `reviewState`)。诊断器对 `inferred`/`reported` 的修复提示措辞降级;
- **矩阵包必须无代码、无 install script** —— `prepare` 会触发 pnpm `allowBuilds`(见 §5.4),这条约束让"矩阵只装数据"在实现层可验证;
- **矩阵记录不承载出处字段**。`compatibility.json` 是扁平的 `Record<string, string[]>`(`profile-compatibility.ts:42-45`),没有位置放矩阵 id;出处写在 rescue 自己的状态文件里。

**数据生产管道**(半自动,离线):

1. **类型面 diff**:**先复用仓库既有快照**。`docs/persistence-changes/releases/` 已有 26 个发布 tag、25 次相邻转换的完整类型快照;第一期把既有快照映射到矩阵的 `vocabulary.failure` 即可,自建 diff 管道降为备选;
2. **changelog/commit 提取**(辅助):从官方 release notes 抓取破坏性变更关键词;
3. **人工评审**:候选经人工确认后入库,标注 `confidence: inferred`;
4. **社区回填**(后期):用户诊断报告在显式 opt-in 后回填 `reported` 记录(见 §10 Q3)。采集端只允许结构化三元组,禁止携带 error message / stack / config 值。

harness 每次发版时,管道自动跑 diff 并向矩阵仓库开 PR —— 矩阵维护从"纯手工"降为"评审确认"。

### 5.2 诊断器 `dsh-rescue-doctor`

**定位**:in-harness 服务插件,在启动 reconcile 完成后与升级后运行;同时暴露为 agent tool 与 Typert 远程服务(对齐 PluginManager 的暴露方式)。

**核心修正(v0.2 起)**:D2 不是新发明。仓库里已经有三处等价实现 —— `auditStartupEntries`(`app-boot/src/index.ts:925`,已公开导出)、客户端的 `assertEntriesActive`(`client/web/src/boot-client.ts:66-88`)、以及 `readPluginInventory`(`plugin-inventory/src/index.ts:82`,已带 `fiberPhase`)。rescue 的增量是**把一次性检查变成持续观测,并补上未满足 key**,这也是本体里最值得写的那几十行。

检测项:

- **D1 peer 评估**:直接复用 `evaluatePluginCompatibility()` 的结果并叠加 `compatibility.json` 豁免状态,区分"被拦截"与"已豁免运行";
- **D2 PENDING 持续观测**:订阅 `internal/status`(每次 fiber 状态迁移都发,`vendor/cordis/src/fiber.ts:586`),在每次迁移时重算未满足 key:`Object.keys(fiber.inject).filter(k => fiber.ctx.get(k) === undefined)`。启动瞬间对齐 `auditStartupEntries` 的输出,之后不再是一次性快照。枚举路径:`ctx.registry.values()` → `runtime.fibers`(`vendor/cordis/src/registry.ts:270-291,140`);
- **D3 加载失败捕获**:复用预检 stderr、`$DSH_HOME/logs/startup-*.log`,以及 `--dump-config` / `--dump-config-schema` 的免启动检查(后者带"哪个文件提供了这一行"的溯源注释);
- **D4 API 面比对**:静态扫描插件构建产物的 import 说明符与具名导入,与**当前安装内实际导出面**比对。参照物是 `RuntimeResolutionEntry` 的 `packageDir`(读真实 `exports`),**不是** `cordis_inspect` —— 后者服务的是静态生成的 API 目录(`tool-cordis/src/api-catalog.ts`),不是运行实例的自省。启发式,结果只用于佐证;
- **D5 运行时错误捕获**(增强):订阅错误面,把插件监听器抛出的运行时错误归因到插件。归因有两道闸门(v0.4 补):① 候选名必须先过包名白名单,拒 `:`、空白、`.` / `..`、多层 scope —— 不能把日志里的任意 token 当包名;② **归因不唯一就不指认插件**,只报根因(§6 决策 3)。参考实现把这条做成了硬闸门:五级归因每级的通过条件都是 `owners.len() == 1`,判不出唯一就返回空集合,前端拿到空集合就不弹恢复页(`desktop:recovery/ownership.rs:244,305`);
- **D6 提供者释放检测**:唯一真正的静默面。`reflect.ts:297-303` 的 provide disposer 把依赖方退回 PENDING,没有审计钩子;由 D2 的状态订阅捕获。

**两段式启动**:

- **启动期**读 `$DSH_HOME/logs/startup-*.log` —— 该文件已含"每个未激活插件的模块与状态"(`apps/cli/reference/README.md:71-75`)。rescue 自己的 bundle 层必须排在被诊断插件之前,否则它自己会 PENDING;
- **运行期**才是 in-process 服务。

**不另写诊断报告**。官方报告明示原始插件错误可能含配置或凭据且**值不脱敏**(`apps/cli/reference/README.md:75`)。默认读既有报告;若确需自写,先给出字段级脱敏清单。

**输出报告**(每个插件一行结论):

```text
插件诊断报告(profile: default,harness 0.2.0-rc.1,证据通道: rc)
  @community/foo-tools 1.4.2   ✗ PENDING
    根因: 等待服务 ctx.fooLegacy,当前树无提供者 —— service-key-removed
    排除: 同名服务存在于其他 isolate label —— 未命中
    匹配矩阵: BRK-2026-0142(confidence: verified,verifiedOn 0.2.0-rc.1)
    可用修复: 补丁 @dsh-rescue/patch-foo-legacy@^1.0.0 [安装]
              前置条件: HMR ✓ / 模块可解析 ✓ / 预检 ✓ / inject ✓  → 可热生效
            | F4 手动迁移指南 [查看]
```

"排除"一行是必须的:类别 5 与 6 症状完全相同,不下补丁就会挂错。

**输出必须确定性排序**(v0.4):报告里的候选插件、候选修法、冲突条目一律显式排序(按矩阵记录 id,其次按包名)。同一份日志里同时提到多个包时,取集合迭代的第一个会让两次诊断给出不同文案 —— 而"定位率"(§8)这类度量在不可复现的输出上无法计算。

**渲染前过滤**(v0.4):读官方 `startup-*.log` 已决定不自写报告,但该报告明示原始错误**可能含配置值或凭据且不脱敏**(`apps/cli/reference/README.md:75`)。因此错误摘要在进入 Web 卡片、截图、或 Q3 回填**之前**必须过一次过滤:error message 截断 + 路径 / 凭据模式剔除,卡片上标注"可能含敏感信息"。A7 断言的范围随之从"是否自写文件"扩到"渲染前"。

**接口形态**:M1 起以一个 agent tool 暴露(单 tool 多 action,对齐 plugin-manager 工具族风格:`diagnose | propose_fixes | apply_fix | rollback | list_applied`)。Web 侧不是新成本:Plugins 页与 Settings 只读清单已在渲染 `pluginInventory`,rescue 只需在上游 PR 合入前自备一个同形状的读,并注册自己的配置页(`plugins.bundle.config` 插槽 + `ctx.settingsScope`)。

### 5.3 补丁执行器 `dsh-rescue-patcher`

五种修法,按风险与实现难度排序:

| 编号 | 手段 | 落盘变更 | 适用失效类别 |
|---|---|---|---|
| F0 | **allow**(有依据豁免) | 经 `pluginManager.setVersionExemption` 写 `compatibility.json` | 1 |
| F1 | **config-patch**(配置翻译) | 生成按行 id 寻址的覆盖写入 profile 的 `cordis.patch.yml` | 3、10、11 |
| F2 | **补丁**(旁挂适配插件) | 安装补丁包(声明 `dsh.bundle`)+ 加入 `dsh.profile.bundles` | 5、7、8、9、12 |
| F3 | **codemod**(源码迁移) | **建议砍掉,见 §10 Q5** | — |
| F4 | **manual**(迁移指南) | 无落盘变更,仅输出根因与官方迁移指引 | 兜底 |

各手段要点:

- **F0**:豁免是精确 `package@version` → 精确 dsh 版本,**插件升级与 dsh 升级都不继承**。因此 `list_applied` 把它显示为**将过期**而不是"已应用"。落盘后必须走服务(自带 `reload()`)而不是直接改文件 —— `setProfileVersionExemption` 自己不重载已加载实例(`profile-compatibility.ts:109`)。用户拒绝了 `acceptRisk` 就**不写**;矩阵证据只影响措辞,不影响是否需要用户同意。类别 2 不走 F0;
- **F1**:patch 是对行 `config` 的**整值覆盖**而不是深合并(`docs/user/develop/basic/publish.md:129-131`;`vendor/include/src/index.ts:120-123`),所以 fixer 必须自己按 `configMapping` 完成旧→新合并,并复述该行需要的每个键。Config 可含 `!!js` 表达式标记(`vendor/include/src/index.ts:9-23`):往返必须用 `entryListSchema`,**表达式值机器迁不动** —— 引用了已删服务的表达式会让该行 failed(`app-boot/src/index.ts:830`),这类行跳过并交给用户;
- **F2**:Cordis 的 inject 语义是"等服务出现",补丁注册缺失 key 后 PENDING fiber 会就地解挂(`reflect.ts:294-296,314-336`)。**四个前置条件必须全部满足才承诺热生效**(记入矩阵的 `requires` 字段):① HMR 启用 —— **headless / sdk / acp 默认关闭**(`hmr/README.md:27`);② 启动时算出的 `RuntimeResolution` 不因配置刷新重算,补丁必须当场可解析;③ 该行通过兼容预检;④ 其 inject 可满足。任一不满足则结果标为 `restartRequired`。另外**新装**一个包是热的(版本替换才需重启,`hmr/README.md:89`)。**`hmrEnabled` 为 false 不是死路**:同一份文档写明 "Headless, SDK and ACP bundles disable that entry in YAML; **a later profile patch can enable it**"(`hmr/README.md:27`)—— 因此对 headless 用户可能存在"先由 rescue 下一条 F1 打开 HMR、再挂补丁即热生效"的组合修法。**该修法目前只有文档依据、没有实测**,由 M0 的 A3 附带项裁定后再进 §5.6 的修法列表;裁定前一律只报 `restartRequired`。补丁写法与硬性约束见 [附录 D](#附录-d补丁规格),完整样例见 [附录 E](#附录-e补丁样例dsh-rescuepatch-foo-legacy);
- **F2 的安装路径**:补丁声明 `dsh.bundle`,由 `dsh plugin` 追加进 `dsh.profile.bundles`(`plugin-manager/src/index.ts:715-735`),可逆性由 `removeBundle` 提供。手工往用户 patch 插行会绕过 `protectsManager` 与安装期 `incompatible-version` 检查(`:546-547`)。**一补丁一包时 rescue 不得把它固定为依赖**,否则每次加补丁都要牵动主包版本,与"逐包评审"矛盾。**F2 的安装与卸载一律不得删除 `pnpm-lock.yaml`**:lockfile 是整个档案所有依赖的版本锁定,删掉它意味着下次 `pnpm install` 重新解析**每一个**插件 —— 一次针对单个插件的修复不该有全档案级副作用(参考实现把这条写死在恢复路径里,后果实测是"其他插件可能悄悄升版本")。确实需要时,那是一项 profile 级操作,必须在批准界面单列并取得显式同意;
- **F3**:成本最高、适用面最窄。§9 已自陈"补丁成为新 bug 源",而 F3 一次引入 AST 迁移 + 本地构建 + 本地路径安装 + `allowBuilds` 四条新信任链。改为"生成可提交的补丁交给作者",rescue 不持有构建链。

**落盘位置与层优先级**(Q8 已在 v0.4 收敛):有效层序是 bundles → profile `cordis.patch.yml` → **`$DSH_HOME/cordis.patch.yml`** → `--patch` 覆盖(`profile-context.ts:65-70`;`apps/cli/reference/README.md:9`)。后两层会压过 profile 层。收敛结论:**F2 = bundle 层**(补丁装成 bundle,`dsh.profile.bundles` 天然 per-profile,"home 层共享一份"在 F2 上不成立);**F1 = profile 层**。多 profile 各装一份补丁是可接受的(单补丁 ≤ 10 KB)。

判定"我的写入会不会被更高层压过"**优先复用既有信号**:`setPluginEnabled` 已返回 `'overridden'`(`plugin-manager/src/index.ts:433`),不必自己读组合树重算;仅在需要向用户展示冲突来源时才读 `readProfilePatches` / `composeEntries`。无法证明会胜出时仍然**拒绝应用**并说明原因。

**回滚策略**:patch 语言**没有 remove 操作**(`vendor/include/src/index.ts:57-141`,只有 `insert` 与按 id 整值覆盖)。因此"删行"实际是重写用户自己的 `cordis.patch.yml` —— 那是一份带说明注释、可能正被用户并发编辑的文件。本项目的做法是:

1. 应用时把 F1 记为**按 id 的整值覆盖**,不新增行(除非确有必要且已向用户展示将插入的内容);匹配**只按行 id 精确命中,不得按值扫** —— 参考实现的 `patch_entry_targets` 匹配"任意顶层键或值等于包名"(`desktop:recovery/uninstall.rs:153-161`),既会误删别人的条目,又漏掉 `insert` 里的别名;
2. 回滚时**再次按 id 覆盖回原值**,而不是删除行;
3. 需要 F4(指南)而非落盘的记录,回滚就是什么都不做;
4. rescue 自己的状态文件记录**意图与还原所需的原值**,用户层的文件是"当前配置"的唯一事实来源 —— 这两件事不冲突,没有 `before` 的意图无法还原(下表)。

**每条 applied 记录必须带 `before`**,按 fixKind 取值:

| fixKind | `before` 的内容 | 逐字节等价由谁保证 |
|---|---|---|
| F1 config-patch | 被覆盖行的原文本片段 **+** 整个 `cordis.patch.yml` 的 `.bak-<stamp>` 路径 | `.bak`,不是行级结构化往返(注释与 `!!js` 标记过 `entryListSchema` 不保证逐字节) |
| F0 allow | 豁免条目的原状态,含"原本不存在"这一取值 | 宿主自带 `withFileLock + writeFileAtomic` |
| F2 补丁包 | 安装前的 `dependencies` 与 `dsh.profile.bundles` 全量 | 还原时写回这两项 |
| F4 manual | 无 | 不适用 |

#### 5.3.1 写盘、中断与幂等

§5.3 的应用流程跨三个写入面(`compatibility.json` / `cordis.patch.yml` / 经 `dsh plugin` 改 `package.json` + bundles)。v0.4 起以下六条是硬要求,缺任一条则 §3.2 的"逐字节等价"与"失败可读"都不成立:

1. **意图先行(journal)**:状态文件里先写 `intent` 记录(含 `before`),再改用户文件,复检通过后才标 `applied`。下次启动发现 `intent` 未 `confirm`,报"上次修复未完成"并给"继续 / 还原"两个动作 —— 这就是中断恢复语义。**"尽力而为"只能写在文档里,不能写在类型上**:复检与回滚的接口必须能返回失败(参考实现有一处签名是 `Result<(), String>` 但所有路径返回 `Ok(())`,调用点的 `if let Err` 成了死分支)。
2. **任何触碰用户文件的写入都走"先 `.bak-<stamp>`,再 `.tmp` + `rename`",并沿用宿主已有的重试语义**,包括 F1 的应用与撤回。`vendor/include/src/index.ts:289-308` 的 `_writeFile` 已经是这个形状:写 `<file>.tmp` → `rename`,对 `EACCES / EBUSY / EPERM`(`retryableWriteError`,`:38-41`)退避重试 **10 次、间隔 `(retry+1) × 50 ms`**(`WRITE_RETRY_LIMIT` / `WRITE_RETRY_DELAY_MS`,`:35-36`),装载时用 `access(W_OK)` 探测只读并在只读时抛 `cannot overwrite readonly config`(`:204-211`、`:290-292`)。rescue **对齐这套常量与错误码**,不另起一套写盘策略;直接 `import` 那份实现则要经 `@deepseek-ai/dsh-atomic-write`(`packages/util/atomic-write`,`writeFileAtomic:79` / `withFileLock:235`)声明 peer —— 该前缀受兼容门禁管辖,与 §0.1 的本体约束冲突,**取舍见 §10 Q17**。
   为什么必须原子:半截 YAML 在两个时机的后果不同且都坏 —— **冷启动 fail loud**(读文件时只有 `ENOENT` 才回落 `initial`,其余解析错误一律抛,`:245-259` 的注释明写"an existing-but-invalid file must fail loud with its real parse error"),profile 直接起不来;**热重载静默用旧树**(`refresh()` 读不了就 warn 并"keeping the running tree",`:279-287`),于是 rescue 的复检可能拿到上一棵树而误判"没有变化"。`read()` 还注明空文件或被截断的文件会 parse 成 `undefined` 而不是报错(`:225-232`),这正是"写到一半"的形状。
3. **一次只允许一个 apply / rollback**(状态目录里的锁文件)。注意宿主的临时文件名是**固定**的 `filename + '.tmp'`,没有 stamp 也没有冲突避让 —— 两个写入者会撞同一个临时文件,rescue 必须自己排他;并且要与 `withFileLock` 保护的那把锁语义一致,否则 rescue 的锁与豁免写入互不排斥。拿不到锁就报"另一次修复正在进行"。
4. **并发编辑检测**:apply 前把目标文件的 mtime + 内容哈希记入 `intent`,写前重读比对,不一致则中止并报"文件已被你改动,请重试"。这把 M0 断言 A5 的"用户并发编辑不被覆盖"从断言变成机制。
5. **回滚幂等**:重复执行无副作用;`before` 指向的 `.bak` 不存在时不猜、直接报"无法还原:备份缺失",并把该记录标为需人工处理。
6. **写入没报错不等于生效**:`applyEntryPatches` 对匹配不到目标的补丁**只 warn 后跳过,不抛错** —— 目标行不存在(`vendor/include/src/index.ts:110-113`)、`insert` 的目标不是 group(`:86-89`)、缺 id(`:104-107`)、以及**补丁带了 `name` 而该行已被用户改名**(`:115-118`),四种情况都会整条跳过。因此 F1 的应用与还原都必须在写完后**重读文件确认那一行的值确实是预期值**,以文件内容而不是"写入未报错"为成功判据。反过来,`name` 是免费的防错锁:rescue 写入时带上记录里的原 `name`,用户改过行名的情况下补丁会主动不覆盖。

**完整性校验用内容哈希**,落盘时算、还原前验。条目数 + 字节数的双计数挡不住保持这两项不变的内容替换。

**应用与回滚流程**(所有手段统一):

```text
诊断 → 列出可用修法(附矩阵出处与 confidence)→ 用户批准(按 fixKind 分级,见 §5.6)
    → [F2 且来源为 git/tarball] allowBuilds 放行
    → [F2 专属] 试运行:内存挂载,用于快速证伪
    → 写 intent(含 before)→ 落盘变更(.bak + tmp + rename)→ 热应用或标记 restart-required
    → 复检(两条判据)→ 标 applied 记入审计;随时可 rollback
```

- **试运行是快速证伪通道**,不是有效性证明(v0.4 改措辞):它能低成本排除明显走不通的修法,但是否真的修好,以落盘后 `reconcileProfilePatches` 的结果为准。两条理由:① 解析来源不同 —— 试运行走 `cordis-host-runner`(进程内、重启即失),落盘走 `installBundle` → pnpm → `selectBundle` → `reload()`,而 `RuntimeResolution` 启动时算定、不因配置刷新重算;② `notify` 会比较 isolate label(`reflect.ts:314`),不在同一 label 时试运行**恒为无效**(假阴性)。因此 A6 判据补两条:试运行必须与目标插件同 isolate label 否则结论无效;试运行失败**不得**当作"补丁无效";
- **复检有两条判据,缺一不可**(v0.4 补第二条):① `reconcileProfilePatches`(`app-boot/src/index.ts:273-302`)无新增失败 —— 该函数已实现"快照前态 → 应用 → `loader.await()` → 重审 → 新增或变化条目即 throw → 返回当前诊断",直接用它,不另建第二条验证路径,那会制造第二个生命周期真相;**但"无新增失败"只证明没变坏,不证明修好了**;② 重跑产生该诊断的那个检测器(D1 / D2 / D3 / D6),断言**原症状消失**。少了②,一个仍然 PENDING 的插件会被记成"已修复"。**①的前提是它读到的是新树**:`Include.refresh()`(`vendor/include/src/index.ts:279-287`)在文件读不了或解析失败时只 warn 并"keeping the running tree",因此复检前必须确认这一层的补丁确实被重放(断言 A15),否则两条判据都可能建立在改造前的树上;
- 回滚依据 rescue 自己的状态文件 `$DSH_HOME/profiles/<name>/.plugin-rescue/state.json`:每次修复记录 kind、目标、触碰的文件、**`before`(见上表)**、矩阵记录 id、时间戳、`attempts`;忽略记录(§5.6)与 `undo.md`(§5.7)同在 `.plugin-rescue/` 下,不开第二个状态目录;
- 状态文件带版本:`schema: rescue.state/v1`,与矩阵的 `rescue.matrix/v2` 同构;读到不认识的版本 → 只读不写并报"请升级 rescue"。**v1 不落任何未实现字段** —— 参考实现的快照 manifest 里 `includeConfig` 恒为 `false`、`patches` 注释写着"v1 为空",后果是"卸载 → 从快照还原"静默丢失用户自己的补丁配置,正是 §3.2 要禁止的结果;
- 可见性:补丁行在 profile 的 `cordis.patch.yml` 里可读可改,补丁是普通已装包,豁免条目在 `compatibility.json` —— 用户不依赖 rescue 也能看到全部痕迹,并能照着状态目录里的 `.bak` 与 `undo.md` 手动还原(§5.7)。

### 5.4 交付形态与信任模型

**形态**:

```text
dsh-plugin-rescue/
  packages/
    rescue/    # 本体:bundle 入口(dsh.bundle 补丁层)+ doctor + patcher
    matrix/    # 矩阵包:schema + 纯数据,无代码无 install script
  patches/     # 补丁源码,一补丁一包,按 §5.3 的方式分发
```

用户通过现有插件安装通道(`dsh plugin add` → pnpm)装入 profile;rescue 的 bundle 补丁层把 doctor 服务挂进组合树。**本体体积是安装体验的一部分**,见 §3.1。

**信任模型**(对齐现有 `accept-risk` 语义,不发明新机制):

- 矩阵数据走 PR 评审流程,且**无代码、无 install script**;补丁走代码评审 + npm provenance;
- **按需拉取矩阵是新的信任面**:固定来源 + 校验和;rescue 提供"完全离线"开关(只用缓存或不用矩阵),见 §10 Q13;
- **批准通道复用 `plugin_manager` 既有机制**:它的每个动作已经要求 `danger-full-access` 或逐次批准(`plugin-manager/README.md:31`),`setVersionExemption` 另需 `acceptRisk`。不叠第二套同意面;
- **`allowBuilds` 是真正的"安装即在你机器上执行代码"时刻**:git 源包会跑 `prepare`,pnpm ≥10 要求用户在 `<profile>/pnpm-workspace.yaml` 放行,`dsh` 已经会指路(`apps/cli/src/plugin.ts:81-83`;`publish.md:159-179`)。矩阵里的补丁 spec 若来自 git 或 tarball,必须先说清这一点;
- `confidence: reported` 的提示明确标注"社区上报,未复核";
- **支持窗口与跟版策略**(v0.4 补):out-of-tree 意味着本体依赖上游公开包的 API 面,而公共 API 是 pre-stable。写明支持窗口为**当前 stable 与上一个 minor**;上游发版后的跟版 SLA 由矩阵的 `generatedFor` 驱动(矩阵未跟进 ⇒ 修法一栏降级为 F4,诊断不受影响);上游 API 变化导致本体不可用时,降级路径是**诊断侧退化为只读、修复侧停用并明示**,不是静默失败;
- 修复后强制复检,失败即回滚提示 —— **修复从来不静默**。

### 5.5 过期守卫与撤回

F2 的唯一真实风险不是"补丁写错了",而是"**补丁过时了**":官方在某个版本真的发布了那个服务,`reflect.ts:289-291` 随即抛出 `service "X" has been registered at <name>`,一个原本静默的 PENDING 变成**整个 profile 起不来**。

**守卫分两层执行,v0.4 起这是 §5.5 的核心修正**。v0.3 把两层都写成 rescue 的职责,而那是**时序上不可能的**:rescue 是普通插件(§6 决策 4),它的 fiber 要等 profile 组合完成才可能 ACTIVE,而抛错发生在补丁自己 `apply()` 里的 `ctx.reflect.provide`(`reflect.ts:289-290`),那一步在树挂载途中,**早于 rescue 激活**。守卫若跑在灾难之后,就拦不住这次抛错。

| 层 | 执行者 | 时机 | 能力 |
|---|---|---|---|
| **硬守卫** | **补丁自身**(kit 提供 `assertNotProvided(key)` 原语) | `apply()` 开头、`provide` 之前 | 唯一能阻止 `reflect.ts:289` 抛错的时机 |
| **软巡检** | rescue | 启动后 | 发现"矩阵区间已不覆盖 / 官方已发布真提供者 / 疑似过期",报 `patch-stale` 并给选项 |

因此必须明写一句:**rescue 无法阻止 `provide` 冲突抛错,它只能降低概率并在事后给出可操作的诊断。** "任一不满足就禁用补丁"的准确表述是"**由补丁自行禁用;rescue 负责提示与记录**"。两个时机的检查内容不变:

- **安装前**:矩阵记录的 `harness` 区间是否仍覆盖当前 runtime;`requires` 四项是否全真;命中 `supersededBy` 时改为建议升级;
- **每次启动**:已装补丁的目标 key 是否已被真实提供者占用 —— 由补丁自己在 `apply()` 开头判定。

**"禁用"有现成原语,不要自己改写用户文件**:`@Remote setBundleEnabled(name, false)`(`plugin-manager/src/index.ts:443`)保留已装依赖、只把 bundle 从 `dsh.profile.bundles` 摘除、自带 `reload()`,语义上就是"像禁用 mod 一样"。不点名它,实现者会跑去重写用户的 `cordis.patch.yml`,那正好踩 §5.3 的坑(patch 语言无 remove + 用户文件带注释)。

守卫失败是**一等的诊断结果**,不是错误:doctor 报 `patch-stale`(术语在附录 D/E 已统一)并给出"升级插件 / 卸载补丁 / 暂不处理"三个选项。§10 Q11、Q12 决定默认选哪个。

**F1 的撤回要改写用户文件,手法与失败处置**(v0.4 补):走 §5.3.1 第 2 条(先 `.bak-<stamp>`,再同目录 `.tmp-<stamp>` + `rename`)。**改名保留,不删除** —— 参考实现把破坏性自愈做成改名:`<原文件名>.broken-<UTC 时间戳>`,内容原样保留、决定权交回用户(`desktop:patch_guard.rs:13`),改写补丁层前先复制 `<原名>.bak-<时间戳>`(`desktop:patch_entries.rs:12,136`),再用同目录 `.tmp-<stamp>` + `rename`(`:415-420`);`rename` 失败时**硬失败**:不改状态文件、不宣称撤回、报专用错误码,并给一句可执行的人话。参考实现的文案是好的模板(`desktop:src/i18n/locales/zh-CN.json:107` 原文):"无法隔离损坏的补丁文件(改名失败):{{detail}}。文件仍在原处,重启会再次报同样的解析错误。请先关闭占用该文件的程序(编辑器 / 同步网盘 / 杀毒软件),或手动把该文件改名为 `.broken-<时间戳>` 备份,然后重试。"

**兜底自身失效时硬失败,不假装恢复**:参考实现的隔离一旦有失败项就**禁止切换档案与重启**(`desktop:patch_guard.rs:63` 的 `has_failures()` + `desktop:bridge/lifecycle.rs:375-377`),理由写在注释里 —— "再次解析失败,切过去等于把『安全模式』也变成失败循环。此时让用户先处理文件,而不是假装已恢复"(`desktop:bridge/lifecycle.rs:362-363`)。同样的纪律适用于 rescue 的还原:还原没成功就不要把状态标成已还原。

### 5.6 用户交互:补丁管理器界面

易用性的具体形态。目标是让用户全程不接触 `cordis.patch.yml`。

**列表**。每个失效插件一行:

```text
┌────────────────────────────────────────────────────────────┐
│ @community/foo-tools 1.4.2                    ✗ 未激活       │
│ 等待服务 ctx.fooLegacy —— 官方 0.2.0 拆掉了它              │
│                                                            │
│ 已验证可用   [ 一键修复 ]  [ 查看迁移指南 ]  [ 忽略 ]        │
└────────────────────────────────────────────────────────────┘
```

**已应用的**变成可还原的开关,像禁用 mod:

```text
┌────────────────────────────────────────────────────────────┐
│ @community/foo-tools 1.4.2                    ✓ 已修复       │
│ 补丁 @dsh-rescue/patch-foo-legacy  BRK-2026-0142              │
│                                    [ 还原 ]                │
└────────────────────────────────────────────────────────────┘
```

**三种卡片形态**(v0.4 补第三态):失效(`✗ 未激活`)、已修复(`✓ 已修复`)、**不建议自动修复**(`— 无可用自动修法`)。第三态对应矩阵里 `autoFixable: false` 的类别 2 / 13 / 14 与 `cordis-core-changed`,措辞写死("放行也不会工作,需作者适配"),**不提供一键按钮** —— 给一个注定失败的按钮比不给更糟。

规则:

- **"一键"省的是导航与手工编辑,不省批准**。批准强度按 `fixKind` 分级,而不是统一"第一次点击即批准":

| 修法 | 实际做了什么 | 批准强度 |
|---|---|---|
| F0 allow | 在 `compatibility.json` 写一行,可能崩溃或损坏数据 | 强确认(勾选风险) |
| F2 补丁 | **装一个第三方包并在本机执行它的代码** | **同为强确认** —— v0.3 这里是零确认,严重性与确认强度完全反了 |
| F1 config-patch | 按 id 整值覆盖用户配置的一行 | 弱确认,但**必须可预览将被覆盖的整值**(patch 是整值覆盖,用户要看清将复述的每一个键) |
| F4 manual | 无落盘 | 无需批准 |

- **`allowBuilds` 是流程里的一步,不是意外**:F2 若装 git / tarball 源包会触发 `prepare`,pnpm ≥10 要求用户在 `<profile>/pnpm-workspace.yaml` 放行,宿主已有待批准流程(`plugin-manager/src/build-approval.ts:18-48`)。这一步必然是一次额外交互,所以 §3.2 的计量单位是**交互**而非点击;
- 试运行或复检失败 → **自动还原**并报一句人话("这个补丁没能修好,已经撤回了"),附"查看详情"入口(展开矩阵记录与原始错误,已按 §5.2 渲染前过滤),不要求用户开日志文件;
- **同一目标最多自动尝试 3 次**:计数键 `(插件, harness 精确版本, fixKind)`,只在**修复动作失败**时 +1,诊断次数不计入。达上限后该项降级为 F4,卡片显示"已尝试 3 次"并给出人工路径。参考实现把这件事做成了 `MAX_RECOVERY_ATTEMPTS = 3` + 一句专用文案,但它**数错了东西**:计数发生在每次"定位"成功时,于是运行期报三次错(用户一次修复都没做)就会看到"多次处理后问题仍反复出现";它也不按 reason / 插件维度区分。两条都不要重犯;
- **批量动作逐项报告**:一次处理多个已应用修复时,任一项失败不得宣称整体成功,失败项在卡片上单独标出。参考实现在同一份 store 里两种语义并存 —— 还原是逐项吞异常后照常重启(用户观感是"点了还原、重启、还是同一个错误页"),卸载是首项失败即整体中断 —— 两条都是反面教材;
- **"存在但不可读 / 不可还原"是独立状态**,有自己的措辞,不得回落成"可用"。参考实现在备份 manifest 读不出时回落当前时间并仍报 `exists: true`,UI 只看 `exists` 决定按钮是否出现,结果是损坏的备份显示成"刚刚创建"、按钮亮着但必然失败;探测失败被静默吞掉后,用户分不清"没有备份"和"查询失败";
- 冲突时明确列出两个补丁 id,**不自动**择一,但给出 **"选 A / 选 B"两个可见选项** —— 拒绝自动裁决不等于把用户堵在死路上(v0.3 的卡片只有 [一键修复][查看迁移指南][忽略],冲突即无出口);
- 矩阵取不到时,列表照常显示已观察到的根因,把"可用修复"一栏标成"需要联网获取修复建议",并说明离线不是插件没坏;完全离线且无缓存时,按 §5.1 明说首次只有根因没有修法;
- 忽略是有状态的:记入 rescue 状态文件,同一 (插件, harness 版本) 不再重复提示,但 Plugins 页仍可手动展开;
- **自举诊断**(v0.4 补):rescue 自身 `disabled` / PENDING / import 失败时,Plugins 页必须留一行"修复功能当前不可用(原因:…)"而不是安静地消失一个分区。判定材料现成 —— `readPluginInventory` 的输出已含 `enabled` 与 `fiberPhase`(`plugin-inventory/src/index.ts:88-93`)。这与 §5.7 的逃生舱是同一件事的两面:一面是 rescue 还活着但要报告自己不能干活,另一面是 rescue 不在了也有还原路径;
- **不做自动降级**:不引入"连续失败 N 次自动进入某种模式"。自动动作只有复检失败后的自动还原(撤销 rescue 自己刚写的东西),且受上面的次数上限约束。参考实现同样没有崩溃计数器,兜底模式只有用户显式入口 —— 误判成本(把一个还能用的 profile 降级掉)高于收益。

**触发时机**:启动后、每次配置重算后、用户在 Plugins 页点刷新。**默认只读** —— 未点击时不产生任何落盘变更(§3.2)。

### 5.7 逃生舱:还原能力不能依赖它自己要救的运行时

§3.2 的"零 CLI"与 §5.6 的"让用户全程不接触 `cordis.patch.yml`"合起来,把 rescue 的全部交互面放在了 profile 里。这留下一个死角,由三条既有设定叠成:

- 决策 4:rescue 是**普通插件**,挂在组合树旁边,没有特权启动钩子;
- §5.5:F2 的首要风险是过期补丁让 **整个 profile 起不来**;
- §3.2:还原入口只有 Plugins 页。

profile 起不来 ⇒ Plugins 页不存在 ⇒ 还原开关不存在 ⇒ 用户唯一出路是手工编辑那个方案承诺让他不必碰的文件。这与 R1(本体 peer 触发门禁、rescue 被禁用)是同一结论的两个入口:**修复工具在最需要它的时刻不在场**。

参考实现给出的答案是一条硬约束 —— **恢复能力不依赖被恢复的运行时**:安全档案是宿主级常量 `SAFE_PROFILE = "safe"`(`desktop:profile/mod.rs:59`),契约明写"只加载核心 bundles、**不带任何用户插件 / 补丁层**"(`desktop:safe.rs:1-4`),即**兜底路径必须绕开被兜底的东西**;进入前把该档案里的用户插件清干净,理由是"不清理的话每次进安全模式都带着同一批插件重启,隔离形同虚设 —— 用户看到的仍是同一个启动失败"(`desktop:safe.rs:9-19`);卸载走**离线精准路径**(`desktop:recovery/mod.rs:12`"本模块离线、精准,不需要网络"、`:159-160` 的 `uninstall`),**不依赖 node / pnpm / 窗口、不触网,"即使插件产物已损坏也能移除"**(`desktop:safe.rs:16-17`)。

rescue 是 out-of-tree、一期不改 harness,拿不到宿主级安全档案。等价物是三条:

1. **undo 产物自包含,且读者是一个打不开 Plugins 页的用户**。`.plugin-rescue/` 下除 `state.json` 外,保留每次改动的 `.bak-<stamp>` 原件(§5.3.1),外加一份人可读的 `undo.md`:哪个文件的哪一行被改成了什么、原值是什么、手动改回的步骤。它由 rescue 在标 `applied` 时生成,之后**不再依赖 rescue** 存在;
2. **文档化一条不依赖 rescue 的还原命令**,并在失效卡片、README、`undo.md` 三处都写明。§3.2 因此改成"**日常路径**零 CLI;逃生舱例外" —— 这不是让步,是把"零 CLI"限定在它本来就该管的范围;
3. **硬守卫放在补丁自身 `apply()` 开头**(§5.5)。这是唯一在"rescue 加载不了"时仍然生效的防线,因为它随补丁包分发,不随 rescue。

**明确不做的事**:不在 harness 里为 rescue 开特权启动钩子(违背决策 4 与一期零 core 改动)、不把还原做成必须联网 / 必须 `pnpm install` 的路径(参考实现特意做成离线,正是为了产物已损坏的情形)。

**验收**:M0 断言 A12 —— 在 rescue 被禁用或直接删除的情况下,仍能用一条不依赖 rescue 的命令把用户配置还原到应用前,且还原后逐字节等价。不可行则 §3.2 的"还原 ≤ 2 击"与"逐字节等价"必须降级为"rescue 在场时",并把这一降级写进 §9。

## 6. 关键设计决策与依据

- **决策 1:补丁以旧版类型包为编译期契约,但 peer 必须声明宽范围。** 类型只在编译期存在(pnpm 多版本共存无冲突);运行时拦截层保证所有插件共享唯一实现实例(`installRuntimeInterception`)。**但官方教程教插件作者把 dsh 包同时写进 peer 与 devDependencies(`docs/user/develop/basic/publish.md:103`)—— 对补丁这会自我否定**:旧范围不满足运行时即被预检置 `disabled`(`plugin-compatibility.ts:75-80`;`compatibility-preflight.ts:101-118`),**修复永不生效**;旧副本若被物理安装还会让解析改走补丁自己的祖先副本,丢掉单实例保证。因此补丁的 peer 必须声明**始终包含当前运行时的宽范围**(如 `>=0.1.0 <0.3.0`),旧类型只放 `devDependencies`,且运行时不得物理安装旧包。**能绕开这一切的写法是补丁根本不 import 任何 dsh 包** —— 只通过 `inject` 声明拿服务(见 [附录 D](#附录-d补丁规格)),这样连编译期依赖都没有。**v0.4 把同一条约束施加到本体**:v0.3 只在补丁侧认识到这个陷阱,本体侧的四个 peer 里 `dsh-app-boot` 与 `dsh-plugin-manager` 同样命中门禁过滤式,结果是 harness 一升级、修复工具比被修的插件先死(§0.1、R1、断言 A10)。机制来源:profile 生成的 `pnpm-workspace.yaml` 是 `nodeLinker: hoisted` + `autoInstallPeers: false`(`profile.ts:230-235`);
- **决策 2:修复落盘到可见层,并按手段收敛作用域。** 依据:可见、可 git、可回滚,且与 HMR / profile reconcile 的既有机制天然集成。**但必须承认层优先级**:home 层 `$DSH_HOME/cordis.patch.yml` 与 `--patch` 覆盖会压过 profile 层。v0.4 收敛为 **F2 = bundle 层(per-profile)、F1 = profile 层**(§5.3),"home 层共享一份"对 F2 不成立;判定是否被压过优先复用 `'overridden'` 信号(`plugin-manager/src/index.ts:433`),不自己读组合树重算;
- **决策 3:fail-loud 原则的落实方式。** doctor 永远先展示根因;修复需批准;修复后强制复检;不做任何"无诊断的静默兜底"。rescue 的存在不降低问题的可见性,只降低解决的成本。**贯穿诊断与修复的一条不变量:证据不唯一就不动手** —— 归因不唯一则只报根因、不指认插件;修法冲突则不自动择一;归属不唯一则不写用户文件。这条把 §5.2 的 D5、§5.6 的冲突裁决与 Q12 统一到同一个判据下,参考实现的对应闸门是 `owners.len() == 1`,判不出唯一就返回空集合(`desktop:recovery/ownership.rs:244,305`);
- **决策 4:rescue 自身只是一个普通插件。** 符合"no privileged core to patch"的框架哲学 —— 它不是补丁层下面的特权层,而是挂在组合树旁边的普通服务,全部能力走 `ctx.effect()` / 事件 / 服务注入等文档化扩展点,第一期零 core 修改;
- **决策 5:诊断与修复拆包;上游路径是加字段而不是加包。** D1/D2/D3 的**新增部分**(持续观测 + 未满足 key)只有两处,可以作为既有 `pluginInventory` 服务上的一个可加字段 + 一个 `internal/status` 订阅器提给上游;
- **决策 6:矩阵按需拉取 + 本地缓存,诊断本体永远离线可用。** 这是 G6(小)与离线可用性的交点。代价是引入"运行时出网"这一信任面(§5.4、§10 Q13),并要求把 D1/D2/D3 与矩阵严格分层 —— 没有这条分层,矩阵一取不到,整个产品就不可用。

## 7. 备选方案对比

| 备选 | 结论 | 原因 |
|---|---|---|
| A. 只做静态迁移指南/知识库 | 否 | 不解决落地问题,用户仍需手工操作,且无法诊断 |
| B. 推动官方维护 N 个版本的兼容层 | 否 | 维护成本随版本数平方增长,官方已明确用版本门禁 + 迁移文档的路线 |
| C. fork 全部常用社区插件自行维护 | 否 | 不可扩展,且与上游永久漂移 |
| D. **本方案:数据驱动的分级补丁** | 采纳 | 把"失效知识"变成可执行资产,诊断侧还能以小 PR 反哺官方 |
| E. 自建诊断扫描(不读已有服务) | 否 | `auditStartupEntries` / `pluginInventory` 已覆盖同一事实,重做会产生第二个生命周期真相,还会撑大本体 |
| F. 矩阵内置在本体里(离线优先) | 否 | 体积随失效记录线性增长,与 G6 冲突;改用"按需拉取 + 严格分层"保住离线可用性 |
| G. 本体承担 codemod / AST 迁移 | 否 | 与 G6 直接冲突,且引入四条新信任链 |
| H. rescue 在 harness 里开一个特权启动钩子(宿主级"安全档案")以解决 §5.7 的死角 | 否 | 违背决策 4(no privileged core to patch)与一期零 core 改动。参考实现的对应物是**宿主**级 `SAFE_PROFILE`(`desktop:profile/mod.rs:59`),它的执行者在桌面壳里、在 dsh 之外 —— out-of-tree 项目拿不到那个位置。可行的替代是"产物自包含 + 一条不依赖 rescue 的命令"(§5.7),不需要特权位置 |
| I. 还原靠内存态(不写 `.bak`,记住"我改了哪几行"即可) | 否 | §3.2 的逐字节等价无法兑现:F1 的整值覆盖过 `entryListSchema` 往返会丢注释与 `!!js` 标记;而 `intent` 未 confirm 时内存态随进程一起消失,中断后无从还原(§5.3.1) |

## 8. 里程碑与验收标准

排序与工期不在本文,见 [roadmap.md](roadmap.md)(含阶段收口条件、放弃清单、顺延顺序)。M0 断言清单也在 roadmap,本节只定范围与验收。

| 里程碑 | 内容 | 验收标准 |
|---|---|---|
| **M0 spike** | 三项可行性(S1–S3)+ **十五条硬断言(A1–A15)** + A3 的附带项 | 每项有可运行 demo 或书面结论(含"不可行"结论与替代路径),判据一律是**行为**而不是读码——代码前提已在 `roadmap.md` 的「前提核验记录(HEAD `4878cdabd8`)」核完。A1–A9 见原清单;**A10 本体 peer 组合不触发兼容门禁**、**A11 补丁能自行避免 `provide` 冲突抛错**(v0.4 新增)、**A12 逃生舱:rescue 不在场也能还原**、**A13 中断:apply 中途 kill 后不留半截文件且能检出未完成记录**(v0.4 新增)、**A14 写完重读确认生效(patch 匹配不到只 warn 跳过,"没报错"不等于"改对了")**、**A15 复检读到的是重放后的新树(`refresh()` 读失败会沿用旧树)**(由前提核验发现新增) |
| **M1(MVP)** | doctor(D1/D2/D3/D6)+ 矩阵 v2 首批记录 + 按需拉取与缓存 + F0/F1 + **首个真实补丁(F2 手工版,不含 kit 与守卫)** + 一键修复/还原 UI + 状态文件 v1 与 `.bak` + 逃生舱命令与 `undo.md` | ① 断网时诊断仍出结果;② **选定 foo-tools(`service-key-removed`)作为端到端场景**:升级 → 诊断 → 批准 → 修复 → 插件恢复 → 还原后用户配置逐字节等价 —— v0.3 的 M1 范围"不含 F2",而全文主痛点、唯一完整样例 `BRK-2026-0142` 与样例补丁都属于 F2,主线在 M1 无法演示,故 v0.4 把样例补丁前移(kit、守卫、agent tools 仍留 M2);③ 本体 ≤ 100 KB 且 0 个新增运行时依赖;④ **恢复 ≤ 3 次交互**;⑤ 复检按 §5.3 的两条判据(无新增失败 **且** 原症状消失);⑥ rescue 被禁用时 Plugins 页仍有"修复功能当前不可用"一行(§5.6 自举诊断) |
| **M2** | 补丁 kit(`assertNotProvided` 等受控原语)+ 过期守卫两层化 + 批量还原 + agent tools | 一个真实案例经 kit 挂载且守卫在真提供者占用 key 时自行禁用;**单个补丁 ≤ 10 KB**;一次 harness 升级的候选清单自动产出;批量还原逐项报告失败 |
| **M3** | D4/D5 增强、上游 PR 推进(诊断侧) | 上游 PR 有评审结论 |

F3 codemod 默认不排期,见 §10 Q5。

**成功度量按来源分栏**(v0.4 改,Q3 推荐默认关闭 ⇒ 跨用户指标在默认配置下永远采不到,写成一个数字会误导):

| 指标 | 来源 | 默认可得 |
|---|---|---|
| 应用次数 / 复检通过率 / 自动回滚次数 | 本地 `state.json` | 是 |
| 误修率 | **设计约束**(拒绝应用 + 复检双判据 + 冲突不自动择一),不可统计 | — |
| 诊断定位率 / 修复命中率 | 需 Q3 回填 opt-in;须同时写明分母定义 | 否 |

本地三项绑定到 `reconcileProfilePatches` 的返回值与 rescue 状态文件。没有这两个绑定,数字不可验证。

## 9. 风险与缓解

- **过期补丁变成启动失败源(F2 的首要风险)**:矩阵记录不再覆盖当前 runtime、或官方发布了真实提供者时,`provide` 抛 `service "X" has been registered at <name>`,静默 PENDING 变成 profile 起不来。缓解:§5.5 的两层守卫 —— **硬守卫在补丁自己的 `apply()` 开头**(唯一能拦住抛错的时机),rescue 的软巡检只负责提示与记录;禁用走 `setBundleEnabled(name, false)` 而不是改写用户文件。**若 A11 证明补丁无法自行规避冲突,则 §5.5 的"启动前"这一层不存在,本风险降为"只能事后补救",该等级必须上调**;
- **修复工具在最需要它的时刻不在场**(v0.4 新增,与上一条同级):三个入口都让还原能力消失 —— ① 本体的 `@deepseek-ai/dsh-*` peer 被兼容门禁判定,harness 一升级 rescue 自己先被 `disabled`,Plugins 页的"修复"分区无声消失;② rescue 自身 PENDING / import 失败;③ 它写的补丁让 profile 起不来,而 rescue 就在这个 profile 里。缓解:R1 的"本体不 import dsh-\* 包"(断言 A10)+ §5.6 自举诊断 + **§5.7 逃生舱**;残余风险由 A12 验收,不可行则 §3.2 的承诺必须降级;
- **单点修复造成全档案级副作用**(v0.4 新增):删 `pnpm-lock.yaml` 会让下次安装重新解析**每一个**插件的版本,一次针对单个插件的修复因此可能悄悄升级所有插件。缓解:§5.3 明令 F2 的安装与卸载不得删 lockfile;确实需要时作为 profile 级操作单独取得显式同意;
- **平台差异**(v0.4 新增):Windows 上有五个会真实咬人的点,参考实现每一个都付出过代价 —— ① `rename` 在文件被编辑器 / 同步盘 / 杀毒软件占用时失败(`desktop:patch_guard.rs:119`;其锁定测试用的真实样本就是 `Access is denied. (os error 5)`,`desktop:test/patch-layer.test.ts:51-52`),§5.5 的撤回路径直接命中;② `fsync` 必须以 read+write 打开,只读句柄 `sync_all` 报 `ERROR_ACCESS_DENIED (os error 5)`(`desktop:snapshot.rs:253-259`);③ GUI 进程以 `CREATE_NO_WINDOW` 直接 spawn `node` 会让子进程各建一个可见控制台(黑窗闪烁),且原始进程句柄非 `Send`,spawn + 读管道 + 等待必须整体放进一个 `spawn_blocking`(`desktop:verify.rs:214-216,235-241`);④ 用户 pnpm 在 Windows 只接受 `.exe`,因为 CreateProcess 不能直接执行 `.cmd` / `.bat`(`desktop:verify.rs:193-196`);⑤ junction 与 symlink 必须双重判定(`is_symlink() || is_symlink_dir()`),否则把重解析点当普通目录**递归删进应用资源目录**(`desktop:recovery/uninstall.rs:75-80`)。缓解:§5.3.1 的原子写手法本来就要求同目录 `rename`,把失败当一等结果处理;M0 的 A5 必须在 Windows 上实测(本项目开发环境即 Windows);
- **敏感信息经诊断卡片外流**(v0.4 新增):§5.2 决定读官方 `startup-*.log`,而该报告明示原始错误**可能含配置值或凭据且不脱敏**;卡片渲染 + 用户截图 + Q3 回填构成三条外流路径。缓解:§5.2 的渲染前过滤 + 卡片标注 + 采集端类型约束;
- **上游 API 漂移**(v0.4 新增,§5.4 的支持窗口):out-of-tree 项目依赖上游公开包,而公共 API 是 pre-stable,上游 0.3 改一次 API 面即可能让本体失效。缓解:支持窗口写死为"当前 stable 与上一个 minor";降级路径是**诊断侧退化为只读、修复侧停用并明示**,不是静默失败;
- **矩阵取不到导致产品不可用**:缓解:§0.2 与 §5.1 的严格分层 —— D1/D2/D3 不依赖矩阵,离线降级是设计的一部分而非异常路径;提供完全离线开关;
- **运行时出网扩大了供应链面**:缓解:固定来源 + 校验和 + 矩阵无代码无 install script;`confidence: reported` 明确降级措辞;社区回填默认关闭且只上传结构化三元组(§10 Q3、Q13);
- **Cordis 框架自身 API 变化(失效类别 `cordis-core-changed`)**:所有插件共享拦截层保证的唯一 cordis 实例,补丁无从适配。缓解:明确划为一期非目标;若发生,评估在 resolver 包表层做 import 重定向的可行性(改 `installRuntimeInterception` 的包表,二期再议);
- **dsh 包被解析出第二份实例**:插件可以解析到安装里的另一份 dsh 包,症状是状态分裂与 `instanceof` 失败,不落在任何现有检测器上。缓解:归入类别 13,D4 读取 `RuntimeResolutionEntry.packageDir` 后比对模块 identity;
- **体积失控**:本体每加一个能力就多一份依赖。缓解:§3.1 的预算作为 CI 门禁,`dependencies` 段必须为空;需要宿主能力的全部走 peer;
- **矩阵维护负担**:缓解:先复用仓库既有的发布间类型快照,把生产降为评审;`confidence` 分级让未复核数据不误导;社区回填摊薄成本;
- **补丁成为新 bug 源**(尤其 waterfall 桥接的顺序语义):缓解:补丁 kit 提供受控桥接原语并禁用裸 `prepend: true`;每个补丁带针对新旧两个 harness 版本的行为测试;`prepend` 仅限文档化特例;
- **供应链风险**(修复即代码):缓解:补丁独立成包、逐包评审、显式批准后安装;矩阵只装数据;
- **修复掩盖真实问题**:缓解:§6 决策 3;根因展示前置、复检强制、审计可查;
- **PENDING 检测依赖 Cordis 内部状态**:缓解:枚举走 `RegistryService` 与 `Plugin.Runtime.fibers` 这类公开面,不碰 `_store` / `_checkImpl` / `_refresh`;若某项确实缺最小暴露,以只读 introspection 形式向上游提议;
- **批准面重复**:缓解:§6 决策 5,收敛到 `plugin_manager` 既有通道。

## 10. 待决问题(评审重点)

**已决,记录在此以免重新辩论**:Q5 砍 F3 codemod;Q8 收敛为 F2 = bundle 层、F1 = profile 层(§5.3、§6 决策 2);Q6 定为 M1 就做 UI、落点是 rescue 自带配置页;Q2 定为按需拉取且不保留 npm 种子(其代价已在 §5.1 写死)。

| # | 要决的 | 选项 | 推荐 | 影响面 |
|---|---|---|---|---|
| Q1 | 项目落点 | 独立 out-of-tree 仓库 / 在本仓库内建包 / 混合 | **混合,但混合点是"加字段"而非"建包"** —— 诊断侧真正的空白只有持续观测 + 未满足 key,上游 PR 可以小到"给 `pluginInventory` 加一个 `missingServices` 字段 + 一个 `internal/status` 订阅器" | 修复侧完全 out-of-tree;rescue 消费新字段并在旧版 dsh 上自备实现 |
| Q3 | 社区回填诊断数据 | 不做 / 默认开启 / 默认关闭 + 显式 opt-in | **接受 opt-in,但"只允许结构化三元组"必须是采集端的类型约束,不是文档承诺** —— 官方报告明示原始错误不脱敏(`apps/cli/reference/README.md:75`) | 禁携 error message / stack / config 值;与 §5.2 渲染前过滤同源 |
| Q4 | 补丁分发粒度 | 一补丁一包 / 单包多补丁 | **一补丁一包**,且本体不得把补丁固定为依赖 | 审计与按需安装粒度;否则每次矩阵更新都牵动本体版本 |
| Q7 | 命名与 npm scope | `dsh-rescue-*` / 独立 `@dsh-rescue/*` | **独立 scope** —— `dsh` 是 launcher 的 profile 缩写(`apps/cli/reference/README.md:9`),`dsh rescue` 已被用作示例 profile 名,发布名要避开与 CLI 形状的相似性 | ⚠ **当前三套命名并存**:Q7 推荐 `@dsh-rescue/*`、矩阵用 `@dsh-rescue/matrix`、样例补丁用 `@dsh-rescue/patch-foo-legacy`、§5.4 目录用 `packages/rescue`。定名后需一次性统一,是机械改动,不影响机制 |
| Q9 | doctor 是否自写报告文件 | 读官方 `startup-*.log` / 自写 | **默认读既有报告**;确需自写时先回答字段级脱敏(A7) | 与 §5.2 的渲染前过滤绑定 |
| Q10 | 预发布版本的矩阵策略 | 共用记录 / 独立通道 / 一律降级 | **独立通道 + 降级**(`meta.prerelease`)—— `includePrerelease: true` 会让 rc 落进 stable 区间(`plugin-compatibility.ts:77`) | 矩阵 schema 与诊断措辞 |
| Q11 | 官方已修复时优先升级还是继续挂补丁 | 建议升级 / 继续挂 | **优先升级** —— 过期补丁 + 官方真提供者 = 注册冲突抛错、profile 起不来(`reflect.ts:289-291`);补丁必须在 `apply()` 开头自检并自行禁用(§5.5) | 既是信任问题也是可用性问题 |
| Q12 | 同 key 冲突谁裁决 | 拒绝应用报冲突 / 按 confidence 高者胜 | **拒绝自动择一,但给"选 A / 选 B"可见出口**(§5.6)—— 自动择一会让"误修率 0"失去意义,而无出口会让冲突成为死路 | §6 决策 3 的不变量实例 |
| Q13 | 运行时出网是否可接受 | 默认出网 / 默认只用缓存 / 显式开关 | **显式开关,默认出网、可切 `offlineOnly`** —— 把体积、可用性、信任的取舍交还用户 | **决定 G6 与信任模型的形态** |
| Q14 | 体积预算是门禁还是参考 | 写进 CI 门禁 / 仅参考 | **写进门禁** —— `dependencies` 段为空比字节数更值得守;门禁逼"超预算就砍能力",与"悄悄放宽预算"方向相反,后者才是以小为卖点的项目的真正失败模式 | §3.1 全部口径 |
| **Q15**(v0.4 新增,由 R15/R21) | rescue 自身不可用时的降级形态 | 无兜底 / 自举诊断 / 自举诊断 + 逃生舱 | **自举诊断 + §5.7 逃生舱** —— rescue 的 peer 被门禁禁用、自身 PENDING / import 失败、或它写的补丁让 profile 起不来,三种都会让还原入口消失 | §3.2、§5.6、§5.7、A10/A12 |
| **Q16**(v0.4 新增,由 R6) | 三个成功指标哪些只在 opt-in 后才有数据 | 三项都承诺 / 分栏标注 | **分栏标注**:定位率与命中率只在 Q3 回填开启后可得,M1/M2 只承诺本地可算的三项(§8) | §8 度量的可验证性 |
| **Q17**(v0.4 新增,前提核验时发现) | rescue 的原子写从哪来 | a. 自己实现"`.bak` → `.tmp` + `rename` + 退避重试",常量与错误码对齐宿主(`vendor/include/src/index.ts:35-36,38-41,289-308`) / b. 直接 import `@deepseek-ai/dsh-atomic-write` 的 `writeFileAtomic` / `withFileLock`(`packages/util/atomic-write/src/index.ts:79,235`)复用实现 / c. 向上游提 PR,把该包移出 `dsh-` 前缀 | **a**。b 要新增一个 `@deepseek-ai/dsh-*` peer,而门禁的过滤式正好管辖这个前缀(`plugin-compatibility.ts:75`)—— 与 §0.1 的本体约束、断言 A10 直接冲突;c 是长期正解但周期不受本项目控制,可作为 M3 的上游 PR 顺带提出。**代价**:rescue 自己维护约 15 行写入代码,并承担与宿主重试常量漂移的风险 | §5.3.1 第 2 / 3 条、§3.1 的 0 新增依赖、A10 / A14 |

## 附录 A:相关代码索引

### A.1 兼容门禁与豁免

| 机制 | 位置 |
|---|---|
| peer 兼容评估(公开导出) | `packages/boot/app-boot/src/plugin-compatibility.ts`(`evaluatePluginCompatibility`) |
| 预检禁用不兼容行 | `packages/boot/app-boot/src/compatibility-preflight.ts`(`prepareProfileEntries` / `prepareProfilePatches`) |
| 版本豁免 `compatibility.json` | `packages/boot/app-boot/src/profile-compatibility.ts`(`readProfileVersionExemptions:99` / `setProfileVersionExemption`);CLI `apps/cli/src/plugin.ts`(`allow-version --accept-risk`);服务 `plugin-manager/src/index.ts`(`setVersionExemption`) |
| 启动审计(PENDING + 缺失服务) | `packages/boot/app-boot/src/index.ts`(`auditStartupEntries` / `inactiveEntries`) |
| 修复后复检(新增失败即抛) | `packages/boot/app-boot/src/index.ts`(`reconcileProfilePatches`) |

### A.2 组合、解析与热应用

| 机制 | 位置 |
|---|---|
| 运行时拦截层(bare import → 实例表) | `packages/boot/app-boot/src/profile-resolution/resolver.ts`(`installRuntimeInterception`);包表构建 `src/profile.ts`(`createRuntimeResolution`) |
| profile 目录与模板 | `packages/boot/app-boot/src/profile.ts`(`resolveProfileDir`、`PROFILE_TEMPLATES`、`OPTIONAL_BUNDLES`、`PROFILE_PATCH_FILENAME`) |
| 入口列表解析与补丁(**无 remove 操作**) | `vendor/include/src/index.ts`(`entryListSchema`、`applyEntryPatches`、`PatchOptions`);`entryListSchema` 是公开发布成员(`vendor/include/package.json` 的 `publishConfig.access: public`) |
| Loader 与插件挂载 | `vendor/loader/src/index.ts`;入口 import `vendor/loader/src/config/entry.ts` |
| HMR 与配置热应用 | `packages/boot/hmr/src/index.ts`(监听 profile / home 补丁与 manifest)、`src/watch-config.ts` |
| 服务注册与通知 | `vendor/cordis/src/reflect.ts`(`ReflectService.provide` / `set`、`notify`) |
| Cordis 核心(registry/fiber) | `vendor/cordis/src/`(`registry.ts` 枚举、`fiber.ts` 状态机) |

### A.3 诊断与交付面

| 机制 | 位置 |
|---|---|
| 活体插件清单(Remote + 读函数) | `packages/host/plugin-inventory/src/index.ts`(`readPluginInventory`、`pluginInventory/list`) |
| 客户端启动审计 | `packages/client/web/src/boot-client.ts`(`assertEntriesActive`) |
| PluginManager(安装/豁免/复检) | `packages/boot/plugin-manager/src/index.ts`、`src/operations.ts`、`src/install-spec.ts`、`src/tools.ts` |
| Web 插件页 | `packages/client/ui-plugin-manager/`;只读清单 `packages/client/ui-settings-plugin-inventory/` |
| 动态插件与试运行 | `packages/extensions/cordis-host-runner/` |
| 静态 API 目录(非运行实例自省) | `packages/extensions/tool-cordis/`(`cordis_inspect_list` / `cordis_inspect_query`) |
| PENDING 手工诊断配方 | `docs/cordis-tutorial/06-composition-and-hmr.md:61` |

### A.4 文档与决策记录

| 内容 | 位置 |
|---|---|
| bundle 作者指南、peer/devDependency 规则、`allowBuilds` | `docs/user/develop/basic/publish.md` |
| 层序、启动诊断、插件管理、配置 dump | `apps/cli/reference/README.md` |
| 准入边界与 profile 语义 | `packages/boot/app-boot/README.md#profiles` |
| 双实例失效面 | `.agents/notes/implemented/architecture/2026-09-08-desktop-bundled-runtime-and-external-plugins.md` |
| 社区插件现状(手写 lib、探测 argv 猜版本) | `.agents/notes/implemented/feature/2026-08-25-promote-open-anywhere-plugin.md` |
| 发布间类型快照(可复用于矩阵管道) | `docs/persistence-changes/releases/` |

## 附录 B:矩阵记录完整示例

字段契约、受控词表与分发段见 [附录 C](#附录-c矩阵-schema-与受控词表)。以下为 `rescue.matrix/v2` 的代表性记录。

```yaml
schema: rescue.matrix/v2
meta:
  generatedFor: "0.2.0"
  updated: "2026-09-29"
  prerelease:
    matchesStable: false
    channels: [stable, rc]
    onRcRuntime: downgrade-confidence
delivery:
  mode: pull-on-demand
  cacheDir: "$DSH_HOME/plugin-rescue/matrix"
  cacheKey: "generatedFor(minor) × channel × matrix-major"   # 不用 harness 精确版本,见 §5.1
  retain: [current, previous]
  maxCacheBytes: 307200        # 300 KB,见 §3.1;字节上限优先于份数
  offline:
    degradeTo: [D1, D2, D3, D6] # 仍然可用
    lose: [classification, fixes]

records:
  # 正向记录:已知可用。false-block 的豁免证据依赖这类记录。
  - id: OK-2026-0004
    state: works
    harness: ">=0.2.0 <0.3.0"
    plugin: { name: "@community/quick-notify", versions: ">=1.4.0" }
    severity: low
    confidence: verified
    verifiedOn: "0.2.0-rc.1"
    notes:
      - "已更新 peer 范围,预检放行,功能实测正常"
    source: "本地实测 2026-09-20"

  # 类别 1 false-block:预检禁用但实测兼容 → 有依据豁免(仍需用户 acceptRisk)
  - id: BRK-2026-0087
    state: broken
    harness: ">=0.2.0 <0.3.0"
    plugin: { name: "@community/quick-notify", versions: "1.0.0 - 1.3.9" }
    failure: false-block
    detection: { loadErrorCode: incompatible-version, moduleName: "@community/quick-notify" }
    severity: low
    confidence: verified
    verifiedOn: "0.2.0-rc.1"
    fix: { kind: allow }
    notes:
      - "0.2.0 未触及 notify 相关 API,作者仅未更新 peer 范围"
    source: "本地实测 2026-09-20"

  # 类别 3 config-schema-changed:Config 校验失败 → 整值覆盖
  - id: BRK-2026-0119
    state: broken
    harness: ">=0.2.0 <0.3.0"
    plugin: { name: "@community/multi-model-router", versions: "<=2.1.0" }
    failure: config-schema-changed
    detection: { loadErrorCode: config.validation, moduleName: "@community/multi-model-router" }
    severity: medium
    confidence: verified
    verifiedOn: "0.2.0-rc.1"
    fix:
      kind: config-patch
      addressing: by-row-id          # 整值覆盖,不是深合并
      preserveExpressions: true       # !!js 标记必须原样保留
      configMapping:
        - from: "routes[].model"
          to: "routes[].target"
        - from: "fallbackModel"
          to: null                    # 字段已删除,丢弃
    notes:
      - "含 !!js 表达式的字段不参与映射,原样保留并提示用户"
    source: "types-diff 0.1.x→0.2.0;issue #98"

  # 类别 5 service-key-removed:key 桩补丁,四前置条件显式记录
  - id: BRK-2026-0142
    state: broken
    harness: ">=0.2.0 <0.3.0"
    plugin: { name: "@community/foo-tools", versions: "<=1.4.2" }
    failure: service-key-removed
    detection: { pendingService: fooLegacy, fiberState: pending, moduleName: "@community/foo-tools" }
    severity: high
    confidence: verified
    verifiedOn: "0.2.0-rc.1"
    fix: { kind: patch, ref: "@dsh-rescue/patch-foo-legacy@^1.0.0" }
    requires:
      hmrEnabled: true
      moduleResolves: true
      preflightPasses: true
      injectSatisfiable: true
    restartRequired: false            # headless/sdk/acp 运行时置 true
    notes:
      - "0.2.0 将 ctx.fooLegacy 拆分为 ctx.foo 与 ctx.fooPolicy"
    source: "issue #123;types-diff 0.1.x→0.2.0"

  # 会被官方修复取代:命中时优先建议升级,不再挂补丁
  - id: BRK-2026-0155
    state: broken
    harness: ">=0.2.0 <0.3.0"
    plugin: { name: "@community/bar-tools", versions: "<=2.0.0" }
    failure: service-key-removed
    detection: { pendingService: barLegacy }
    severity: high
    confidence: verified
    verifiedOn: "0.2.0-rc.1"
    fix: { kind: patch, ref: "@dsh-rescue/patch-bar-legacy@^1.0.0" }
    requires: { hmrEnabled: true, moduleResolves: true, preflightPasses: true, injectSatisfiable: true }
    supersededBy: "@community/bar-tools@2.1.0"
    notes:
      - "2.1.0 起不再需要补丁;到该版本后本记录必须撤回或降级"
    source: "issue #131"
```

## 附录 C:矩阵 schema 与受控词表

矩阵是**数据声明,不是自由 YAML**:任何未列出的枚举值一律拒绝入库,否则矩阵退化成无法机器校验的散文(§5.1)。本附录是 `rescue.matrix/v2` 的唯一 schema 来源,[附录 B](#附录-b矩阵记录完整示例) 的记录按此契约写。

```yaml
schema: rescue.matrix/v2

# ── 分发 ──────────────────────────────────────────────────────────────
# 本体不内置矩阵(G6)。offline.degradeTo 列出的检测器**不读矩阵**,因此矩阵取不到
# 时诊断仍然可用,丢的只是 classification 与 fixes —— 取不到矩阵不等于产品不可用。
delivery:
  mode: pull-on-demand
  source:
    registry: npm
    package: '@dsh-rescue/matrix'                 # 定名后随 Q7 一并改
  verify: npm-provenance+schema-assert            # 不用 sha256:期望值只能来自同一 registry,等于没验
  cacheDir: '$DSH_HOME/plugin-rescue/matrix'
  cacheKey: 'generatedFor(minor) × channel × matrix-major'
  retain: [current, previous]
  maxCacheBytes: 307200                           # 300 KB;与 retain 冲突时字节上限优先
  maxAgeDays: 30                                  # 超期重拉;离线时用旧的并明示年龄
  oversizePolicy: reject-and-keep-previous        # 单份超限拒收,不截断(截断会静默丢修法)
  offline:
    degradeTo: [D1, D2, D3, D6]
    lose: [classification, fixes]
    uiCopy: '需要联网获取修复建议 —— 离线不是插件没坏'
    offlineOnly: false                            # §10 Q13 的显式开关

# ── 元数据 ────────────────────────────────────────────────────────────
meta:
  generatedFor: '0.2.0'                           # 生成时的 harness 版本
  updated: '2026-09-29'
  prerelease:                                     # includePrerelease:true 会让 rc 落进 stable 区间
    matchesStable: false                          # (plugin-compatibility.ts:77),区间语义必须显式声明
    channels: [stable, rc]
    onRcRuntime: downgrade-confidence             # rc 运行时把 stable 证据降为 inferred

# ── 受控词表 ──────────────────────────────────────────────────────────
vocabulary:
  failure:                                        # 15 类,与 §2 的表一一对应
    - { id: false-block,                detector: D1, autoFixable: true }
    - { id: peer-range-stale,           detector: D1, autoFixable: false, note: 豁免只解锁预检,不改变运行时行为 }
    - { id: config-schema-changed,      detector: D3, autoFixable: true,  note: 症状是 failed fiber,不是行被禁用 }
    - { id: config-expression-broken,   detector: D3, autoFixable: false, note: !!js 表达式引用已删服务,机器迁不动 }
    - { id: service-key-removed,        detector: D2, autoFixable: true }
    - { id: service-key-scope-mismatch, detector: D2, autoFixable: false, note: 与 service-key-removed 症状相同,必须先排除 }
    - { id: service-api-changed,        detector: [D4, D5], autoFixable: true }
    - { id: event-contract-changed,     detector: D4, autoFixable: true }
    - { id: tool-api-changed,           detector: [D4, D5], autoFixable: true }
    - { id: include-file-denied,        detector: D3, autoFixable: true,  note: 一个文件触到不兼容行 → 整份消失 }
    - { id: bundle-skipped,             detector: D3, autoFixable: true,  note: 贡献行全消失 }
    - { id: provider-disposed-runtime,  detector: D6, autoFixable: true,  note: 运行期释放 → 静默退回 PENDING }
    - { id: duplicate-package-instance, detector: D4, autoFixable: false }
    - { id: import-failed,              detector: D3, autoFixable: false }
    - { id: cordis-core-changed,        detector: ~,  autoFixable: false }  # 一期非目标

  detection:                                      # 指纹词表;同键多值表示命中其一
    pendingService:                               # fiber.inject 中 ctx.get() 为 undefined 的 key
    failedService:                                # inject 满足但 fiber 失败
    loadErrorCode:                                # 与 PluginManager 的 ManagementFailure code 对齐
    fiberState:                                   # pending | loading | failed | unloading | null
    entryId:                                      # Loader entry id
    moduleName:                                   # Loader entry.options.name
    bundleName:                                   # 被 skip 的 bundle
    includePath:                                  # 被整份否决的 include 文件
    unresolvedImport:                             # 静态扫描发现的、安装实例中不存在的具名导入
    duplicateInstance:                            # 同一 dsh 包在运行树中出现两个 module identity

  fixKind:                                        # requires 描述 F2 补丁的四个前置条件(§5.3)
    allow:        { writes: compatibility.json, via: pluginManager.setVersionExemption, consent: strong }
    config-patch: { writes: cordis.patch.yml, addressing: by-row-id, removeOpAvailable: false, consent: preview-required }
    patch:        { writes: [package.json, dsh.profile.bundles], lockfileTouched: false, dryRun: cordis-host-runner, consent: strong }
    manual:       { writes: nothing }
    # codemod(F3)已按 §10 Q5 砍掉,不进词表 —— "未知值拒绝入库"本身就是防线

  confidence:
    verified:   { needs: [runLogId, verifiedOn] }
    inferred:   { needs: [typesDiffRefs] }
    reported:   { needs: [reporter, reviewState] }   # reviewState: unreviewed | accepted | rejected

# ── 记录字段契约 ──────────────────────────────────────────────────────
record:
  id:              '字符串,BRK-YYYY-NNNN / OK-YYYY-NNNN;撤回记录保留原 id'
  state:           'works | broken —— 正向记录承载 false-block 的豁免证据'
  harness:         '区间;预发布语义见 meta.prerelease'
  plugin:          '{ name, versions }'
  failure:         'vocabulary.failure 的 id'
  detection:       'vocabulary.detection 的键值'
  severity:        'low | medium | high'
  confidence:      'vocabulary.confidence 的 id'
  fix:             '{ kind, ref(仅 patch:含精确版本范围的 specifier), configMapping(仅 config-patch:from→to,数组路径语法须实现时冻结) }'
  requires:        '仅 patch;四项全真才允许应用 —— 也是 §5.5 硬守卫的判定材料'
  restartRequired: 'bool;true 时 fixer 直接给重启提示,不承诺热生效'
  verifiedOn:      '精确 harness 版本;confidence: verified 时必填'
  expiresAt:       '矩阵区间终点;到期记录降级为 inferred'
  retractedBy:     '记录 id 或官方修复版本'
  supersededBy:    '官方已修复的插件版本;命中时优先建议升级(§10 Q11)'
  notes:           '自由文本'
  source:          'issue / PR / types-diff 引用'
```

**术语统一(v0.4)**:`fixKind` 用 `patch`(旧草案的 `shim` 废止),守卫失败的诊断结果统一写 `patch-stale`(旧拼写 `patch-stale` 废止)。npm 包名与 scope 由 Q7 决定,定名后一次性替换示例里的 `dsh-rescue-*` 名字即可,不影响任何机制。

## 附录 D:补丁规格

模型参照游戏 mod 补丁:**本体不打补丁,补丁是旁挂的最小差异;补丁管理器裁定兼容性;一键装卸还原;冲突必须报错而不是猜。**

### D.1 一个补丁是什么

补丁 = **一条"这里原来是什么"的声明 + 一段把它接回去的适配**。它不复现被删掉的功能,只把旧名字重新指回新名字。

```text
补丁 = { 补什么(指纹) + 做什么(适配) + 需要什么(前置条件) + 碰了什么(可回滚依据) }
```

"补什么"必须能与诊断器观察到的状态对上,而不是靠用户描述 —— 指纹取自 [附录 C](#附录-c矩阵-schema-与受控词表) 的 `vocabulary.detection`。"碰了什么"就是 §5.3 的 `before`:它决定这个补丁能不能被干净撤掉,不是可选注释。

### D.2 四种形态与体量

| 形态 | 补什么 | 适配内容 | 体量预算 |
|---|---|---|---|
| **key 桩** `service-key-removed` / `provider-disposed-runtime` | 一个被删掉或被释放的服务 key | `ctx.reflect.provide(旧名, 指向新服务的适配对象)` | 1–3 KB |
| **调用适配** `service-api-changed` / `tool-api-changed` | 旧签名或旧注册 API | 包一层,把旧调用翻译成新调用 | 2–8 KB |
| **事件桥接** `event-contract-changed` | 改名或改载荷的事件 | 旧名 → 新名 的重订阅,载荷按映射表转译 | 2–5 KB |
| **配置覆盖** `config-schema-changed` | 旧字段名 | 一条按行 id 的整值覆盖 | 200 B–2 KB |

后三者本质上都是数据 + 很薄的代码。体量是预算不是实测,A8 负责量(口径见 §3.1)。

### D.3 硬性约束

写补丁时必须同时满足,否则评审不通过:

1. **peer 声明宽范围,或者干脆不 import。** 需要共享实例的 dsh 包写 **peer**,范围必须**始终包含当前运行时**(如 `>=0.1.0 <0.3.0`);旧类型只进 `devDependencies`,且运行时**不得物理安装**旧包。照官方教程把旧范围写进 peer 会让补丁在加载前被兼容预检禁用(`compatibility-preflight.ts:101-118`),修复根本不生效。**更稳的写法是补丁一个 dsh 包都不 import**,服务全部经 `inject` 声明获得(§6 决策 1、[附录 E](#附录-e补丁样例dsh-rescuepatch-foo-legacy));
2. **零新增运行时依赖。** 补丁只 import peer;
3. **可撤。** 补丁占用的服务注册、写入的配置覆盖、装的包,都要能被逆操作干净还原。`ctx.reflect.provide` 返回的 disposer 天然是 fiber effect,随插件卸载一起消失(`vendor/cordis/src/reflect.ts:277-304`);
4. **不猜。** 补丁只在矩阵记录明确覆盖当前 harness 区间时启用;区间不覆盖就不加载,并把决定交给用户;
5. **会过期,且自己拦得住。** 官方发布真实提供者后,`ctx.reflect.provide` 会抛 `service "X" has been registered at <name>`(`reflect.ts:289-291`),把静默 PENDING 变成 profile 起不来。因此**每个补丁的 `apply()` 第一件事就是探测目标 key 是否已被占用,已占用则不 `provide` 并自行禁用**(§5.5 的硬守卫)。rescue 的巡检来不及拦 —— 它激活得比抛错晚;
6. **顺序敏感的原语禁用。** 事件桥接不得裸用 `prepend: true`;需要时只走 kit 提供的受控桥接原语,并在 kit 的评审清单里登记特例;
7. **新旧两版都要测。** 每个补丁带针对新旧两个 harness 版本的行为测试;只在新版上测过的补丁不给发布。

### D.4 冲突规则

游戏 mod 管理器的核心体验是"冲突要报错"。rescue 对应:

| 冲突 | 处置 |
|---|---|
| 两个补丁补同一个 key | **拒绝自动应用**,报出两个补丁 id,由人裁决;UI 给"选 A / 选 B"两个可见选项(§5.6),不按 confidence 自动择一 |
| 补丁补的 key 已被真实提供者占用 | 视为过期,**由补丁自行禁用**(不删除),rescue 报 `patch-stale` |
| 两个补丁改同一行的配置 | 拒绝应用 |
| 矩阵两条记录指纹重叠 | 报冲突,矩阵维护者在评审期解决 |

### D.5 分发与信任

- 补丁**独立成包、一补丁一包**,逐包评审 + npm provenance;rescue 本体**不把它固定为依赖**,否则每次加补丁都要发主包版本,与"逐包评审"矛盾;
- 矩阵只装数据、无代码、无 install script —— 从 git 装会触发 `prepare`,pnpm ≥10 要求用户在 `<profile>/pnpm-workspace.yaml` 的 `allowBuilds` 放行,那才是真正的"安装即执行代码"时刻;
- 应用补丁一律要用户显式批准,走 `plugin_manager` 已有的权限通道,不叠第二套同意面。**装第三方包并在本机执行其代码,确认强度不得低于写一行豁免**(§5.6 的分级表);
- `confidence: reported` 的补丁提示明确标注"社区上报,未复核"。

### D.6 怎么写

以 `service-key-removed` 为例。矩阵记录(见 [附录 B](#附录-b矩阵记录完整示例) 的 `BRK-2026-0142`)给出指纹与前置条件,补丁本体就是"提供那个 key,并委托给新服务":

```ts
export const name = '@dsh-rescue/patch-foo-legacy'

// 声明它依赖新的服务 —— 这些是 dsh 0.2 提供的,不是它自己造出来的
export const inject = ['foo', 'fooPolicy']

export function apply(ctx) {
  // 硬守卫:目标 key 已被真实提供者占用就不 provide(§5.5、D.3 第 5 条)
  if (ctx.get('fooLegacy') !== undefined) return () => {}
  // provide 返回 disposer,并注册为 fiber effect:卸载时连带消失
  return ctx.reflect.provide('fooLegacy', {
    async run(spec) { return ctx.foo.run(spec) },
    limits() { return ctx.fooPolicy.limits() },   // 旧字段 → 新字段
  })
}
```

这就是全部。没有重新实现 `foo`,没有条件分支去猜行为,没有依赖表。完整样例(含 manifest、生命周期、边界情形)见 [附录 E](#附录-e补丁样例dsh-rescuepatch-foo-legacy)。

### D.7 怎么撤

| 撤的对象 | 操作 |
|---|---|
| key 桩 | 卸载补丁插件 → disposer 释放注册 → 依赖方退回 PENDING(**无报错**) |
| 调用适配 / 事件桥接 | 同上 |
| 配置覆盖 | **再次按行 id 覆盖回原值**,不是删行 —— patch 语言没有 remove 操作(`vendor/include/src/index.ts:57-141`);匹配只按 id,不按值扫 |
| 版本豁免 | `pluginManager.setVersionExemption(..., enabled: false)` |
| 补丁包 | `dsh plugin remove`;bundle 层从 `dsh.profile.bundles` 摘除。**不得删 `pnpm-lock.yaml`**(§5.3) |

rescue 自己的状态文件(`.plugin-rescue/state.json`)记录**意图与 `before`**;用户层的文件是当前配置的唯一事实来源。撤回到哪一步算完,由 §5.3.1 的复检与 `.bak` 哈希判定,不由"操作没报错"判定。

## 附录 E:补丁样例`@dsh-rescue/patch-foo-legacy`

补的是**类别 5 `service-key-removed`**:dsh 0.2.0 把 `ctx.fooLegacy` 拆成 `ctx.foo` 与 `ctx.fooPolicy`,凡是 `inject: ['fooLegacy']` 的社区插件停在 PENDING。矩阵记录与插件名是示例,方法可迁移到任何同类失效。

### E.1 矩阵记录

见 [附录 B](#附录-b矩阵记录完整示例) 的 `BRK-2026-0142`。`detection` 三个字段缺一不可:`pendingService` 是类别 5 与类别 6(`service-key-scope-mismatch`)的唯一区别,`fiberState` 排除"已 failed",`moduleName` 把补丁绑到具体插件而不是一个通用 key。

### E.2 源码

见 D.6。关键的一点是 `apply` 里**不 import 任何 dsh 包**:`ctx` 上的服务通过 `inject` 拿到,值来自宿主的单实例。补丁因此对 harness 的编译期类型零依赖,不存在"旧类型副本破坏单实例"的问题(§6 决策 1)。

### E.3 manifest

```json
{
  "name": "@dsh-rescue/patch-foo-legacy",
  "version": "1.0.0",
  "type": "module",
  "main": "lib/index.js",
  "files": ["lib/index.js", "lib/types/index.d.ts", "cordis.patch.yml"],
  "dsh": { "bundle": { "patch": "./cordis.patch.yml" } },
  "peerDependencies": { "@deepseek-ai/cordis": ">=4.0.0 <5.0.0" },
  "devDependencies": { "@deepseek-ai/cordis": "^4.0.0", "@deepseek-ai/dsh-foo": "^0.2.0" }
}
```

```yaml
# cordis.patch.yml
- insert:
    - id: rescue-patch-foo-legacy
      name: @dsh-rescue/patch-foo-legacy
```

两处要点:**peer 只有一个且范围够宽**,`dsh-foo` 只在 devDependencies 里供类型检查 —— 把旧范围写进 peer 会让兼容预检在加载前禁用这一行(`plugin-compatibility.ts:75-80`);补丁声明 `dsh.bundle`,因此 `dsh plugin add` 会把它追加进 `dsh.profile.bundles` 并触发树重算(`plugin-manager/src/index.ts:715-735`),`dsh plugin remove` 就是还原。

### E.4 生命周期

```text
诊断        观察到 @community/foo-tools 停在 pending,缺 fooLegacy
  ↓           矩阵匹配 BRK-2026-0142,confidence: verified
批准        按 fixKind=patch 的强确认(§5.6);git/tarball 来源含 allowBuilds 放行
  ↓
试运行      内存挂载 → foo-tools 变 active(只能证伪,不证明有效)
  ↓
写 intent   记 before(原值 + .bak 路径)与目标文件哈希
  ↓
落盘        .bak-<stamp> → tmp+rename 写补丁行 → dsh plugin add → selectBundle → reload()
  ↓
复检        ① reconcileProfilePatches 无新增失败 ② 重跑 D2:foo-tools 不再 pending
  ↓
标 applied  写 state.json;同时生成 .bak 与 undo.md(§5.7)
```

### E.5 边界情形

| 情形 | 行为 | 依据 |
|---|---|---|
| 补丁加载时 `fooLegacy` 已被真实提供者占用 | `provide` 抛 `service "fooLegacy" has been registered at <…>` | `vendor/cordis/src/reflect.ts:289-291` |
| 官方在 0.3.0 真的发布了 `fooLegacy` | 上面的抛错会把静默 PENDING 变成 profile 起不来 ⇒ **硬守卫必须在补丁自己 `apply()` 开头拦截** | §5.5 |
| `foo` 提供者还在 PENDING 时补丁先激活 | `notify` 只对已 ACTIVE 的提供者立即通知;提供者到达 ACTIVE 时由 `_updateState` 恢复 | `reflect.ts:294-296`;`vendor/cordis/src/fiber.ts:588-594` |
| 用户卸载补丁 | disposer 释放注册,依赖方退回 PENDING,**不报错** | `reflect.ts:297-303` |
| `fooLegacy` 存在于别的 isolate label | 补丁不解决这种情形,那属于类别 6,矩阵里标为不可自动修复;试运行也会因 label 过滤而假阴性 | `reflect.ts:314` |
| 运行的 harness 是 headless / sdk / acp | HMR 默认关闭,`requires.hmrEnabled` 为 false,结果标 `restartRequired` | `packages/boot/hmr/README.md:27` |
| 矩阵区间不覆盖当前 harness | 补丁不加载,报"这条路走不通" | D.3 第 4 条 |

### E.6 体量

| 项 | 预算 | 口径 |
|---|---|---|
| `lib/index.js` | ≤ 3 KB | 打包产物字节数,不含 sourcemap |
| `lib/types/index.d.ts` | ≤ 2 KB | 声明不计入运行时预算,但计入 npm 包大小 |
| 整包安装后增量 | ≤ 10 KB | 排除 pnpm store 共享内容 |
| 新增运行时依赖 | 0 | 只允许 peer |

以上是预算不是实测。实测口径见 §3.1 与 A8:`pnpm pack` 后量 `lib/**/*.js` + `cordis.patch.yml` 的字节和,另记 profile 内安装后增量作为参考;超出预算的补丁不予合并。

### E.7 评测

按 D.3 第 7 条,补丁带针对新旧两个 harness 版本的行为测试:

- **旧版(0.1.x)**:不加载(补丁的 `harness` 区间不覆盖),断言矩阵不匹配;
- **新版(0.2.x)**:`foo-tools` 由 pending 转 active,`ctx.get('fooLegacy')` 可读,`run` 的结果与 `ctx.foo.run` 一致;
- **冲突版**:同时提供真实 `fooLegacy` 时,断言**不抛错、补丁自行禁用、rescue 报 `patch-stale`**(A11 的判据)。
