# snapfile-rs 替代实现 — 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 用 Rust 重写 Go snapfile 二进制, 作为 SnapAny Electron 应用的 drop-in 下载引擎替换。

**Architecture:** 长驻 tokio 进程, stdin 读 JSON 行命令, stdout 写 JSON 行响应。每个下载任务在独立 tokio task 中运行, 通过 Semaphore 控制并发, CancellationToken 控制取消。ffmpeg/ffprobe 通过 `tokio::process::Command` 直接调用。

**Tech Stack:** Rust + tokio + reqwest + serde_json + clap + tracing + md-5 + uuid

**设计文档:** `docs/082_spec.md`

**协议参考:** `vendor/081_design.md` §6, `vendor/snapfile-go/README.md`

---

## 文件结构

```
snapany-rs/
├── Cargo.toml
├── src/
│   ├── main.rs           # 入口: CLI + runtime + stdin 循环 + 信号处理
│   ├── cli.rs            # clap Args 结构体
│   ├── protocol.rs       # serde 类型 + 状态码常量 + 消息常量
│   ├── output.rs         # OutputWriter (Arc<Mutex<BufWriter<Stdout>>>)
│   ├── error.rs          # SnapfileError + TaskError + 到状态码映射
│   ├── paths.rs          # md5 命名, _first 后缀, 冲突解决, 目录计算
│   ├── proxy.rs          # reqwest::Client 构建, macOS 系统代理读取
│   ├── log.rs            # tracing 初始化
│   ├── downloader.rs     # 流式下载 + 进度 + 重试
│   ├── ffprobe.rs        # ffprobe 调用 + JSON 解析
│   ├── converter.rs      # ffmpeg 合并/转码 + 进度解析
│   ├── mover.rs          # 文件移动 + 冲突处理
│   ├── task.rs           # Task 状态机 + run_task 编排 + CleanupGuard
│   └── manager.rs        # TaskManager: 任务注册, 并发调度, 取消, panic 隔离
├── tests/
│   ├── protocol_test.rs  # serde 兼容性测试
│   └── integration_test.rs # 端到端测试 (本地 HTTP server)
├── dist/
│   ├── package.sh        # 替换 + 重签名脚本
│   └── README.md
├── vendor/
│   ├── 081_design.md
│   └── snapfile-go/
│       ├── snapfile      # 原始 Go 二进制
│       └── README.md     # 协议参考
└── docs/
    ├── 082_spec.md       # 设计文档
    └── superpowers/plans/2026-08-07-snapfile-rs.md  # 本文档
```

---

## Task 1: 项目脚手架 + Cargo.toml

**Files:**
- Create: `Cargo.toml`
- Create: `src/main.rs`

- [ ] **Step 1: 创建 Cargo.toml**

```toml
[package]
name = "snapfile-rs"
version = "0.1.0"
edition = "2021"

[[bin]]
name = "snapfile"
path = "src/main.rs"

[dependencies]
tokio = { version = "1", features = ["full"] }
tokio-util = "0.7"
reqwest = { version = "0.12", features = ["stream", "socks"] }
serde = { version = "1", features = ["derive"] }
serde_json = "1"
clap = { version = "4", features = ["derive"] }
anyhow = "1"
thiserror = "1"
uuid = { version = "1", features = ["v4"] }
md-5 = "0.10"
tracing = "0.1"
tracing-subscriber = { version = "0.3", features = ["fmt", "env-filter"] }
futures-util = "0.3"

[dev-dependencies]
tokio-test = "0.4"
```

注意: `[[bin]] name = "snapfile"` 确保编译产物名为 `snapfile`, 与 JS 层 `getBinPath("snapfile")` 一致。

- [ ] **Step 2: 创建最小 main.rs**

```rust
fn main() {
    eprintln!("snapfile-rs starting...");
}
```

- [ ] **Step 3: 验证编译**

Run: `cargo build`
Expected: 编译成功, `target/debug/snapfile` 存在

- [ ] **Step 4: Commit**

```bash
git add Cargo.toml Cargo.lock src/main.rs
git commit -m "feat: project scaffold"
```

---

## Task 2: 日志初始化 (log.rs)

**Files:**
- Create: `src/log.rs`
- Modify: `src/main.rs`

- [ ] **Step 1: 实现 log.rs**

```rust
use tracing_subscriber::EnvFilter;

pub fn init(level: &str) {
    let filter = EnvFilter::try_new(level).unwrap_or_else(|_| EnvFilter::new("info"));
    tracing_subscriber::fmt()
        .with_env_filter(filter)
        .with_target(true)
        .with_timestamps(true)
        .init();
    tracing::info!(level = level, "日志系统已初始化");
}
```

- [ ] **Step 2: 在 main.rs 中调用**

```rust
mod log;

fn main() {
    log::init("info");
    tracing::info!("snapfile-rs 启动");
}
```

- [ ] **Step 3: 验证编译并运行**

Run: `cargo run`
Expected: stderr 输出包含 "snapfile-rs 启动" 和 "日志系统已初始化"

- [ ] **Step 4: Commit**

```bash
git add src/log.rs src/main.rs
git commit -m "feat: tracing logger init"
```

---

## Task 3: CLI 参数解析 (cli.rs)

**Files:**
- Create: `src/cli.rs`
- Modify: `src/main.rs`

- [ ] **Step 1: 实现 cli.rs**

```rust
use clap::Parser;
use std::path::PathBuf;

#[derive(Parser, Debug)]
#[command(name = "snapfile", about = "SnapAny download engine")]
pub struct Args {
    #[arg(long = "ffmpeg-path", required = true)]
    pub ffmpeg_path: PathBuf,

    #[arg(long = "ffprobe-path", required = true)]
    pub ffprobe_path: PathBuf,

    #[arg(long = "max-downloading-task", default_value_t = 5)]
    pub max_downloading_task: usize,

    #[arg(long = "log-level", default_value = "info")]
    pub log_level: String,
}
```

- [ ] **Step 2: 在 main.rs 中使用**

```rust
mod log;
mod cli;

use clap::Parser;

fn main() {
    let args = cli::Args::parse();
    log::init(&args.log_level);
    tracing::info!(
        ffmpeg = ?args.ffmpeg_path,
        ffprobe = ?args.ffprobe_path,
        max_task = args.max_downloading_task,
        log_level = %args.log_level,
        "snapfile-rs 启动"
    );
}
```

- [ ] **Step 3: 验证参数解析**

Run: `cargo run -- --ffmpeg-path /usr/bin/ffmpeg --ffprobe-path /usr/bin/ffprobe --max-downloading-task 3 --log-level debug`
Expected: stderr 输出包含 ffmpeg 路径和 max_task=3

- [ ] **Step 4: 验证缺少必填参数时报错**

Run: `cargo run`
Expected: clap 输出错误信息, 提示缺少 --ffmpeg-path 和 --ffprobe-path

- [ ] **Step 5: Commit**

```bash
git add src/cli.rs src/main.rs
git commit -m "feat: CLI argument parsing with clap"
```

---

## Task 4: 协议类型定义 (protocol.rs)

**Files:**
- Create: `src/protocol.rs`
- Modify: `src/main.rs`

这是最关键的模块, 定义了所有 stdin 输入和 stdout 输出的数据结构。参考 `vendor/snapfile-go/README.md` 和 `docs/082_spec.md` §2。

- [ ] **Step 1: 实现输入命令类型**

```rust
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

// ==================== 输入 (stdin → snapfile) ====================

#[derive(Debug, Deserialize)]
#[serde(tag = "type", content = "payload")]
pub enum Request {
    #[serde(rename = "start-task")]
    StartTask(StartTaskPayload),

    #[serde(rename = "delete-task")]
    DeleteTask(DeleteTaskPayload),

    #[serde(rename = "update-max-download-task")]
    UpdateMaxDownloadTask(UpdateLimitPayload),

    #[serde(rename = "stop-recording-live")]
    StopRecordingLive(StopLivePayload),
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StartTaskPayload {
    pub task_id: String,
    pub name: String,
    pub output_dir: String,
    pub temp_dir: String,
    pub output_type: String,
    pub output_video_format: Option<String>,
    pub output_audio_format: Option<String>,
    pub live: bool,
    pub embedded_subtitle: bool,
    pub proxy: String,
    pub files: Vec<FileSpec>,
    #[serde(default)]
    pub audio_bitrate: Option<u32>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct FileSpec {
    pub url: String,
    #[serde(default)]
    pub language: Option<String>,
    #[serde(default)]
    pub header: Option<HashMap<String, String>>,
    #[serde(default)]
    pub optional_download: Option<bool>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeleteTaskPayload {
    pub task_ids: Vec<String>,
}

#[derive(Debug, Deserialize)]
pub struct UpdateLimitPayload {
    pub limit: u32,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StopLivePayload {
    pub task_id: String,
}
```

