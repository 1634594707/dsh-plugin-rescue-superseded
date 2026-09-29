---
description: "第三轮评审:以 deepseek-harness-desktop 已上线的插件恢复模式为参考实现,对还原/回滚/中断/所有权/逃生舱这条轴给出 R19–R32,每条附两侧 file:line 证据与具体改法。"
kind: "working-material"
---

# 第三轮评审意见(v0.3 → v0.4)· 恢复模式对照

评审对象:`proposal.md` v0.3 的 §3.2 / §5.3 / §5.5 / §5.6(还原与回滚这条轴)。
参考实现:`D:/Administrator/Desktop/deepseek/deepseek-harness-desktop` —— Tauri 桌面壳,内核基线同为 dsh `0.2.0-rc.1`(该仓 commit `e9f0d228`)。它已经把"插件坏了 → 归因 → 快照 → 卸载/还原 → 安全模式"这条链路**写完并上线**,是本方案同一条链路的现成对照物:哪些是必须有的机制、哪些是踩过坑之后加的、哪些是加了反而制造新问题的,都有代码可查。

编号续 [findings-round2.md](findings-round2.md) 的 R18,不重号。**R1–R18 尚未合入正文**,本轮 R21 建立在 R1(rescue 会被门禁禁用)与 R2(硬守卫应放在补丁自身)之上。

路径缩写:

| 缩写 | 展开 |
|---|---|
| `desktop:` | 参考实现仓库根 |
| `P/` | `desktop:src-tauri/src/service/plugin/` |
| `S/` | `desktop:src/store/modules/recovery/` |
| `proposal:` | 本目录 `proposal.md` |

本轮实测的两侧事实(不沿用既有结论):

| 核验项 | 结论 |
|---|---|
| `proposal.md` 关键词计数(`grep -c` 实测) | `原子` 0 · `事务` 0 · `中断` 0 · `幂等` 0 · `journal` 0 · `安全模式` 0 · `逃生` 0 |
| `proposal.md` 里的"快照"(7 处) | 全部指**类型快照**(`docs/persistence-changes/releases/`,`:242,444,515`)或 `reconcileProfilePatches` 的内部前态(`:328`)与 D2 的一次性对齐(`:258`)—— **没有一处是 rescue 自己的改前备份** |
| 回滚依据的字段清单 | `proposal:329` = kind / 目标 / 触碰的文件 / 矩阵记录 id / 时间戳 —— **不含被覆盖行的原值**,而 `proposal:313` 要求"覆盖回原值" |
| `state.json` 这个文件名 | 全目录只出现在 `patches/example-foo-legacy.md:106`;`proposal` 本体只写"manifest / 状态文件",无 schema、无版本 |
| desktop 安全模式的触发方式 | 仅用户显式命令 `enter_safe_mode`(`desktop:src-tauri/src/bridge/lifecycle.rs:363-380`);`crash_count` / `consecutive` / `failure_count` / `restart_count` 在 `desktop:src-tauri/src/**.rs` **零命中** → 无自动降级 |
| desktop 的隔离手法 | rename 为 `<原名>.broken-<UTC 时间戳>`,冲突追加 `-2`/`-3`,绝不覆盖,内容原样保留(`P/patch_guard.rs:13,90-106,112-146`) |
| desktop 隔离失败时的处置 | `has_failures()` 为真则**禁止切档案与重启**(`P/patch_guard.rs:57-66` + `lifecycle.rs:375-377`),并给定向文案(`desktop:src/i18n/locales/zh-CN.json:107`) |
| desktop 的原子写 | 补丁层:先 `copy` 成 `.bak-<stamp>`,再同目录 `<名>.tmp-<stamp>` + `rename`(`P/patch_entries.rs:137-180,404-424`);归档:`.tmp` → `sync_all()` → `rename`(`P/snapshot.rs:245-263`) |
| desktop 的还原三阶段 | 预检(可还原性 + 完整性 + 操作锁 + 停服务)→ 解压到 `.staging-<id>-<pid>` 并校验 → dest↔`.backup-<token>` 切换,失败逐步反转,还原后核验实体(`P/snapshot.rs:591-677`) |
| desktop 的归属唯一性闸门 | `owners.len() == 1` 共五处(`P/recovery/ownership.rs:244,263,267,277,299`);判不出唯一归属返回空集合(`:305`),前端拿到空集合就不弹恢复页(`S/store.ts:68`) |
| desktop 的重试上限 | `MAX_RECOVERY_ATTEMPTS = 3`(`S/types.ts:26`)→ `exhausted`(`S/store.ts:25-27`)→ 专用文案(`zh-CN.json:358`) |
| desktop 计数语义的缺陷 | `attempts` 在每次**定位**成功时 +1(`S/store.ts:51`),而注释写的是"连续修复失败达到上限"(`S/types.ts:24`)→ 运行期报错三次即触发"多次处理仍反复",且计数不按 reason / 插件维度区分 |

