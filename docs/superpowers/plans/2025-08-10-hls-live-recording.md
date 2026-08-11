# HLS Live Recording Implementation Plan (v2)

> **修订说明**: 本版 plan 根据 critic review (critic.md) 全面修正了以下问题:
> - Mock 脚本参数解析 (C1)
> - VOD 进度 total_duration (C2)
> - HLS 分支绕过 semaphore (C3)
> - stderr 管道未消费导致死锁 (C4)
> - TDD 流程名存实亡 (C5, 改为直接实现)
> - live_stop 线程传递不完整 (C6, 改用 LiveStopSignal)
> - SIGINT 退出码匹配脆弱 (C7, 改用 graceful_stop flag)
> - is_hls_url 检测遗漏 .m3u8# (C8)
> - speed 永远 0 (C9, 设计决策不变)
> - Headers 安全 (C10, 已知限制)
> - 凭据过期 (C11, 已知限制)
> - Live moov atom (C12, TS 中间格式)
> - CleanupGuard 与 partial 文件 (C13)

**Goal:** 为 snapany-rs 添加 HLS VOD 和 Live 录制支持, 把所有 HLS 工作委托给 ffmpeg.

**Design doc:** `docs/superpowers/specs/2025-08-10-hls-live-recording-design.md`

**Critic:** `docs/superpowers/critic.md`

---

## 架构概览

```
run_task
├─HLS 分支 (semaphore 之后)
│  ├─ VOD: ffmpeg -i m3u8 → mp4 (一步完成) → move → complete
│  └─ Live: ffmpeg -i m3u8 → ts (录制中)
│           ├─ 用户停止: SIGINT → 优雅退出
│           └─ 自然结束: EXT-X-ENDLIST → 自然退出
│           → remux ts→mp4 → move → complete
│
├─ 普通分支 (不变)
│  └─ downloader 分片下载 → converter 合并 → move → complete
│
└─ stop-recording-live: LiveStopSignal.stop() → ffmpeg SIGINT → remux → complete
   delete-task: CancellationToken.cancel() → kill → cancelled
```

---

## 文件结构

```
snapany-rs/
├── src/
│   ├── hls.rs                          # NEW: HLS 检测/命令构造/进度解析/runner
│   ├── task.rs                         # MODIFY: HLS 分支 + run_hls_task
│   ├── manager.rs                      # MODIFY: LiveStopSignal + live_stops map
│   ├── protocol.rs                     # MODIFY: duration_secs 字段
│   ├── error.rs                        # MODIFY: Hls variant
│   └── paths.rs                        # MODIFY: hls_temp_output_path
├── tests/
│   ├── mock_ffmpeg_vod.sh              # NEW: VOD mock (输出 -progress 格式)
│   ├── mock_ffmpeg_live.sh             # NEW: Live mock (持续运行直到 SIGINT)
│   ├── mock_ffmpeg_remux.sh            # NEW: remux mock (复制 ts → mp4)
│   └── hls_integration_test.rs         # NEW: 集成测试
└── docs/superpowers/plans/2025-08-10-hls-live-recording.md  # This file
```

**职责边界:**
- `hls.rs` — 纯 HLS 逻辑, 不引用 Task/Manager. 函数: `is_hls_url`, `build_ffmpeg_hls_args`, `parse_progress_line`, `check_disk_space`, `run_hls_vod`, `run_hls_live`, `remux_ts_to_mp4`
- `task.rs` — 编排层. 检测 HLS URL, 分支到 `run_hls_task`
- `manager.rs` — 持有 `live_stops` map, 创建/存储/触发 `LiveStopSignal`

---

## Task 1: 基础设施变更

**Files:** `Cargo.toml`, `src/error.rs`, `src/protocol.rs`, `src/paths.rs`, `src/task.rs`

- [ ] **Step 1: Cargo.toml — 添加 libc 依赖**

```toml
libc = "0.2"
```

- [ ] **Step 2: error.rs — 添加 Hls variant**

```rust
// 在 SnapfileError enum 中添加:
#[error("HLS 录制失败: {0}")]
Hls(String),

// 在 to_status_code() 中添加:
Self::Hls(_) => codes::DOWNLOAD_ERROR,
```

- [ ] **Step 3: protocol.rs — 添加 duration_secs 字段**

```rust
// 在 StartTaskPayload 中添加:
#[serde(rename = "durationSecs")]
pub duration_secs: Option<u64>,
```

- [ ] **Step 4: paths.rs — 添加 hls_temp_output_path**

```rust
/// HLS 临时输出路径: {temp_root}/hls_output.{ext}
/// temp_root 已是 {temp_dir}/{task_id}, 此函数只追加文件名
pub fn hls_temp_output_path(temp_root: &Path, ext: &str) -> PathBuf {
    temp_root.join(format!("hls_output.{}", ext))
}
```

- [ ] **Step 5: task.rs — Task struct 添加 live 和 duration_secs**

```rust
// Task struct 添加:
pub live: bool,
pub duration_secs: Option<u64>,

// Task::from_payload 中添加:
live: payload.live,
duration_secs: payload.duration_secs,
```

- [ ] **Step 6: 验证编译**

```bash
cargo check 2>&1 | tail -5
```

- [ ] **Step 7: Commit**

```bash
git add Cargo.toml Cargo.lock src/error.rs src/protocol.rs src/paths.rs src/task.rs
git commit -m "feat(hls): add infrastructure (libc dep, Hls error, duration_secs, hls path)"
```

---

## Task 2: hls.rs — 检测 + 命令构造 + 进度解析

**Files:** Create `src/hls.rs`, modify `src/main.rs`

> 注意: 项目同时有 `lib.rs` 和 `main.rs`. binary crate 使用 `main.rs` 中的 `mod` 声明.
> `hls` 模块声明在 `main.rs`, 不在 `lib.rs`.

- [ ] **Step 1: main.rs — 声明模块**

在 `mod resume;` 后添加:

```rust
mod hls;
```

- [ ] **Step 2: hls.rs — 检测函数**

```rust
/// 检测 URL 是否为 HLS 流.
/// 检查 .m3u8 后缀, 或包含 .m3u8? / .m3u8# (query string / fragment).
/// snapany-rs 不做 Content-Type 检测 (不发送 HTTP 请求).
pub fn is_hls_url(url: &str) -> bool {
    let lower = url.to_lowercase();
    lower.ends_with(".m3u8") || lower.contains(".m3u8?") || lower.contains(".m3u8#")
}
```

> **C8 修正**: 原版遗漏 `.m3u8#` (fragment). 非 .m3u8 结尾的 CDN URL 是 V1 已知限制.

- [ ] **Step 3: hls.rs — ffmpeg 命令构造**