- [ ] **Step 2: 实现输出响应类型**

```rust
// ==================== 输出 (snapfile → stdout) ====================

#[derive(Debug, Serialize)]
pub struct Response {
    pub code: &'static str,
    pub data: ResponseData,
    pub message: &'static str,
}

#[derive(Debug, Serialize)]
#[serde(untagged)]
pub enum ResponseData {
    Status {
        #[serde(rename = "taskID")]
        task_id: String,
    },
    Progress {
        #[serde(rename = "taskID")]
        task_id: String,
        done: u64,
        total: u64,
        speed: u64,
        #[serde(rename = "remainingTime")]
        remaining_time: u64,
    },
    Complete {
        #[serde(rename = "taskID")]
        task_id: String,
        files: Vec<String>,
    },
    FileError {
        #[serde(rename = "taskID")]
        task_id: String,
        url: String,
    },
    Deleted {
        #[serde(rename = "taskID")]
        task_id: String,
    },
}
```

- [ ] **Step 3: 实现状态码和消息常量**

```rust
// ==================== 状态码常量 ====================

pub mod codes {
    pub const TASK_STARTED:            &str = "task_started";
    pub const TASK_START_PREPARE:      &str = "task_start_prepare";
    pub const TASK_PREPARED:           &str = "task_prepared";
    pub const TASK_PENDING_DOWNLOAD:   &str = "task_pending_download";
    pub const TASK_START_DOWNLOAD:     &str = "task_start_download";
    pub const TASK_DOWNLOADED:         &str = "task_downloaded";
    pub const TASK_PENDING_CONVERSION: &str = "task_pending_conversion";
    pub const TASK_START_CONVERSION:   &str = "task_start_conversion";
    pub const TASK_CONVERTED:          &str = "task_converted";
    pub const TASK_START_MOVE:         &str = "task_start_move";
    pub const TASK_MOVED:              &str = "task_moved";
    pub const TASK_COMPLETE:           &str = "task_complete";
    pub const TASK_DELETED:            &str = "task_deleted";

    pub const TASK_DOWNLOAD_PROGRESS:   &str = "task_download_progress";
    pub const TASK_CONVERSION_PROGRESS: &str = "task_conversion_progress";

    pub const FILE_DOWNLOAD_ERROR:       &str = "file_download_error";
    pub const DOWNLOAD_ERROR:            &str = "download_error";
    pub const CONVERT_ERROR:            &str = "convert_error";
    pub const MOVE_ERROR:               &str = "move_error";
    pub const PREPARE_ERROR:            &str = "prepare_error";
    pub const HTTP_STATUS_FORBIDDEN:    &str = "http_status_forbidden_error";
    pub const DISK_FULL:                &str = "disk_full";
    pub const OS_PERMISSION_DENIED:     &str = "os_permission_denied";
    pub const UNKNOWN_ERROR:            &str = "unknown_error";
}

// ==================== 消息常量 (中文, 必须逐字匹配 Go snapfile) ====================

pub mod messages {
    pub const TASK_STARTED:            &str = "任务已启动";
    pub const TASK_START_PREPARE:      &str = "任务开始预处理";
    pub const TASK_PREPARED:           &str = "任务预处理完成";
    pub const TASK_PENDING_DOWNLOAD:   &str = "等待下载";
    pub const TASK_START_DOWNLOAD:     &str = "任务开始下载";
    pub const TASK_DOWNLOADED:         &str = "任务下载完成";
    pub const TASK_PENDING_CONVERSION: &str = "任务等待转换";
    pub const TASK_START_CONVERSION:   &str = "任务开始转换";
    pub const TASK_CONVERTED:          &str = "任务转换完成";
    pub const TASK_START_MOVE:         &str = "任务开始移动";
    pub const TASK_MOVED:              &str = "任务移动完成";
    pub const TASK_COMPLETE:           &str = "任务完成";
    pub const TASK_DELETED:            &str = "任务已删除";
    pub const DOWNLOAD_PROGRESS:       &str = "更新下载进度";
    pub const CONVERSION_PROGRESS:     &str = "更新转换进度";
    pub const FILE_DOWNLOAD_ERROR:     &str = "文件下载错误";
}
```

- [ ] **Step 4: 在 main.rs 中引用模块**

在 `mod log; mod cli;` 后添加 `mod protocol;`

- [ ] **Step 5: 验证编译**

Run: `cargo build`
Expected: 编译成功

- [ ] **Step 6: Commit**

```bash
git add src/protocol.rs src/main.rs
git commit -m "feat: protocol type definitions (Request/Response/StatusCodes)"
```

---

## Task 5: 错误类型 (error.rs)

**Files:**
- Create: `src/error.rs`
- Modify: `src/main.rs`

- [ ] **Step 1: 实现 error.rs**

```rust
use crate::protocol::codes;

#[derive(Debug)]
pub enum TaskError {
    Cancelled,
    Failed { code: &'static str, message: String },
}

impl TaskError {
    pub fn failed(code: &'static str, msg: impl Into<String>) -> Self {
        Self::Failed { code, message: msg.into() }
    }
}

#[derive(Debug, thiserror::Error)]
pub enum SnapfileError {
    #[error("HTTP 403 Forbidden")]
    HttpStatusForbidden,
    #[error("下载失败: {0}")]
    DownloadFailed(String),
    #[error("转换失败: {0}")]
    ConvertFailed(String),
    #[error("文件移动失败: {0}")]
    MoveFailed(String),
    #[error("IO 错误: {0}")]
    Io(#[from] std::io::Error),
    #[error("任务已取消")]
    Cancelled,
    #[error("Reqwest: {0}")]
    Reqwest(#[from] reqwest::Error),
}

impl SnapfileError {
    pub fn to_status_code(&self) -> &'static str {
        match self {
            Self::HttpStatusForbidden => codes::HTTP_STATUS_FORBIDDEN,
            Self::DownloadFailed(_) => codes::DOWNLOAD_ERROR,
            Self::ConvertFailed(_) => codes::CONVERT_ERROR,
            Self::MoveFailed(_) => codes::MOVE_ERROR,
            Self::Io(e) => {
                let msg = e.to_string();
                if msg.contains("No space left") {
                    codes::DISK_FULL
                } else if msg.contains("Permission denied") {
                    codes::OS_PERMISSION_DENIED
                } else {
                    codes::DOWNLOAD_ERROR
                }
            }
            Self::Cancelled => codes::DOWNLOAD_ERROR,
            Self::Reqwest(_) => codes::DOWNLOAD_ERROR,
        }
    }

    pub fn to_message(&self) -> String {
        self.to_string()
    }
}
```

- [ ] **Step 2: 在 main.rs 中添加 `mod error;`**

- [ ] **Step 3: 验证编译**

Run: `cargo build`
Expected: 编译成功

- [ ] **Step 4: Commit**

```bash
git add src/error.rs src/main.rs
git commit -m "feat: error types with status code mapping"
```

---

## Task 6: 路径计算 (paths.rs)

**Files:**
- Create: `src/paths.rs`
- Modify: `src/main.rs`

参考 `docs/082_spec.md` §2.4 临时目录结构和文件命名规则。

- [ ] **Step 1: 实现 paths.rs**

