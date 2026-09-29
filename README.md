---
description: "dsh-plugin-rescue 项目总览:权威文档指针、三条硬约束、目录结构、当前进度与上手路径。"
kind: "project-index"
---

# dsh-plugin-rescue

给 dsh 装的**补丁管理器**,模型参照游戏 mod 补丁:本体不打补丁,补丁旁挂;补丁按需分发;一键装、卸、还原;兼容性由矩阵裁定。

dsh 侧的一切(状态读取、复检、装包、写豁免)都**已经存在**。本项目只写增量,这也是它能压到百 KB 量级的原因。

| | |
|---|---|
| 状态 | 方案 v0.4;项目已建仓,`rescue.matrix/v2` 校验器与写盘/状态/报告的纯逻辑 kernel 已落地并有测试,**doctor / patcher 的宿主耦合面未写**(要真实 profile) |
| 权威文档 | 机制口径以 [proposal.md](proposal.md) 为准,推进清单以 [roadmap.md](roadmap.md) 为准;本目录即项目根,改动落在这里(harness 仓内的 `dsh-plugin-rescue/` 是起草副本) |
| 基线 | deepseek-harness @ `4878cdabd8`(dsh `0.2.0-rc.1`);peer 实测版本 `@deepseek-ai/cordis` 4.0.4、`@deepseek-ai/cordis-plugin-include` 1.0.9 |
| 参考实现 | deepseek-harness-desktop @ `21dbac0ccd`(插件恢复模式已上线,同基线),引用写作 `desktop:` 前缀 |
| 表决 | 阶段 0 的 Q7 = 独立 scope `@dsh-rescue/*`;Q13 = 默认出网、可切 `offlineOnly`;Q14 = 体积写进 CI;Q17 = 原子写本体自写并对齐宿主常量。Q1 / Q6 / Q8 / Q5 的无异议确认与 Q15 / Q16 仍待评审 |

## 这个项目解决什么

官方升级后社区插件失效,目前只有"拦截"没有"修复":peer 门禁把不兼容插件挡在加载前,用户只能 `allow-version --accept-risk` 裸放行或等作者;另一些失效停在 PENDING,启动时有一次报告,运行期彻底静默。

rescue 补上的是**诊断 → 判定 → 一键修复 → 可还原**这条链路,以及它背后的兼容矩阵。

## 三条硬约束

**一、体积。** 本体越小越好,补丁是差异不是重写。口径已冻结:`pnpm pack` 后 tarball 内 `lib` 下所有 `.js` + `cordis.patch.yml` 的字节和(`.d.ts` 不计)。

| 预算项 | 目标 | 实测(2026-09-29) |
|---|---|---|
| rescue 本体 | ≤ 100 KB | **42 418 B / 7 文件** |
| 单个补丁 | ≤ 10 KB | 待 `patches/` 建包后量(A8) |
| 矩阵缓存 | ≤ 300 KB | 种子数据 **4 452 B** |
| 本体依赖树 | 0 个新增运行时依赖 | `dependencies` 为空、peer 只含 cordis 与 include,由 `check:manifest` 守 |

**二、方便。** 用户不该理解 patch 文件:零 CLI(**日常路径**,逃生舱例外)、自动触发、一个入口、一键修复、像禁用 mod 一样还原、失败用 mod 的措辞、默认只读。逐项验收见 [proposal.md §3.2](proposal.md#32-易用性验收标准)。

**三、可还原是机制,不是承诺。** "逐字节等价"要求改前备份、原子写、意图先行的状态记录;"零 CLI"要求一条**不依赖 rescue 能否加载**的还原路径([§5.7](proposal.md#57-逃生舱还原能力不能依赖它自己要救的运行时))。

明确禁止的增重项:不内置矩阵、不自带 diff 引擎、不带 AST/codemod(F3 已砍)、不自带 YAML 库(`entryListSchema` 从 `@deepseek-ai/cordis-plugin-include` 以 peer 取得)。

## 目录

```text
dsh-plugin-rescue/
  proposal.md               方案 v0.4 —— 机制、口径、验收标准的唯一来源
  roadmap.md                唯一推进清单 —— 阶段收口条件、A1–A15 断言、放弃清单、顺延顺序
  packages/
    rescue/                 本体 @dsh-rescue/rescue(0 个 dependencies)
      cordis.patch.yml      bundle 补丁层,两行现在都 disabled:入口未接线,挂了只会让 profile 自己 PENDING
      src/matrix/schema.ts  rescue.matrix/v2 受控词表与字段契约(附录 C 的可执行实现)
      src/matrix/cache.ts   缓存键与淘汰:字节上限优先、单份超限拒收并回退上一份
      src/report/redact.ts  渲染前过滤:路径与凭据模式剔除,附被过滤项清单(A7)
      src/report/render.ts  确定性排序的诊断报告(同一 profile 两次输出逐字节相同)
      src/state/store.ts    rescue.state/v1:意图先行 journal、按 fixKind 取值的 before、尝试计数与还原判定
      src/write/atomic.ts   原子写:`.bak-<stamp>` → `.tmp-<stamp>` → rename,重试常量对齐宿主(Q17)
    matrix/                 @dsh-rescue/matrix:纯数据,无代码、无 install script
      data/0.2-rc.json      种子记录(附录 B;confidence 按附录 C 的证据规则重新落级,见 roadmap 不符项 f)
  scripts/
    check-size.mjs          §3.1 口径的体积门禁(读 tarball,不借外部 tar)
    check-manifest.mjs      dependencies 为空、peer 无 dsh-*、无 install 钩子
  patches/                  补丁规格与样例(§5.4 的"一补丁一包",包尚未建)
  review/                   v0.1–v0.3 期间的工作材料,结论已合入 v0.4 正文;术语按当时写法冻结
  .github/workflows/ci.yml  门禁:manifest → build → test → size,ubuntu + windows 双 runner(Q14)
```

## 现在能跑什么

```sh
pnpm install
pnpm run gate        # check:manifest → build → test(40 项)→ check:size
pnpm run typecheck   # 含 *.test.ts
```

宿主耦合面(D1 复用、D2 `internal/status` 订阅、`installBundle`、`setVersionExemption`、真实 profile 上的还原)一行未写:那些判据要在装了 dsh 的 profile 上实测,归 [roadmap.md](roadmap.md) 阶段 1 的 A1–A6 / A9 / A10。

## 上手路径

1. 读 [proposal.md](proposal.md) 的 §0.1(与宿主已有能力的关系)、§3.1(体积口径)、§5.4(交付形态)—— 三段决定项目长什么样;
2. 读 [roadmap.md](roadmap.md) 的阶段 0(四条已回、两条待回)与[前提核验记录](roadmap.md#前提核验记录head-4878cdabd8) —— 核验记录已在当前 HEAD 上把承重引用的 `file:line` 全部读过一遍,并因此回写了五处不符;骨架落地时新发现的两处口径不符(附录 B 记录缺 `runLogId`、区间裸写法无定义)记在同节末尾;
3. 读 [patches/README.md](patches/README.md) 与 [patches/example-foo-legacy.md](patches/example-foo-legacy.md) —— 补丁是什么东西、完整实例长什么样;
4. 评审 `proposal.md` §10 剩下的 Q1 / Q6 / Q8 / Q5 复述确认与 Q15 / Q16;
5. 按 [roadmap.md](roadmap.md) 阶段 1 补 M0 的实机断言,再按阶段 2 把 doctor / patcher 接线、把 `rescue-doctor` / `rescue-patcher` 两行从 `disabled` 打开。
