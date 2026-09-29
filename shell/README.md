---
description: "dsh-rescue 的桌面壳:极薄 Tauri 外壳,判据与写盘全在 Node 内核。"
kind: "package-index"
---

# shell

外壳只做三件事:列 profile、渲染内核的 JSON、把按钮转成一次内核调用。**这里没有任何判据** —— peer 计算、公开面 diff、写盘与还原都在 `../lib/cli.js`。

三个视图:「插件市场」(结论 hero + 占比条 + 筛选/搜索 + 逐插件卡片)、「本机诊断」(体检事实条 + 真启动采集 + 待处理卡片)、「改动记录」(journal 时间线与还原)。写动作仍是预览 → 确认两步,确认条挂在窗口底部,同一时刻只挂一个待确认动作。所有来自内核与市场索引的文本都走 `textContent` —— release 正文与描述是第三方写的,不能当标记解析。

## 跑起来

```sh
cd shell
pnpm install
# Windows 上必须让 MSVC 的 link.exe 排在 PATH 前面:Git Bash 自带的 link.exe 会让 cargo 链接失败
export PATH="/c/Program Files (x86)/Microsoft Visual Studio/2022/BuildTools/VC/Tools/MSVC/<版本>/bin/Hostx64/x64:$PATH"
cd .. && pnpm run build && cd shell   # 壳调的是 ../lib/cli.js,内核要先构建
pnpm tauri dev
```

`app-icon.png` 与 `scripts/make-icon.mjs` 是占位图标:`tauri-build` 在没有 `icons/icon.ico` 时直接失败,所以先程序化生成一张,换成真实图标后删掉这两个文件。

## 边界

| 位置 | 负责什么 | 明确不负责 |
|---|---|---|
| `src-tauri/src/main.rs` | 找 node 与内核、以参数数组启动、Windows 上加 `CREATE_NO_WINDOW`(否则每个子进程弹一个黑窗)、把 stdout 的 JSON 交出去 | 任何判定;任何写盘 |
| `src/shell.js` + `index.html` | 渲染诊断、把动作排成"预览 → 确认"两步 | 自己解释根因 |
| `../src/**`(内核) | peer、面 diff、症状采集、写盘、journal、还原、PR 材料 | 往别人仓库 push |

命令与参数都走数组,不拼 shell 字符串。写动作在壳上永远是两次调用:第一次带 `--dry-run`,人看到"要改哪一行"之后才发第二次。`capture` 会真的启动一次 dsh,所以要显式勾"允许在默认 home 真启动",否则内核拒绝。
