---
description: "dsh-plugin-rescue 方案 v0.1 每条机制性断言的源码核验台账。"
kind: "working-material"
---

# 源码证据台账

对方案 v0.1 每条机制性断言的核验结果。判定含义:**VERIFIED** 源码支持;**REFUTED** 源码与之矛盾;**PARTIAL** 部分成立但缺关键前置条件;**NOT-FOUND** 源码中不存在。

基线:`deepseek-harness` @ `4878cdabd8`(dsh `0.2.0-rc.1`)。

---

## 0. 附录 A 代码索引

17 条路径**全部存在**,无虚构引用。`vendor/cordis` 是上游 `cordis` 4.0.0-rc.7(`packages/core`,commit `56b3d4f725681cf4556c1a8695a709cc3b6eed74`)的重命名副本,发布为 `@deepseek-ai/cordis` 4.0.4(`vendor/cordis/package.json:2-4`,`vendor/README.md:17`)。

| # | 断言 | 判定 | 证据 |
|---|---|---|---|
| 0.1 | `evaluatePluginCompatibility` 位于 `plugin-compatibility.ts` | VERIFIED | `packages/boot/app-boot/src/plugin-compatibility.ts:61` |
| 0.2 | 该函数是**公开 API**,第三方可直接调用 | VERIFIED | `packages/boot/app-boot/src/index.ts:22` 公开再导出 |
| 0.3 | `prepareProfileEntries` / `prepareProfilePatches` 可用 | VERIFIED | `app-boot/src/index.ts:28` 公开再导出 |
| 0.4 | `setProfileVersionExemption` / `readProfileCompatibility` 可用 | VERIFIED | `app-boot/src/index.ts:24-25` 公开再导出 |
| 0.5 | `vendor/include/src/index.ts` 提供 `entryListSchema` / `applyEntryPatches` | VERIFIED | `vendor/include/src/index.ts:23,57` |
| 0.6 | 方案暗示 patch 支持"删行" | **REFUTED** | `vendor/include/src/index.ts:57-141` 只有 `insert` 与按 id 整值覆盖,**无 remove** |
| 0.7 | 附录 A 未收录已有的诊断服务与启动诊断文档 | PARTIAL | 缺 `packages/host/plugin-inventory/src/index.ts`、`apps/cli/reference/README.md:71-75` |

---

## 1. §1.2 / §2 / §5.2 · PENDING 是否静默

| # | 断言 | 判定 | 证据 |
|---|---|---|---|
| 1.1 | Cordis 层不满足 inject 时永远等待,无任何提示 | VERIFIED | `vendor/cordis/src/` 内无 `console.warn` / `logger.warn` / 超时 / 重试;无 `Inject` 类、无 `#markWaiting` 标志。`packages/client/AGENTS.md` 亦写明 "Unsatisfied \| stays PENDING, with no timeout" |
| 1.2 | 状态名为 `FiberState.PENDING` | VERIFIED | `vendor/cordis/src/fiber.ts:147-154`;PENDING 是 `_getState()` 派生态(`:574-579`),非标志位 |
| 1.3 | **「dsh 侧完全黑盒,用户连原因都看不到」** | **REFUTED** | `app-boot/src/index.ts:850-856` 计算未满足 key;`:881` 渲染 `id (name): pending (waiting for services: …)`;`:899-905` 打印 `Plugins waiting for services (N)` 表格 |
| 1.4 | 上述审计可被第三方复用 | VERIFIED | `auditStartupEntries` 是**公开导出**(`app-boot/src/index.ts:925`),可选插件走 `:938` 的 stderr warning |
| 1.5 | 客户端有等价审计 | VERIFIED | `packages/client/web/src/boot-client.ts:66-88` `assertEntriesActive`,非 active 即 throw |
| 1.6 | 官方文档已描述该输出 | VERIFIED | `apps/cli/reference/README.md:71-75`(含 `$DSH_HOME/logs/startup-*.log` 完整报告) |
| 1.7 | 官方教程已给出手工诊断配方 | VERIFIED | `docs/cordis-tutorial/06-composition-and-hmr.md:61-83`,`ctx.registry.values()` → `runtime.fibers` → `fiber.state === FiberState.PENDING` |
| 1.8 | 配置重算时会重新报告 inactive 条目 | VERIFIED | `packages/boot/hmr/src/index.ts:229-233` 把 `reconcileProfilePatches` 返回的诊断逐条 `logger.warn` |
| 1.9 | **真正静默的窗口:运行期提供者被释放** | VERIFIED | `vendor/cordis/src/reflect.ts:297-303` 的 provide disposer 只 `delete` + `notify`,依赖方退回 PENDING,**无审计钩子** |
| 1.10 | 外部可枚举 pending fiber 与未满足 key | VERIFIED | `RegistryService.values()/keys()/entries()/forEach()`(`vendor/cordis/src/registry.ts:270-291`);`Plugin.Runtime.fibers` 是公开字段(`registry.ts:140`)且可迭代(`utils.ts:33-35`);`fiber.state`、`public inject` 公开(`fiber.ts:194,225`) |
| 1.11 | 无需访问私有 `_store` | VERIFIED | 公开过滤式为 `Object.keys(fiber.inject).filter(k => fiber.ctx.get(k) === undefined)`,与 in-tree 实现一致 |

