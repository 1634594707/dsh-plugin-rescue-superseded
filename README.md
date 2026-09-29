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

已装 bundle 10 个(其中官方 runtime 2 个,不参与兼容性判定):peer 全满足 7 个,会被拦 1 个,已放行 0 个,没装上 0 个。
下一步:升级 @michengai/dsh-archive-manager → 1.0.7(作者已修,2026-09-28T13:26:50Z;最新 1.0.7 的 17 个 dsh peer 全部覆盖 0.1.7-rc.2)—— 不需要补丁或豁免
  dsh plugin --profile desktop update @michengai/dsh-archive-manager
```

上面这段是对本机 `~/.dsh/profiles/desktop` 的真实读取结果:10 个 bundle 里 7 个 peer 全满足、1 个会被预检拦下、2 个是官方 runtime 不参与判定 —— 而被拦下的那个,作者已经在 1.0.7 修好,所以这条 `doctor` 给的是升级命令,不是豁免命令。

## 命令

| 动作 | 做什么 | 落盘 |
|---|---|---|
| `profiles [--json]` | 列该 home 下带 `package.json` 的 profile | 无 |
| `doctor [--home DIR] [--profile NAME] [--json]` | 按宿主的门禁语义(`@deepseek-ai/dsh*` peer,带 `includePrerelease`)算谁会预检禁用;读补丁层的显式禁用行;读 `compatibility.json` 的已放行条目;用 `matrix.json` 给已知修法;对每个被拦的插件问一次市场索引 | 无 |
| `market [--runtime VER] [--json] [--offline]` | 已装社区插件 × 市场索引(`awesome-dsh-plugin.com` 的 `plugins.json` + `updates.json`,缓存 24 小时):取市场最新版的 `package.json`,用宿主同款判据问"作者跟上没有"。`--runtime` 让你提前问"官方出新版会怎样",不必真升本机 | `$(home)/.dsh-rescue/market/`、`cache/`(工具自己的缓存) |
| `capture [--dsh PATH] [--timeout 秒] [--allow-live]` | 真启动一次 dsh,把"哪个条目没起来、在等哪个服务"采成 `rescue.symptoms/v1`。默认拒绝在你的默认 home 上启动 | 无(由 dsh 自己写 session/日志) |
| `why <包名> [--to <官方版本>] [--symptoms 文件] [--json]` | 插件的具名 import 面 × 新旧官方公开面(旧面读本机已装包,新面 `npm pack` 目标版本并缓存);给了症状就把"缺 provider"从猜测升成运行证据 | 无 |
| `pr <包名> --to <官方版本> [--out DIR]` | 诊断包 → PR 材料:`peer-dependencies.diff`、`PR.md`、`diagnostic.json`、可认仓库时给一条 `gh pr create` 命令 | `pr-out/`(工具目录) |
| `fix exempt <pkg@version> --runtime VER --accept-risk` | 写一条精确版本豁免(F0) | `compatibility.json` |
| `fix row <行 id> [--disabled true\|false] [--config FILE]` | 按行 id 整值覆盖 profile 的 `cordis.patch.yml`(F1);`config` 是整值替换,不是深合并 | `cordis.patch.yml` |
| `undo <序号>` | 有 `.bak` 就从备份还原并核对哈希;没有备份就按 journal 记的原值写回,原本「不存在」就删掉该文件 | 上述文件 |
| `status [--json]` | 看 journal:已应用、未完成意图、失败计数 | 无 |

`--dry-run` 对所有写动作可用:算出将要写什么、登记意图,但不碰用户文件。`--json` 时 stdout 只有 JSON,提示走 stderr —— 桌面壳就靠这条边界复用同一个内核。

## 五条不变量

**先问作者修没修,再谈打补丁。** 市场索引里最新版的 peer 覆盖判定用的 runtime ⇒ 结论是"升级即可",工具不给这条插件写豁免、不生成 PR 材料、也不给 `gh pr create` 命令 —— 替一个已经被作者修好的插件打补丁,是在给社区制造重复劳动。反过来,最新版亲手写的范围就不覆盖 ⇒ 明说"升级不解决问题",不含糊成"可以考虑升级"。结论句由内核算(`analyze/market.ts`),壳只涂颜色。

**默认只读。** `doctor`、`market` 与 `status` 不写任何用户文件;写动作必须点名 `fix` 或 `undo`,而豁免还必须带 `--accept-risk`(与宿主 `setProfileVersionExemption` 同判据)。

**写了要确认生效。** 每次写完重读文件,核对那一行或那个键确实是预期值 —— 宿主的 `applyEntryPatches` 匹配不到目标只 warn 后跳过,「没报错」不等于「改对了」。核对不过就报错,并说明文件现在是什么状态、下次启动会怎样。

**还原是机制,不是承诺。** 改任何用户文件之前先留 `.bak-<stamp>`,写入走 `.tmp-<stamp>` + `rename`,对 `EACCES/EBUSY/EPERM` 退避重试 10 次、间隔 `(n+1)×50 ms`,常量对齐 `vendor/include/src/index.ts`。逐字节等价由 `.bak` 保证,不由 YAML/JSON 往返保证;备份读不到就报「无法还原:备份缺失」,不猜原值。测试里那条还原断言就是拿还原前后的 sha256 相等来判的。

**证据不唯一就不指认。** peer 范围解析不了、豁免条目对不上当前 runtime、矩阵没有覆盖该区间的记录 —— 这些都只报观察到的事实与根因,不推荐自动修法。`matrix.json` 目前是空的,所以 `doctor` 只给分类与「让作者放宽范围」这一条,不会替你冒风险。

## 实测到的七条(都在这台机器上跑出来,不是推断)

1. **`^0.2.0` 和 `>=0.2.0` 都不放行 `0.2.0-rc.1`**,即使带 `includePrerelease: true`(宿主同款判据)。所以 `pr` 生成的建议范围是 `>=0.2.0-0 <0.3.0` —— 给作者提 `^0.2.0` 等于提一个仍然被拦的 PR。
2. **可选条目未激活不写 `startup-*.log`,只打一行警告**。实测两次:`dsh: warning: 1 entry did not activate` + `… pending (waiting for service: webServer)`,而 `logs/` 里什么都没有 —— 所以 `capture` 解析的是启动摘要,报告文件只是顺带。
3. **"peer 过了"不等于"能用"**。npm 上的 `@michengai/dsh-archive-manager` 已经出到 1.0.7 并把 peer 放宽到含 `0.2.0-rc.1`;真启动后它不再被拦,而是卡在等一个 headless profile 里根本没有的 `webServer`。同一个插件,失效种类从 `peer-range-stale` 变成缺 provider —— 这正是静态分析与真启动必须分工的原因。
4. **判据不能搬到 Rust 去算**:Rust 的 `semver` crate 对真实插件写的 `0.1.0-rc.8 || 0.1.1-rc.2 || …` 是 16/16 解析失败,而宿主的门禁就是 node-semver。壳只渲染,内核留在 JS。
5. **社区插件的"没人修"多半是"没人升级"**。本机 `desktop` profile 的 8 个社区插件,市场索引全部有更新版;拿 0.2.0-rc.1 逐个判,7 个的作者已经把 peer 放宽到覆盖(archive-manager 1.0.7 的 17 个 dsh peer 全覆盖,作者说明原话是"可以用在 DSH 0.2.0-rc.1 上"),只有 `dsh-better-reasoning-effort` 0.5.0 的上限还停在 `^0.1.7-rc.1` —— 那才是真需要提 PR 的一条。
6. **F0 豁免写的就是宿主读的那一份**。在排演 home 里对 0.2.0-rc.1 装 `dsh-better-reasoning-effort@0.5.0`:宿主**安装时就拒**(`dsh: installation rejected: … is incompatible with dsh 0.2.0-rc.1`)并点名逃生口 `dsh plugin allow-version`。`fix exempt` 写出 `profiles/<name>/compatibility.json` 后,同一句 `dsh plugin add` 装上了,`dsh plugin version-exemptions` 打印出的正是我们写的那条 —— `packages/boot/app-boot/src/profile-compatibility.ts:10` 的 `PROFILE_COMPATIBILITY_FILENAME` 与 `join(profileDir, …)` 是同一份文件。
7. **启动时最常见的症状是"整个 bundle 被跳过"**,宿主打的是 `dsh: skipping profile bundle "X": Error: Plugin … is incompatible with dsh <V>: peerDependencies {…}`。`capture` 原先只认 `did not activate` / `waiting for service`,这一行**一条都不报** —— 实测的 A/B 里"修好前"和"修好后"输出一模一样才暴露出来。现在它是 `state: 'skipped'`,并把宿主给的 peer 范围原样带进 `detail`。

## 端到端实测记录(2026-09-29,排演 home)

`C:\Users\Administrator\AppData\Local\Temp\dsh-fix-e2e-home` + harness 0.2.0-rc.1 源码宿主,全程没碰 `~/.dsh`:

| 步骤 | 结果 |
|---|---|
| `dsh plugin add dsh-better-reasoning-effort@0.5.0` | 拒装,并给出 `allow-version` 逃生口 |
| `fix exempt … --runtime 0.2.0-rc.1 --accept-risk --dry-run` | 只报将写哪个文件,不落盘 |
| 同上去掉 `--dry-run` | 写出 `compatibility.json`,journal + `undo.md` 落在 `.dsh-rescue/` |
| 再 `dsh plugin add` | 装上(`+ dsh-better-reasoning-effort 0.5.0`) |
| `capture` | 修好前:`预检跳过 摘要:与 dsh 0.2.0-rc.1 不兼容 —— peerDependencies {…}`;修好后:没有未激活条目 |
| `dsh plugin version-exemptions` | 打印出我们写的那条,证明宿主读的是同一份文件 |
| `undo 1` | 预览与实际一致("将删掉这次创建的 compatibility.json"),文件删除,不留 `{}` 残留 |
| 再 `capture` | 又回到 `预检跳过` —— 还原是真的把状态倒回去 |

**这个 home 里 `doctor` / `why` 看不到 runtime**(`runtime 未识别`):宿主从源码 checkout 跑,`@deepseek-ai/*` 不在 home 的 `node_modules` 里,所以 peer 判定停在 `unknown` 而不是猜一个结论。同一条判据在 `market --runtime 0.2.0-rc.1` 上是完整的(它读 npm 上的 manifest,不依赖本机 runtime 包),运行证据由 `capture` 补。要让 doctor 也看见,得给它第二个解析根(源码 checkout)—— 记在 [roadmap.md](roadmap.md),没顺手做。

## 排演一个新版本(不碰你的 profile)

```sh
export DSH_HOME=/某个临时目录                      # dsh 认这个环境变量
HARNESS=/路径/deepseek-harness                     # 里面是 0.2.0-rc.1 的源码,先 pnpm run build
node "$HARNESS/apps/cli/lib/bin.js" --profile headless "hi"                  # 首次自动初始化模板 profile
node "$HARNESS/apps/cli/lib/bin.js" plugin --profile headless add @michengai/dsh-archive-manager
node lib/cli.js capture --home "$DSH_HOME" --profile headless --dsh "$HARNESS/apps/cli/lib/bin.js" --json > symptoms.json
node lib/cli.js why @michengai/dsh-archive-manager --home "$DSH_HOME" --profile headless --to 0.2.0-rc.1 --symptoms symptoms.json
```

`capture` 不给你 `--allow-live` 就拒绝在默认 home 上启动,并且把 `DSH_HOME` 显式传给子进程 —— 少这一条,排演就会打到你的真 profile。

## 桌面壳

`shell/` 是极薄 Tauri 壳:列 profile、渲染内核 JSON、把按钮排成"预览 → 确认"。判据与写盘一行都不在壳里,所以换 UI 不用重算判据。跑法与踩到的 Windows 坑(`link.exe` 顺序、`CREATE_NO_WINDOW`、占位图标)见 [shell/README.md](shell/README.md)。

## 结构

```text
src/
  cli.ts              命令入口、参数、journal 读写
  analyze/profile.ts  读 profile:bundle 清单、runtime 版本、补丁层、豁免文件(目录与 junction 都认)
  analyze/peers.ts    按宿主的门禁语义判 peer
  analyze/classify.ts 观察 → 失效类别 → 诊断行
  analyze/market.ts   市场对照:索引缓存/离线退回、作者最新版 peer 判定、结论句与升级命令
  fix/apply.ts        F0 / F1 的落盘装备:意图先行 → .bak → .tmp+rename → 重读确认 → applied
  matrix/schema.ts    rescue.matrix/v2 的受控词表与字段校验(未知枚举值拒绝入库)
  report/render.ts    确定性排序的报告输出:同一 profile 两次跑,输出逐字节相同
  state/store.ts      rescue.state/v1:意图、before、尝试计数、还原判定、undo.md
test/                 72 项:profile 读取、peer 判定、市场对照与缓存、argv 闸门、写盘与还原、备份缺失不猜、只读姿态拒绝写
matrix.json           已知失效知识库(受控词表在 src/matrix/schema.ts)
```

## 上手

```sh
pnpm install
pnpm run gate                                                   # typecheck(含测试)→ build → 72 项测试
node src/cli.ts doctor --profile desktop                        # Node 24 直接跑源码,不必先 build
node lib/cli.js fix row <行 id> --disabled false --profile ...   # 或跑构建产物
```

写动作会改你 profile 里的真实文件。想先看效果,把 profile 目录里的 `package.json` 与 `cordis.patch.yml` 复制一份、`node_modules` 做成 junction,再用 `--home` 指过去(仓库内 `tmp-demo/` 已 gitignore)。

## 相关文档

`proposal.md` 是这个项目早先的平台化草案(补丁管理器、矩阵按需拉取、GUI 分区、agent tool),`roadmap.md` 是它配套的推进清单。当前形态只取其中「静态分析 + F0/F1 落盘 + 可还原」这条最小组合,其余部分已在两份文件开头标注为**未采纳**。`review/` 与 `patches/` 保留为设计材料,不是待办。
