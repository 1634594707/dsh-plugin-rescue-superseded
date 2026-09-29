---
description: "dsh-plugin-rescue 待决问题 Q1–Q14,含每问的选项、证据倾向与推荐。"
kind: "working-material"
---

# §10 待决问题(改写版)

保留方案 v0.1 的 Q1–Q4、Q6、Q7 编号;Q5 按评审结论改写;v0.2 新增 Q8–Q12;v0.3 随补丁模型新增 Q13、Q14,并按 v0.3 的既定结论更新 Q2 与 Q6。每问给出选项、证据倾向与推荐,便于评审直接表决。

---

## Q1 项目落点

独立 out-of-tree 仓库起步(推荐,零流程成本)→ 诊断模块成熟后向上游 PR?还是直接在本仓库内建包(受 in-repo 全套流程约束:capability seam 三角色、快照、i18n、doc-sync)?还是混合?

- **证据倾向**:混合,但**混合点不是"建包"而是"加字段"**。诊断侧真正的空白只有一处 —— 持续观测 + 未满足 key;其余复用 `auditStartupEntries`(`app-boot/src/index.ts:925`)、`readPluginInventory`(`plugin-inventory/src/index.ts:82`)、`reconcileProfilePatches`(`:273-302`)。上游 PR 因此可以小到"给 `pluginInventory` 加一个 `missingServices` 字段 + 一个 `internal/status` 订阅器",而不是一个新包。
- **推荐**:修复侧完全 out-of-tree;诊断侧按上式向上游提小 PR,rescue 侧消费新字段并在旧版 dsh 上自备实现。

## Q2 矩阵分发

v0.3 已定为**按需拉取 + 本地缓存**(见 proposal §5.1、决策 6),理由是本体不能内置矩阵(体积约束 G6)。本问只决定剩下的细节:

- 是否**同时保留一个 npm 矩阵包作为离线种子**,让完全离线的用户仍能装到一份初始矩阵?
- 缓存的 `maxAgeDays`(草案取 30 天)是否合适 —— 离线时用旧缓存,过期是否应当明确提示而不是静默使用?

- **依据**:`delivery` 段已把 `offline.degradeTo: [D1, D2, D3, D6]` 写死,矩阵取不到时诊断仍可用,因此"没有种子"不是硬伤,只是首次拿不到修法建议。
- **推荐**:不保留 npm 种子(省一个发布物与一条信任链),改由 `offlineOnly` 开关 + 缓存过期提示覆盖离线场景。

## Q3 诊断数据社区回填

是否做?默认关闭、显式 opt-in、仅上传脱敏的"插件名 × 版本 × 失效类别"三元组,可接受吗?

- **补充约束**:官方诊断报告明示"原始插件错误可能含配置或凭据,值不脱敏"(`apps/cli/reference/README.md:75`)。因此 Q3 的"脱敏"不能靠事后承诺,应在**采集端**就只允许结构化三元组,禁止携带 error message / stack / config 值。
- **推荐**:接受,但把"只允许三元组"写成采集端的类型约束,而不是文档承诺。

## Q4 补丁分发粒度

一补丁一包(推荐,审计与按需安装粒度细)vs 单包多补丁(省安装次数)?

- **补充**:若选一补丁一包,rescue 本体**不得**把补丁固定为依赖,而是按矩阵记录在应用时单独安装 —— 否则每次矩阵更新都会牵动本体版本,与"逐包评审"的信任粒度矛盾。
- **推荐**:保持推荐项。

## Q5 codemod(F3)是否保留

成本高、适用面窄、可被"补丁 + 等作者更新"替代。保留为 M3 还是砍掉?

- **评审结论:砍。** §9 自己承认"补丁成为新 bug 源",而 F3 一次引入 AST 迁移 + 本地构建 + 本地路径安装 + `allowBuilds` 四条新信任链,换来的场景补丁已能覆盖。它还与体积约束 G6 直接冲突。
- **替代**:改为"生成可提交的补丁交给作者",rescue 不持有构建链。对应 [matrix-v2.yaml](matrix-v2.yaml) 中 `fixKind.codemod.status: proposed-drop`。

## Q6 诊断交互形态

v0.3 已定为 **M1 就做 UI**(见 proposal §5.6),即"插件管理器列表 + 一键修复 + 还原开关"。本问只决定实现落点:

- 注册为 rescue 自带的配置页(走 `plugins.bundle.config` 插槽 + `ctx.settingsScope`),还是等上游把修复分区加进 `ui-plugin-manager`?