---

## 2. §5.2 · 诊断器接口形态

| # | 断言 | 判定 | 证据 |
|---|---|---|---|
| 2.1 | D4「参照 `cordis_inspect` 的 introspection 思路」 | **PARTIAL** | `cordis_inspect_list` / `cordis_inspect_query`(`packages/extensions/tool-cordis/src/index.ts:23,42`)服务的是**静态生成的 API 目录**(`src/api-catalog.ts:6`),不是运行实例的自省。判断"引用了不存在的导出"应以安装实例为准,参照物是 `RuntimeResolutionEntry`(`name`/`packageDir`/`version`,`app-boot/src/profile.ts:125-136`) |
| 2.2 | D2 需从零实现 registry 扫描 | **REFUTED** | 已实现两处:`app-boot/src/index.ts:850-856`、`client/web/src/boot-client.ts:79-81` |
| 2.3 | 活体插件清单需自建 | **REFUTED** | `readPluginInventory(ctx)` 已公开导出(`packages/host/plugin-inventory/src/index.ts:82`),带 `fiberPhase`(`:93`);`PluginInventoryGateway` 提供 `pluginInventory/list` Remote(`:70-73`);`plugin-manager/src/index.ts:258` 已在消费 |
| 2.4 | 已有页面渲染该清单 | VERIFIED | `packages/client/ui-plugin-manager/README.md:14,30`;另有 `packages/client/ui-settings-plugin-inventory` |
| 2.5 | 该清单缺"未满足 inject key" | VERIFIED | `plugin-inventory/README.md:103-105` 自陈缺口:无层级归属、无变更能力、缺失 root fiber 一律报 `null` |
| 2.6 | 持续观测(状态迁移通知)已有实现 | **NOT-FOUND** | 每次迁移发 `internal/status`(`vendor/cordis/src/fiber.ts:586`),但仓库内无持续订阅消费者。**这是 D2 唯一真空白** |

---

## 3. §5.3 F0 · allow(有依据豁免)

| # | 断言 | 判定 | 证据 |
|---|---|---|---|
| 3.1 | `setProfileVersionExemption` 可直接调用写入 | PARTIAL | `profile-compatibility.ts:113` 是公开导出,但写入前有硬性约束 |
| 3.2 | **豁免不需要 `acceptRisk`** | **REFUTED** | `profile-compatibility.ts:117-119`:`if (enabled && !acceptRisk) throw`;`:121-123` 还要求 `runtimeVersion === current` |
| 3.3 | 矩阵出处可以写进 `compatibility.json` | **REFUTED** | 文件结构是扁平的 `Record<string, string[]>`(`:42-45,78-91`),只有 `package@version` → dsh 版本列表,**无备注字段** |
| 3.4 | 可安全直接改写该文件 | **REFUTED** | 任一记录被判废即 `rewritable: false`(`:92`),授予/撤销会 `throw` 要求用户手工修复(`:128-130`);写入用 `withFileLock` + `writeFileAtomic`(`:126-139`) |
| 3.5 | 写完即生效 | **REFUTED** | `:109` 明写 "Existing plugin instances are not reloaded by this operation";须走 `PluginManager.setVersionExemption`,它接 `reload()`(`plugin-manager/src/index.ts:245-249`) |
| 3.6 | 豁免可跨版本继承 | **REFUTED** | 精确 `package@version` → 精确 dsh 版本;插件升级与 dsh 升级均不继承(`plugin-manager/README.md:65`,`app-boot/README.md:56`) |
| 3.7 | 类别 2(`peer-range-stale`)可用 allow 修复 | **PARTIAL** | 豁免只解锁预检(`compatibility-preflight.ts:101-118`),不改变运行时行为;真不兼容的插件仍会坏 |
| 3.8 | 预检只对 peer 冲突禁用行 | VERIFIED | `compatibility-preflight.ts:101-118`;`deny()` 仅在 `denial()` 返回非空时调用 |
| 3.9 | 预检在组合边界执行,坏插件不会被 import | VERIFIED | `app-boot/README.md:54`;`prepareProfilePatches` 在 root Include 挂载时与每次重算时运行 |