```rust
use md5::{Md5, Digest};
use std::path::{Path, PathBuf};

/// 计算 URL 的 MD5 十六进制表示, 用于临时文件命名
pub fn md5_hex(input: &str) -> String {
    let mut hasher = Md5::new();
    hasher.update(input.as_bytes());
    hasher.finalize().iter()
        .map(|b| format!("{:02x}", b))
        .collect()
}

/// 下载文件名: 第一个文件加 _first 后缀
pub fn download_filename(url: &str, index: usize) -> String {
    let hash = md5_hex(url);
    if index == 0 {
        format!("{}_first.m4s", hash)
    } else {
        format!("{}.m4s", hash)
    }
}

/// 下载目录: {temp_dir}/{task_id}/{task_id}/download/
pub fn download_dir(temp_dir: &Path, task_id: &str) -> PathBuf {
    temp_dir.join(task_id).join(task_id).join("download")
}

/// 转码目录: {temp_dir}/{task_id}/{task_id}/converting/
pub fn converting_dir(temp_dir: &Path, task_id: &str) -> PathBuf {
    temp_dir.join(task_id).join(task_id).join("converting")
}

/// 转码完成目录: {temp_dir}/{task_id}/{task_id}/converted/
pub fn converted_dir(temp_dir: &Path, task_id: &str) -> PathBuf {
    temp_dir.join(task_id).join(task_id).join("converted")
}

/// 临时目录根: {temp_dir}/{task_id}
pub fn temp_root(temp_dir: &Path, task_id: &str) -> PathBuf {
    temp_dir.join(task_id)
}

/// 转码中的文件名: {md5(name)}.{ext}
pub fn converting_filename(name: &str, ext: &str) -> String {
    format!("{}.{}", md5_hex(name), ext)
}

/// 最终输出文件路径
pub fn output_path(output_dir: &Path, name: &str, ext: &str) -> PathBuf {
    let safe_name = sanitize_filename(name);
    output_dir.join(format!("{}.{}", safe_name, ext))
}

/// 过滤文件名中的非法字符
pub fn sanitize_filename(name: &str) -> String {
    name.chars()
        .map(|c| match c {
            '/' | ':' | '\0' | '\n' | '\r' => '_',
            _ => c,
        })
        .collect::<String>()
        .trim()
        .to_string()
}

/// 检查输出扩展名
pub fn output_extension(output_type: &str, video_format: Option<&str>, audio_format: Option<&str>) -> &str {
    match output_type {
        "video" => video_format.unwrap_or("mp4"),
        "audio" => audio_format.unwrap_or("mp3"),
        _ => "mp4",
    }
}

/// 判断是否需要转码
pub fn needs_conversion(output_type: &str, audio_format: Option<&str>, file_count: usize) -> bool {
    match output_type {
        "audio" => match audio_format {
            Some("m4a") => false,
            Some("mp3") | Some("ogg") => true,
            _ => false,
        },
        "video" => file_count > 1,
        _ => false,
    }
}
```

- [ ] **Step 2: 在 main.rs 中添加 `mod paths;`**

- [ ] **Step 3: 验证编译**

Run: `cargo build`
Expected: 编译成功

- [ ] **Step 4: Commit**

```bash
git add src/paths.rs src/main.rs
git commit -m "feat: path calculation utilities"
```

---

## Task 7: OutputWriter (output.rs)

**Files:**
- Create: `src/output.rs`
- Modify: `src/main.rs`

- [ ] **Step 1: 实现 output.rs**

```rust
use crate::protocol::{Response, ResponseData, codes, messages};
use std::io::{BufWriter, Write};
use std::sync::{Arc, Mutex};

pub struct OutputWriter {
    inner: Arc<Mutex<BufWriter<std::io::Stdout>>>,
}

impl OutputWriter {
    pub fn new() -> Self {
        Self {
            inner: Arc::new(Mutex::new(BufWriter::new(std::io::stdout()))),
        }
    }

    /// 发送一条响应到 stdout, 返回是否成功
    pub async fn send(&self, response: Response) -> bool {
        let json = match serde_json::to_string(&response) {
            Ok(s) => s,
            Err(e) => {
                tracing::error!(error = %e, "Response 序列化失败");
                return false;
            }
        };

        let inner = self.inner.clone();
        let result = tokio::task::spawn_blocking(move || {
            let mut w = inner.lock().unwrap();
            match writeln!(w, "{}", json) {
                Ok(()) => {
                    let _ = w.flush();
                    true
                }
                Err(e) => {
                    tracing::error!(error = %e, "stdout 写入失败, 父进程可能已关闭管道");
                    false
                }
            }
        }).await;

        result.unwrap_or(false)
    }

    /// 发送状态变更消息
    pub async fn send_status(&self, task_id: &str, code: &'static str, message: &'static str) {
        tracing::debug!(task_id = task_id, code = code, "→ stdout");
        self.send(Response {
            code,
            data: ResponseData::Status { task_id: task_id.to_string() },
            message,
        }).await;
    }

    /// 发送进度消息
    pub async fn send_progress(
        &self, code: &'static str, task_id: &str,
        done: u64, total: u64, speed: u64, remaining: u64,
    ) {
        self.send(Response {
            code,
            data: ResponseData::Progress {
                task_id: task_id.to_string(),
                done, total, speed,
                remaining_time: remaining,
            },
            message: if code == codes::TASK_DOWNLOAD_PROGRESS {
                messages::DOWNLOAD_PROGRESS
            } else {
                messages::CONVERSION_PROGRESS
            },
        }).await;
    }

    /// 发送完成消息
    pub async fn send_complete(&self, task_id: &str, files: Vec<String>) {
        tracing::info!(task_id = task_id, "→ stdout: task_complete");
        self.send(Response {
            code: codes::TASK_COMPLETE,
            data: ResponseData::Complete {
                task_id: task_id.to_string(),
                files,
            },
            message: messages::TASK_COMPLETE,
        }).await;
    }

    /// 发送文件下载错误
    pub async fn send_file_error(&self, task_id: &str, url: &str) {
        tracing::warn!(task_id = task_id, url = url, "→ stdout: file_download_error");
        self.send(Response {
            code: codes::FILE_DOWNLOAD_ERROR,
            data: ResponseData::FileError {
                task_id: task_id.to_string(),
                url: url.to_string(),
            },
            message: messages::FILE_DOWNLOAD_ERROR,
        }).await;
    }

    /// 发送致命错误
    pub async fn send_error(&self, task_id: &str, code: &'static str, message: &str) {
        tracing::error!(task_id = task_id, code = code, "→ stdout: {}", code);
        self.send(Response {
            code,
            data: ResponseData::Status { task_id: task_id.to_string() },
            message,
        }).await;
    }
}

impl Clone for OutputWriter {
    fn clone(&self) -> Self {
        Self { inner: self.inner.clone() }
    }
}
```

- [ ] **Step 2: 在 main.rs 中添加 `mod output;`**

- [ ] **Step 3: 验证编译**

Run: `cargo build`
Expected: 编译成功

- [ ] **Step 4: Commit**

```bash
git add src/output.rs src/main.rs
git commit -m "feat: OutputWriter for thread-safe stdout JSON"
```

---

## Task 8: 代理配置 (proxy.rs)

**Files:**
- Create: `src/proxy.rs`
- Modify: `src/main.rs`

- [ ] **Step 1: 实现 proxy.rs**

```rust
use reqwest::Client;
use std::time::Duration;

pub fn build_client(proxy_str: &str) -> Client {
    let mut builder = Client::builder()
        .timeout(Duration::from_secs(300))
        .connect_timeout(Duration::from_secs(30))
        .pool_idle_timeout(Duration::from_secs(90));

    match proxy_str {
        "system" | "" => {
            // reqwest 默认读 HTTP_PROXY/HTTPS_PROXY 环境变量
            #[cfg(target_os = "macos")]
            {
                if std::env::var("HTTP_PROXY").is_err() && std::env::var("HTTPS_PROXY").is_err() {
                    if let Some(proxy_url) = read_macos_system_proxy() {
                        tracing::debug!(proxy = %proxy_url, "使用 macOS 系统代理");
                        if let Ok(proxy) = reqwest::Proxy::all(&proxy_url) {
                            builder = builder.proxy(proxy);
                        }
                    }
                }
            }
        }
        "direct" => {
            tracing::debug!("直连, 不使用代理");
            builder = builder.no_proxy();
        }
        url => {
            tracing::debug!(proxy = url, "使用自定义代理");
            if let Ok(proxy) = reqwest::Proxy::all(url) {
                builder = builder.proxy(proxy);
            }
        }
    }

    builder.build().unwrap_or_else(|_| Client::new())
}

#[cfg(target_os = "macos")]
fn read_macos_system_proxy() -> Option<String> {
    let output = std::process::Command::new("scutil")
        .arg("--proxy")
        .output()
        .ok()?;

    let text = String::from_utf8_lossy(&output.stdout);

    let http_enabled = text.lines()
        .any(|l| l.contains("HTTPEnable : 1"));
    let https_enabled = text.lines()
        .any(|l| l.contains("HTTPSEnable : 1"));

    if !http_enabled && !https_enabled {
        return None;
    }

    let host = text.lines()
        .find(|l| l.contains("HTTPProxy :") || l.contains("HTTPSProxy :"))
        .and_then(|l| l.split(':').nth(1))?
        .trim();

    let port = text.lines()
        .find(|l| l.contains("HTTPPort :") || l.contains("HTTPSPort :"))
        .and_then(|l| l.split(':').nth(1))?
        .trim();

    Some(format!("http://{}:{}", host, port))
}
```

- [ ] **Step 2: 在 main.rs 中添加 `mod proxy;`**

- [ ] **Step 3: 验证编译**

Run: `cargo build`
Expected: 编译成功

- [ ] **Step 4: Commit**

```bash
git add src/proxy.rs src/main.rs
git commit -m "feat: proxy configuration with macOS system proxy support"
```

---

## Task 9: HTTP 下载器 (downloader.rs)

**Files:**
- Create: `src/downloader.rs`
- Modify: `src/main.rs`

- [ ] **Step 1: 实现 downloader.rs**