---

## 一句话结论

**方案的"可还原"目前是一句验收承诺(`proposal:158` 逐字节等价),不是一套机制。** 参考实现里支撑同一句承诺的东西有五件:改前备份、原子写、意图先行的状态记录、唯一性闸门、以及一条不依赖被恢复运行时的逃生路径 —— 这五件在 `proposal.md` 里分别是"缺"、"缺"、"字段不含原值"、"只在冲突一处提到"、"完全没有"。其中**逃生路径是致命的**:rescue 是普通插件(决策 4,`proposal:407`),它写坏的 profile 会让它自己加载不了,而 §5.5 自陈的头部风险恰恰是"整个 profile 起不来"(`proposal:357`)。R1 说的是"被门禁禁用",R21 说的是"被自己写的补丁炸掉",两条合起来是同一个结论:**还原入口在最需要它的时刻不存在。**

好消息是这批改动的体积代价接近零 —— 它们是写盘纪律、状态字段和文案,不是新代码路径,不引入任何依赖(见文末附录)。

---

## 致命(P0)·不解决则"可还原"这句话不成立

### R19 · 回滚要用的"原值"没有落在任何地方

三处规定互相矛盾:

1. `proposal:313` —— "回滚时**再次按 id 覆盖回原值**";
2. `proposal:329` —— 回滚依据是状态文件,字段为 kind / 目标 / 触碰的文件 / 矩阵记录 id / 时间戳,**没有原值**;
3. `proposal:315` —— manifest "只记录**意图**,用户层的文件永远是唯一事实来源"。

意图不含原值,用户文件又已被覆盖,原值就无处可取。F1 是唯一有这个问题的修法(F0 走服务、F2 走 `removeBundle`、F4 不落盘),但 F1 恰好覆盖的是类别 3/10/11 三类失效(`proposal:295`),是 M1 的主力。

还有第二处:`proposal:158` 承诺"还原后用户配置文件与还原前**逐字节等价**"。F1 是整值覆盖,往返要过 `entryListSchema`(`proposal:303`),而用户的 `cordis.patch.yml` 带说明注释、可能含 `!!js` 表达式标记 —— **结构化往返不保证逐字节**。逐字节等价只能由文件级备份保证。

参考实现的做法是两条腿并存:结构化 manifest 自包含关键字段(`pluginId` / `created` / `spec` / `entryCount` / `archiveSize`,`P/snapshot.rs:85-99`),但还原时不信任结构化数据,直接从整份归档解压(`P/snapshot.rs:624-650`)。

**改法**:每条 applied 记录必须带 `before`,按 fixKind 取值:

| fixKind | `before` 的内容 | 逐字节等价由谁保证 |
|---|---|---|
| F1 config-patch | 被覆盖行的原文本片段 **+** 整个 `cordis.patch.yml` 的 `.bak-<stamp>` 路径 | `.bak`(不是行级往返) |
| F0 allow | 豁免条目的原状态,含"原本不存在"这一取值 | 宿主自带 `withFileLock + writeFileAtomic`([evidence.md](evidence.md) 已核验) |
| F2 补丁包 | 安装前的 `dependencies` 与 `dsh.profile.bundles` 全量 | 还原时写回这两项 —— 参考实现正是这么做的(`P/snapshot.rs:684-691`) |
| F4 manual | 无 | 不适用 |

