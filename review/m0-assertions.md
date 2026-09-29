---
description: "dsh-plugin-rescue M0 阶段的硬断言清单:每条含验证方法、通过判据与失败时的替代路径。"
kind: "working-material"
---

# M0 硬断言清单

方案 v0.1 的 M0(1–2 周)验证三件事。本清单在此之上补入 [findings.md](findings.md) 揭示的**必须先证伪或证实**的机制断言 —— 它们决定 M1 的范围是否成立,不能留到 M1。v0.3 另加两条与体积、离线相关的断言,合计九条(A1–A9)。

每条给出:验证方法、通过判据、**不可行时的替代路径**。M0 的交付物是"每项有可运行 demo 或书面结论(含'不可行'结论与替代路径)"(方案 §8),清单即该交付物的验收表。

---

## 原有三项

### S1 registry/fiber 能否枚举 PENDING 插件与未满足 inject key

- **方法**:起一个 profile,挂一个 `inject: ['fooLegacy']` 且无人提供该服务的插件,运行方案 `docs/cordis-tutorial/06-composition-and-hmr.md:61-83` 的配方。
- **判据**:能枚举到该 fiber,并能读出 `fooLegacy`。
- **已知**:可行。`RegistryService.values()`(`vendor/cordis/src/registry.ts:270-291`)+ `Plugin.Runtime.fibers`(`:140`,`utils.ts:33-35`)+ `fiber.state` / `public inject`(`fiber.ts:194,225`)。**建议把 S1 缩减为"与 `auditStartupEntries`(`app-boot/src/index.ts:925`)和 `readPluginInventory`(`plugin-inventory/src/index.ts:82`)的输出对齐"**,而不是重做一遍。

### S2 类型面 diff 能否产出可用失效候选

- **方法**:对比相邻两个 harness 版本的 `lib/types` 导出面。
- **判据**:产出可人工确认的候选清单。
- **修正**:**先查 `docs/persistence-changes/releases/`** —— 已有 26 个 tag、25 次相邻转换的完整类型快照(findings.md B9)。S2 应缩为"评估既有快照能否直接映射到矩阵的 `vocabulary.failure`",自建 diff 管道降为备选。

### S3 补丁行生成 → HMR 热应用 → shim 挂载解挂 PENDING

- **判据**:端到端跑通,坏插件状态从 pending 变为 active。
- **已知**:行级热挂载可行(`hmr/src/index.ts:214-236` → `:229-233`;`app-boot/src/index.ts:289`;测试 `hmr/tests/profile.spec.ts:117-127`)。S3 的真正未知量是下面的 A1–A4。

---

## 新增四条(决定 M1 是否成立)

### A1 shim 的 peer 范围必须宽到能通过预检 ⚠️ 最高优先级

- **断言**:一个为旧版 dsh 包编译的 shim,若按官方教程把旧范围写进 `peerDependencies`,会在**加载前被禁用**。
- **方法**:按 `docs/user/develop/basic/publish.md:103` 写一个 shim(旧范围同时进 peer 与 devDependencies),装进 profile,启动,观察 stderr 有无 `disabling profile plugin …`。
- **判据**:出现该行 → 断言成立。正确写法是 peer 声明**始终包含当前运行时的宽范围**,旧类型只在 devDependencies,且运行时不得物理安装旧包(`plugin-compatibility.ts:75-80`;`compatibility-preflight.ts:101-118`)。
- **不可行时**:shim 不再自编译,而是**以纯 JS 手写并只依赖 dsh 的公开运行时表面**;`fix.kind` 降级为需要人工核对的 `manual`。

### A2 旧类型副本不会破坏单实例

- **断言**:devDependencies 里的旧副本不参与运行时解析,shim 拿到的仍是安装里的唯一实例。
- **方法**:在 shim 里对某 dsh 服务类做 `instanceof`,同时让宿主也持有该实例,检查是否同一引用;再用 `ctx.reflect` 观察注册来源。
- **判据**:同一引用 → 通过。**若解析改走 shim 自己的祖先副本,单实例保证即失效**(`findings.md` A4 第二点,证据待实测)。
- **不可行时**:shim 不得 import 任何 dsh 包的**值**,只能通过 `ctx.get(name)` 拿已注册的服务(服务键 + 调用约定走矩阵数据描述)。这会让 shim 从"翻译代码"退化为"数据驱动的桩",能力下降但仍可修 PENDING。

### A3 shim 挂载的四个前置条件