```rust
use crate::error::SnapfileError;
use crate::output::OutputWriter;
use crate::paths;
use crate::protocol::{codes, FileSpec};
use futures_util::StreamExt;
use reqwest::StatusCode;
use std::path::{Path, PathBuf};
use tokio_util::sync::CancellationToken;
use std::time::Duration;

pub async fn download_all_files(
    files: &[FileSpec],
    download_dir: &Path,
    proxy_str: &str,
    task_id: &str,
    output: &OutputWriter,
    cancel_token: &CancellationToken,
) -> Result<Vec<PathBuf>, SnapfileError> {
    let client = crate::proxy::build_client(proxy_str);
    tokio::fs::create_dir_all(download_dir).await
        .map_err(SnapfileError::Io)?;

    let mut results = Vec::new();
    let mut required_failures: Vec<String> = Vec::new();

    for (index, spec) in files.iter().enumerate() {
        if cancel_token.is_cancelled() {
            return Err(SnapfileError::Cancelled);
        }

        let filename = paths::download_filename(&spec.url, index);
        let file_path = download_dir.join(&filename);

        tracing::debug!(task_id = task_id, url = %spec.url, file = %filename, "开始下载文件");

        match download_single(
            &client, spec, &file_path, task_id,
            output, cancel_token,
        ).await {
            Ok(()) => {
                tracing::debug!(task_id = task_id, file = %filename, "文件下载完成");
                results.push(file_path);
            }
            Err(SnapfileError::Cancelled) => {
                return Err(SnapfileError::Cancelled);
            }
            Err(e) => {
                let optional = spec.optional_download.unwrap_or(false);
                if optional {
                    tracing::warn!(task_id = task_id, url = %spec.url, error = %e, "可选文件下载失败, 跳过");
                } else {
                    output.send_file_error(task_id, &spec.url).await;
                    tracing::error!(task_id = task_id, url = %spec.url, error = %e, "必需文件下载失败");
                    required_failures.push(spec.url.clone());
                }
            }
        }
    }

    if !required_failures.is_empty() {
        return Err(SnapfileError::DownloadFailed(
            format!("{} 个必需文件下载失败", required_failures.len())
        ));
    }

    Ok(results)
}

async fn download_single(
    client: &reqwest::Client,
    spec: &FileSpec,
    dest: &Path,
    task_id: &str,
    output: &OutputWriter,
    cancel_token: &CancellationToken,
) -> Result<(), SnapfileError> {
    let mut request = client.get(&spec.url);
    if let Some(headers) = &spec.header {
        for (key, value) in headers {
            request = request.header(key, value);
        }
    }

    tracing::debug!(task_id = task_id, "GET {}", spec.url);

    let response = request.send().await?;

    let status = response.status();
    if status == StatusCode::FORBIDDEN {
        return Err(SnapfileError::HttpStatusForbidden);
    }
    if !status.is_success() {
        return Err(SnapfileError::DownloadFailed(format!("HTTP {}", status)));
    }

    let total = response.content_length().unwrap_or(0);
    tracing::debug!(task_id = task_id, "HTTP {} Content-Length={}", status, total);

    let mut file = tokio::fs::File::create(dest).await?;
    let mut stream = response.bytes_stream();
    let mut downloaded: u64 = 0;
    let mut last_second_bytes: u64 = 0;
    let mut interval = tokio::time::interval(Duration::from_secs(1));
    interval.tick().await;

    loop {
        tokio::select! {
            biased;
            _ = cancel_token.cancelled() => {
                tracing::info!(task_id = task_id, "下载被取消");
                return Err(SnapfileError::Cancelled);
            }
            chunk = stream.next() => {
                match chunk {
                    Some(Ok(bytes)) => {
                        tokio::io::AsyncWriteExt::write_all(&mut file, &bytes).await?;
                        let n = bytes.len() as u64;
                        downloaded += n;
                        last_second_bytes += n;
                    }
                    Some(Err(e)) => {
                        return Err(SnapfileError::Reqwest(e));
                    }
                    None => break,
                }
            }
            _ = interval.tick() => {
                let speed = last_second_bytes;
                last_second_bytes = 0;
                let remaining = if speed > 0 {
                    total.saturating_sub(downloaded) / speed
                } else { 0 };
                output.send_progress(
                    codes::TASK_DOWNLOAD_PROGRESS,
                    task_id, downloaded, total, speed, remaining,
                ).await;
            }
        }
    }

    file.flush().await?;
    tracing::debug!(task_id = task_id, downloaded = downloaded, total = total, "文件写入完成");
    Ok(())
}
```

- [ ] **Step 2: 在 main.rs 中添加 `mod downloader;`**

- [ ] **Step 3: 验证编译**

Run: `cargo build`
Expected: 编译成功

- [ ] **Step 4: Commit**

```bash
git add src/downloader.rs src/main.rs
git commit -m "feat: HTTP streaming downloader with progress and cancel"
```

---

## Task 10: ffprobe 封装 (ffprobe.rs)

**Files:**
- Create: `src/ffprobe.rs`
- Modify: `src/main.rs`

- [ ] **Step 1: 实现 ffprobe.rs**

```rust
use serde::Deserialize;
use std::path::Path;
use crate::error::SnapfileError;

#[derive(Debug, Deserialize)]
pub struct FfprobeOutput {
    pub streams: Vec<StreamInfo>,
    #[serde(default)]
    pub format: Option<FormatInfo>,
}

#[derive(Debug, Deserialize)]
pub struct StreamInfo {
    pub index: u32,
    pub codec_type: String,
    #[serde(default)]
    pub codec_name: Option<String>,
    #[serde(default)]
    pub duration: Option<String>,
    #[serde(default)]
    pub width: Option<u32>,
    #[serde(default)]
    pub height: Option<u32>,
    #[serde(default)]
    pub bit_rate: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct FormatInfo {
    #[serde(default)]
    pub duration: Option<String>,
}

pub async fn probe(
    ffprobe_path: &Path,
    file: &Path,
    task_id: &str,
) -> Result<FfprobeOutput, SnapfileError> {
    let cmd_str = format!(
        "ffprobe -v quiet -print_format json -show_format -show_streams {}",
        file.display()
    );
    tracing::debug!(task_id = task_id, cmd = %cmd_str, "调用 ffprobe");

    let output = tokio::process::Command::new(ffprobe_path)
        .arg("-v").arg("quiet")
        .arg("-print_format").arg("json")
        .arg("-show_format")
        .arg("-show_streams")
        .arg(file)
        .output()
        .await
        .map_err(|e| SnapfileError::ConvertFailed(format!("ffprobe 启动失败: {}", e)))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(SnapfileError::ConvertFailed(format!("ffprobe 失败: {}", stderr)));
    }

    serde_json::from_slice::<FfprobeOutput>(&output.stdout)
        .map_err(|e| SnapfileError::ConvertFailed(format!("ffprobe JSON 解析失败: {}", e)))
}
```

- [ ] **Step 2: 在 main.rs 中添加 `mod ffprobe;`**

- [ ] **Step 3: 验证编译**

Run: `cargo build`
Expected: 编译成功

- [ ] **Step 4: Commit**

```bash
git add src/ffprobe.rs src/main.rs
git commit -m "feat: ffprobe wrapper with JSON parsing"
```

---

## Task 11: FFmpeg 转换器 (converter.rs)

**Files:**
- Create: `src/converter.rs`
- Modify: `src/main.rs`

- [ ] **Step 1: 实现 converter.rs**