**落点**:`proposal:313`、`:315`、`:329` 三处同改;`patches/README.md:104-112` 的撤销操作表;`patches/example-foo-legacy.md:106`;[m0-assertions.md](m0-assertions.md) A5 的判据从"注释不丢"升级为"`.bak` 存在且可还原,逐字节等价由 `.bak` 保证而非结构化往返"。

### R20 · 写盘没有原子性,也没有中断语义

`proposal:317-325` 的应用流程跨三个写入面(`compatibility.json` / `cordis.patch.yml` / 经 `dsh plugin` 改 `package.json` + bundles),而全文 `原子` `中断` `幂等` `事务` 各出现 0 次。任一步进程死掉之后的状态没有规则:包装了一半、审计没记上、原值已丢但覆盖未写完。`proposal:310` 承认用户文件"可能正被用户并发编辑",但没给处置。

参考实现在这三件事上都有明确手法:

- **原子替换**:同目录 `.tmp-<stamp>` → `rename`。它的文档注释把"为什么不能直接 write"讲透了 —— `fs::write` 先截断原文件,写到一半失败(磁盘满 / 被中断)会把用户手写的补丁层截成半截 YAML,`.bak` 还在但半截文件会让下次启动**多报一个语法错误**;同目录 `rename` 在 Windows(`MOVEFILE_REPLACE_EXISTING`)与 Unix 上都是原子替换,失败时原文件保持不动(`P/patch_entries.rs:404-424`)。
- **操作锁 + 停服务**:还原前 `acquire_operation_lock`,并要求服务未启动(`P/snapshot.rs:591-613`;`P/safe.rs:16-19` 说明"改清单、删 `node_modules` 目录才安全")。
- **幂等**:manifest 未改则不写盘(`P/recovery/uninstall.rs:13-36`);删目录吞掉 `NotFound`(`:99-103`);清错误记录仅在命中时才写(`P/errors.rs:69-75`)。

**改法**:§5.3 增一小节"写盘、中断与幂等",规定四条:

1. **意图先行**:state 里先写 `intent`(含 R19 的 `before`),再改用户文件,复检通过后才标 `applied`。下次启动发现 `intent` 未 `confirm`,报"上次修复未完成",给"继续 / 还原"两个动作 —— 这就是缺失的中断恢复语义。
2. **任何触碰用户文件的写入都走 `.bak-<stamp>` + 同目录 tmp + rename**,包括 F1 的应用与撤回。不允许直接覆盖写。
3. **一次只允许一个 apply / rollback**,用 state 目录里的锁文件;拿不到锁就报"另一次修复正在进行"。
4. **并发编辑检测**:apply 前把目标文件的 mtime + 内容哈希记入 `intent`,写前重读比对,不一致则中止并报"文件已被你改动,请重试"。这条把 [m0-assertions.md](m0-assertions.md) A5 的"用户并发编辑不被覆盖"从断言变成机制。
5. **rollback 幂等**:重复执行无副作用;`before` 指向的 `.bak` 不存在时不猜、直接报"无法还原:备份缺失",并把该记录标为需人工处理。

**落点**:§5.3 新增小节;§3.1 预算不受影响(无新增依赖);m0 A5 判据补 3/4/5 三条。

### R21 · 没有逃生舱:rescue 写坏的 profile 会让 rescue 自己加载不了

现状三条叠起来是一个死角:

- 决策 4(`proposal:407`)—— rescue 自身只是一个普通插件,挂在组合树旁边;
- §5.5(`proposal:357`)—— 过期补丁会让 `provide` 冲突抛错,"一个原本静默的 PENDING 变成**整个 profile 起不来**";
- §3.2(`proposal:154`)—— 零 CLI,所有动作都在 Plugins 页里。

profile 起不来 ⇒ Plugins 页不存在 ⇒ 还原开关不存在 ⇒ 用户唯一的出路是手工编辑 `cordis.patch.yml`,而 §5.6 的目标恰恰是"让用户全程不接触 `cordis.patch.yml`"(`proposal:368`)。

参考实现的答案是一条硬约束:**恢复能力不依赖被恢复的运行时**。三个具体点:

1. 安全档案是**宿主级常量** `SAFE_PROFILE = "safe"`(`desktop:src-tauri/src/service/profile/mod.rs:59`),其契约是"只加载 web 模板核心 bundles、**不带任何用户插件/补丁层**"(`P/safe.rs:1-4`)—— 兜底路径必须绕开被兜底的东西;
2. 进入前把该档案里的用户插件清干净,只保留内置插件与 `@deepseek-ai/*`(`P/safe.rs:9-19,34-108`),理由写在注释里:不清理的话每次进安全模式都带着同一批插件重启,"隔离形同虚设(用户看到的仍是同一个启动失败)";
3. 卸载走**离线精准路径**,不依赖 node / pnpm / 网络 / 窗口,"即使插件产物已损坏也能移除"(`P/recovery/mod.rs:12,160`);
4. 兜底自身失效时**硬失败而不是假装恢复**:隔离有失败就拒绝切档案,注释写的是"再次解析失败,切过去等于把『安全模式』也变成失败循环。此时让用户先处理文件,而不是假装已恢复"(`lifecycle.rs:362-378`)。

rescue 是 out-of-tree、一期不改 harness,拿不到宿主级安全档案。可迁移的等价物是三条:

- **(a) undo 产物自包含,且能在 rescue 不加载时使用。** `.plugin-rescue/` 下除 state 外,保留每次改动的 `.bak-<stamp>` 原件,外加一份人可读的 `undo.md`:哪个文件的哪一行被改成了什么、原值是什么、手动改回的步骤。这份文件的读者是**一个打不开 Plugins 页的用户**。
- **(b) 文档化一条不依赖 rescue 的还原命令。** 与 §3.2 的"零 CLI"有张力,处理办法是把那一行改成"**日常路径**零 CLI;逃生舱例外",并在失效卡片、`README` 与 `undo.md` 三处都写清这条命令。参考实现的对应物是错误页上"隔离损坏的补丁文件"这个显式入口(`desktop:src/ui/plugin/recovery.tsx:166-169`)与教用户具体动作的文案(`zh-CN.json:107`)。
- **(c) 硬守卫放在补丁自身 `apply()` 开头**(round2 R2 已提)。这是唯一在"rescue 加载不了"时仍然生效的防线,因为它随补丁包分发,不随 rescue。

**改法**:新增 §5.7 逃生舱,收 (a)(b)(c) 三条;§3.2 零 CLI 行加例外;§9 风险表把 R1 与 R21 合并成一条"rescue 自身不可用时还原入口消失",缓解指向 §5.7。

**验收**:新增 M0 断言 A12 —— 在 rescue 被禁用或直接删除的情况下,仍能用一条不依赖 rescue 的命令把用户配置还原到应用前,且还原后逐字节等价(对齐 `proposal:158`)。

---

## 重要(P1)·机制缺口,可在 M1 内补齐

### R22 · 没有重试预算,也没有"转人工"终态

`proposal:394` 规定复检失败即自动还原,但没有次数上限:用户可以无限次"一键修复 → 失败 → 自动还原",每次都看到同一句人话。

参考实现有明确终态:`MAX_RECOVERY_ATTEMPTS = 3`(`S/types.ts:26`)→ `exhausted`(`S/store.ts:25-27`)→ 文案「多次处理后问题仍反复出现。请打开 Harness 日志查看详细错误,或在「插件」面板手动卸载该插件。」(`zh-CN.json:358`)。清零只发生在服务真正就绪或停止时(`desktop:src/store/modules/harness/store.ts:429,825`),`clear()` / `hide()` 刻意保留计数(`S/store.ts:141-157`)。

**但它计数的方式不要抄**:`attempts` 是在每次**定位**成功时 +1(`S/store.ts:51`),运行期插件报三次错(用户一次修复都没做)就会看到"多次处理后问题仍反复出现";而注释写的是"连续修复失败达到上限"(`S/types.ts:24`)。计数也不按 reason / 插件维度区分,三次不同原因各失败一次同样触发。