```rust
use std::collections::HashMap;
use std::path::Path;

/// 构建 ffmpeg HLS 录制命令参数.
/// Headers 用 \r\n (CRLF) 拼接, 末尾追加 \r\n (ffmpeg -headers 要求).
/// is_live=true 时不加 -movflags +faststart (Live 输出 TS, 无 moov atom).
/// 输出路径始终是最后一个参数.
pub fn build_ffmpeg_hls_args(
    m3u8_url: &str,
    headers: Option<&HashMap<String, String>>,
    output_path: &Path,
    is_live: bool,
) -> Vec<String> {
    let mut args: Vec<String> = Vec::new();

    // -headers: join all headers with \r\n, terminated by final \r\n
    if let Some(h) = headers {
        if !h.is_empty() {
            let header_str: String = h
                .iter()
                .map(|(k, v)| format!("{}: {}", k, v))
                .collect::<Vec<_>>()
                .join("\r\n");
            args.push("-headers".to_string());
            args.push(format!("{}\r\n", header_str));
        }
    }

    args.push("-i".to_string());
    args.push(m3u8_url.to_string());
    args.push("-c".to_string());
    args.push("copy".to_string());

    // VOD: add faststart for progressive playback
    if !is_live {
        args.push("-movflags".to_string());
        args.push("+faststart".to_string());
    }

    args.push("-progress".to_string());
    args.push("pipe:1".to_string());
    args.push("-y".to_string());
    args.push(output_path.to_string_lossy().to_string());

    args
}
```

- [ ] **Step 4: hls.rs — 进度解析器**

```rust
/// 解析单行 ffmpeg -progress 输出.
/// 返回 Some(done_seconds) 表示有意义的进度行.
/// 返回 None 表示无关行 (frame=, fps=, total_size= 等).
pub fn parse_progress_line(line: &str) -> Option<u64> {
    let line = line.trim();
    if line == "progress=end" {
        return Some(0);
    }
    if let Some(us_str) = line.strip_prefix("out_time_us=") {
        if let Ok(us) = us_str.trim().parse::<u64>() {
            return Some(us / 1_000_000);
        }
    }
    None
}
```

> **C9 说明**: speed 字段 V1 不解析, 统一报 0. 这是设计决策.

- [ ] **Step 5: hls.rs — 磁盘空间检查**

```rust
use crate::error::SnapfileError;
use std::path::Path;

#[cfg(unix)]
pub fn check_disk_space(path: &Path, threshold_mb: u64) -> Result<u64, SnapfileError> {
    use std::ffi::CString;
    use std::os::unix::ffi::OsStrExt;

    // Walk up to find existing directory
    let mut check_path = path;
    while !check_path.exists() {
        match check_path.parent() {
            Some(parent) if !parent.as_os_str().is_empty() => check_path = parent,
            _ => break,
        }
    }

    let c_path = CString::new(check_path.as_os_str().as_bytes())
        .map_err(|_| SnapfileError::Hls("路径包含 NUL 字节".to_string()))?;

    let mut stat: libc::statvfs = unsafe { std::mem::zeroed() };
    let result = unsafe { libc::statvfs(c_path.as_ptr(), &mut stat) };
    if result != 0 {
        return Err(SnapfileError::Hls(format!(
            "statvfs 失败: {}", std::io::Error::last_os_error()
        )));
    }

    let available_bytes = stat.f_frsize as u64 * stat.f_bavail as u64;
    let available_mb = available_bytes / (1024 * 1024);

    if available_mb < threshold_mb {
        Err(SnapfileError::Hls(format!(
            "磁盘空间不足: {} MB 可用, 需要 {} MB", available_mb, threshold_mb
        )))
    } else {
        Ok(available_mb)
    }
}

#[cfg(not(unix))]
pub fn check_disk_space(_path: &Path, _threshold_mb: u64) -> Result<u64, SnapfileError> {
    Ok(0) // 非 Unix 平台跳过检查
}
```

- [ ] **Step 6: hls.rs — 单元测试 (内联)**

在 `src/hls.rs` 底部添加 `#[cfg(test)] mod tests` 块, 覆盖:
- `is_hls_url`: 简单 .m3u8 / 带 query / 带 fragment / 大写 / 非 HLS / m4s
- `build_ffmpeg_hls_args`: VOD+headers (CRLF 验证) / Live 无 faststart / progress=pipe:1 / 空 headers 跳过 / output 是最后一个参数
- `parse_progress_line`: out_time_us → 秒 / progress=end / 无关行 / 畸形输入 / 带空白
- `check_disk_space`: /tmp 正常阈值 / 不可能阈值

- [ ] **Step 7: 验证编译 + 测试**

```bash
cargo test --lib hls 2>&1 | tail -20
```

- [ ] **Step 8: Commit**

```bash
git add src/hls.rs src/main.rs
git commit -m "feat(hls): add URL detection, command builder, progress parser, disk check"
```

---

## Task 3: hls.rs — stderr drainer

> **C4 修正**: stderr 必须消费, 否则 64KB 缓冲区满后 ffmpeg 阻塞, 永远不退出.

**Files:** `src/hls.rs`

- [ ] **Step 1: hls.rs — spawn_stderr_drainer 函数**

```rust
use tokio::io::{AsyncBufReadExt, BufReader};

/// Spawn 一个 task 持续读 ffmpeg stderr, 输出到 tracing.
/// 防止 stderr 管道缓冲区满导致 ffmpeg 阻塞死锁.
fn spawn_stderr_drainer(stderr: std::process::ChildStderr, task_id: &str) {
    let tid = task_id.to_string();
    tokio::spawn(async move {
        let mut reader = BufReader::new(stderr).lines();
        loop {
            match reader.next_line().await {
                Ok(Some(line)) => {
                    tracing::debug!(task_id = %tid, "ffmpeg: {}", line);
                }
                _ => break,
            }
        }
    });
}
```

- [ ] **Step 2: 验证编译**

```bash
cargo check 2>&1 | tail -5
```

- [ ] **Step 3: Commit**

```bash
git add src/hls.rs
git commit -m "feat(hls): add stderr drainer to prevent pipe deadlock"
```

---

## Task 4: hls.rs — VOD runner

**Files:** `src/hls.rs`

- [ ] **Step 1: hls.rs — run_hls_vod 函数**