---

## 4. §5.3 F1 · config-patch

| # | 断言 | 判定 | 证据 |
|---|---|---|---|
| 4.1 | **「补丁层本就支持按 id 替换整行配置,纯数据变更,最安全」** | **PARTIAL** | 按 id 整值覆盖为 VERIFIED(`vendor/include/src/index.ts:120-123` `target[key] = value`);"纯数据"为 REFUTED,见 4.2–4.4 |
| 4.2 | patch 深度合并 config 键 | **REFUTED** | `docs/user/develop/basic/publish.md:129-131`:"a patch replaces a row's entire `config` value rather than deep-merging keys",且必须复述该行需要的每个键 |
| 4.3 | Config 可含表达式 | VERIFIED | `vendor/include/src/index.ts:9-23`:`entryListSchema = yaml.JSON_SCHEMA.extend(JsExpr)`,`!!js` 标量成为惰性标记 `{ "__jsExpr": … }` |
| 4.4 | 表达式在运行时求值,引用已删服务会失败 | VERIFIED | `vendor/loader/src/config/entry.ts:169` `resolveConfig(...)`;`app-boot/src/index.ts:830` 把抛错的 `disabled` 表达式记为 entry 失败,phase `disabled expression failed` |
| 4.5 | 用普通 YAML 库往返不会破坏标记 | **REFUTED** | 必须使用 `entryListSchema`;否则标记丢失或被求值(`vendor/include/src/index.ts:12-14`) |
| 4.6 | 回滚可"删行" | **REFUTED** | patch 语言无 remove(`vendor/include/src/index.ts:57-141`);删除 = 重写用户文件 |
| 4.7 | 落 profile 层即最终生效 | **REFUTED** | 层序:bundles → profile `cordis.patch.yml` → **`$DSH_HOME/cordis.patch.yml`** → `--patch`(`app-boot/src/profile-context.ts:65-70`;`apps/cli/reference/README.md:9`)。home 层与 `--patch` 会压过 profile 层 |
| 4.8 | 用户 patch 文件是可安全重写的结构化文件 | **REFUTED** | 模板带说明注释(`app-boot/src/profile.ts:220-224`),且可能被用户并发编辑 |

---

## 5. §5.3 F2 · shim

