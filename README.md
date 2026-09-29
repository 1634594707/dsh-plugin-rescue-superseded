---
description: "dsh-rescue:分析 dsh profile 里社区插件为什么失效,并落一条可见、可还原的补丁。"
kind: "project-index"
---

# dsh-rescue

一条命令分析 + 一条命令打补丁的小项目。它不启动 dsh、不装插件、不改宿主 —— 读的是 profile 目录里已经存在的事实,写的也是用户本来就能看见的那几个文件。

```sh
dsh-rescue doctor --profile desktop
```

```text
插件诊断报告(profile: desktop,harness 0.1.7-rc.2,证据通道: rc)
  @michengai/dsh-archive-manager 0.1.44   ✗ 被预检禁用
    根因: peer 范围不覆盖本机 runtime 0.1.7-rc.2:client-connection 要 0.1.0-rc.8 … 0.1.6-alpha.2,已装 0.1.7-rc.2;另 13 个同类 —— peer-range-stale
    排除: 放宽 peer 也救不了:@deepseek-ai/dsh-client-runtime 本机没装
    可用修复: F0 显式豁免该精确版本 [写入 compatibility.json]
              | F4 让作者放宽 peer 范围 [查看]
下一步:dsh-rescue fix exempt @michengai/dsh-archive-manager@0.1.44 --runtime 0.1.7-rc.2 --accept-risk
```

上面这段是对本机 `~/.dsh/profiles/desktop` 的真实读取结果:10 个 bundle 里 7 个 peer 全满足、1 个会被预检拦下、2 个是官方 runtime 不参与判定。

## 命令

| 动作 | 做什么 | 落盘 |
|---|---|---|
| `doctor [--home DIR] [--profile NAME]` | 按宿主的门禁语义(`@deepseek-ai/dsh*` peer,带 `includePrerelease`)算谁会预检禁用;读补丁层的显式禁用行;读 `compatibility.json` 的已放行条目;用 `matrix.json` 给已知修法 | 无 |
| `fix exempt <pkg@version> --runtime VER --accept-risk` | 写一条精确版本豁免(F0) | `compatibility.json` |
| `fix row <行 id> [--disabled true\|false] [--config FILE]` | 按行 id 整值覆盖 profile 的 `cordis.patch.yml`(F1);`config` 是整值替换,不是深合并 | `cordis.patch.yml` |
| `undo <序号>` | 有 `.bak` 就从备份还原并核对哈希;没有备份就按 journal 记的原值写回,原本「不存在」就删掉该文件 | 上述文件 |
| `status` | 看 journal:已应用、未完成意图、失败计数 | 无 |

`--dry-run` 对所有写动作可用:算出将要写什么、登记意图,但不碰用户文件。

## 四条不变量

**默认只读。** `doctor` 与 `status` 不写任何东西;写动作必须点名 `fix` 或 `undo`,而豁免还必须带 `--accept-risk`(与宿主 `setProfileVersionExemption` 同判据)。

**写了要确认生效。** 每次写完重读文件,核对那一行或那个键确实是预期值 —— 宿主的 `applyEntryPatches` 匹配不到目标只 warn 后跳过,「没报错」不等于「改对了」。核对不过就报错,并说明文件现在是什么状态、下次启动会怎样。

**还原是机制,不是承诺。** 改任何用户文件之前先留 `.bak-<stamp>`,写入走 `.tmp-<stamp>` + `rename`,对 `EACCES/EBUSY/EPERM` 退避重试 10 次、间隔 `(n+1)×50 ms`,常量对齐 `vendor/include/src/index.ts`。逐字节等价由 `.bak` 保证,不由 YAML/JSON 往返保证;备份读不到就报「无法还原:备份缺失」,不猜原值。测试里那条还原断言就是拿还原前后的 sha256 相等来判的。

**证据不唯一就不指认。** peer 范围解析不了、豁免条目对不上当前 runtime、矩阵没有覆盖该区间的记录 —— 这些都只报观察到的事实与根因,不推荐自动修法。`matrix.json` 目前是空的,所以 `doctor` 只给分类与「让作者放宽范围」这一条,不会替你冒风险。

## 结构

```text
src/
  cli.ts              命令入口、参数、journal 读写
  analyze/profile.ts  读 profile:bundle 清单、runtime 版本、补丁层、豁免文件(目录与 junction 都认)
  analyze/peers.ts    按宿主的门禁语义判 peer
  analyze/classify.ts 观察 → 失效类别 → 诊断行
  fix/apply.ts        F0 / F1 的落盘装备:意图先行 → .bak → .tmp+rename → 重读确认 → applied
  matrix/schema.ts    rescue.matrix/v2 的受控词表与字段校验(未知枚举值拒绝入库)
  report/render.ts    确定性排序的报告输出:同一 profile 两次跑,输出逐字节相同
  state/store.ts      rescue.state/v1:意图、before、尝试计数、还原判定、undo.md
test/                 37 项:profile 读取、peer 判定、写盘与还原、备份缺失不猜、只读姿态拒绝写
matrix.json           已知失效知识库(受控词表在 src/matrix/schema.ts)
```

## 上手

```sh
pnpm install
pnpm run gate                                                   # typecheck(含测试)→ build → 37 项测试
node src/cli.ts doctor --profile desktop                        # Node 24 直接跑源码,不必先 build
node lib/cli.js fix row <行 id> --disabled false --profile ...   # 或跑构建产物
```

写动作会改你 profile 里的真实文件。想先看效果,把 profile 目录里的 `package.json` 与 `cordis.patch.yml` 复制一份、`node_modules` 做成 junction,再用 `--home` 指过去(仓库内 `tmp-demo/` 已 gitignore)。

## 相关文档

`proposal.md` 是这个项目早先的平台化草案(补丁管理器、矩阵按需拉取、GUI 分区、agent tool),`roadmap.md` 是它配套的推进清单。当前形态只取其中「静态分析 + F0/F1 落盘 + 可还原」这条最小组合,其余部分已在两份文件开头标注为**未采纳**。`review/` 与 `patches/` 保留为设计材料,不是待办。
