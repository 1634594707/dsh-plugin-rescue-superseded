---
description: "补丁规格:一个 dsh 补丁是什么、多大、由谁审、怎么写、怎么撤。"
kind: "specification"
---

# 补丁规格

模型参照游戏 mod 补丁:**本体不打补丁,补丁是旁挂的最小差异;补丁管理器裁定兼容性;一键装卸还原;冲突必须报错而不是猜。**

## 一个补丁是什么

补丁 = **一条"这里原来是什么"的声明 + 一段把它接回去的适配**。它不复现被删掉的功能,只把旧名字重新指回新名字。

```text
补丁 = { 补什么(指纹) + 做什么(适配) + 需要什么(前置条件) + 碰了什么(可回滚依据) }
```

"补什么"必须能与诊断器观察到的状态对上,而不是靠用户描述。指纹取自 [matrix-v2.yaml](../review/matrix-v2.yaml) 的 `vocabulary.detection`。

## 四种形态与体量

| 形态 | 补什么 | 适配内容 | 体量预算 |
|---|---|---|---|
| **key 桩** `service-key-removed` / `provider-disposed-runtime` | 一个被删掉或被释放的服务 key | `ctx.reflect.provide(旧名, 指向新服务的适配对象)` | 1–3 KB |
| **调用适配** `service-api-changed` / `tool-api-changed` | 旧签名或旧注册 API | 包一层,把旧调用翻译成新调用 | 2–8 KB |
| **事件桥接** `event-contract-changed` | 改名或改载荷的事件 | 旧名 → 新名 的重订阅,载荷按映射表转译 | 2–5 KB |
| **配置覆盖** `config-schema-changed` | 旧字段名 | 一条按行 id 的整值覆盖 | 200 B–2 KB |

后三者本质上都是数据 + 很薄的代码。体量是预算,不是实测值 —— [M0](../review/m0-assertions.md) 的 A8 负责量出来。

## 硬性约束

写补丁时必须同时满足,否则评审不通过:

1. **peer 声明宽范围。** 需要共享实例的 dsh 包写 **peer**,范围必须**始终包含当前运行时**(如 `>=0.1.0 <0.3.0`)。旧类型只进 `devDependencies`,且运行时**不得物理安装**旧包。照官方教程把旧范围写进 peer 会让补丁在加载前被兼容预检禁用(`compatibility-preflight.ts:101-118`),修复根本不生效。
2. **零新增运行时依赖。** 补丁只 import peer。
3. **可撤。** 补丁占用的服务注册、写入的配置覆盖、装的包,都要能被逆操作干净还原。`ctx.reflect.provide` 返回的 disposer 天然是 fiber effect,随插件卸载一起消失(`vendor/cordis/src/reflect.ts:277-304`)。
4. **不猜。** 补丁只在矩阵记录明确覆盖当前 harness 区间时启用;区间不覆盖就不加载,并把决定交给用户。
5. **会过期。** 官方发布了真实提供者后,`ctx.reflect.provide` 抛 `service "X" has been registered at <name>"`(`reflect.ts:289-291`),补丁会把静默 PENDING 变成 profile 起不来。因此每个补丁必须在**启动前**自检并能自行禁用,见 proposal §5.5。
6. **顺序敏感的原语禁用。** 事件桥接不得裸用 `prepend: true`;需要时只走 补丁 kit 提供的受控桥接原语,并在 补丁 kit 的评审清单里登记特例。
7. **新旧两版都要测。** 每个补丁带针对新旧两个 harness 版本的行为测试;只在新版上测过的补丁不给发布。

## 冲突规则

游戏 mod 管理器的核心体验是"冲突要报错"。rescue 对应:

| 冲突 | 处置 |
|---|---|
| 两个补丁补同一个 key | **拒绝应用**,报出两个补丁 id,由人裁决。不按 confidence 自动择一 |
| 补丁补的 key 已被真实提供者占用 | 视为过期,**禁用补丁**(不删除),报 `patch-stale` |
| 两个补丁改同一行的配置 | 拒绝应用 |
| 矩阵两条记录指纹重叠 | 报冲突,矩阵维护者在评审期解决 |

## 分发与信任

- 补丁**独立成包、一补丁一包**,逐包评审 + npm provenance;rescue 本体**不把它固定为依赖**,否则每次加补丁都要发主包版本,与"逐包评审"矛盾;
- 矩阵只装数据、无代码、无 install script —— 从 git 装会触发 `prepare`,pnpm ≥10 要求用户在 `<profile>/pnpm-workspace.yaml` 的 `allowBuilds` 放行,那才是真正的"安装即执行代码"时刻;
- 应用补丁一律要用户显式批准,且批准走 `plugin_manager` 已有的权限通道,不叠第二套同意面;
- `confidence: reported` 的补丁提示明确标注"社区上报,未复核"。

## 怎么写

以 `service-key-removed` 为例。矩阵记录(节选自 [matrix-v2.yaml](../review/matrix-v2.yaml) 的示例)给出指纹与前置条件:

```yaml
- id: BRK-2026-0142
  state: broken
  harness: ">=0.2.0 <0.3.0"
  plugin: { name: "@community/foo-tools", versions: "<=1.4.2" }
  failure: service-key-removed
  detection: { pendingService: fooLegacy, fiberState: pending, moduleName: "@community/foo-tools" }
  confidence: verified
  verifiedOn: "0.2.0-rc.1"
  fix: { kind: patch, ref: "@dsh-rescue/patch-foo-legacy@^1.0.0" }
  requires: { hmrEnabled: true, moduleResolves: true, preflightPasses: true, injectSatisfiable: true }
  restartRequired: false
```

补丁本体就是"提供那个 key,并委托给新服务":

```ts
export const name = '@dsh-rescue/patch-foo-legacy'

// 声明它依赖新的服务 —— 这些是 dsh 0.2 提供的,不是它自己造出来的
export const inject = ['foo', 'fooPolicy']

export function apply(ctx) {
  // provide 返回 disposer,并注册为 fiber effect:卸载时连带消失
  return ctx.reflect.provide('fooLegacy', {
    // 旧插件要的形状,新服务的数据
    async run(spec) { return ctx.foo.run(spec) },
    // 旧字段 → 新字段
    limits() { return ctx.fooPolicy.limits() },
  })
}
```

这就是全部。没有重新实现 `foo`,没有条件分支去猜行为,没有依赖表。

完整可运行样例(含 package.json、生命周期、边界情形)见 [example-foo-legacy.md](example-foo-legacy.md)。

## 怎么撤

| 撤的对象 | 操作 |
|---|---|
| key 桩 | 卸载补丁插件 → disposer 释放注册 → 依赖方退回 PENDING(无报错) |
| 调用适配 / 事件桥接 | 同上 |
| 配置覆盖 | **再次按行 id 覆盖回原值**,不是删行 —— patch 语言没有 remove 操作(`vendor/include/src/index.ts:57-141`) |
| 版本豁免 | `pluginManager.setVersionExemption(..., enabled: false)` |
| 补丁包 | `dsh plugin remove`;bundle 层从 `dsh.profile.bundles` 摘除 |

rescue 自己维护的 `$DSH_HOME/profiles/<name>/.plugin-rescue/` 只记录**意图**;用户层的文件永远是唯一事实来源。
