---
description: "一个完整补丁的样例:矩阵记录、源码、manifest、生命周期、边界情形与体量实测口径。"
kind: "worked-example"
---

# 样例补丁:`@dsh-rescue/patch-foo-legacy`

补的是**类别 5 `service-key-removed`**:dsh 0.2.0 把 `ctx.fooLegacy` 拆成 `ctx.foo` 与 `ctx.fooPolicy`,凡是 `inject: ['fooLegacy']` 的社区插件停在 PENDING。

本文是 [patches/README.md](README.md) 规格的完整实例。**矩阵记录与插件名是示例**,方法可迁移到任何同类失效。

## 1. 矩阵记录

```yaml
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
  requires: { hmrEnabled: true, moduleResolves: true, preflightPasses: true, injectSatisfiable: true }
  restartRequired: false
  notes:
    - "0.2.0 将 ctx.fooLegacy 拆分为 ctx.foo 与 ctx.fooPolicy"
  source: "issue #123;types-diff 0.1.x→0.2.0"
```

`detection` 三个字段缺一不可:`pendingService` 是类别 5 与类别 6(`service-key-scope-mismatch`)的唯一区别,`fiberState` 排除"已 failed",`moduleName` 把补丁绑到具体插件而不是一个通用 key。

## 2. 补丁源码

```ts
// src/index.ts
/**
 * 把被 0.2.0 拆掉的 ctx.fooLegacy 重新提供给依赖它的旧插件。
 * 不重新实现 foo:所有行为委托给 0.2 的服务。
 */
export const name = '@dsh-rescue/patch-foo-legacy'

/** 这些服务由宿主提供。补丁只依赖它们,不 import 任何 dsh 包。 */
export const inject = ['foo', 'fooPolicy']

/**
 * 注册旧服务键。返回的 disposer 注册为 fiber effect:
 * 插件卸载时连带释放,依赖方退回 PENDING 而不报错。
 */
export function apply(ctx: Context): () => Promise<void> {
  return ctx.reflect.provide('fooLegacy', {
    run: (spec: FooSpec) => ctx.foo.run(spec),
    limits: () => ctx.fooPolicy.limits(),
  })
}
```

**这就是补丁的全部。** 它没有分支去猜 `foo` 的行为,没有复制一份实现,没有依赖表。旧插件拿到的是它当年认识的那个形状,数据来自 0.2 的真服务。

关键的一行是 `apply` 里**不 import 任何 dsh 包**:`ctx` 上的服务是通过 `inject` 拿到的,值来自宿主的单实例。这样补丁对 harness 的编译期类型零依赖,也就没有"旧类型副本破坏单实例"的问题(见 proposal §6 决策 1)。

## 3. manifest

```json
{
  "name": "@dsh-rescue/patch-foo-legacy",
  "version": "1.0.0",
  "type": "module",
  "main": "lib/index.js",
  "files": ["lib/index.js", "lib/types/index.d.ts", "cordis.patch.yml"],
  "dsh": { "bundle": { "patch": "./cordis.patch.yml" } },
  "peerDependencies": {
    "@deepseek-ai/cordis": "^4.0.0"
  },
  "devDependencies": {
    "@deepseek-ai/cordis": "^4.0.0",
    "@deepseek-ai/dsh-foo": "^0.2.0"
  }
}
```

```yaml
# cordis.patch.yml
- insert:
    - id: rescue-patch-foo-legacy
      name: @dsh-rescue/patch-foo-legacy
```

两处要点:

- **peer 只有一个**,而且是宽范围。`dsh-foo` 只在 devDependencies 里,供类型检查;运行时补丁一个 dsh 包都不 import。若把 `^0.1.0` 写进 peer,兼容预检会在加载前禁用这一行(`plugin-compatibility.ts:75-80`;`compatibility-preflight.ts:101-118`),修复不会生效。
- 补丁声明 `dsh.bundle`,因此 `dsh plugin add` 会把它追加进 `dsh.profile.bundles` 并触发树重算(`plugin-manager/src/index.ts:715-735`);`dsh plugin remove` 就是还原。

