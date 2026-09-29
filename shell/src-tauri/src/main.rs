#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

//! 壳的 Rust 侧:定位 Node 与内核、跑一条命令、把 JSON 原样交给前端。
//!
//! 这里没有任何判据:peer 计算、面 diff、写盘与还原全在 `lib/cli.js`。壳只保证三件事 ——
//! 参数是数组而不是拼好的 shell 字符串、Windows 上不闪黑窗、内核的非零退出把 stderr 原文带回。

use serde_json::Value;
use std::env;
use std::path::PathBuf;
use std::process::{Command, Stdio};

#[cfg(windows)]
use std::os::windows::process::CommandExt;

/// CREATE_NO_WINDOW:GUI 进程直接 spawn 控制台程序会让子进程各开一个可见窗口。
#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

/// @return 内核入口 `lib/cli.js` 的绝对路径
fn core_path() -> PathBuf {
    if let Ok(given) = env::var("DSH_RESCUE_CORE") {
        return PathBuf::from(given);
    }
    // shell/src-tauri → 仓库根;CARGO_MANIFEST_DIR 已是绝对路径,不必再规整
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join("..")
        .join("lib")
        .join("cli.js")
}

/// @return 要用的 node 可执行文件;默认走 PATH,可用 DSH_RESCUE_NODE 指到桌面壳自带的那份
fn node_path() -> String {
    env::var("DSH_RESCUE_NODE").unwrap_or_else(|_| "node".to_string())
}

/// 规整成用户能看懂的一行失败原因。
///
/// @param error spawn 或读取失败的文本
/// @return 带上"内核路径没构建出来"这一句提示,免得只剩 ENOENT
fn explain(error: String) -> String {
    let core = core_path();
    if !core.exists() {
        return format!(
            "{error}\n内核还没构建:找不到 {}。先在项目根跑 `pnpm run build`。",
            core.display()
        );
    }
    error
}

/// 跑内核的一条命令。
///
/// @param args 参数数组(绝不拼成 shell 字符串)
/// @return 内核 stdout;非零退出时把 stderr 作为错误抛出
fn run(args: &[String]) -> Result<Value, String> {
    let mut command = Command::new(node_path());
    command
        .arg(core_path())
        .args(args)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    #[cfg(windows)]
    command.creation_flags(CREATE_NO_WINDOW);

    let mut child = command.spawn().map_err(|error| explain(format!("启动 {node_path()} 失败:{error}")))?;
    let output = child
        .wait_with_output()
        .map_err(|error| explain(format!("读取内核输出失败:{error}")))?;
    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(if stderr.is_empty() {
            format!("内核退出码 {}", output.status.code().unwrap_or(-1))
        } else {
            stderr
        });
    }
    serde_json::from_str(&stdout).map_err(|error| format!("内核输出不是 JSON({error}):\n{stdout}"))
}

/// @return 该 home 下可用的 profile 名与所在 home
#[tauri::command]
fn profiles() -> Result<Value, String> {
    run(&["profiles".to_string(), "--json".to_string()])
}

/// @param profile profile 名
/// @return 只读体检结果
#[tauri::command]
fn doctor(profile: String) -> Result<Value, String> {
    run(&[
        "doctor".to_string(),
        "--profile".to_string(),
        profile,
        "--json".to_string(),
    ])
}

/// @param profile profile 名
/// @param plugin 插件包名
/// @param target 对照的官方版本
/// @return 诊断包
#[tauri::command]
fn why(profile: String, plugin: String, target: String) -> Result<Value, String> {
    run(&[
        "why".to_string(),
        plugin,
        "--profile".to_string(),
        profile,
        "--to".to_string(),
        target,
        "--json".to_string(),
    ])
}

/// @param profile profile 名
/// @param plugin 插件包名
/// @param target 对照的官方版本
/// @return PR 材料清单(目录、文件、gh 命令)
#[tauri::command]
fn pr_draft(profile: String, plugin: String, target: String) -> Result<Value, String> {
    run(&[
        "pr".to_string(),
        plugin,
        "--profile".to_string(),
        profile,
        "--to".to_string(),
        target,
        "--json".to_string(),
    ])
}

/// @param profile profile 名
/// @param row_id 补丁层里的行 id
/// @param disabled 目标 disabled 取值
/// @param confirm 为 false 时走 --dry-run,只看要写什么
#[tauri::command]
fn fix_row(profile: String, row_id: String, disabled: bool, confirm: bool) -> Result<Value, String> {
    let mut args = vec![
        "fix".to_string(),
        "row".to_string(),
        row_id,
        "--profile".to_string(),
        profile,
        "--disabled".to_string(),
        disabled.to_string(),
    ];
    if !confirm {
        args.push("--dry-run".to_string());
    }
    run(&args)
}

/// @param profile profile 名
/// @param plugin_version 精确 `包名@版本`
/// @param runtime 要放行的官方精确版本
/// @param confirm 为 false 时走 --dry-run
/// @return 内核返回的写入结果
#[tauri::command]
fn fix_exempt(profile: String, plugin_version: String, runtime: String, confirm: bool) -> Result<Value, String> {
    let mut args = vec![
        "fix".to_string(),
        "exempt".to_string(),
        plugin_version,
        "--profile".to_string(),
        profile,
        "--runtime".to_string(),
        runtime,
        "--accept-risk".to_string(),
    ];
    if !confirm {
        args.push("--dry-run".to_string());
    }
    run(&args)
}

/// @param profile profile 名
/// @return journal 现状
#[tauri::command]
fn status(profile: String) -> Result<Value, String> {
    run(&["status".to_string(), "--profile".to_string(), profile, "--json".to_string()])
}

/// @param profile profile 名
/// @param ordinal journal 里的序号
/// @param confirm 为 false 时走 --dry-run,只看会还原什么
/// @return 还原结果
#[tauri::command]
fn undo(profile: String, ordinal: u32, confirm: bool) -> Result<Value, String> {
    let mut args = vec![
        "undo".to_string(),
        ordinal.to_string(),
        "--profile".to_string(),
        profile,
        "--json".to_string(),
    ];
    if !confirm {
        args.push("--dry-run".to_string());
    }
    run(&args)
}

fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            profiles,
            doctor,
            why,
            pr_draft,
            fix_row,
            fix_exempt,
            status,
            undo
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
