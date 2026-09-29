---
description: "@dsh-rescue/matrix:矩阵数据包的边界 —— 为什么这里只有数据、谁来裁定数据。"
kind: "package-index"
---

# @dsh-rescue/matrix

矩阵是**数据声明,不是自由 YAML**(proposal 附录 C)。本包只装数据:

- **无代码**:`files` 段不含 `lib` / `src`,包里没有一行可执行 JS;
- **无 install script**:`package.json` 没有 `scripts`,因此从 git 或 tarball 安装不会触发 `prepare`,也就不会牵动 pnpm ≥10 的 `allowBuilds` 放行(§5.4);
- **裁定者是 rescue 里的校验器**:`rescue.matrix/v2` 的受控词表与字段契约由 `@dsh-rescue/rescue` 的 `src/matrix/schema.ts` 单点实现,未知枚举值一律拒绝入库(§5.1)。本包不放第二份 schema(JSON Schema 文件没有消费者,只会与校验器漂移)。

## 数据文件

`data/<generatedForMinor>-<channel>.json`,与 rescue 的缓存键同构(§5.1):

| 文件 | generatedFor | 通道 | 记录 |
|---|---|---|---|
| `data/0.2-rc.json` | `0.2.0` | `rc` | OK-2026-0004、BRK-2026-0087、BRK-2026-0119、BRK-2026-0142、BRK-2026-0155 |

记录出处见 proposal 附录 B。**这些记录是方案里的示例证据,不是本项目实测**:每条 `confidence` / `verifiedOn` / `runLogId` 在进入 M1 的端到端场景前必须按 `roadmap.md` 阶段 1 重跑一遍再定,校验器只保证形状与词表合规。