- **成本判断**:不高于原估计。Plugins 页与 Settings 只读清单已在渲染 `pluginInventory`(`packages/client/ui-plugin-manager/README.md:14,30`),社区插件本就可以注册自己的配置页(`.agents/notes/implemented/architecture/2026-09-17-settings-pages-as-companion-packages.md`)。rescue 是 out-of-tree 项目,不需要在 harness 仓库建 client 包。
- **推荐**:自带配置页,不等上游;上游 PR 只做诊断字段。

## Q7 命名与 npm scope

`dsh-rescue-*` 前缀是否可用?是否注册独立 scope(如 `@dsh-rescue/*`)避免与官方 `@deepseek-ai` 混淆?

- **补充**:`dsh` 是 launcher 的 profile 缩写(`apps/cli/reference/README.md:9`),文档里 `dsh rescue` 已被用作示例 profile 名。发布名建议避开与 CLI 形状的相似性。
- **推荐**:独立 scope;包名不与 `dsh <profile>` 读法冲突。

---

## 新增

### Q8 补丁的作用域:per-profile 还是 `$DSH_HOME`?

- **选项**:随 profile 安装(隔离强、装 N 份)vs 装在 home 层共享一份。
- **依据**:home 层 `$DSH_HOME/cordis.patch.yml` 的语义是"机器本地偏好,被所有 profile 共享,且优先级高于 per-profile 层"(`profile-context.ts:65-70`;`apps/cli/reference/README.md:9`)。补丁属于机器本地适配,语义上更贴近 home 层。
- **推荐**:home 层共享 + 按 profile 记录"哪个 profile 用了哪个补丁";同时必须处理层优先级(修复可能被更高层压过)。

### Q9 doctor 是否自写诊断报告文件?

- **选项**:读 `$DSH_HOME/logs/startup-*.log`(官方已有)vs 自写一份。
- **依据**:官方报告已含"每个未激活插件的模块与状态",但明示不脱敏(`apps/cli/reference/README.md:71-75`)。
- **推荐**:默认读既有报告;确需自写时,先回答 [m0-assertions.md](m0-assertions.md) A7 的字段级脱敏问题。

### Q10 预发布版本的矩阵策略

dsh 处于 `0.2.0-rc.1`,而 `includePrerelease: true` 使 rc 落入 stable 区间(`plugin-compatibility.ts:77`)。verified 证据是否对 rc 有效?

- **选项**:rc 与 stable 共用一套记录 / rc 独立通道 / rc 证据一律降级为 `inferred`。
- **推荐**:独立通道 + 降级,对应 [matrix-v2.yaml](matrix-v2.yaml) 的 `meta.prerelease`。

### Q11 官方已修复时优先升级还是继续挂补丁?

- **选项**:命中 `supersededBy` 时建议升级 / 继续挂补丁。
- **依据**:过期补丁 + 官方新提供者 = 注册冲突抛错、profile 起不来(`vendor/cordis/src/reflect.ts:289-291`)。这既是信任问题也是可用性问题。
- **推荐**:优先升级;补丁必须在启动前自检并可自行禁用(见 [m0-assertions.md](m0-assertions.md) A4)。

### Q12 谁来解决"同 key 冲突"?

当两个补丁补同一个被删除的服务 key,或矩阵两条记录给出不同修法,rescue 是拒绝应用、还是按 confidence 高者胜出?

- **推荐**:拒绝应用并报出两个补丁 id,由人裁决。自动择一会让"误修率 0"这一目标失去意义。对应 [patches/README.md](../patches/README.md) 的冲突规则表。

### Q13 运行时出网是否可接受?(v0.3 新增,最关键)

按需拉取矩阵意味着 rescue **默认出网**。这是相对 v0.2(矩阵内置)新增的信任面。

- **选项**:
  - a. 默认出网,失败即降级(当前草案);
  - b. 默认只用缓存,首次更新需用户手动触发;
  - c. 提供显式开关,默认出网但可切到 `offlineOnly`。
- **依据**:本体的核心诊断(D1/D2/D3/D6)完全本地,`delivery.offline.degradeTo` 已把这层依赖写死,所以出网只影响"分类 + 修法"。
- **推荐**:c。它把体积(G6)、可用性与信任三者的取舍显式交给用户,而不是替用户选。

### Q14 体积预算是否写进 CI 门禁?(v0.3 新增)

§3.1 的 100 KB / 10 KB / 300 KB 是**门禁**还是**参考**?

- **选项**:写进 CI 门禁(超预算即红)vs 仅作设计参考。
- **补充**:门禁会强迫"超预算就砍能力",这与"悄悄放宽预算"是相反的方向 —— 对一个以小为卖点的项目,后者才是真正的失败模式。
- **推荐**:写进 CI 门禁。本体依赖树里 `dependencies` 段必须为空,这一条比字节数更容易守住,也更值得守。