**改法**:计数键 = `(插件, harness 精确版本, fixKind)`,**只在修复动作失败时 +1**,诊断次数不计入;达 3 次后该键的"一键修复"降级为 F4(只给指南),卡片上写明"已尝试 3 次"。清零时机 = 该插件的复检通过,或 harness 版本变化。

**落点**:§5.6 规则清单加一条;state 字段加 `attempts`;与 round2 R6 的"自动回滚次数"度量同源,一并写明。

### R23 · 归因缺唯一性闸门,与冲突裁决应该是同一条不变量

现状是三处各自表述、没有统一原则:D5 运行时错误归因(`proposal:261`)、报告里的"排除"行(`proposal:284`)、冲突时不自动择一(`proposal:396`,即 Q12)。

参考实现把这件事做成了硬闸门:归属判定分五级(直接命中 → 依赖拥有 → 动态引用 → entry id → 槽位,`P/recovery/ownership.rs:80-213`),**每一级的通过条件都是 `owners.len() == 1`**(`:244,263,267,277,299`),判不出唯一就返回空集合(`:305`),前端拿到空集合就不弹恢复页(`S/store.ts:68`)—— 宁可不救也不误救。候选名还要先过白名单,拒 `:`、空白、`.` / `..`、多层 scope(`P/recovery/mod.rs:54-95`)。

**改法**:把 Q12 的答案上升为贯穿诊断与修复的不变量,写进 §6 决策 3(fail-loud):**证据不唯一就不动手** —— 归因不唯一则只报根因、不指认插件;修法冲突则不自动择一;归属不唯一则不写用户文件。同时给 D5 补包名白名单校验,避免把日志里的任意 token 当包名。

### R24 · 复检只证"没变坏",不证"修好了"

`proposal:323` 的判据是"`reconcileProfilePatches` 的**新增失败**即视为失败",`:428` / `:434` 的验收与度量同源。这意味着:补丁装上、profile 仍然 PENDING、没有新增失败 ⇒ 按现文算**通过**,而用户看到的是一个"已修复"卡片和一个仍然不工作的插件。

参考实现有一处同类缺陷可作反面教材:预检用"归档条目数 + 解压后字节数"双计数(`P/snapshot.rs:322-331`),还原后却只查 `dest/package.json` 是否存在(`:670`)—— 前后强度不对称,那道"防假成功"闸门能挡住的情形比它看起来能挡的少。

**改法**:复检 = ①`reconcileProfilePatches` 无新增失败 **且** ②重跑产生该诊断的那个检测器(D1 / D2 / D3 / D6)并断言**原症状消失**。①② 缺一不可,写进 `:323` 与 M1 验收 `:428`。round2 R4("试运行只能证伪不能证实")与此同源,一并合入。

### R25 · 撤回 F1 要改写用户文件:必须"隔离优于删除",隔离失败必须硬失败

§5.5 的"禁用而非删除"对 F2 是正确的(且有现成原语 `setBundleEnabled`,round2 R2 已点名),但 F1 的撤回必须改写用户自己的 `cordis.patch.yml`,`proposal` 没有规定改写手法与失败处置。

参考实现在这条路径上的三件装备:

- **改名保留,不删**:`.broken-<UTC 时间戳>`,冲突追加 `-2`/`-3`,绝不覆盖,决定权交回用户(`P/patch_guard.rs:13,90-106,112-146`);改写补丁层前先 `copy` 成 `.bak-<stamp>`(`P/patch_entries.rs:137-180`);
- **失败即硬失败**:`has_failures()` 为真则禁止切档案与重启(`P/patch_guard.rs:57-66` + `lifecycle.rs:375-377`);
- **专用错误码 + 可执行的人话**:`PATCH_LAYER_QUARANTINE_FAILED`(`P/patch_guard.rs:135,195`),文案直接教动作:「文件仍在原处,重启会再次报同样的解析错误。请先关闭占用该文件的程序(编辑器 / 同步网盘 / 杀毒软件),或手动把该文件改名为 `.broken-<时间戳>` 备份,然后重试。」(`zh-CN.json:107`)

**Windows 上这不是理论风险**:文件被编辑器 / 同步盘 / 杀软占用时(无 `FILE_SHARE_DELETE`)`rename` 会失败,参考实现的锁定测试用的真实样本就是 `Access is denied. (os error 5)`(`desktop:test/patch-layer.test.ts:51-52`)。