| # | 断言 | 判定 | 证据 |
|---|---|---|---|
| 5.1 | Cordis 的 inject 语义是"等服务出现",shim 注册后 PENDING fiber 就地解挂 | VERIFIED | `vendor/cordis/src/reflect.ts:294-296`(`state === ACTIVE` 时 `notify`)、`:314-336`(`notify` 遍历 `ctx.registry.values()` → `runtime.fibers`,对每个跑 `_checkImpl` + `_refresh`);`Service` 子类经 `ctx.reflect.provide` 注册(`service.ts:57`) |
| 5.2 | 解挂是无条件的、即时的 | **REFUTED** | 异步(`fiber.ts:650` 先 `await` 一个微任务,`:654` 重查 epoch);提供者未达 ACTIVE 时 `_getImpl(name, true)` 拒绝该实现(`reflect.ts:241`);提供者在自己 setup 中注册时看到 `LOADING`,立即 notify 被跳过,改由 `LOADING→ACTIVE` 分支恢复(`fiber.ts:588-594`) |
| 5.3 | 与 isolate 无关 | **REFUTED** | `notify` 的默认过滤器比较 isolate label(`reflect.ts:314`),不同 label 下的 fiber 收不到通知 |
| 5.4 | shim 覆盖已有服务不会有问题 | **REFUTED** | `vendor/cordis/src/reflect.ts:290`:`service "X" has been registered at <name>` 直接抛;`:260-262` 的 `ReflectService.set` 也拒绝跨 fiber 写入 |
| 5.5 | 向 `<profile>/cordis.patch.yml` 插入的行会被热挂载 | VERIFIED | `packages/boot/hmr/src/index.ts:214-236` 注册配置监听(该文件 + `$DSH_HOME/cordis.patch.yml` + profile manifest);`:229-233` 调 `reconcileProfilePatches`;`app-boot/src/index.ts:289` `entry.update`;`vendor/include/src/index.ts:190-201` 就地 `this.root.update(...)`;测试 `packages/boot/hmr/tests/profile.spec.ts:117-127` |
| 5.6 | 上述热挂载无前置条件 | **REFUTED** | (a) HMR 在 headless / sdk / acp 默认关闭(`packages/boot/hmr/README.md:27`;`packages/bundle/base/cordis.patch.yml:27-32`);(b) 启动时算出的 `RuntimeResolution` 不因配置刷新重算,shim 必须当场可解析;(c) 该行须通过兼容预检;(d) 其 inject 须可满足 |
| 5.7 | 安装新包是热生效 | VERIFIED | `plugin-manager/src/index.ts:561` 的 `restart-required` 只在 `Object.hasOwn(before, name)` 即该名字原本已是依赖时返回;新装继续走 `:562` 的 `reload()` |
| 5.8 | 版本替换是热生效 | **REFUTED** | `packages/boot/hmr/README.md:89`:"Replacing installed package versions still requires a restart through Plugin Manager" |
| 5.9 | interception 保证 shim 与宿主共享唯一 dsh 实例 | VERIFIED | `installRuntimeInterception`(`app-boot/src/profile-resolution/resolver.ts:709`)改写 Node 内建解析器(`resolver.ts:613-653` 取得 `internal/modules/esm/loader`、`cjs/loader`、`esm/resolve`;`:773-809` 包 `esm.resolveSync`/`resolve`;`:811,856-908` 包 `cjs.Module._resolveFilename`) |
| 5.10 | 运行时 resolution 覆盖运行时安装表 | VERIFIED | `createRuntimeResolution`(`app-boot/src/profile.ts:431-464`)= 安装依赖与 peer 的 BFS(`:363-414`)+ bundle 携带闭包(`:526-537`)+ profile 本地依赖(`:478-482`)+ 外部链接根(`:306-334`) |
| 5.11 | 表外说明符无法解析 | **REFUTED** | `resolver.ts:507-521`:profile 层未命中走 `native-after-interception`,链接层未命中返回 `{kind:'native'}`;表只覆盖 Node 本会做的选择 |
| 5.12 | 装 shim 的正规路径是"在用户 patch 里插一行" | **PARTIAL** | 文档化路径是 shim 声明 `dsh.bundle` 后由 `dsh plugin` 追加进 `dsh.profile.bundles`(`docs/user/develop/basic/publish.md:59-64,83-100`;`plugin-manager/src/index.ts:715-735` `selectBundle`),可逆性由 `removeBundle` 提供。手工插行会绕过 `protectsManager` 与安装期 `incompatible-version` 检查(`:546-547`) |

---

## 6. §6 决策 1 · 旧版类型包作编译期契约