## 4. 生命周期

```text
诊断          观察到 @community/foo-tools 停在 pending,缺 fooLegacy
  ↓           矩阵匹配 BRK-2026-0142,confidence: verified
用户批准      试运行:内存挂载 → foo-tools 变 active
  ↓
落盘          dsh plugin add @dsh-rescue/patch-foo-legacy
  ↓           pnpm 装包 → selectBundle 追加 bundles → reload() 重算树
复检          reconcileProfilePatches:无新增失败 → 判定修复成功
  ↓
记录          .plugin-rescue/state.json 记 kind/target/矩阵 id/触碰的文件
```

**试运行**用 `cordis-host-runner` 的 host-only 定义:在本进程激活、重启即失(`packages/extensions/cordis-host-runner/README.md:12,46,50`)。它验证修复真的有效,又不污染用户文件。

**复检**复用 `reconcileProfilePatches`(`app-boot/src/index.ts:273-302`)——它已实现"快照前态 → 应用 → 等待 → 重审 → 新增失败即抛",rescue 不另建第二条验证路径。

## 5. 边界情形

| 情形 | 行为 | 依据 |
|---|---|---|
| 补丁加载时 `fooLegacy` 已被真实提供者占用 | `provide` 抛 `service "fooLegacy" has been registered at <…>"` | `vendor/cordis/src/reflect.ts:289-291` |
| 官方在 0.3.0 真的发布了 `fooLegacy` | 上面的抛错会把静默 PENDING 变成 profile 起不来 → **补丁必须在启动前自检并自行禁用** | proposal §5.5 |
| `foo` 提供者还在 PENDING 时补丁先激活 | `notify` 只对已 ACTIVE 的提供者立即通知;提供者到达 ACTIVE 时由 `_updateState` 恢复 | `reflect.ts:294-296`;`vendor/cordis/src/fiber.ts:588-594` |
| 用户卸载补丁 | disposer 释放注册,依赖方退回 PENDING,**不报错** | `reflect.ts:297-303` |
| `fooLegacy` 存在于别的 isolate label | 补丁不解决这种情形,那属于类别 6,矩阵里标为不可自动修复 | `reflect.ts:314` 的 label 过滤 |
| 运行的 harness 是 headless / sdk / acp | HMR 默认关闭,`requires.hmrEnabled` 为 false,结果标 `restartRequired` | `packages/boot/hmr/README.md:27` |
| 矩阵区间不覆盖当前 harness | 补丁不加载,报"这条路走不通" | 硬性约束 4 |

## 6. 体量

| 项 | 预算 | 口径 |
|---|---|---|
| `lib/index.js` | ≤ 3 KB | 打包产物字节数,不含 sourcemap |
| `lib/types/index.d.ts` | ≤ 2 KB | 声明不计入运行时预算,但计入 npm 包大小 |
| 整包安装后增量 | ≤ 10 KB | 排除 pnpm store 共享内容 |
| 新增运行时依赖 | 0 | 只允许 peer |

以上是预算不是实测。实测口径见 [m0-assertions.md](../review/m0-assertions.md) A8:对每个补丁在 `pnpm pack` 后量产物字节数,在 profile 里量安装后增量,超出预算的补丁不予合并。

## 7. 评测

按硬性约束 7,补丁带针对新旧两个 harness 版本的行为测试:

- **旧版(0.1.x)**:不加载(补丁的 `harness` 区间不覆盖),断言矩阵不匹配;
- **新版(0.2.x)**:`foo-tools` 由 pending 转 active,`ctx.get('fooLegacy')` 可读,`run` 的结果与 `ctx.foo.run` 一致;
- **冲突版**:同时提供真实 `fooLegacy` 的插件挂载时,断言抛错且补丁自行禁用。