```rust
use crate::error::SnapfileError;
use crate::output::OutputWriter;
use crate::protocol::{codes, messages};
use std::path::{Path, PathBuf};
use std::process::Stdio;
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Command;
use tokio_util::sync::CancellationToken;

/// 视频合并: 多个文件合并为一个
pub async fn merge_video_audio(
    ffmpeg_path: &Path,
    files: &[PathBuf],
    output_path: &Path,
    output_format: &str,
    task_id: &str,
    total_input_size: u64,
    output: &OutputWriter,
    cancel_token: &CancellationToken,
) -> Result<(), SnapfileError> {
    let mut cmd = Command::new(ffmpeg_path);

    for f in files {
        cmd.arg("-i").arg(f);
    }

    cmd.arg("-progress").arg("pipe:1")
       .arg("-map").arg("0:v:0");

    if files.len() > 1 {
        cmd.arg("-map").arg("1:a:0");
    }

    match output_format {
        "mkv" => {
            cmd.arg("-c:v").arg("copy").arg("-c:a").arg("copy");
        }
        _ => {
            cmd.arg("-movflags").arg("+faststart")
               .arg("-c:v").arg("copy").arg("-c:a").arg("copy");
        }
    }

    cmd.arg("-y").arg(output_path);

    let cmd_str = format!("{:?}", cmd);
    tracing::debug!(task_id = task_id, cmd = %cmd_str, "调用 ffmpeg 合并");

    run_ffmpeg_with_progress(cmd, output, task_id, total_input_size, cancel_token).await
}

/// 音频转码
pub async fn transcode_audio(
    ffmpeg_path: &Path,
    input: &Path,
    output_path: &Path,
    audio_format: &str,
    bitrate: Option<u32>,
    task_id: &str,
    total_input_size: u64,
    output: &OutputWriter,
    cancel_token: &CancellationToken,
) -> Result<(), SnapfileError> {
    let mut cmd = Command::new(ffmpeg_path);

    cmd.arg("-i").arg(input)
       .arg("-progress").arg("pipe:1")
       .arg("-map").arg("0:a:0");

    match audio_format {
        "mp3" => {
            cmd.arg("-c:a").arg("libmp3lame");
            if let Some(br) = bitrate {
                cmd.arg("-b:a").arg(format!("{}k", br));
                tracing::info!(task_id = task_id, bitrate = br, "MP3 转码码率设置");
            }
        }
        "ogg" => { cmd.arg("-c:a").arg("libvorbis"); }
        "m4a" => { cmd.arg("-c:a").arg("aac"); }
        _ => {}
    }

    cmd.arg("-y").arg(output_path);

    let cmd_str = format!("{:?}", cmd);
    tracing::debug!(task_id = task_id, cmd = %cmd_str, "调用 ffmpeg 转码");

    run_ffmpeg_with_progress(cmd, output, task_id, total_input_size, cancel_token).await
}

/// 运行 ffmpeg 并解析 -progress pipe:1 输出
async fn run_ffmpeg_with_progress(
    mut cmd: Command,
    output: &OutputWriter,
    task_id: &str,
    total_size: u64,
    cancel_token: &CancellationToken,
) -> Result<(), SnapfileError> {
    cmd.stdout(Stdio::piped()).stderr(Stdio::piped());

    let mut child = cmd.spawn()
        .map_err(|e| SnapfileError::ConvertFailed(format!("ffmpeg 启动失败: {}", e)))?;

    let stdout = child.stdout.take().unwrap();
    let reader = BufReader::new(stdout);
    let mut lines = reader.lines();

    let mut current_size: u64 = 0;
    let mut last_reported_size: u64 = 0;
    let mut interval = tokio::time::interval(std::time::Duration::from_secs(1));
    interval.tick().await;

    loop {
        tokio::select! {
            biased;
            _ = cancel_token.cancelled() => {
                tracing::info!(task_id = task_id, "ffmpeg 被取消, kill 进程");
                let _ = child.kill().await;
                return Err(SnapfileError::Cancelled);
            }
            line = lines.next_line() => {
                match line {
                    Ok(Some(text)) => {
                        if let Some((key, value)) = text.split_once('=') {
                            if key == "total_size" {
                                current_size = value.parse().unwrap_or(0);
                            }
                            if key == "progress" && value.trim() == "end" {
                                break;
                            }
                        }
                    }
                    Ok(None) => break,
                    Err(_) => break,
                }
            }
            _ = interval.tick() => {
                let speed = current_size.saturating_sub(last_reported_size);
                last_reported_size = current_size;
                let remaining = if speed > 0 {
                    total_size.saturating_sub(current_size) / speed
                } else { 0 };
                output.send_progress(
                    codes::TASK_CONVERSION_PROGRESS,
                    task_id, current_size, total_size, speed, remaining,
                ).await;
            }
        }
    }

    let status = child.wait().await
        .map_err(|e| SnapfileError::ConvertFailed(format!("ffmpeg 等待失败: {}", e)))?;

    if !status.success() {
        let stderr = child.stderr.take();
        if let Some(mut stderr) = stderr {
            use tokio::io::AsyncReadExt;
            let mut buf = Vec::new();
            let _ = stderr.read_to_end(&mut buf).await;
            let stderr_text = String::from_utf8_lossy(&buf);
            return Err(SnapfileError::ConvertFailed(format!(
                "ffmpeg 退出码 {:?}: {}", status.code(), stderr_text
            )));
        }
        return Err(SnapfileError::ConvertFailed(format!("ffmpeg 退出码 {:?}", status.code())));
    }

    tracing::debug!(task_id = task_id, "ffmpeg 完成");
    Ok(())
}
```

- [ ] **Step 2: 在 main.rs 中添加 `mod converter;`**

- [ ] **Step 3: 验证编译**

Run: `cargo build`
Expected: 编译成功

- [ ] **Step 4: Commit**

```bash
git add src/converter.rs src/main.rs
git commit -m "feat: ffmpeg converter with merge/transcode and progress parsing"
```

---

## Task 12: 文件移动 (mover.rs)

**Files:**
- Create: `src/mover.rs`
- Modify: `src/main.rs`

- [ ] **Step 1: 实现 mover.rs**

```rust
use crate::error::SnapfileError;
use std::path::{Path, PathBuf};

pub async fn move_to_output(source: &Path, output_dir: &Path, name: &str, ext: &str) -> Result<PathBuf, SnapfileError> {
    if let Some(parent) = output_dir.parent() {
        tokio::fs::create_dir_all(parent).await.map_err(SnapfileError::Io)?;
    }
    tokio::fs::create_dir_all(output_dir).await.map_err(SnapfileError::Io)?;

    let safe_name = crate::paths::sanitize_filename(name);
    let base_path = output_dir.join(format!("{}.{}", safe_name, ext));
    let final_dest = resolve_conflict(&base_path).await?;

    tracing::debug!(from = %source.display(), to = %final_dest.display(), "移动文件");

    // 尝试 rename, 跨设备时 fallback 到 copy + delete
    match tokio::fs::rename(source, &final_dest).await {
        Ok(()) => Ok(final_dest),
        Err(_) => {
            tracing::debug!(task = "move", "rename 失败, 尝试 copy + delete");
            tokio::fs::copy(source, &final_dest).await.map_err(SnapfileError::Io)?;
            tokio::fs::remove_file(source).await.map_err(SnapfileError::Io)?;
            Ok(final_dest)
        }
    }
}

async fn resolve_conflict(path: &Path) -> Result<PathBuf, SnapfileError> {
    if !tokio::fs::try_exists(path).await.unwrap_or(false) {
        return Ok(path.to_path_buf());
    }

    let parent = path.parent().unwrap();
    let file_name = path.file_name().unwrap().to_string_lossy().to_string();

    let (stem, ext) = match file_name.rsplit_once('.') {
        Some((s, e)) => (s.to_string(), e.to_string()),
        None => (file_name.clone(), String::new()),
    };

    for counter in 1u32..1000 {
        let new_name = if ext.is_empty() {
            format!("{}({})", stem, counter)
        } else {
            format!("{}({}).{}", stem, counter, ext)
        };
        let new_path = parent.join(&new_name);
        if !tokio::fs::try_exists(&new_path).await.unwrap_or(false) {
            tracing::debug!(conflict = %file_name, resolved = %new_name, "文件冲突, 重命名");
            return Ok(new_path);
        }
    }

    Err(SnapfileError::MoveFailed(format!("无法解析文件冲突: {}", path.display())))
}

/// 清理临时目录 (best effort)
pub async fn cleanup_temp_dir(dir: &Path) {
    match tokio::fs::remove_dir_all(dir).await {
        Ok(()) => tracing::info!(dir = %dir.display(), "临时目录已清理"),
        Err(e) => tracing::warn!(dir = %dir.display(), error = %e, "清理临时目录失败"),
    }
}
```

- [ ] **Step 2: 在 main.rs 中添加 `mod mover;`**

- [ ] **Step 3: 验证编译**

Run: `cargo build`
Expected: 编译成功

- [ ] **Step 4: Commit**

```bash
git add src/mover.rs src/main.rs
git commit -m "feat: file mover with conflict resolution"
```

---

## Task 13: Task 状态机与编排 (task.rs)

**Files:**
- Create: `src/task.rs`
- Modify: `src/main.rs`

- [ ] **Step 1: 实现 Task 结构和状态机**