```rust
use crate::output::OutputWriter;
use crate::protocol::codes;
use std::path::PathBuf;
use tokio::process::Command;
use tokio_util::sync::CancellationToken;
use std::process::Stdio;

/// 运行 ffmpeg 录制 VOD HLS 流, 直接输出 MP4.
/// total_duration_secs=0 时不报进度百分比 (total=0).
/// ffmpeg 异常退出时, 如果输出文件有内容, 返回 Ok (保留部分录制).
pub async fn run_hls_vod(
    ffmpeg_path: &Path,
    m3u8_url: &str,
    headers: Option<&HashMap<String, String>>,
    output_path: &Path,
    task_id: &str,
    total_duration_secs: u64,
    output: &OutputWriter,
    cancel_token: &CancellationToken,
) -> Result<PathBuf, SnapfileError> {
    let args = build_ffmpeg_hls_args(m3u8_url, headers, output_path, false);
    log_hls_start(task_id, headers, false);

    let mut child = Command::new(ffmpeg_path)
        .args(&args)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())       // C4: piped + drained
        .kill_on_drop(true)
        .spawn()
        .map_err(|e| SnapfileError::Hls(format!("ffmpeg 启动失败: {}", e)))?;

    let stdout = child.stdout.take().unwrap();
    let stderr = child.stderr.take().unwrap();
    spawn_stderr_drainer(stderr, task_id);   // C4: drain stderr

    let mut reader = BufReader::new(stdout).lines();

    loop {
        tokio::select! {
            biased;

            // 硬取消: kill 进程, 不保留
            _ = cancel_token.cancelled() => {
                let _ = child.kill().await;
                let _ = child.wait().await;
                return Err(SnapfileError::Cancelled);
            }

            line_result = reader.next_line() => {
                match line_result {
                    Ok(Some(line)) => {
                        if let Some(done_secs) = parse_progress_line(&line) {
                            let remaining = total_duration_secs.saturating_sub(done_secs);
                            output.send_progress(
                                codes::TASK_DOWNLOAD_PROGRESS,
                                task_id, done_secs, total_duration_secs, 0, remaining,
                            ).await;
                        }
                    }
                    Ok(None) => break,   // stdout EOF: ffmpeg 退出
                    Err(_) => break,
                }
            }
        }
    }

    let status = child.wait().await
        .map_err(|e| SnapfileError::Hls(format!("等待 ffmpeg 退出失败: {}", e)))?;

    if status.success() {
        tracing::info!(task_id = task_id, "HLS VOD 录制完成");
        Ok(output_path.to_path_buf())
    } else {
        // C13: ffmpeg 异常退出, 检查 partial 文件
        if let Ok(meta) = tokio::fs::metadata(output_path).await {
            if meta.len() > 0 {
                tracing::warn!(task_id = task_id, "ffmpeg 异常退出但文件有内容, 保留部分录制");
                return Ok(output_path.to_path_buf());
            }
        }
        Err(SnapfileError::Hls(format!("ffmpeg 异常退出: {:?}", status)))
    }
}
```

> **C2 修正**: `total_duration_secs` 来自 `task.duration_secs.unwrap_or(0)`, 不再硬编码 0.
> **C13**: partial 文件检查在 runner 内部完成, 返回 Ok 后 task.rs 走 move 路径.

- [ ] **Step 2: hls.rs — log_hls_start 辅助函数**

```rust
/// 记录 HLS 开始日志, 只记 header key 不记 value (C10 安全).
fn log_hls_start(task_id: &str, headers: Option<&HashMap<String, String>>, is_live: bool) {
    let header_keys: Vec<&str> = headers
        .map(|h| h.keys().map(|k| k.as_str()).collect())
        .unwrap_or_default();
    tracing::info!(
        task_id = task_id,
        header_keys = ?header_keys,
        live = is_live,
        "HLS 录制开始 (headers redacted)"
    );
}
```

- [ ] **Step 3: 验证编译**

```bash
cargo check 2>&1 | tail -5
```

- [ ] **Step 4: Commit**

```bash
git add src/hls.rs
git commit -m "feat(hls): add VOD runner with progress, cancel, partial-recovery"
```

---

## Task 5: LiveStopSignal + manager.rs 改动

> **C6 修正**: 不用 oneshot channel (stop 可能比 ffmpeg 启动先到, 信号丢失).
> 改用 LiveStopSignal: AtomicBool (状态) + Notify (唤醒).
> LiveStopSignal 定义在 hls.rs (runner 的输入), manager.rs 通过 `use crate::hls::LiveStopSignal` 使用.
> 这避免了 hls.rs → manager.rs 的反向依赖, 保持 hls.rs 自包含.

**Files:** `src/hls.rs`, `src/manager.rs`

- [ ] **Step 1: hls.rs — LiveStopSignal 结构**

```rust
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tokio::sync::Notify;

/// 直播停止信号. 线程安全, 可在 ffmpeg 启动前/后安全触发.
/// - stopped: AtomicBool, stop() 后永远为 true
/// - notify: Notify, 唤醒正在 await 的 ffmpeg 主循环
pub struct LiveStopSignal {
    stopped: Arc<AtomicBool>,
    notify: Arc<Notify>,
}

impl LiveStopSignal {
    pub fn new() -> Self {
        Self {
            stopped: Arc::new(AtomicBool::new(false)),
            notify: Arc::new(Notify::new()),
        }
    }

    /// 触发停止信号. 幂等: 多次调用安全.
    pub fn stop(&self) {
        self.stopped.store(true, Ordering::SeqCst);
        self.notify.notify_waiters();
    }

    /// 检查是否已停止.
    pub fn is_stopped(&self) -> bool {
        self.stopped.load(Ordering::SeqCst)
    }

    /// 等待停止通知. 在 ffmpeg 主循环的 select! 中使用.
    pub async fn stopped_notified(&self) {
        self.notify.notified().await;
    }
}
```

- [ ] **Step 2: manager.rs — TaskManager 添加 live_stops map**

```rust
use crate::hls::LiveStopSignal;

pub struct TaskManager {
    tasks: HashMap<String, CancellationToken>,
    live_stops: Arc<Mutex<HashMap<String, Arc<LiveStopSignal>>>>,  // NEW
    output: OutputWriter,
    semaphore: Arc<Semaphore>,
    // ... rest unchanged
}
```

在 `TaskManager::new()` 中初始化:

```rust
live_stops: Arc::new(Mutex::new(HashMap::new())),
```

- [ ] **Step 3: manager.rs — start_task 中创建 LiveStopSignal**

在 `start_task` 方法中, 创建 signal 并存入 map, clone 到 spawned task:

```rust
pub async fn start_task(&mut self, payload: StartTaskPayload) {
    // ... existing task_id check ...

    let cancel_token = CancellationToken::new();
    self.tasks.insert(task_id.clone(), cancel_token.clone());

    // C6: 为 Live 任务创建 LiveStopSignal
    let live_stop = if payload.live {
        let signal = Arc::new(LiveStopSignal::new());
        self.live_stops.lock().unwrap().insert(task_id.clone(), signal.clone());
        Some(signal)
    } else {
        None
    };

    let task = Task::from_payload(payload, cancel_token.clone());
    let live_stops = self.live_stops.clone();  // clone Arc for cleanup
    // ... clone other fields ...

    let tid = task_id.clone();
    let out = self.output.clone();
    tokio::spawn(async move {
        let result = run_task(
            task, ffmpeg_path, ffprobe_path, out.clone(),
            semaphore, resume_max_age_days, max_connections,
            connect_timeout, read_timeout,
            live_stop,  // NEW: pass to run_task
        ).await;

        // 任务结束后清理 live_stops
        live_stops.lock().unwrap().remove(&tid);

        // ... existing result handling ...
    });
}
```