- **断言**:行级热挂载只在 HMR 启用、模块当场可解析、通过兼容预检、inject 可满足时成立。
- **方法**:分别在 `web` 与 `headless` profile 各跑一遍。`headless` 的 HMR 在 bundle 层被关闭(`packages/boot/hmr/README.md:27`),预期**不热生效**。
- **判据**:`web` 生效、`headless` 不生效且报告为 `restart-required`(`matrix-v1.schema.yaml` 的 `restartRequired` 字段)。
- **不可行时**:fixer 把"需重启"作为一等结果,不再承诺热应用;M1 的"分钟级恢复"承诺相应收窄。

### A4 注册冲突的抛错与规避

- **断言**:过期 shim 撞上官方新发布的真实提供者时,`provide` 抛 `service "X" has been registered at <shim>`,profile 起不来(`vendor/cordis/src/reflect.ts:290`)。
- **方法**:先让 shim 占用一个 key,再挂一个同样注册该 key 的插件。
- **判据**:抛出该错误 → 断言成立。
- **必须一并验证的规避手段**:shim 在矩阵记录不再覆盖当前 runtime 时**启动前禁用自己**。这是 [findings.md](findings.md) B1 的核心,也是 F2 唯一的真实风险控制点。

---

## 建议追加

### A5 回滚在真实 profile 上可逆

- **断言**:patch 语言没有 remove 操作(`vendor/include/src/index.ts:57-141`),"删 shim 行"实为重写用户的 `cordis.patch.yml`。
- **方法**:在装有用户自定义注释与 `!!js` 表达式的 profile 上执行一次 F1 应用与回滚。
- **判据**:注释不丢、`!!js` 标记不丢(`entryListSchema`,`vendor/include/src/index.ts:9-23`)、用户并发编辑不被覆盖。
- **不可行时**:回滚改为**按 id 置 `disabled: true`**(整值覆盖,不动行集合),并接受"文件里会留下 rescue 注释过的行"。

### A6 试运行通道可用

- **断言**:`cordis-host-runner` 的 host-only 定义能在本进程挂载 shim 而不落盘(`packages/extensions/cordis-host-runner/README.md:12,46,50`)。
- **判据**:内存挂载后坏插件由 pending 转 active,重启后消失。
- **价值**:作为 F2 的前置验证与"修复后复检"的第一步(findings.md B13)。

### A7 脱敏姿态

- **断言**:官方诊断日志明示原始插件错误**不脱敏**、可能含凭据(`apps/cli/reference/README.md:75`)。
- **判据**:确定 doctor 是否自写报告文件;若写,给出字段级脱敏清单;若读既有报告,说明它继承同一风险并提示用户分享前检查。

### A8 体积基线(v0.3 新增)

- **断言**:rescue 本体能压进 §3.1 的预算,且**不需要任何新增 `dependencies`**。
- **方法**:搭一个只含 doctor + patcher 编排层的空壳包,manifest 只写 peer(`@deepseek-ai/cordis`、`@deepseek-ai/cordis-plugin-include`、`@deepseek-ai/dsh-app-boot`、`@deepseek-ai/dsh-plugin-manager`),`pnpm pack` 后量 `lib/index.js` 字节数;再用样例补丁 [patches/example-foo-legacy.md](../patches/example-foo-legacy.md) 量单补丁产物。
- **判据**:本体 ≤ 100 KB、单补丁 ≤ 10 KB、`dependencies` 段为空、解析出的依赖树里没有可打包的第三方库。
- **依据**:`entryListSchema` 来自公开发布的 vendored 成员(`vendor/include/package.json` 的 `publishConfig.access: public`),以 peer 引用即可白嫖宿主的 YAML 往返,不必自带 js-yaml。
- **超预算时**:先砍能力而不是压缩字节 —— D4/D5 已是 M3,矩阵分类可以退化为"只报失效类别不报修法",把字节让给 D2 持续观测(它是唯一真空白)。**预算不允许通过引入依赖来达成。**

### A9 离线降级(v0.3 新增)

- **断言**:矩阵取不到时,D1/D2/D3/D6 仍然给出结果,只有 classification 与 fixes 消失。
- **方法**:在 `delivery.offlineOnly: true` 下(或直接断网)跑一个已知失效 profile 的诊断。
- **判据**:报告仍然列出"哪个插件、什么状态、缺哪些服务";"属于哪类失效/有没有修法"一栏明确标注"需要联网获取修复建议 —— 离线不是插件没坏",而不是静默留空或整份报告失败。
- **不可行时**:说明分层被破坏了 —— 诊断器里混进了读矩阵的代码路径,必须先把它拆开再继续 M1。这是 G6 与可用性的交点,不是可以延后的优化。