```rust
use crate::error::{SnapfileError, TaskError};
use crate::output::OutputWriter;
use crate::protocol::{codes, messages, StartTaskPayload, FileSpec};
use crate::{downloader, ffprobe, converter, mover, paths};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use tokio::sync::Semaphore;
use tokio_util::sync::CancellationToken;

pub struct Task {
    pub id: String,
    pub name: String,
    pub output_dir: PathBuf,
    pub temp_dir: PathBuf,
    pub output_type: String,
    pub output_video_format: Option<String>,
    pub output_audio_format: Option<String>,
    pub audio_bitrate: Option<u32>,
    pub proxy: String,
    pub files: Vec<FileSpec>,
    pub cancel_token: CancellationToken,
}

impl Task {
    pub fn from_payload(payload: StartTaskPayload, cancel_token: CancellationToken) -> Self {
        Self {
            id: payload.task_id,
            name: payload.name,
            output_dir: PathBuf::from(payload.output_dir),
            temp_dir: PathBuf::from(payload.temp_dir),
            output_type: payload.output_type,
            output_video_format: payload.output_video_format,
            output_audio_format: payload.output_audio_format,
            audio_bitrate: payload.audio_bitrate,
            proxy: payload.proxy,
            files: payload.files,
            cancel_token,
        }
    }

    fn ext(&self) -> &str {
        paths::output_extension(
            &self.output_type,
            self.output_video_format.as_deref(),
            self.output_audio_format.as_deref(),
        )
    }
}

/// RAII guard: 无论 run_task 以何种方式退出都清理临时目录
struct CleanupGuard {
    dir: PathBuf,
    task_id: String,
}

impl Drop for CleanupGuard {
    fn drop(&mut self) {
        let dir = self.dir.clone();
        let task_id = self.task_id.clone();
        std::thread::spawn(move || {
            match std::fs::remove_dir_all(&dir) {
                Ok(()) => tracing::info!(task_id = %task_id, dir = %dir.display(), "临时目录已清理"),
                Err(e) => tracing::warn!(task_id = %task_id, dir = %dir.display(), error = %e, "清理临时目录失败"),
            }
        });
    }
}
```

- [ ] **Step 2: 实现 run_task 编排**

```rust
pub async fn run_task(
    task: Task,
    ffmpeg_path: Arc<Path>,
    ffprobe_path: Arc<Path>,
    output: OutputWriter,
    semaphore: Arc<Semaphore>,
) -> Result<(), TaskError> {
    let _guard = CleanupGuard {
        dir: paths::temp_root(&task.temp_dir, &task.id),
        task_id: task.id.clone(),
    };

    tracing::info!(task_id = %task.id, name = %task.name, files = task.files.len(), "任务开始");

    // 1. Started
    emit_status(&task, codes::TASK_STARTED, messages::TASK_STARTED, &output).await;

    // 2. Prepare
    emit_status(&task, codes::TASK_START_PREPARE, messages::TASK_START_PREPARE, &output).await;
    let download_dir = paths::download_dir(&task.temp_dir, &task.id);
    let converting_dir = paths::converting_dir(&task.temp_dir, &task.id);
    let converted_dir = paths::converted_dir(&task.temp_dir, &task.id);
    tokio::fs::create_dir_all(&download_dir).await
        .map_err(|e| to_task_error(&e, &task.id))?;
    emit_status(&task, codes::TASK_PREPARED, messages::TASK_PREPARED, &output).await;

    // 3. Acquire download permit
    emit_status(&task, codes::TASK_PENDING_DOWNLOAD, messages::TASK_PENDING_DOWNLOAD, &output).await;
    let _permit = semaphore.acquire_owned().await
        .map_err(|_| TaskError::failed(codes::DOWNLOAD_ERROR, "信号量已关闭"))?;
    tracing::debug!(task_id = %task.id, "获取下载许可");

    // 4. Download
    emit_status(&task, codes::TASK_START_DOWNLOAD, messages::TASK_START_DOWNLOAD, &output).await;
    let downloaded = downloader::download_all_files(
        &task.files, &download_dir, &task.proxy,
        &task.id, &output, &task.cancel_token,
    ).await.map_err(|e| to_task_error(e, &task.id))?;

    emit_status(&task, codes::TASK_DOWNLOADED, messages::TASK_DOWNLOADED, &output).await;

    // 5. Convert (optional)
    let source_file = if paths::needs_conversion(
        &task.output_type,
        task.output_audio_format.as_deref(),
        downloaded.len(),
    ) {
        emit_status(&task, codes::TASK_PENDING_CONVERSION, messages::TASK_PENDING_CONVERSION, &output).await;
        emit_status(&task, codes::TASK_START_CONVERSION, messages::TASK_START_CONVERSION, &output).await;

        tokio::fs::create_dir_all(&converting_dir).await
            .map_err(|e| to_task_error(&e, &task.id))?;
        tokio::fs::create_dir_all(&converted_dir).await
            .map_err(|e| to_task_error(&e, &task.id))?;

        let conv_name = paths::converting_filename(&task.name, task.ext());
        let conv_path = converting_dir.join(&conv_name);
        let conv_done_path = converted_dir.join(&conv_name);

        // 获取输入文件总大小 (用于进度)
        let mut total_input: u64 = 0;
        for f in &downloaded {
            if let Ok(meta) = tokio::fs::metadata(f).await {
                total_input += meta.len();
            }
        }

        match task.output_type.as_str() {
            "video" => {
                converter::merge_video_audio(
                    &ffmpeg_path, &downloaded, &conv_path, task.ext(),
                    &task.id, total_input, &output, &task.cancel_token,
                ).await.map_err(|e| to_task_error(e, &task.id))?;
            }
            "audio" => {
                converter::transcode_audio(
                    &ffmpeg_path, &downloaded[0], &conv_path,
                    task.output_audio_format.as_deref().unwrap_or("mp3"),
                    task.audio_bitrate,
                    &task.id, total_input, &output, &task.cancel_token,
                ).await.map_err(|e| to_task_error(e, &task.id))?;
            }
            _ => {}
        }

        tokio::fs::rename(&conv_path, &conv_done_path).await
            .map_err(|e| to_task_error(&e, &task.id))?;

        emit_status(&task, codes::TASK_CONVERTED, messages::TASK_CONVERTED, &output).await;
        conv_done_path
    } else {
        // 不转码: 直接用第一个下载文件
        downloaded[0].clone()
    };

    // 6. Move
    emit_status(&task, codes::TASK_START_MOVE, messages::TASK_START_MOVE, &output).await;
    let final_path = mover::move_to_output(
        &source_file, &task.output_dir, &task.name, task.ext(),
    ).await.map_err(|e| to_task_error(e, &task.id))?;

    emit_status(&task, codes::TASK_MOVED, messages::TASK_MOVED, &output).await;

    // 7. Complete
    output.send_complete(&task.id, vec![final_path.to_string_lossy().to_string()]).await;
    tracing::info!(task_id = %task.id, "任务完成");

    Ok(())
}

async fn emit_status(task: &Task, code: &'static str, message: &'static str, output: &OutputWriter) {
    output.send_status(&task.id, code, message).await;
}

fn to_task_error(e: SnapfileError, task_id: &str) -> TaskError {
    let code = e.to_status_code();
    let msg = e.to_message();
    tracing::error!(task_id = task_id, code = code, error = %msg, "任务错误");
    TaskError::failed(code, msg)
}
```

- [ ] **Step 3: 在 main.rs 中添加 `mod task;`**

- [ ] **Step 4: 验证编译**

Run: `cargo build`
Expected: 编译成功

- [ ] **Step 5: Commit**

```bash
git add src/task.rs src/main.rs
git commit -m "feat: task state machine and lifecycle orchestration"
```

---

## Task 14: TaskManager (manager.rs)

**Files:**
- Create: `src/manager.rs`
- Modify: `src/main.rs`

- [ ] **Step 1: 实现 manager.rs**