**改法**:§5.5 补"F1 撤回的写盘手法"(= R20 第 2 条);写失败时不静默、不改 state、报专用错误码 + 一句可执行的人话,措辞形态照 `zh-CN.json:107`(说清文件仍在原处、下次启动会怎样、用户具体能做什么)。这与 `proposal:160` 的"失败可读"验收是同一件事,但需要把"可执行"写进判据。

### R26 · state 文件缺 schema 与版本,并且不要预留空字段

现状:`proposal:315` 只说"记录意图",`:329` 只列字段名,`state.json` 这个文件名只在 `patches/example-foo-legacy.md:106` 出现过一次;没有 schema、没有版本、没有升级规则。对比矩阵侧是有 `rescue.matrix/v2` 与 cacheKey 里的 matrix-major 的(`proposal:211,226`)。

参考实现的反例(**不要抄**):`SnapshotManifest` 里 `includeConfig` 恒为 `false`、`patches` 的注释直接写"(v1 为空)"(`P/snapshot.rs:88-94`),模块文档自陈这是降级——"配置段读写桥是未落地的前置任务……降级为「只还原包 + 提示重启」"(`P/snapshot.rs:11-13`)。后果是实的:卸载会剥掉用户的 patch 条目(`P/recovery/uninstall.rs:186`),而还原路径不恢复它(`patches` 永远为空)⇒ "卸载 → 从快照还原"**静默丢失用户自己的补丁配置**。这正是 `proposal:158` 要禁止的结果。

**改法**:① state 顶部写 `schema: rescue.state/v1`,与矩阵同构;不认识的版本 → 只读不写,报"请升级 rescue";② v1 不落任何未实现字段,需要时再加版本;③ F2 的还原必须写回安装前的 `dependencies` + `dsh.profile.bundles`(见 R19 表格)。

**落点**:`proposal:315`、`:329`、`:398`(忽略记录也进同一份 state,别开第二个文件)、`patches/example-foo-legacy.md:106`。

### R27 · 批量动作里单项失败会静默,"存在但不可读"会被显示成"可用"

现状:`proposal:394` 只规定单个修复的失败措辞;而 `list_applied`(`proposal:286`)与多张已修复卡片(`proposal:381-389`)意味着存在批量还原,批量失败语义缺失。

参考实现有两条可直接引以为戒的缺陷:

1. **同一个 store 两种失败语义**:`restoreAndRedetect` 逐项 try/catch,单项失败只 `console.error`,然后照常 `clear()` + `restart()`(`S/store.ts:112-122`);而 `recoverAndRedetect` 是外层单 try、首项失败即中断整个循环(`S/store.ts:87-100`)。前者的用户观感是"点了还原 → 重启 → 还是同一个错误页",零解释。
2. **损坏备份显示成"刚刚创建"**:`get()` 在 manifest 读不出时回落 `now_timestamp()` 并仍报 `exists: true`(`P/snapshot.rs:458-474`,注释自陈"保持 UI 可展示"),而 UI 只看 `exists` 决定按钮是否出现(`desktop:src/ui/plugin/recovery.tsx:41-64`)⇒ 按钮亮着但必然失败。快照探测失败又被 `silence()` 吞掉(`recovery.tsx:52-57`),用户分不清"没有备份"和"查询备份失败"。

**改法**:§5.6 规则加两条 —— ① 批量动作逐项报告,任一项失败则不宣称整体成功,失败项在卡片上单独标出;② "存在但不可读 / 不可还原"是**独立状态**,有自己的措辞,不得回落成"可用",也不得与"没有备份"共用同一个不显示分支。§3.2 "失败可读"行的验收同步补这两条。

---

## 改进(P2)·口径与平台

### R28 · 明确不要抄的四条