> **时序保证**: `start_task` 在 main stdin 循环线程同步执行.
> signal 在 `tokio::spawn` 之前插入 map.
> `stop_recording_live` 只能在后续 stdin 迭代中到达, 此时 signal 必然已在 map 中.

- [ ] **Step 4: manager.rs — stop_recording_live 改用 LiveStopSignal**

```rust
pub fn stop_recording_live(&self, task_id: &str) {
    let signal = self.live_stops.lock().unwrap().get(task_id).cloned();
    if let Some(sig) = signal {
        tracing::info!(task_id = task_id, "发送直播停止信号");
        sig.stop();
    } else {
        // Fallback: 非 HLS live 任务, 或任务已结束
        tracing::warn!(task_id = task_id, "无 LiveStopSignal, 尝试 cancel token");
        if let Some(token) = self.tasks.get(task_id) {
            token.cancel();
        }
    }
}
```

> **注意**: `stop_recording_live` 从 `&self` 改为 `&self` (不变, 因为 live_stops 用 Arc<Mutex>).
> 原版已经是 `&self`, 只是内部从 cancel 改为 LiveStopSignal.

- [ ] **Step 5: manager.rs — delete_tasks 清理 live_stops**

在 `delete_tasks` 中, 除了 cancel token, 也清理 live_stops:

```rust
pub async fn delete_tasks(&mut self, task_ids: &[String]) {
    for id in task_ids {
        self.live_stops.lock().unwrap().remove(id);
        if let Some(token) = self.tasks.remove(id) {
            // ... existing cancel logic ...
        }
    }
}
```

- [ ] **Step 6: 验证编译**

```bash
cargo check 2>&1 | tail -5
```

- [ ] **Step 7: Commit**

```bash
git add src/manager.rs
git commit -m "feat(hls+manager): add LiveStopSignal in hls.rs, wire live_stops in manager"
```

---

## Task 6: hls.rs — Live runner

**Files:** `src/hls.rs`

- [ ] **Step 1: hls.rs — run_hls_live 函数**

```rust
/// 运行 ffmpeg 录制 Live HLS 流, 输出 MPEG-TS.
/// 停止方式:
///   LiveStopSignal → SIGINT → ffmpeg 优雅退出 → TS 文件完整
///   CancellationToken → kill → Err(Cancelled), 不保留
/// 返回 .ts 路径, 调用方需 remux.
pub async fn run_hls_live(
    ffmpeg_path: &Path,
    m3u8_url: &str,
    headers: Option<&HashMap<String, String>>,
    ts_output_path: &Path,
    task_id: &str,
    output: &OutputWriter,
    cancel_token: &CancellationToken,
    live_stop: &LiveStopSignal,
) -> Result<PathBuf, SnapfileError> {
    // C6: 如果 stop 在 ffmpeg 启动前就到了, 直接返回
    if live_stop.is_stopped() {
        return Err(SnapfileError::Hls("录制在启动前已被停止".to_string()));
    }

    let args = build_ffmpeg_hls_args(m3u8_url, headers, ts_output_path, true);
    log_hls_start(task_id, headers, true);

    let mut child = Command::new(ffmpeg_path)
        .args(&args)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true)
        .spawn()
        .map_err(|e| SnapfileError::Hls(format!("ffmpeg 启动失败: {}", e)))?;

    let pid = child.id().expect("child pid") as i32;
    let stdout = child.stdout.take().unwrap();
    let stderr = child.stderr.take().unwrap();
    spawn_stderr_drainer(stderr, task_id);

    let mut reader = BufReader::new(stdout).lines();
    let mut graceful_stop = false;

    // Phase 1: 主循环 (stop / cancel / progress)
    loop {
        tokio::select! {
            biased;

            _ = cancel_token.cancelled() => {
                tracing::info!(task_id = task_id, "硬取消, kill ffmpeg");
                let _ = child.kill().await;
                let _ = child.wait().await;
                return Err(SnapfileError::Cancelled);
            }

            _ = live_stop.stopped_notified() => {
                graceful_stop = true;
                tracing::info!(task_id = task_id, pid = pid, "收到停止信号, 发送 SIGINT");
                unsafe { libc::kill(pid, libc::SIGINT); }
                break;
            }

            line_result = reader.next_line() => {
                match line_result {
                    Ok(Some(line)) => {
                        if let Some(done_secs) = parse_progress_line(&line) {
                            output.send_progress(
                                codes::TASK_DOWNLOAD_PROGRESS,
                                task_id, done_secs, 0, 0, 0,  // live: total=0
                            ).await;
                        }
                    }
                    Ok(None) => break,   // stdout EOF: natural end (ENDLIST)
                    Err(_) => break,
                }
            }
        }
    }

    // Phase 2: SIGINT 后 drain 剩余 stdout + 等待退出
    loop {
        tokio::select! {
            biased;

            _ = cancel_token.cancelled() => {
                let _ = child.kill().await;
                let _ = child.wait().await;
                return Err(SnapfileError::Cancelled);
            }

            // C7: SIGINT 超时保护, 30s 后强制 kill
            _ = tokio::time::sleep(std::time::Duration::from_secs(30)) => {
                tracing::warn!(task_id = task_id, "ffmpeg 未在 30s 内响应 SIGINT, 强制 kill");
                let _ = child.kill().await;
                let _ = child.wait().await;
                break;
            }

            line_result = reader.next_line() => {
                match line_result {
                    Ok(Some(line)) => {
                        if let Some(done_secs) = parse_progress_line(&line) {
                            output.send_progress(
                                codes::TASK_DOWNLOAD_PROGRESS,
                                task_id, done_secs, 0, 0, 0,
                            ).await;
                        }
                    }
                    _ => break,  // None or Err: stdout closed
                }
            }
        }
    }

    let _ = child.wait().await;

    // 检查 TS 文件
    if ts_output_path.exists() {
        if let Ok(meta) = tokio::fs::metadata(ts_output_path).await {
            if meta.len() > 0 {
                tracing::info!(
                    task_id = task_id, graceful = graceful_stop,
                    size = meta.len(), "HLS Live 录制完成 (TS)"
                );
                return Ok(ts_output_path.to_path_buf());
            }
        }
    }

    // C13: 无内容, 返回错误
    if graceful_stop {
        Err(SnapfileError::Hls("停止录制后 TS 文件为空".to_string()))
    } else {
        Err(SnapfileError::Hls("ffmpeg 异常退出且无录制内容".to_string()))
    }
}
```