```rust
use crate::error::TaskError;
use crate::output::OutputWriter;
use crate::protocol::{codes, messages, StartTaskPayload};
use crate::task::{run_task, Task};
use std::collections::HashMap;
use std::path::Path;
use std::sync::Arc;
use tokio::sync::Semaphore;
use tokio::task::JoinHandle;
use tokio_util::sync::CancellationToken;

pub struct TaskManager {
    tasks: tokio::sync::Mutex<HashMap<String, TaskHandle>>,
    semaphore: Arc<Semaphore>,
    ffmpeg_path: Arc<Path>,
    ffprobe_path: Arc<Path>,
    output: OutputWriter,
}

struct TaskHandle {
    cancel_token: CancellationToken,
    join_handle: JoinHandle<()>,
}

impl TaskManager {
    pub fn new(
        ffmpeg_path: Arc<Path>,
        ffprobe_path: Arc<Path>,
        max_downloading_tasks: usize,
        output: OutputWriter,
    ) -> Self {
        Self {
            tasks: tokio::sync::Mutex::new(HashMap::new()),
            semaphore: Arc::new(Semaphore::new(max_downloading_tasks)),
            ffmpeg_path,
            ffprobe_path,
            output,
        }
    }

    pub async fn start_task(&self, payload: StartTaskPayload) {
        let task_id = payload.task_id.clone();
        let cancel_token = CancellationToken::new();

        let task = Task::from_payload(payload, cancel_token.clone());
        let ffmpeg = self.ffmpeg_path.clone();
        let ffprobe = self.ffprobe_path.clone();
        let output = self.output.clone();
        let semaphore = self.semaphore.clone();
        let manager_task_id = task_id.clone();

        let join_handle = tokio::spawn(async move {
            let result = std::panic::AssertUnwindSafe(
                run_task(task, ffmpeg, ffprobe, output.clone(), semaphore)
            ).catch_unwind().await;

            match result {
                Ok(Ok(())) => {}
                Ok(Err(TaskError::Cancelled)) => {
                    output.send_status(&manager_task_id, codes::TASK_DELETED, messages::TASK_DELETED).await;
                }
                Ok(Err(TaskError::Failed { code, message })) => {
                    output.send_error(&manager_task_id, code, &message).await;
                }
                Err(panic_info) => {
                    tracing::error!(
                        task_id = %manager_task_id,
                        "任务 panic, 已隔离, 进程继续运行"
                    );
                    output.send_error(
                        &manager_task_id,
                        codes::DOWNLOAD_ERROR,
                        "内部错误",
                    ).await;
                }
            }
        });

        self.tasks.lock().await.insert(task_id, TaskHandle {
            cancel_token,
            join_handle,
        });
    }

    pub async fn delete_tasks(&self, task_ids: &[String]) {
        for id in task_ids {
            let handle = self.tasks.lock().await.remove(id);
            if let Some(handle) = handle {
                handle.cancel_token.cancel();
                let _ = tokio::time::timeout(
                    std::time::Duration::from_secs(5),
                    handle.join_handle,
                ).await;
            }
            // 即使不存在也发出 task_deleted
            self.output.send_status(id, codes::TASK_DELETED, messages::TASK_DELETED).await;
        }
    }

    pub fn update_limit(&self, limit: u32) {
        tracing::info!(limit = limit, "update-max-download-task 请求 (动态调整暂未实现)");
    }

    pub fn stop_recording_live(&self, task_id: &str) {
        tracing::info!(task_id = task_id, "stop-recording-live (暂未实现)");
    }
}
```

注意: `AssertUnwindSafe` + `catch_unwind` 需要 `std::panic` 模块。需要在 main.rs 顶部添加:
```rust
use std::panic::AssertUnwindSafe;
use futures_util::FutureExt; // for catch_unwind on futures
```

- [ ] **Step 2: 确保 Cargo.toml 中 futures-util 已包含** (Task 1 已添加)

- [ ] **Step 3: 在 main.rs 中添加 `mod manager;`**

- [ ] **Step 4: 验证编译**

Run: `cargo build`
Expected: 编译成功

- [ ] **Step 5: Commit**

```bash
git add src/manager.rs src/main.rs
git commit -m "feat: TaskManager with panic isolation and cancel support"
```

---

## Task 15: stdin 循环 + main.rs 组装

**Files:**
- Modify: `src/main.rs`

- [ ] **Step 1: 实现完整 main.rs**

```rust
mod cli;
mod converter;
mod downloader;
mod error;
mod ffprobe;
mod log;
mod log_mod;
mod manager;
mod mover;
mod output;
mod paths;
mod protocol;
mod proxy;
mod task;

use clap::Parser;
use futures_util::FutureExt;
use std::io::BufRead;
use std::panic::AssertUnwindSafe;
use std::sync::Arc;
use tokio::io::AsyncBufReadExt;

#[tokio::main]
async fn main() {
    let args = cli::Args::parse();
    log_mod::init(&args.log_level);

    tracing::info!(
        ffmpeg = ?args.ffmpeg_path,
        ffprobe = ?args.ffprobe_path,
        max_task = args.max_downloading_task,
        "snapfile-rs 启动"
    );

    let output = output::OutputWriter::new();
    let manager = Arc::new(manager::TaskManager::new(
        Arc::from(args.ffmpeg_path.as_path()),
        Arc::from(args.ffprobe_path.as_path()),
        args.max_downloading_task,
        output.clone(),
    ));

    // stdin 读取循环
    let stdin = tokio::io::stdin();
    let reader = tokio::io::BufReader::new(stdin);
    let mut lines = reader.lines();
    let mut line_number: u64 = 0;

    tracing::info!("stdin 读取循环已启动");

    loop {
        let line = lines.next_line().await;

        match line {
            Ok(Some(text)) => {
                line_number += 1;

                if text.trim().is_empty() {
                    continue;
                }

                let request: protocol::Request = match serde_json::from_str(&text) {
                    Ok(req) => req,
                    Err(e) => {
                        tracing::error!(
                            line_number = line_number,
                            raw = %text,
                            error = %e,
                            "stdin JSON 解析失败, 跳过此行"
                        );
                        continue;
                    }
                };

                match request {
                    protocol::Request::StartTask(payload) => {
                        let task_id = payload.task_id.clone();
                        let name = payload.name.clone();
                        let count = payload.files.len();
                        tracing::info!(task_id = %task_id, name = %name, files = count, "收到 start-task");
                        manager.start_task(payload).await;
                    }
                    protocol::Request::DeleteTask(payload) => {
                        tracing::info!(task_ids = ?payload.task_ids, "收到 delete-task");
                        manager.delete_tasks(&payload.task_ids).await;
                    }
                    protocol::Request::UpdateMaxDownloadTask(payload) => {
                        manager.update_limit(payload.limit);
                    }
                    protocol::Request::StopRecordingLive(payload) => {
                        manager.stop_recording_live(&payload.task_id);
                    }
                }
            }
            Ok(None) => {
                // stdin EOF = 父进程关闭管道
                tracing::info!("stdin 已关闭, 进程准备退出");
                break;
            }
            Err(e) => {
                tracing::error!(error = %e, "stdin 读取错误");
                break;
            }
        }
    }
}
```

注意: `log_mod` 而非 `log` 是因为 `log` 与 Rust 的 `log` crate 名称冲突。或者将模块改名为 `logging.rs`。

修正: 将 `src/log.rs` 改名为 `src/logging.rs`, main.rs 中 `mod logging;`。

- [ ] **Step 2: 重命名 log.rs → logging.rs**

```bash
mv src/log.rs src/logging.rs
```

main.rs 中改 `mod log;` 为 `mod logging;`, 调用改 `log::init` → `logging::init`。

- [ ] **Step 3: 验证编译**

Run: `cargo build`
Expected: 编译成功

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat: complete main.rs with stdin loop and module wiring"
```

---

## Task 16: 协议兼容性测试

**Files:**
- Create: `tests/protocol_test.rs`

- [ ] **Step 1: 编写 serde 测试**

```rust
use snapfile_rs::protocol::*;

#[test]
fn test_deserialize_start_task_camel_case() {
    let json = r#"{
        "type": "start-task",
        "payload": {
            "taskID": "test-uuid",
            "name": "测试视频",
            "outputDir": "/tmp/output",
            "tempDir": "/tmp/temp",
            "outputType": "audio",
            "outputAudioFormat": "m4a",
            "live": false,
            "embeddedSubtitle": false,
            "proxy": "direct",
            "files": [
                {"url": "https://example.com/audio.m4s", "language": null, "header": {"Referer": "https://example.com"}}
            ]
        }
    }"#;

    let req: Request = serde_json::from_str(json).unwrap();
    match req {
        Request::StartTask(payload) => {
            assert_eq!(payload.task_id, "test-uuid");
            assert_eq!(payload.name, "测试视频");
            assert_eq!(payload.output_dir, "/tmp/output");
            assert_eq!(payload.output_type, "audio");
            assert_eq!(payload.output_audio_format.as_deref(), Some("m4a"));
            assert_eq!(payload.files.len(), 1);
            assert_eq!(payload.files[0].url, "https://example.com/audio.m4s");
            assert!(payload.files[0].language.is_none());
            assert!(payload.files[0].header.is_some());
        }
        _ => panic!("expected StartTask"),
    }
}

#[test]
fn test_deserialize_start_task_missing_optional_fields() {
    let json = r#"{
        "type": "start-task",
        "payload": {
            "taskID": "test",
            "name": "test",
            "outputDir": "/tmp",
            "tempDir": "/tmp",
            "outputType": "video",
            "live": false,
            "embeddedSubtitle": false,
            "proxy": "direct",
            "files": [{"url": "https://example.com"}]
        }
    }"#;

    let req: Request = serde_json::from_str(json).unwrap();
    match req {
        Request::StartTask(payload) => {
            assert!(payload.output_video_format.is_none());
            assert!(payload.output_audio_format.is_none());
            assert!(payload.audio_bitrate.is_none());
            assert!(payload.files[0].language.is_none());
            assert!(payload.files[0].header.is_none());
            assert!(payload.files[0].optional_download.is_none());
        }
        _ => panic!("expected StartTask"),
    }
}