| 反例 | 参考实现证据 | 对 rescue 的约束 |
|---|---|---|
| 无条件删整个 `pnpm-lock.yaml` | `P/recovery/mod.rs:186-192`(注释自称 best-effort)、`P/snapshot.rs:687-691` | 单插件修复不得有全档案级副作用:F2 的安装与卸载**不许删 lockfile**。删掉它意味着下次 `pnpm install` 重新解析**每一个**插件的版本 —— 一次精准修复的副作用是全体插件可能悄悄升版本。若某个补丁确实需要,那是 profile 级操作,必须在批准界面单列并取得显式同意 |
| best-effort 写在类型上 | `P/verify.rs:71-126` 签名是 `Result<(), String>` 但所有路径返回 `Ok(())`,调用点 `desktop:src-tauri/src/service/workflow/launch.rs:449-451` 的 `if let Err` 是死分支 | 复检与回滚的接口必须能返回失败。"尽力而为"只能写在文档里,不能写在类型上(与 AGENTS.md 的 fail-loud 同源) |
| 完整性校验用双计数,且创建时不校验 | `P/snapshot.rs:322-331`(条目数 + 解压字节数)、`:360-406`(`create()` 写完即返回,唯一校验点在 `restore()`) | `.bak` 落盘时就算并记内容哈希,还原前校验哈希。双计数挡不住保持计数不变的内容替换 |
| 同仓两种写盘强度 | `P/recovery/mod.rs:180` 非原子 `fs::write` vs `P/patch_entries.rs:410-424` tmp + rename | rescue 只允许一种:任何触碰用户文件的写入都走 tmp + rename(R20 第 2 条) |

### R29 · 回滚按 id 精确匹配,不要按顶层键值扫

参考实现的 `patch_entry_targets` 是 `map.iter().any(|(k, v)| k.as_str() == Some(id) || v.as_str() == Some(id))`(`P/recovery/uninstall.rs:153-161`,注释自陈"顶层 id 字段**或任意字段值**")。它同时过宽和过窄:过宽 —— 一条 `- id: other-plugin` 只要带一个值等于目标包名的字段就被整条删掉;过窄 —— 不递归 `insert` 列表、没有别名兼容。同一个仓库里更好的口径在 `P/disable.rs:116-128`(把包内 `package.json` 的 `name` 也收进候选,测试 `:686-708` 锁定别名命中)。

**改法**:F1 回滚的行匹配(`proposal:313`)**只按行 id 精确匹配**,不得按值扫;F2 若要剥 bundle 条目,别名口径参考 `disable.rs` 而不是 `uninstall.rs`。落点 `patches/README.md:104-110` 的撤销操作表。

### R30 · 诊断输出必须确定性排序

参考实现从 `HashSet` 收集引用(`P/recovery/extract.rs:67`),再取 `.into_iter().next()`(`:105-109`)⇒ 日志里同时提到多个包时,展示哪个是**随机的**,同一份日志两次检测可能给出不同文案;测试只覆盖单引用(`:139-152`),多引用的不确定性无测试。

**改法**:诊断报告(`proposal:271-284`)与候选列表必须显式排序(按矩阵记录 id 或包名)。否则 §8 `:434` 的"定位率"不可复现,而"同一状态两次诊断给不同文案"会直接打掉 §5.6 想建立的信任。

### R31 · Windows 清单(参考实现踩过的五个坑)

| 坑 | 证据 | rescue 会在哪撞上 |
|---|---|---|
| fsync 必须 read+write 打开,否则 `ERROR_ACCESS_DENIED (os error 5)` | `P/snapshot.rs:253-259` | 写 `.bak` / state 时若要 fsync |
| 用户 pnpm 只接受 `.exe` —— CreateProcess 不能直接跑 `.cmd` / `.bat` | `P/verify.rs:193-196` | F2 装补丁包若自己 spawn pnpm |
| GUI 进程直接 spawn node 会闪黑窗;原始句柄非 `Send`,spawn + 读管道 + 等待必须整体塞进一个 `spawn_blocking` | `P/verify.rs:212-267` | 同上 |
| junction 与 symlink 要双重判定,否则把重解析点当普通目录**递归删进应用资源目录** | `P/recovery/uninstall.rs:75-80` | F2 卸载删目录时(profile 是 `nodeLinker: hoisted`,链接很多) |
| 文件被占用 ⇒ `rename` 失败 | `P/patch_guard.rs:119` + `desktop:test/patch-layer.test.ts:51-52` | F1 撤回改写 `cordis.patch.yml` |