> **C7 修正**: 不匹配 exit code (130/143). 用 `graceful_stop: bool` flag 区分.
> SIGINT 后 ffmpeg 的 exit code 在不同版本/平台不一致, 不依赖它.
> **C12**: Live 输出 TS, 不是 MP4. TS 无 moov atom, SIGINT 后天然完整.
> **C4**: stderr piped + drained.

- [ ] **Step 2: 验证编译**

```bash
cargo check 2>&1 | tail -5
```

- [ ] **Step 3: Commit**

```bash
git add src/hls.rs
git commit -m "feat(hls): add Live runner with SIGINT graceful stop and TS output"
```

---

## Task 7: hls.rs — TS → MP4 remux

> **C12**: Live 录制用 TS 中间格式, 停止后 remux 为 MP4.

**Files:** `src/hls.rs`

- [ ] **Step 1: hls.rs — remux_ts_to_mp4 函数**

```rust
/// 将 MPEG-TS remux 为 MP4 (纯容器转换, -c copy -movflags +faststart).
/// 成功后删除 TS 中间文件.
pub async fn remux_ts_to_mp4(
    ffmpeg_path: &Path,
    ts_path: &Path,
    mp4_path: &Path,
    task_id: &str,
    cancel_token: &CancellationToken,
) -> Result<PathBuf, SnapfileError> {
    let ts_str = ts_path.to_string_lossy().to_string();
    let mp4_str = mp4_path.to_string_lossy().to_string();
    let args = ["-i", &ts_str, "-c", "copy", "-movflags", "+faststart", "-y", &mp4_str];

    tracing::info!(task_id = task_id, "开始 remux TS -> MP4");

    let mut child = Command::new(ffmpeg_path)
        .args(&args)
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .kill_on_drop(true)
        .spawn()
        .map_err(|e| SnapfileError::Hls(format!("ffmpeg remux 启动失败: {}", e)))?;

    let stderr = child.stderr.take().unwrap();
    spawn_stderr_drainer(stderr, task_id);

    loop {
        tokio::select! {
            _ = cancel_token.cancelled() => {
                let _ = child.kill().await;
                let _ = child.wait().await;
                return Err(SnapfileError::Cancelled);
            }
            wait_result = child.wait() => {
                let status = wait_result
                    .map_err(|e| SnapfileError::Hls(format!("等待 ffmpeg remux 退出失败: {}", e)))?;
                if status.success() {
                    let _ = tokio::fs::remove_file(ts_path).await;
                    tracing::info!(task_id = task_id, "remux 完成");
                    return Ok(mp4_path.to_path_buf());
                } else {
                    return Err(SnapfileError::Hls(format!("remux 失败: {:?}", status)));
                }
            }
        }
    }
}
```

- [ ] **Step 2: 验证编译**

```bash
cargo check 2>&1 | tail -5
```

- [ ] **Step 3: Commit**

```bash
git add src/hls.rs
git commit -m "feat(hls): add TS→MP4 remux with faststart"
```

---

## Task 8: task.rs — HLS 分支集成

> **C3 修正**: HLS 分支在 `semaphore.acquire_owned()` 之后, 共享并发控制.

**Files:** `src/task.rs`

- [ ] **Step 1: task.rs — run_task 签名添加 live_stop 参数**

```rust
pub async fn run_task(
    task: Task,
    ffmpeg_path: Arc<Path>,
    _ffprobe_path: Arc<Path>,
    output: OutputWriter,
    semaphore: Arc<Semaphore>,
    resume_max_age_days: u64,
    max_connections: usize,
    connect_timeout: Duration,
    read_timeout: Duration,
    live_stop: Option<Arc<hls::LiveStopSignal>>,  // NEW
) -> Result<(), TaskError> {
```

- [ ] **Step 2: task.rs — 在 semaphore 之后添加 HLS 分支**

在 `let _permit = semaphore.acquire_owned().await...` 之后, `// 4. Download` 之前:

```rust
    let _permit = semaphore.acquire_owned().await
        .map_err(|_| TaskError::failed(codes::DOWNLOAD_ERROR, "信号量已关闭"))?;
    tracing::debug!(task_id = %task.id, "获取下载许可");

    // C3: HLS 分支在 semaphore 之后
    let is_hls = task.files.len() == 1 && hls::is_hls_url(&task.files[0].url);
    if is_hls {
        return run_hls_task(
            task, &ffmpeg_path, &output, live_stop,
        ).await;
    }

    // 4. Download (普通路径, 不变)
```

- [ ] **Step 3: task.rs — run_hls_task 函数**

```rust
/// HLS 任务编排: ffmpeg 录制 → (Live: remux) → move → complete.
async fn run_hls_task(
    task: Task,
    ffmpeg_path: &Path,
    output: &OutputWriter,
    live_stop: Option<Arc<hls::LiveStopSignal>>,
) -> Result<(), TaskError> {
    let temp_root = paths::temp_root(&task.temp_dir, &task.id);
    tokio::fs::create_dir_all(&temp_root).await
        .map_err(|e| to_task_error(SnapfileError::Io(e), &task.id))?;

    // C10: 只记 header key, 不记 value
    let header_ref = task.files[0].header.as_ref();

    emit_status(&task, codes::TASK_START_DOWNLOAD, messages::TASK_START_DOWNLOAD, output).await;

    let source_file = if task.live {
        // Live: ffmpeg → TS → remux → MP4
        if let Err(e) = hls::check_disk_space(&task.output_dir, 500) {
            return Err(to_task_error(e, &task.id));
        }

        let live_stop = live_stop.unwrap_or_else(|| {
            tracing::warn!(task_id = %task.id, "Live 任务缺少 LiveStopSignal, 创建临时");
            Arc::new(hls::LiveStopSignal::new())
        });

        let ts_path = paths::hls_temp_output_path(&temp_root, "ts");

        let ts_result = hls::run_hls_live(
            ffmpeg_path, &task.files[0].url, header_ref,
            &ts_path, &task.id, output, &task.cancel_token, &live_stop,
        ).await;

        let ts_file = match ts_result {
            Ok(p) => p,
            Err(SnapfileError::Cancelled) => return Err(TaskError::Cancelled),
            Err(e) => return Err(to_task_error(e, &task.id)),
        };

        // remux TS → MP4
        let mp4_path = paths::hls_temp_output_path(&temp_root, "mp4");
        let mp4_file = hls::remux_ts_to_mp4(
            ffmpeg_path, &ts_file, &mp4_path, &task.id, &task.cancel_token,
        ).await.map_err(|e| to_task_error(e, &task.id))?;

        mp4_file
    } else {
        // VOD: ffmpeg → MP4 (一步完成)
        let mp4_path = paths::hls_temp_output_path(&temp_root, "mp4");
        let total_duration = task.duration_secs.unwrap_or(0);  // C2

        hls::run_hls_vod(
            ffmpeg_path, &task.files[0].url, header_ref,
            &mp4_path, &task.id, total_duration, output, &task.cancel_token,
        ).await.map_err(|e| match e {
            SnapfileError::Cancelled => TaskError::Cancelled,
            other => to_task_error(other, &task.id),
        })?
    };

    // Move phase (复用现有 mover)
    emit_status(&task, codes::TASK_START_MOVE, messages::TASK_START_MOVE, output).await;
    let final_path = mover::move_to_output(
        &source_file, &task.output_dir, &task.name, task.ext(),
    ).await.map_err(|e| to_task_error(e, &task.id))?;
    emit_status(&task, codes::TASK_MOVED, messages::TASK_MOVED, output).await;

    // Complete
    output.send_complete(&task.id, vec![final_path.to_string_lossy().to_string()]).await;
    tracing::info!(task_id = %task.id, "HLS 任务完成");

    Ok(())
}
```