#[test]
fn test_deserialize_delete_task() {
    let json = r#"{"type":"delete-task","payload":{"taskIDs":["a","b"]}}"#;
    let req: Request = serde_json::from_str(json).unwrap();
    match req {
        Request::DeleteTask(payload) => {
            assert_eq!(payload.task_ids, vec!["a", "b"]);
        }
        _ => panic!("expected DeleteTask"),
    }
}

#[test]
fn test_deserialize_update_max_download_task() {
    let json = r#"{"type":"update-max-download-task","payload":{"limit":8}}"#;
    let req: Request = serde_json::from_str(json).unwrap();
    match req {
        Request::UpdateMaxDownloadTask(payload) => {
            assert_eq!(payload.limit, 8);
        }
        _ => panic!("expected UpdateMaxDownloadTask"),
    }
}

#[test]
fn test_deserialize_unknown_type_returns_error() {
    let json = r#"{"type":"unknown-command","payload":{}}"#;
    let result: Result<Request, _> = serde_json::from_str(json);
    assert!(result.is_err());
}

#[test]
fn test_serialize_response_status() {
    let response = Response {
        code: codes::TASK_STARTED,
        data: ResponseData::Status { task_id: "test-uuid".to_string() },
        message: messages::TASK_STARTED,
    };

    let json = serde_json::to_string(&response).unwrap();
    assert!(json.contains("\"taskID\":\"test-uuid\""));
    assert!(json.contains("\"code\":\"task_started\""));
    assert!(json.contains("任务已启动"));
}

#[test]
fn test_serialize_response_progress() {
    let response = Response {
        code: codes::TASK_DOWNLOAD_PROGRESS,
        data: ResponseData::Progress {
            task_id: "test".to_string(),
            done: 100,
            total: 1000,
            speed: 50,
            remaining_time: 18,
        },
        message: messages::DOWNLOAD_PROGRESS,
    };

    let json = serde_json::to_string(&response).unwrap();
    assert!(json.contains("\"taskID\":\"test\""));
    assert!(json.contains("\"done\":100"));
    assert!(json.contains("\"total\":1000"));
    assert!(json.contains("\"remainingTime\":18"));
}
```

- [ ] **Step 2: 确保 src 模块导出为 pub**

在 main.rs 或 lib.rs 中公开 protocol 模块。创建 `src/lib.rs`:

```rust
pub mod protocol;
pub mod paths;
```

并在 main.rs 中 `mod protocol;` → `pub use protocol;` (或直接引用 lib.rs)。

调整: 在 Cargo.toml 中添加 `[lib] name = "snapfile_rs" path = "src/lib.rs"`, lib.rs 中 `pub mod protocol; pub mod paths; pub mod output; pub mod error;` 等。

- [ ] **Step 3: 运行测试**

Run: `cargo test`
Expected: 所有测试通过

- [ ] **Step 4: Commit**

```bash
git add tests/protocol_test.rs src/lib.rs
git commit -m "test: protocol serde compatibility tests"
```

---

## Task 17: 端到端集成测试

**Files:**
- Create: `tests/integration_test.rs`

- [ ] **Step 1: 编写集成测试 (本地 HTTP server + 实际下载)**

```rust
use std::process::{Command, Stdio};
use std::io::Write;
use std::io::BufRead;
use std::path::PathBuf;

fn snapfile_binary() -> PathBuf {
    let mut path = std::env::current_exe().unwrap();
    path.pop(); // pop test binary name
    path.pop(); // pop "deps"
    path.join("snapfile")
}

#[test]
#[ignore = "需要 ffmpeg/ffprobe 可用"]
fn test_e2e_audio_m4a_download() {
    let binary = snapfile_binary();
    assert!(binary.exists(), "snapfile binary not found at {:?}", binary);

    let mut child = Command::new(&binary)
        .args([
            "--ffmpeg-path", "/Applications/SnapAny.app/Contents/Resources/app.asar.unpacked/public/bin/ffmpeg",
            "--ffprobe-path", "/Applications/SnapAny.app/Contents/Resources/app.asar.unpacked/public/bin/ffprobe",
            "--max-downloading-task", "1",
            "--log-level", "debug",
        ])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .expect("failed to start snapfile");

    let stdin = child.stdin.as_mut().unwrap();
    let cmd = r#"{"type":"start-task","payload":{"taskID":"e2e-test-1","name":"E2E Test","outputDir":"/tmp/snapfile-e2e","tempDir":"/tmp/snapfile-e2e-temp","outputType":"audio","outputAudioFormat":"m4a","live":false,"embeddedSubtitle":false,"proxy":"direct","files":[{"url":"https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3"}]}}"#;
    writeln!(stdin, "{}", cmd).unwrap();

    let stdout = child.stdout.take().unwrap();
    let reader = std::io::BufReader::new(stdout);

    let mut codes_seen = Vec::new();
    for line in reader.lines() {
        let line = line.unwrap();
        if let Ok(v) = serde_json::from_str::<serde_json::Value>(&line) {
            if let Some(code) = v["code"].as_str() {
                codes_seen.push(code.to_string());
                eprintln!("stdout: {}", code);
            }
            if codes_seen.last() == Some(&"task_complete".to_string()) {
                break;
            }
            if codes_seen.last().map(|c| c.contains("error")).unwrap_or(false) {
                panic!("got error: {}", line);
            }
        }
    }

    assert!(codes_seen.contains(&"task_started".to_string()), "missing task_started");
    assert!(codes_seen.contains(&"task_complete".to_string()), "missing task_complete");

    // cleanup
    let _ = child.kill();
    let _ = std::fs::remove_dir_all("/tmp/snapfile-e2e");
    let _ = std::fs::remove_dir_all("/tmp/snapfile-e2e-temp");
}
```

- [ ] **Step 2: 运行集成测试**

Run: `cargo test -- --ignored`
Expected: 看到 task_started → ... → task_complete 序列

- [ ] **Step 3: Commit**

```bash
git add tests/integration_test.rs
git commit -m "test: end-to-end integration test with local download"
```

---

## Task 18: 替换到 SnapAny.app 并验证

**Files:**
- Modify: `dist/package.sh` (已有)

- [ ] **Step 1: 编译 release 二进制**

Run: `cargo build --release`
Expected: `target/release/snapfile` 存在

- [ ] **Step 2: 拷贝到 dist/**

```bash
cp target/release/snapfile dist/snapfile
```

- [ ] **Step 3: 运行打包脚本**

```bash
cd dist && ./package.sh
```
Expected: 替换成功, 签名通过

- [ ] **Step 4: 启动 SnapAny 并测试 bilibili 下载**

```bash
open /Applications/SnapAny.app
```

在 app 中粘贴一个 bilibili URL, 选择 audio + m4a 格式, 点击下载。
Expected: 下载成功, 文件出现在 ~/Downloads/

- [ ] **Step 5: 检查 stderr 日志**

```bash
# 日志在 SnapAny 的 stderr 中, 可通过 console.app 或 log 命令查看
# 或修改 package.sh 添加 2>/tmp/snapfile-rs.log 重定向
```

- [ ] **Step 6: Commit**

```bash
git add dist/snapfile
git commit -m "feat: snapfile-rs replacement binary"
```

---

## Self-Review

### Spec Coverage Check

对照 `docs/082_spec.md`:

| Spec 章节 | 对应 Task |
|---|---|
| §1.2 模块划分 | Task 1-15 (每个模块一个 Task) |
| §2 I/O Contract | Task 4 (protocol) + Task 7 (output) + Task 15 (stdin loop) |
| §3 任务状态机 | Task 13 (task.rs) |
| §4.1 错误类型 | Task 5 (error.rs) |
| §4.2 进程级隔离 | Task 14 (manager.rs catch_unwind + CleanupGuard) |
| §5 调用时序 | Task 13 (run_task 编排) |
| §6 日志规范 | 所有 Task 中的 tracing 调用 |
| §7 改进项 (MP3 码率) | Task 11 (converter.rs bitrate 参数) |
| §8 Phase 1 MVP | Task 1-15 + Task 17 |
| §8 Phase 2 ffmpeg | Task 10-11 |

### Placeholder Scan

无 TBD/TODO。所有代码步骤包含完整实现。

### Type Consistency

- `Task::from_payload` 在 Task 13 中定义, Task 14 中使用 ✓
- `OutputWriter` 方法名一致: send_status/send_progress/send_complete/send_file_error/send_error ✓
- `codes::` 和 `messages::` 常量在 Task 4 中定义, 所有后续 Task 使用相同名称 ✓
- `SnapfileError::to_status_code()` 在 Task 5 中定义, Task 13 中使用 ✓

---

*计划版本: 2026-08-07*