**改法**:§9 风险表加一行"平台差异";m0 A5 的实测必须在 Windows 上跑一遍(本项目作者环境就是 Windows)。

### R32 · 不要做自动降级

参考实现全仓无崩溃计数器(grep `crash_count` / `consecutive` / `failure_count` / `restart_count` 零命中),安全模式只有用户显式入口(`lifecycle.rs:363-380`),唯一阈值是 `MAX_RECOVERY_ATTEMPTS = 3`。

**改法**:rescue 不要引入"连续失败 N 次自动降级 / 自动进入某种模式"。自动动作只保留 `proposal:394` 那一条 —— **自动还原自己刚写的东西**,且受 R22 的次数上限约束。理由与参考实现一致:误判成本(把一个还能用的 profile 降级掉)高于收益。

---

## 附录 · 可迁移清单与体积影响

| 参考实现的做法 | 证据 | 迁移到 rescue 的落点 | 体积代价 |
|---|---|---|---|
| 改前备份 + 结构化 manifest 两条腿 | `P/snapshot.rs:85-99,624-650` | R19 | `.bak` 是用户文件副本,不计入本体 |
| 同目录 tmp + rename,先 `.bak` | `P/patch_entries.rs:137-180,404-424` | R20 | ~20 行 |
| 三阶段切换 + 逐步反转 + 还原后实体核验 | `P/snapshot.rs:591-677` | R20 / R24 | ~40 行 |
| 意图先行的状态记录 | `P/disable.rs` 的两文件写入顺序 + 显式回滚 | R20 第 1 条 | ~30 行 |
| 唯一性闸门 `owners.len() == 1` | `P/recovery/ownership.rs:244,305` | R23 | 0(是判据不是代码) |
| 隔离优于删除 + 冲突加序号 | `P/patch_guard.rs:90-106,112-146` | R25 | ~15 行 |
| 兜底自身失效时硬失败 | `P/patch_guard.rs:57-66` + `lifecycle.rs:375-377` | R25 | 0 |
| 专用错误码 + 教动作的文案 | `zh-CN.json:107` | R25 | 文案 |
| 重试上限 + 转人工终态 | `S/types.ts:26`、`zh-CN.json:358` | R22 | ~10 行 |
| 恢复路径离线化(不依赖 node/pnpm/网络) | `P/recovery/mod.rs:12,160` | R21 | 0(是约束) |
| 兜底绕开被兜底的东西 | `P/safe.rs:1-4` | R21 | `undo.md` 生成 <1 KB |

**对 §3.1 预算的影响**:R19–R32 全部是写盘纪律、状态字段与文案,**0 个新增运行时依赖**;本体字节增量估 <3 KB(journal 三段式 ~40 行、哈希与 `.bak` 管理 ~30 行、state schema ~20 行)——【推断,未实测】,A8 实测时一并量。

**需要补进 §3.1 的一条**:`.bak` 落在 profile 目录,是用户文件的副本,不计入本体预算,但要有保留策略 —— 每条 applied 记录一份,还原成功后删;上限与淘汰规则同矩阵缓存(`proposal:212-213` 的"只保留当前与最近一份,超 300 KB 即淘汰"),否则长期运行会把用户 profile 塞满备份。

**新增 M0 断言**(续 [findings-round2.md](findings-round2.md) 的 A10 / A11):

- **A12 · 逃生舱**:在 rescue 被禁用或直接删除的情况下,仍能用一条不依赖 rescue 的命令把用户配置还原到应用前,还原后逐字节等价。不可行 ⇒ §3.2 的"还原 ≤2 击"与 `proposal:158` 必须降级为"rescue 在场时"。
- **A13 · 中断**:apply 进行到一半时 kill 进程,下次启动能检出未完成的 `intent` 并提供"继续 / 还原",且用户的 `cordis.patch.yml` 不留半截 YAML(判据:下次启动不多报语法错误)。
- **A5 判据补充**:并发编辑检测(mtime + 哈希比对)、rollback 幂等、`.bak` 缺失时报错而不猜。