> **C3**: `_permit` 在 `run_hls_task` 返回时 drop, 释放 semaphore.
> **C13**: CleanupGuard 仍在 `run_task` 顶部创建, `run_hls_task` 返回后 guard drop 清理 temp 目录.
>   此时 source_file 已经被 mover 移走, temp 目录只剩碎片 (TS 中间文件已删).
>   如果 move 失败, source_file 还在 temp 里, guard 会删除它. 这是可接受的行为——
>   move 失败已经报错, 用户拿不到文件, 残留 temp 文件无意义.

- [ ] **Step 4: 验证编译**

```bash
cargo check 2>&1 | tail -10
```

- [ ] **Step 5: Commit**

```bash
git add src/task.rs
git commit -m "feat(task): integrate HLS branch after semaphore with VOD and Live paths"
```

---

## Task 9: Mock ffmpeg 脚本

> **C1 修正**: mock 脚本从最后一个参数取 output_path, 不是 $1.
> ffmpeg 参数列表: [-headers, ..., -i, <url>, -c, copy, (-movflags, +faststart), -progress, pipe:1, -y, <output_path>]
> output_path 是最后一个参数.

**Files:** `tests/mock_ffmpeg_vod.sh`, `tests/mock_ffmpeg_live.sh`, `tests/mock_ffmpeg_remux.sh`

- [ ] **Step 1: mock_ffmpeg_vod.sh — 模拟 VOD ffmpeg**

```bash
#!/usr/bin/env bash
# Mock ffmpeg for VOD HLS: outputs -progress lines then exits.
# output_path is the LAST argument (C1 fix).

OUTPUT_PATH="${@: -1}"  # last positional argument

# Write a dummy file so output_path exists
echo "fake mp4 content" > "$OUTPUT_PATH"

# Output ffmpeg -progress format to stdout
echo "frame=100"
echo "fps=30.0"
echo "out_time_us=5000000"
echo "out_time_ms=5000000"
echo "out_time=00:00:05.000000"
echo "dup=0"
echo "drop=0"
echo "speed=2.5x"
echo "progress=continue"
echo "out_time_us=10000000"
echo "progress=end"

exit 0
```

```bash
chmod +x tests/mock_ffmpeg_vod.sh
```

- [ ] **Step 2: mock_ffmpeg_live.sh — 模拟 Live ffmpeg**

```bash
#!/usr/bin/env bash
# Mock ffmpeg for Live HLS: runs until SIGINT, outputs progress periodically.
# output_path is the LAST argument (C1 fix).

OUTPUT_PATH="${@: -1}"

# Write initial content
echo "fake ts content" > "$OUTPUT_PATH"

# Output progress and keep running
echo "out_time_us=1000000"
echo "progress=continue"

# Trap SIGINT, write final progress, exit cleanly
trap 'echo "out_time_us=2000000"; echo "progress=end"; exit 0' INT

# Keep running until killed/signaled
while true; do
    sleep 0.1
done
```

```bash
chmod +x tests/mock_ffmpeg_live.sh
```

- [ ] **Step 3: mock_ffmpeg_remux.sh — 模拟 remux ffmpeg**

```bash
#!/usr/bin/env bash
# Mock ffmpeg for TS→MP4 remux: copies input to output.
# Input is second-to-last arg (-i <input>), output is last arg.

INPUT=""
OUTPUT=""
for ((i=1; i<=$#; i++)); do
    arg="${!i}"
    next_idx=$((i+1))
    if [[ "$arg" == "-i" ]]; then
        INPUT="${!next_idx}"
    fi
done
OUTPUT="${@: -1}"

if [[ -n "$INPUT" && -n "$OUTPUT" ]]; then
    cp "$INPUT" "$OUTPUT"
fi

exit 0
```

```bash
chmod +x tests/mock_ffmpeg_remux.sh
```

- [ ] **Step 4: Commit**

```bash
git add tests/mock_ffmpeg_vod.sh tests/mock_ffmpeg_live.sh tests/mock_ffmpeg_remux.sh
git commit -m "test(hls): add mock ffmpeg scripts (VOD, Live, remux)"
```

---

## Task 10: 集成测试

> **C1**: 测试通过 `--ffmpeg-path` 指向 mock 脚本.
> **C5**: 直接写测试+验证, 不做 TDD 仪式.

**Files:** `tests/hls_integration_test.rs`

- [ ] **Step 1: hls_integration_test.rs — VOD 完整流程**

测试: 启动 snapfile → 发 start-task (VOD HLS) → 收集 stdout → 验证 task_complete.

```rust
use std::io::{BufRead, Write};
use std::path::PathBuf;
use std::process::{Command, Stdio};

fn snapfile_binary() -> PathBuf {
    let mut path = std::env::current_exe().unwrap();
    path.pop();  // deps
    path.pop();  // debug
    path.join("snapfile")
}

fn mock_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests")
}

#[test]
fn test_vod_hls_task_completes() {
    let binary = snapfile_binary();
    let ffmpeg = mock_dir().join("mock_ffmpeg_vod.sh");
    let ffprobe = PathBuf::from("/usr/bin/true");

    let mut child = Command::new(&binary)
        .args(["--ffmpeg-path", ffmpeg.to_str().unwrap(),
               "--ffprobe-path", ffprobe.to_str().unwrap(),
               "--max-downloading-task", "1",
               "--log-level", "error"])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .expect("failed to start snapfile");

    let stdin = child.stdin.as_mut().unwrap();
    writeln!(stdin, r#"{{"type":"start-task","payload":{{"taskID":"vod-test","name":"VOD","outputDir":"/tmp/snapany_test","tempDir":"/tmp/snapany_tmp","outputType":"video","live":false,"embeddedSubtitle":false,"proxy":"direct","files":[{{"url":"https://cdn.example.com/test.m3u8"}}]}}}}"#).unwrap();
    drop(child.stdin.take());

    let stdout = child.stdout.take().unwrap();
    let reader = std::io::BufReader::new(stdout);
    let lines: Vec<String> = reader.lines().filter_map(|l| l.ok()).collect();

    let status = child.wait().expect("failed to wait");
    assert!(status.success());

    assert!(lines.iter().any(|l| l.contains("task_complete") && l.contains("vod-test")),
        "Expected task_complete. Got: {:?}", lines);
}
```