| # | 断言 | 判定 | 证据 |
|---|---|---|---|
| 6.1 | 官方建议共享实例的 dsh 包同时写进 peer 与 devDependencies | VERIFIED | `docs/user/develop/basic/publish.md:103` |
| 6.2 | 运行时 resolution 中已有的 peer 会用安装里的副本 | VERIFIED | 同上:"peers present in the running dsh's runtime resolution use the installation's copy; the devDependency copy serves your type checker" |
| 6.3 | **shim 把旧范围写进 peerDependencies 不影响门禁** | **REFUTED** | `plugin-compatibility.ts:75-80` 只认 `@deepseek-ai/dsh` / `@deepseek-ai/dsh-*` peer;不满足即冲突 → `compatibility-preflight.ts:101-118` 置 `disabled: true` 并打 `disabling profile plugin …` → **shim 在加载前被禁用,修复永不生效** |
| 6.4 | devDependency 里的旧副本不参与运行时解析 | VERIFIED | 文档明述 devDependency 副本"供类型检查与独立测试"(`publish.md:103`);该位置无 peer 声明、无物理包,解析回落到 profile/installation 表 |
| 6.5 | 旧副本若被物理安装或声明为 peer,仍能拿到单实例 | **PARTIAL(高风险,需 M0 实测)** | 解析的 linked-root / peer 优先级会让导入改走 shim 自己的祖先副本,丢掉单实例保证(见 [m0-assertions.md](m0-assertions.md) A2) |
| 6.6 | 该技巧的机制来源 | VERIFIED | profile 生成的 `pnpm-workspace.yaml` 为 `nodeLinker: hoisted` + `autoInstallPeers: false`(`app-boot/src/profile.ts:230-235`),缺失 peer 由 runtime resolution 兜底 |

---

## 7. §2 失效类别表

| # | 断言 | 判定 | 证据 |
|---|---|---|---|
| 7.1 | 类别 3 症状是"Config 校验失败,入口行被禁用" | **PARTIAL** | "被禁用"为 REFUTED:预检只对 peer 冲突置 `disabled`(`compatibility-preflight.ts:101-118`)。Config 校验发生在 entry 初始化(`vendor/loader/src/config/entry.ts:169`),表现为 **failed fiber** |
| 7.2 | 免启动检测器可用 | VERIFIED | `--dump-config` 带"哪个文件提供了这一行"的溯源注释;`--dump-config-schema` 输出逐行状态与 `configRef`(`apps/cli/reference/README.md:51,54-68`) |
| 7.3 | 类别表覆盖全部高影响静默失效 | **REFUTED** | 缺 6 类,见 [findings.md](findings.md) B4 |
| 7.4 | native include 触到不兼容插件时的行为 | VERIFIED(方案未记) | `compatibility-preflight.ts:129-137,160-163`:Include 文件一旦触到被拒插件,**整个文件整份被拒**,因为该文件永不被重写 |
| 7.5 | bundle 被跳过时的行为 | VERIFIED(方案未记) | `app-boot/src/profile.ts:666-683` 收集进 `skippedBundles`,`reportSkippedBundles`(`:118-122`)每次启动打一行;该 bundle 贡献的全部行一起消失 |
| 7.6 | dsh 包被解析出第二份实例是已知失效面 | VERIFIED(方案未记) | `.agents/notes/implemented/architecture/2026-09-08-desktop-bundled-runtime-and-external-plugins.md`:"a plugin can resolve another installed copy; incompatible plugins may fail during Host startup" |
| 7.7 | import 失败无 fiber 的现有归类 | VERIFIED(方案未记) | `app-boot/src/index.ts:836`:`outcome: { kind: 'failed', error: 'failed to import' }` |

---

## 8. §5.3 / §5.4 · 应用流程、复检与信任

| # | 断言 | 判定 | 证据 |
|---|---|---|---|
| 8.1 | 「修复后 doctor 复检(恢复 OK 才标记成功)」需自建 | **REFUTED** | `reconcileProfilePatches`(`app-boot/src/index.ts:273-302`)已实现:快照前态 inactive 条目(`:278-280`)→ 应用 → `loader.await()` → 重审(`:292`)→ **新增或变化条目即 throw**(`:293-296`)→ 返回当前诊断(`:301`) |
| 8.2 | plugin manager 已走该复检 | VERIFIED | `plugin-manager/src/index.ts:756-765` `configure` / `reload` 全部经 `reconcileProfilePatches`,并区分"既有无关失败"与"新发失败" |
| 8.3 | HMR 与插件管理串行化 | VERIFIED | `packages/boot/hmr/src/index.ts:139-147` `runExclusive`;`plugin-manager/src/index.ts:756-760` 在其中执行管理写入 |
| 8.4 | 批准通道需自建 | PARTIAL | 已有一套:`plugin_manager` 每次动作要求 `danger-full-access` 或逐次批准(`plugin-manager/README.md:31`);`setVersionExemption` 另需 `acceptRisk` 且"服务只检查确认与版本,不检查会话历史"(`:65`) |
| 8.5 | 信任模型已覆盖"安装即执行代码"时刻 | **REFUTED(方案未提)** | git 源包会跑 `prepare`,pnpm ≥10 需用户在 `<profile>/pnpm-workspace.yaml` 的 `allowBuilds` 放行;`dsh` 已指路(`apps/cli/src/plugin.ts:81-83`;`docs/user/develop/basic/publish.md:159-179`) |
| 8.6 | 诊断报告可自由生成 | **REFUTED** | 官方报告明确警告原始插件错误可能含配置或凭据且**值不脱敏**(`apps/cli/reference/README.md:75`) |
| 8.7 | 存在内存态挂载通道可做试运行 | VERIFIED(方案未提) | `packages/extensions/cordis-host-runner/README.md:12,46,50`:host-only 定义"在本进程激活",但"session-scoped and process-local … restart clears them" |
| 8.8 | Web 侧 UI 成本高于方案估计 | **REFUTED** | 已有 Plugins 页与 Settings 只读清单(`ui-plugin-manager/README.md:14,30`);社区插件可注册自己的配置页(`.agents/notes/implemented/architecture/2026-09-17-settings-pages-as-companion-packages.md`:`plugins.bundle.config` / `plugins.row.config` 插槽 + `ctx.settingsScope`) |

---

## 9. §5.1 矩阵 · 版本与证据

| # | 断言 | 判定 | 证据 |
|---|---|---|---|
| 9.1 | 矩阵可按 harness 版本区间匹配 | VERIFIED | `plugin-compatibility.ts:44-48` `getDshRuntimeVersion()` 读 app-boot 版本;`:77` `semver.satisfies(runtimeVersion, requirement, { includePrerelease: true })` |
| 9.2 | `">=0.2.0 <0.3.0"` 不会匹配预发布 | **REFUTED** | `includePrerelease: true` 使 `0.2.0-rc.1` 落入该区间 —— 恰是方案自己的示例输出(`harness 0.2.0-rc.1`) |
| 9.3 | 仓库已有可复用的版本间类型快照 | VERIFIED(方案未提) | `docs/persistence-changes/releases/README.md`:26 个发布 tag、25 次相邻转换的完整类型快照 |
| 9.4 | 矩阵只需记录"坏"的一侧 | **PARTIAL** | `false-block` 的证据本身是"实测兼容"(`附录 B` BRK-2026-0087 `confidence: verified`),需要正向记录承载 |
| 9.5 | 记录会随 harness 升级自动失效 | **REFUTED(方案无规则)** | 区间到 `<0.3.0` 即不匹配,但已装 shim 仍在树上;叠加 `reflect.ts:290` 的注册冲突抛错,过期 shim 会把静默 PENDING 变成启动失败 |

---

## 10. §5.2 / §8 · 报告与度量

| # | 断言 | 判定 | 证据 |
|---|---|---|---|
| 10.1 | doctor 需自建报告文件 | **REFUTED** | 启动期已有 `$DSH_HOME/logs/startup-<ts>-<uuid>.log`,含"每个未激活插件的模块与状态"(`apps/cli/reference/README.md:71-75`;`apps/cli/src/startup-diagnostics.ts:59`) |
| 10.2 | doctor 可在启动期自行报告 | **PARTIAL** | `auditStartupEntries` 在 `boot()` 末尾执行(`app-boot/src/index.ts:1012`);一个自身 PENDING 的插件无法报告自己 → 需"启动期读日志 + 运行期 in-process 服务"两段式 |
| 10.3 | 「诊断定位率 ≥80%」可度量 | **NOT-FOUND** | 方案未定义采集口径;可绑到 `reconcileProfilePatches` 返回值与 rescue state 文件 |
| 10.4 | 「误修率 0」可度量 | **NOT-FOUND** | 同上;且必须强制"落盘后复检通过才算成功"才有意义(§5.3 流程已含该步,但未定义记录方式) |