- [ ] **Step 2: hls_integration_test.rs — Live 停止流程**

测试: 启动 snapfile → 发 start-task (Live HLS) → 等 300ms → 发 stop-recording-live → 验证 task_complete.

```rust
#[test]
fn test_live_hls_stop_recording() {
    let binary = snapfile_binary();
    let ffmpeg = mock_dir().join("mock_ffmpeg_live.sh");
    let ffprobe = PathBuf::from("/usr/bin/true");

    let mut child = Command::new(&binary)
        .args(["--ffmpeg-path", ffmpeg.to_str().unwrap(),
               "--ffprobe-path", ffprobe.to_str().unwrap(),
               "--max-downloading-task", "1",
               "--log-level", "error"])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .expect("failed to start snapfile");

    let stdin = child.stdin.as_mut().unwrap();
    writeln!(stdin, r#"{{"type":"start-task","payload":{{"taskID":"live-test","name":"Live","outputDir":"/tmp/snapany_test","tempDir":"/tmp/snapany_tmp","outputType":"video","live":true,"embeddedSubtitle":false,"proxy":"direct","files":[{{"url":"https://cdn.example.com/live.m3u8"}}]}}}}"#).unwrap();

    std::thread::sleep(std::time::Duration::from_millis(500));

    writeln!(stdin, r#"{{"type":"stop-recording-live","payload":{{"taskID":"live-test"}}}}"#).unwrap();
    drop(child.stdin.take());

    let stdout = child.stdout.take().unwrap();
    let reader = std::io::BufReader::new(stdout);
    let lines: Vec<String> = reader.lines().filter_map(|l| l.ok()).collect();

    let status = child.wait().expect("failed to wait");
    assert!(status.success());

    assert!(lines.iter().any(|l| l.contains("task_complete") && l.contains("live-test")),
        "Graceful stop should produce task_complete. Got: {:?}", lines);
}
```

- [ ] **Step 3: hls_integration_test.rs — Header 安全**

测试: 带敏感 header 的 HLS 任务, 验证 stdout 不泄露 header value.

```rust
#[test]
fn test_hls_headers_not_in_stdout() {
    let binary = snapfile_binary();
    let ffmpeg = mock_dir().join("mock_ffmpeg_vod.sh");
    let ffprobe = PathBuf::from("/usr/bin/true");

    let mut child = Command::new(&binary)
        .args(["--ffmpeg-path", ffmpeg.to_str().unwrap(),
               "--ffprobe-path", ffprobe.to_str().unwrap(),
               "--max-downloading-task", "1",
               "--log-level", "error"])  // error level: no debug/info to stdout
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .expect("failed to start snapfile");

    let stdin = child.stdin.as_mut().unwrap();
    writeln!(stdin, r#"{{"type":"start-task","payload":{{"taskID":"hdr-test","name":"HDR","outputDir":"/tmp/snapany_test","tempDir":"/tmp/snapany_tmp","outputType":"video","live":false,"embeddedSubtitle":false,"proxy":"direct","files":[{{"url":"https://cdn.example.com/test.m3u8","header":{{"Cookie":"super_secret_12345","Authorization":"Bearer token_abcdef"}}}}]}}}}"#).unwrap();
    drop(child.stdin.take());

    let stdout = child.stdout.take().unwrap();
    let reader = std::io::BufReader::new(stdout);
    let lines: Vec<String> = reader.lines().filter_map(|l| l.ok()).collect();

    let status = child.wait().expect("failed to wait");
    assert!(status.success());

    for line in &lines {
        assert!(!line.contains("super_secret_12345"), "Cookie leaked: {}", line);
        assert!(!line.contains("token_abcdef"), "Auth leaked: {}", line);
    }
}
```

- [ ] **Step 4: 运行集成测试**

```bash
cargo test --test hls_integration_test 2>&1 | tail -20
```

- [ ] **Step 5: Commit**

```bash
git add tests/hls_integration_test.rs
git commit -m "test(hls): integration tests for VOD, Live stop, header security"
```

---

## Task 11: 全量验证

**Files:** None (verification only)

- [ ] **Step 1: 全量测试**

```bash
cargo test 2>&1 | tail -30
```
Expected: All tests pass

- [ ] **Step 2: Clippy**

```bash
cargo clippy --all-targets 2>&1 | tail -20
```
Expected: No errors

- [ ] **Step 3: Release build**

```bash
cargo build --release 2>&1 | tail -5
```
Expected: Compiles successfully

---

## Critic 问题修正对照表

| # | Critic 问题 | 修正方案 | 对应 Task |
|---|------------|---------|----------|
| C1 | Mock 脚本 $1 取 output_path 错误 | 用 `${@: -1}` 取最后一个参数 | Task 9 |
| C2 | VOD total_duration 永远 0 | 用 `task.duration_secs.unwrap_or(0)` | Task 8 |
| C3 | HLS 绕过 semaphore | 分支在 `acquire_owned()` 之后 | Task 8 |
| C4 | stderr 未消费导致死锁 | `spawn_stderr_drainer` 读 stderr 到 tracing | Task 3 |
| C5 | TDD 名存实亡 | 直接写代码+测试, 不做 TDD 仪式 | All |
| C6 | live_stop 线程传递不完整 | `LiveStopSignal (AtomicBool + Notify)` 替代 oneshot | Task 5 |
| C7 | SIGINT exit code 匹配脆弱 | `graceful_stop: bool` flag, 不依赖 exit code | Task 6 |
| C8 | is_hls_url 遗漏 fragment | 添加 `.m3u8#` 检测 | Task 2 |
| C9 | speed 永远 0 | 设计决策, V1 不解析 | N/A |
| C10 | Headers 命令行安全 | 不记日志值; 多用户是已知限制 | Task 2, 8, 10 |
| C11 | 凭据过期 | V1 已知限制 | N/A |
| C12 | Live moov atom | TS 中间格式 → remux MP4 | Task 6, 7 |
| C13 | CleanupGuard 与 partial | runner 返回 Ok 走 move; 返回 Err 由 guard 清理 | Task 4, 8 |

---

## 关键数据结构

### LiveStopSignal (hls.rs)

```rust
pub struct LiveStopSignal {
    stopped: Arc<AtomicBool>,
    notify: Arc<Notify>,
}
```

- `stop()`: store true + notify_waiters
- `is_stopped()`: load
- `stopped_notified()`: await notify

**时序保证**: signal 在 `start_task` 中 spawn 前创建并存入 map.
`stop_recording_live` 在后续 stdin 迭代到达, signal 必然已存在.
即使 stop 在 ffmpeg 启动前到达, `is_stopped()` 检查也能捕获.

### Task (task.rs)

```rust
pub struct Task {
    // ... existing fields ...
    pub live: bool,              // NEW: 区分 VOD / Live
    pub duration_secs: Option<u64>,  // NEW: VOD 媒体总时长
}
```

### hls.rs 函数签名

```rust
pub fn is_hls_url(url: &str) -> bool

pub fn build_ffmpeg_hls_args(
    m3u8_url: &str,
    headers: Option<&HashMap<String, String>>,
    output_path: &Path,
    is_live: bool,
) -> Vec<String>

pub fn parse_progress_line(line: &str) -> Option<u64>

pub fn check_disk_space(path: &Path, threshold_mb: u64) -> Result<u64, SnapfileError>

pub async fn run_hls_vod(
    ffmpeg_path: &Path,
    m3u8_url: &str,
    headers: Option<&HashMap<String, String>>,
    output_path: &Path,
    task_id: &str,
    total_duration_secs: u64,
    output: &OutputWriter,
    cancel_token: &CancellationToken,
) -> Result<PathBuf, SnapfileError>

pub async fn run_hls_live(
    ffmpeg_path: &Path,
    m3u8_url: &str,
    headers: Option<&HashMap<String, String>>,
    ts_output_path: &Path,
    task_id: &str,
    output: &OutputWriter,
    cancel_token: &CancellationToken,
    live_stop: &LiveStopSignal,
) -> Result<PathBuf, SnapfileError>

pub async fn remux_ts_to_mp4(
    ffmpeg_path: &Path,
    ts_path: &Path,
    mp4_path: &Path,
    task_id: &str,
    cancel_token: &CancellationToken,
) -> Result<PathBuf, SnapfileError>
```

### run_task 签名变更

```rust
pub async fn run_task(
    task: Task,
    ffmpeg_path: Arc<Path>,
    _ffprobe_path: Arc<Path>,
    output: OutputWriter,
    semaphore: Arc<Semaphore>,
    resume_max_age_days: u64,
    max_connections: usize,
    connect_timeout: Duration,
    read_timeout: Duration,
    live_stop: Option<Arc<hls::LiveStopSignal>>,  // NEW
) -> Result<(), TaskError>
```

---

## 数据流详图

### VOD HLS

```
start-task { url: *.m3u8, live: false, durationSecs: 3600 }
  │
  ├─ TASK_STARTED
  ├─ TASK_PREPARE → TASK_PREPARED
  ├─ TASK_PENDING_DOWNLOAD
  ├─ semaphore.acquire_owned()
  ├─ is_hls? YES → run_hls_task()
  │   ├─ TASK_START_DOWNLOAD
  │   ├─ ffmpeg -i m3u8 -c copy -movflags +faststart -progress pipe:1 -y temp/hls_output.mp4
  │   │   ├─ TASK_DOWNLOAD_PROGRESS { done: 5, total: 3600 }
  │   │   └─ TASK_DOWNLOAD_PROGRESS { done: 10, total: 3600 }
  │   ├─ ffmpeg exit 0
  │   ├─ TASK_START_MOVE
  │   ├─ mover.move_to_output → resolve_conflict
  │   ├─ TASK_MOVED
  │   └─ TASK_COMPLETE { files: [output.mp4] }
  │
  └─ _permit drop (semaphore release)
```

### Live HLS

```
start-task { url: *.m3u8, live: true }
  │
  ├─ TASK_STARTED → TASK_PREPARE → TASK_PREPARED
  ├─ TASK_PENDING_DOWNLOAD
  ├─ semaphore.acquire_owned()
  ├─ is_hls? YES → run_hls_task()
  │   ├─ TASK_START_DOWNLOAD
  │   ├─ check_disk_space(output_dir, 500MB)
  │   ├─ ffmpeg -i m3u8 -c copy -progress pipe:1 -y temp/hls_output.ts
  │   │   └─ TASK_DOWNLOAD_PROGRESS { done: 1, total: 0 }  (total=0: live)
  │   │
  │   ├─ 用户停止: stop-recording-live
  │   │   └─ LiveStopSignal.stop() → SIGINT → ffmpeg exit
  │   │      (或自然结束: EXT-X-ENDLIST → ffmpeg exit 0)
  │   │
  │   ├─ remux: ffmpeg -i temp/hls_output.ts -c copy -movflags +faststart -y temp/hls_output.mp4
  │   ├─ TASK_START_MOVE
  │   ├─ mover.move_to_output → resolve_conflict
  │   ├─ TASK_MOVED
  │   └─ TASK_COMPLETE { files: [output.mp4] }
  │
  └─ _permit drop (semaphore release)
```

### 异常路径

```
ffmpeg crash / 网络中断
  │
  ├─ runner 检查 output 文件
  │   ├─ size > 0: 返回 Ok(path) → 走 move 路径 → 用户拿到部分录制
  │   └─ size = 0 / 不存在: 返回 Err → task 报错 → CleanupGuard 清理 temp
  │
delete-task
  │
  ├─ CancellationToken.cancel()
  ├─ runner select! 捕获 → child.kill() → Err(Cancelled)
  └─ CleanupGuard 清理 temp
```

---

## 自检清单

### Spec 覆盖

- [x] HLS URL 检测 (.m3u8 / .m3u8? / .m3u8#) — Task 2
- [x] ffmpeg 命令构造 (CRLF headers) — Task 2
- [x] 进度解析 (out_time_us → 秒) — Task 2
- [x] VOD HLS 流程 — Task 4, 8
- [x] Live HLS 流程 (SIGINT 停止) — Task 5, 6, 8
- [x] TS → MP4 remux — Task 7
- [x] 磁盘空间检查 — Task 2
- [x] Header 安全 (不记 value) — Task 2, 10
- [x] temp → final move — Task 8
- [x] ffmpeg 异常 → partial 保留 — Task 4, 6
- [x] 硬取消 → 不保留 — Task 4, 6
- [x] Live 进度 total=0 — Task 6
- [x] 不做 auto-reconnect — by design
- [x] DASH/直链不变 — by design (分支只在 .m3u8)
- [x] stderr 消费 — Task 3
- [x] semaphore 共享 — Task 8

### Critic 覆盖

- [x] C1: mock 参数 ${@: -1}
- [x] C2: duration_secs.unwrap_or(0)
- [x] C3: 分支在 semaphore 后
- [x] C4: spawn_stderr_drainer
- [x] C5: 不做 TDD 仪式
- [x] C6: LiveStopSignal
- [x] C7: graceful_stop flag
- [x] C8: .m3u8# 检测
- [x] C9: speed=0 设计决策
- [x] C10: header 只记 key
- [x] C11: 凭据不刷新, 已知限制
- [x] C12: TS 中间格式
- [x] C13: partial → Ok, empty → Err + guard
