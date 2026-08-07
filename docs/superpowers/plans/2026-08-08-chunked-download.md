# 断点续传实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 为 snapfile-rs 添加单连接断点续传，失败/取消后保留 `.partial` 文件，下次同 URL 任务自动续传。

**Architecture:** 在 `downloader.rs` 中添加续传逻辑。续传文件持久化到 `{outputDir}/.SnapAny/.resume/{url_hash}/`，独立于任务的临时目录。下载前探测 Range 支持，检查 `.partial` 是否存在，匹配 ETag 后发送 Range 请求。`CleanupGuard` 改为只在任务成功完成时清理临时目录，取消/失败时保留续传文件。大量日志用于确认服务器支持情况。

**Tech Stack:** Rust, tokio, reqwest, serde_json, md-5 (已有依赖)。

---

## 设计决策（Q1 / Q2）

### Q1：任务删除时，元信息和临时文件是否同步删除？

- **临时目录**（`{tempDir}/{taskId}/`）：已由 `CleanupGuard` 在任务退出时自动清理，无需额外处理。
- **续传目录**（`{outputDir}/.SnapAny/.resume/{url_hash}/`）：按 URL 哈希存储，跨任务共享同一 URL。
  - 任务完成 → `.partial` 移到最终目录，`.meta` 删除。
  - 任务取消/失败 → 保留 `.partial` + `.meta`（供续传）。
  - **不做同步删除**：任务从 Electron UI 删除时 snapfile 进程已退出并清理了临时目录；按 URL 共享意味着同步删除需扩展 Electron↔snapfile 协议，收益低。
  - **懒清理（TTL）**：snapfile 处理新任务时，扫描该 outputDir 的 `.resume/`，删除 `.partial.meta` 修改时间超过 `--resume-max-age-days`（默认 7）的条目（Task 8）。
- **更新时同步更新**：任务重试由续传机制天然覆盖——检查 `.partial` 并续传，元数据每秒更新。"更新"语义已被续传流程覆盖。

### Q2：分片/续传对 <1GB、500KB/s+ 文件有多大作用？

- **断点续传（P0）**：价值在网络可靠性，不在速度。500MB @ 500KB/s ≈ 17 分钟；中途断网时续传避免从零重下。稳定连接几乎零成本，不稳定网络价值高，作为保险值得实现。
- **分片并行（P2，暂缓）**：仅在 CDN 限单连接带宽时有收益。当前 500KB/s 可能来自 CDN 限速、用户带宽上限、或 yt-dlp 自身限制——无法仅凭经验判断。
- **决策方法**：先用 Task 7 的完成统计日志采集单连接 avg/peak 速度 + range 支持情况，再决定是否实现分片（见文末 P2 决策门）。

## File Structure

- **Create:** `src/resume.rs` — 续传元数据类型、路径计算、探测、续传检查
- **Modify:** `src/downloader.rs` — 集成续传逻辑，保留单连接流式下载
- **Modify:** `src/task.rs` — `CleanupGuard` 行为调整（取消/失败不清理 `.resume`）
- **Modify:** `src/lib.rs` — 添加 `pub mod resume`
- **Modify:** `src/cli.rs` — 添加 `--resume-max-age-days` 参数
- **Modify:** `Cargo.toml` — 添加 `tempfile = "3"` dev-dependency
- **Create:** `tests/resume_test.rs` — 元数据 round-trip、路径计算、ETag 验证测试

---

### Task 1: 续传元数据类型和路径计算

**Files:**
- Create: `src/resume.rs`
- Modify: `src/lib.rs`
- Create: `tests/resume_test.rs`

- [ ] **Step 1: Write the failing test**

Create `tests/resume_test.rs`:

```rust
use snapfile_rs::resume::{ResumeMeta, resume_dir, partial_path, meta_path};
use std::path::PathBuf;

#[test]
fn test_resume_dir_path() {
    let output_dir = PathBuf::from("/home/user/Downloads");
    let url = "https://example.com/video.m4s";
    let dir = resume_dir(&output_dir, url);
    assert!(dir.starts_with("/home/user/Downloads/.SnapAny/.resume/"));
}

#[test]
fn test_partial_and_meta_paths() {
    let output_dir = PathBuf::from("/tmp/test");
    let url = "https://example.com/video.m4s";
    let dir = resume_dir(&output_dir, url);
    let pp = partial_path(&dir, url);
    let mp = meta_path(&dir, url);
    assert!(pp.to_string_lossy().ends_with(".partial"));
    assert!(mp.to_string_lossy().ends_with(".partial.meta"));
}

#[test]
fn test_same_url_same_hash() {
    let output_dir = PathBuf::from("/tmp/test");
    let url = "https://example.com/video.m4s";
    let dir1 = resume_dir(&output_dir, url);
    let dir2 = resume_dir(&output_dir, url);
    assert_eq!(dir1, dir2);
}

#[test]
fn test_meta_round_trip() {
    let tmp = tempfile::tempdir().unwrap();
    let meta = ResumeMeta {
        url: "https://example.com/test.m4s".to_string(),
        downloaded_bytes: 52428800,
        total_size: 104857600,
        etag: Some("\"abc123\"".to_string()),
        last_modified: Some("Wed, 08 Aug 2026 10:00:00 GMT".to_string()),
    };
    let path = tmp.path().join("test.partial.meta");
    meta.save(&path).unwrap();
    let loaded = ResumeMeta::load(&path).unwrap();
    assert_eq!(loaded.url, meta.url);
    assert_eq!(loaded.downloaded_bytes, meta.downloaded_bytes);
    assert_eq!(loaded.total_size, meta.total_size);
    assert_eq!(loaded.etag, meta.etag);
    assert_eq!(loaded.last_modified, meta.last_modified);
}

#[test]
fn test_load_meta_missing_file() {
    let result = ResumeMeta::load(&PathBuf::from("/nonexistent/meta.json"));
    assert!(result.is_err());
}

#[test]
fn test_etag_match() {
    let meta = ResumeMeta {
        url: "x".to_string(),
        downloaded_bytes: 100,
        total_size: 200,
        etag: Some("\"abc\"".to_string()),
        last_modified: None,
    };
    assert!(meta.matches_server(Some("\"abc\""), None));
    assert!(!meta.matches_server(Some("\"xyz\""), None));
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cargo test --test resume_test`
Expected: FAIL — `snapfile_rs::resume` module not found

- [ ] **Step 3: Write minimal implementation**

Add module declaration to `src/lib.rs`:
```rust
pub mod resume;
```

Create `src/resume.rs`:
```rust
use md5::{Digest, Md5};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

/// 续传元数据，记录已下载字节数和服务器标识
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ResumeMeta {
    pub url: String,
    pub downloaded_bytes: u64,
    pub total_size: u64,
    pub etag: Option<String>,
    pub last_modified: Option<String>,
}

impl ResumeMeta {
    /// 将元数据保存为 JSON 文件
    pub fn save(&self, path: &Path) -> std::io::Result<()> {
        let json = serde_json::to_string_pretty(self)
            .map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e))?;
        std::fs::write(path, json)
    }

    /// 从 JSON 文件加载元数据
    pub fn load(path: &Path) -> std::io::Result<Self> {
        let json = std::fs::read_to_string(path)?;
        serde_json::from_str(&json)
            .map_err(|e| std::io::Error::new(std::io::ErrorKind::InvalidData, e))
    }

    /// 检查服务器返回的 ETag/Last-Modified 是否与之前一致
    pub fn matches_server(&self, etag: Option<&str>, last_modified: Option<&str>) -> bool {
        if let (Some(stored), Some(current)) = (&self.etag, etag) {
            return stored == current;
        }
        if let (Some(stored), Some(current)) = (&self.last_modified, last_modified) {
            return stored == current;
        }
        // 没有 ETag 和 Last-Modified，无法验证，保守返回 false
        false
    }
}

/// 计算 URL 的 MD5 十六进制表示
fn url_hash(url: &str) -> String {
    let mut hasher = Md5::new();
    hasher.update(url.as_bytes());
    hasher.finalize().iter().map(|b| format!("{:02x}", b)).collect()
}

/// 续传缓存目录: {outputDir}/.SnapAny/.resume/{url_hash}/
pub fn resume_dir(output_dir: &Path, url: &str) -> PathBuf {
    output_dir.join(".SnapAny").join(".resume").join(url_hash(url))
}

/// .partial 文件路径
pub fn partial_path(dir: &Path, _url: &str) -> PathBuf {
    dir.join("download.partial")
}

/// .partial.meta 文件路径
pub fn meta_path(dir: &Path, _url: &str) -> PathBuf {
    dir.join("download.partial.meta")
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cargo test --test resume_test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/resume.rs src/lib.rs tests/resume_test.rs
git commit -m "feat: add resume metadata types and path calculation"
```

---

### Task 2: Range 探测函数

**Files:**
- Modify: `src/resume.rs`
- Modify: `tests/resume_test.rs`

- [ ] **Step 1: Write the failing test**

Add to `tests/resume_test.rs`:

```rust
use snapfile_rs::resume::RangeProbe;

#[test]
fn test_range_probe_supports_true() {
    let probe = RangeProbe {
        supports_ranges: true,
        total_size: Some(104857600),
        etag: Some("\"abc\"".to_string()),
        last_modified: Some("Wed, 08 Aug 2026".to_string()),
    };
    assert!(probe.supports_ranges);
    assert_eq!(probe.total_size, Some(104857600));
}

#[test]
fn test_range_probe_supports_false() {
    let probe = RangeProbe {
        supports_ranges: false,
        total_size: Some(5000),
        etag: None,
        last_modified: None,
    };
    assert!(!probe.supports_ranges);
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cargo test --test resume_test -- range_probe`
Expected: FAIL — `RangeProbe` not found

- [ ] **Step 3: Write minimal implementation**

Add to `src/resume.rs`:

```rust
use crate::error::SnapfileError;
use std::collections::HashMap;

/// HEAD 请求探测结果
#[derive(Debug)]
pub struct RangeProbe {
    pub supports_ranges: bool,
    pub total_size: Option<u64>,
    pub etag: Option<String>,
    pub last_modified: Option<String>,
}

/// 发送 HEAD 请求探测 Range 支持和文件大小
pub async fn probe_range(
    client: &reqwest::Client,
    url: &str,
    headers: Option<&HashMap<String, String>>,
    task_id: &str,
) -> Result<RangeProbe, SnapfileError> {
    let mut request = client.head(url);

    // 添加默认 User-Agent
    let has_ua = headers.map(|h| h.keys().any(|k| k.to_lowercase() == "user-agent")).unwrap_or(false);
    if !has_ua {
        request = request.header("User-Agent", crate::downloader::DEFAULT_USER_AGENT);
    }

    if let Some(h) = headers {
        for (key, value) in h {
            request = request.header(key, value);
        }
    }

    tracing::info!(task_id = task_id, url = url, "探测 Range 支持: HEAD 请求");

    let response = request.send().await?;
    let status = response.status();

    tracing::info!(task_id = task_id, status = %status, "HEAD 响应状态");

    // 405 → 回退到 0-byte Range GET
    if status == reqwest::StatusCode::METHOD_NOT_ALLOWED {
        tracing::info!(task_id = task_id, "HEAD 返回 405, 回退到 Range GET");
        return probe_with_range_get(client, url, headers, task_id).await;
    }

    let accept_ranges = response
        .headers()
        .get("accept-ranges")
        .map(|v| v.to_str().unwrap_or(""))
        .unwrap_or("");
    let supports = accept_ranges.eq_ignore_ascii_case("bytes");

    let total_size = response
        .headers()
        .get("content-length")
        .and_then(|v| v.to_str().ok())
        .and_then(|s| s.parse::<u64>().ok());

    let etag = response
        .headers()
        .get("etag")
        .map(|v| v.to_str().unwrap_or("").to_string());

    let last_modified = response
        .headers()
        .get("last-modified")
        .map(|v| v.to_str().unwrap_or("").to_string());

    tracing::info!(
        task_id = task_id,
        accept_ranges = accept_ranges,
        supports_ranges = supports,
        content_length = ?total_size,
        etag = ?etag,
        last_modified = ?last_modified,
        "Range 探测结果"
    );

    Ok(RangeProbe {
        supports_ranges: supports,
        total_size,
        etag,
        last_modified,
    })
}

/// 回退方案: Range: bytes=0-0 探测
async fn probe_with_range_get(
    client: &reqwest::Client,
    url: &str,
    headers: Option<&HashMap<String, String>>,
    task_id: &str,
) -> Result<RangeProbe, SnapfileError> {
    let mut request = client.get(url).header("Range", "bytes=0-0");

    if let Some(h) = headers {
        for (key, value) in h {
            request = request.header(key, value);
        }
    }

    let response = request.send().await?;
    let status = response.status();

    let supports = status == reqwest::StatusCode::PARTIAL_CONTENT;

    let total_size = response
        .headers()
        .get("content-range")
        .and_then(|v| v.to_str().ok())
        .and_then(|s| s.rsplit('/').next())
        .and_then(|s| s.parse::<u64>().ok());

    let etag = response
        .headers()
        .get("etag")
        .map(|v| v.to_str().unwrap_or("").to_string());

    let last_modified = response
        .headers()
        .get("last-modified")
        .map(|v| v.to_str().unwrap_or("").to_string());

    tracing::info!(
        task_id = task_id,
        status = %status,
        supports_ranges = supports,
        total_size = ?total_size,
        "Range GET 探测结果"
    );

    Ok(RangeProbe {
        supports_ranges: supports,
        total_size,
        etag,
        last_modified,
    })
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cargo test --test resume_test -- range_probe`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/resume.rs tests/resume_test.rs
git commit -m "feat: add range support probing with detailed logging"
```

---

### Task 3: 集成续传到 downloader.rs

**Files:**
- Modify: `src/downloader.rs`

- [ ] **Step 1: 替换 download_single，加入续传逻辑**

修改 `src/downloader.rs` 中的 `download_single` 函数。保留现有单连接流式下载逻辑，在请求前加入续传检查：

```rust
async fn download_single(
    client: &reqwest::Client,
    spec: &FileSpec,
    dest: &Path,
    task_id: &str,
    output: &OutputWriter,
    cancel_token: &CancellationToken,
    output_dir: &Path,
) -> Result<(), SnapfileError> {
    // 1. 探测 Range 支持
    let probe = crate::resume::probe_range(
        client, &spec.url, spec.header.as_ref(), task_id,
    ).await?;

    // 2. 检查续传
    let resume_dir = crate::resume::resume_dir(output_dir, &spec.url);
    let partial = crate::resume::partial_path(&resume_dir, &spec.url);
    let meta_path = crate::resume::meta_path(&resume_dir, &spec.url);

    let existing_meta = if partial.exists() && meta_path.exists() {
        match crate::resume::ResumeMeta::load(&meta_path) {
            Ok(m) => {
                tracing::info!(
                    task_id = task_id,
                    downloaded = m.downloaded_bytes,
                    total = m.total_size,
                    "续传检查: .partial 存在"
                );
                Some(m)
            }
            Err(e) => {
                tracing::warn!(task_id = task_id, error = %e, "元数据读取失败, 从头下载");
                None
            }
        }
    } else {
        tracing::info!(task_id = task_id, "无续传文件, 从头下载");
        None
    };

    // 3. 判断是否可以续传
    let resume_offset: Option<u64> = match (&existing_meta, probe.supports_ranges) {
        (Some(m), true) if m.matches_server(probe.etag.as_deref(), probe.last_modified.as_deref()) => {
            tracing::info!(
                task_id = task_id,
                offset = m.downloaded_bytes,
                "续传验证通过: ETag/Last-Modified 匹配"
            );
            Some(m.downloaded_bytes)
        }
        (Some(m), true) => {
            tracing::warn!(
                task_id = task_id,
                stored_etag = ?m.etag,
                server_etag = ?probe.etag,
                "续传验证失败: ETag 不匹配, 从头下载"
            );
            None
        }
        (Some(_), false) => {
            tracing::warn!(task_id = task_id, "服务器不支持 Range, 从头下载");
            None
        }
        (None, _) => None,
    };

    // 4. 确保 resume 目录存在
    tokio::fs::create_dir_all(&resume_dir).await?;

    // 5. 构建 HTTP 请求
    let mut request = client.get(&spec.url);

    let has_user_agent = spec.header.as_ref()
        .map(|h| h.keys().any(|k| k.to_lowercase() == "user-agent"))
        .unwrap_or(false);
    if !has_user_agent {
        request = request.header("User-Agent", DEFAULT_USER_AGENT);
    }

    if let Some(headers) = &spec.header {
        for (key, value) in headers {
            request = request.header(key, value);
        }
    }

    // 6. 如果续传，添加 Range 头，以追加模式打开文件
    let mut file = if let Some(offset) = resume_offset {
        request = request.header("Range", format!("bytes={}-", offset));
        tracing::info!(task_id = task_id, range = format!("bytes={}-", offset), "发送续传请求");

        let mut f = tokio::fs::OpenOptions::new()
            .write(true)
            .append(true)
            .open(&partial)
            .await?;
        f
    } else {
        // 从头下载，创建新文件
        let f = tokio::fs::File::create(&partial).await?;
        f
    };

    let response = request.send().await?;
    let status = response.status();

    tracing::info!(task_id = task_id, status = %status, "下载响应");

    // 7. 检查响应状态
    if status == StatusCode::FORBIDDEN {
        return Err(SnapfileError::HttpStatusForbidden);
    }

    let is_resume_response = status == StatusCode::PARTIAL_CONTENT;
    if !status.is_success() {
        return Err(SnapfileError::DownloadFailed(format!("HTTP {}", status)));
    }

    // 如果发送了 Range 但服务器返回 200，说明不支持续传，需要从头写
    if resume_offset.is_some() && !is_resume_response {
        tracing::warn!(task_id = task_id, "服务器忽略 Range 请求, 从头下载");
        // 重新打开文件（truncate）
        drop(file);
        file = tokio::fs::File::create(&partial).await?;
    }

    // 8. 确定总大小和起始字节
    let total = if is_resume_response {
        // 206: Content-Range 有完整大小
        let full_size = response
            .headers()
            .get("content-range")
            .and_then(|v| v.to_str().ok())
            .and_then(|s| s.rsplit('/').next())
            .and_then(|s| s.parse::<u64>().ok());
        full_size.or(probe.total_size).unwrap_or(0)
    } else {
        probe.total_size.unwrap_or(0)
    };

    let initial_bytes = if is_resume_response {
        resume_offset.unwrap_or(0)
    } else {
        0
    };

    tracing::info!(
        task_id = task_id,
        total = total,
        initial_bytes = initial_bytes,
        is_resume = is_resume_response,
        "开始流式下载"
    );

    // 9. 流式下载 + 更新元数据
    let mut stream = response.bytes_stream();
    let mut downloaded = initial_bytes;
    let mut last_second_bytes: u64 = 0;
    let mut interval = tokio::time::interval(Duration::from_secs(1));
    interval.tick().await;

    // 初始元数据
    let mut current_meta = crate::resume::ResumeMeta {
        url: spec.url.clone(),
        downloaded_bytes: initial_bytes,
        total_size: total,
        etag: probe.etag.clone(),
        last_modified: probe.last_modified.clone(),
    };

    loop {
        tokio::select! {
            biased;
            _ = cancel_token.cancelled() => {
                tracing::info!(task_id = task_id, downloaded = downloaded, "下载被取消, 保留 .partial");
                // 保存当前元数据
                current_meta.downloaded_bytes = downloaded;
                let mp = meta_path.clone();
                if let Err(e) = current_meta.save(&mp) {
                    tracing::error!(task_id = task_id, error = %e, "取消时保存元数据失败");
                }
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
                        // 保存元数据后返回错误
                        current_meta.downloaded_bytes = downloaded;
                        let _ = current_meta.save(&meta_path);
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

                // 每秒更新元数据
                current_meta.downloaded_bytes = downloaded;
                if let Err(e) = current_meta.save(&meta_path) {
                    tracing::warn!(task_id = task_id, error = %e, "元数据更新失败");
                }
            }
        }
    }

    tokio::io::AsyncWriteExt::flush(&mut file).await?;
    drop(file);

    tracing::info!(task_id = task_id, downloaded = downloaded, total = total, ".partial 写入完成");

    // 10. 移动 .partial 到最终目标路径
    tokio::fs::rename(&partial, dest).await?;
    // 删除元数据
    let _ = tokio::fs::remove_file(&meta_path).await;

    tracing::info!(task_id = task_id, dest = %dest.display(), "文件移动完成");
    Ok(())
}
```

- [ ] **Step 2: 更新 download_all_files 签名，传递 output_dir**

`download_single` 需要知道 `output_dir` 来计算续传路径。修改 `download_all_files`：

```rust
pub async fn download_all_files(
    files: &[FileSpec],
    download_dir: &Path,
    proxy_str: &str,
    task_id: &str,
    output: &OutputWriter,
    cancel_token: &CancellationToken,
    output_dir: &Path,  // 新增
) -> Result<Vec<PathBuf>, SnapfileError> {
    // ... 在调用 download_single 时传入 output_dir
    match download_single(
        &client, spec, &file_path, task_id,
        output, cancel_token, output_dir,
    ).await {
```

- [ ] **Step 3: 更新 task.rs 中的调用**

在 `src/task.rs` 的 `run_task` 中，传入 `task.output_dir`：

```rust
let downloaded_files = downloader::download_all_files(
    &task.files,
    &download_dir,
    &task.proxy,
    &task.id,
    &output,
    &task.cancel_token,
    &task.output_dir,  // 新增
).await.map_err(|e| to_task_error(e, &task.id))?;
```

- [ ] **Step 4: Verify it compiles**

Run: `cargo build`
Expected: compiles without errors

- [ ] **Step 5: Commit**

```bash
git add src/downloader.rs src/task.rs
git commit -m "feat: integrate resume download with range support"
```

---

### Task 4: 调整 CleanupGuard 行为

**Files:**
- Modify: `src/task.rs`

- [ ] **Step 1: 修改 CleanupGuard 只在成功时清理**

当前 `CleanupGuard` 在 `run_task` 以任何方式退出时都清理临时目录。续传文件在 `{outputDir}/.SnapAny/.resume/` 下，不在临时目录里，所以不会被动到。

但需要确认：`download/` 目录里的文件（snapfile 下载的中间文件）在取消时应该保留还是清理？

由于 `.partial` 文件已经在 `.resume/` 目录（不在 `download/` 目录），`download/` 目录里的文件在取消时可以安全清理。`CleanupGuard` 行为不需要改变。

确认 `paths.rs` 中 `download_dir` 的路径：
```rust
// download_dir: {temp_dir}/{task_id}/{task_id}/download/
// resume_dir:   {output_dir}/.SnapAny/.resume/{url_hash}/
// 两者完全独立，CleanupGuard 清理 temp_dir 不影响 resume_dir
```

无需改动 `CleanupGuard`，但要添加日志说明：

在 `src/task.rs` 的 `run_task` 开头添加：
```rust
    tracing::info!(
        task_id = %task.id,
        temp_root = %paths::temp_root(&task.temp_dir, &task.id).display(),
        "临时目录 (任务结束清理)，续传文件在 outputDir/.SnapAny/.resume/ (独立保留)"
    );
```

- [ ] **Step 2: Verify it compiles**

Run: `cargo build`
Expected: compiles without errors

- [ ] **Step 3: Commit**

```bash
git add src/task.rs
git commit -m "chore: log temp vs resume directory separation"
```

---

### Task 5: 公开 DEFAULT_USER_AGENT 常量

**Files:**
- Modify: `src/downloader.rs`

- [ ] **Step 1: 将 DEFAULT_USER_AGENT 改为 pub**

在 `src/downloader.rs` 中：
```rust
pub const DEFAULT_USER_AGENT: &str = "Mozilla/5.0 ...";
```

- [ ] **Step 2: Verify it compiles**

Run: `cargo build`
Expected: compiles without errors

- [ ] **Step 3: Commit**

```bash
git add src/downloader.rs
git commit -m "refactor: expose DEFAULT_USER_AGENT for reuse in resume module"
```

---

### Task 6: 更新设计文档

**Files:**
- Modify: `vendor/081_design.md`

- [ ] **Step 1: 追加分片续传章节**

在 `vendor/081_design.md` 末尾追加：

```markdown
## 12. snapfile-rs 断点续传 (2026-08-08)

### 12.1 新增模块

| 模块 | 职责 |
|------|------|
| `src/resume.rs` | 续传元数据、Range 探测、路径计算 |

### 12.2 续传文件结构

```
{outputDir}/.SnapAny/.resume/{url_hash}/
├── download.partial          # 已下载的部分
└── download.partial.meta     # 元数据 (JSON)
```

### 12.3 续传流程

1. HEAD 请求探测 Accept-Ranges、ETag、Last-Modified
2. 检查 .partial 和 .meta 是否存在
3. ETag/Last-Modified 匹配 → 发送 Range: bytes={offset}-
4. 服务器返回 206 → 追加写入
5. 服务器返回 200 → 从头下载
6. 每秒更新 .meta
7. 完成后移动到 download/ 目录，删除 .meta

### 12.4 清理逻辑

- 任务完成: 移动 .partial, 删除 .meta
- 任务取消/失败: 保留 .partial 和 .meta
- 临时目录 ({tempDir}/{taskId}) 照常清理
- .resume/ 目录独立于临时目录，不受影响
```

- [ ] **Step 2: Commit**

```bash
git add vendor/081_design.md
git commit -m "docs: update design doc with resume section"
```

---

### Task 7: 下载完成统计与周期速度日志

**目的**：确认服务器/CDN 实际能力，为 P2 分片决策提供数据。

**Files:**
- Modify: `src/downloader.rs`

- [ ] **Step 1: 添加统计采集变量**

在 `download_single` 的流式下载循环开始前（拿到 response 之后）：
```rust
let start = std::time::Instant::now();
let mut peak_speed: u64 = 0;
let mut tick_count: u64 = 0;
let server = response.headers()
    .get("server").map(|v| v.to_str().unwrap_or("").to_string())
    .unwrap_or_default();
let ttfb_start = std::time::Instant::now();
let mut ttfb_logged = false;
```

- [ ] **Step 2: 记录 TTFB 和周期速度**

收到第一个 chunk 时记录首字节时间；interval 分支每 5 秒输出速度：
```rust
// Some(Ok(bytes)) 分支内，写入之后：
if !ttfb_logged {
    tracing::info!(task_id = task_id, ttfb_ms = ttfb_start.elapsed().as_millis(),
        server = %server, "首字节时间 / 服务器标识");
    ttfb_logged = true;
}

// interval.tick() 分支内，send_progress 之后：
peak_speed = peak_speed.max(speed);
tick_count += 1;
if tick_count % 5 == 0 {
    tracing::info!(task_id = task_id, downloaded = downloaded, total = total,
        speed_kbps = speed / 1024, peak_kbps = peak_speed / 1024,
        pct = if total > 0 { downloaded * 100 / total } else { 0 },
        "下载进度");
}
```

- [ ] **Step 3: 下载完成汇总行**

在 `.partial` 移动到最终路径之后、`Ok(())` 之前：
```rust
let duration_secs = start.elapsed().as_secs().max(1);
let avg_speed_kbps = (downloaded / duration_secs) / 1024;
tracing::info!(
    task_id = task_id,
    total_bytes = downloaded,
    duration_secs = duration_secs,
    avg_speed_kbps = avg_speed_kbps,
    peak_speed_kbps = peak_speed / 1024,
    resumed_bytes = initial_bytes,
    this_session_bytes = downloaded.saturating_sub(initial_bytes),
    range_supported = probe.supports_ranges,
    server = %server,
    "下载完成统计"
);
```

- [ ] **Step 4: 验证**

Run: `cargo build && cargo test`
Expected: 编译通过，现有测试不受影响

- [ ] **Step 5: Commit**

```bash
git add src/downloader.rs
git commit -m "feat: add download completion stats and periodic speed logging"
```

---

### Task 8: 续传文件懒清理（TTL）

**目的**：删除任务后/过期后清理 `.resume/` 孤儿文件，避免磁盘累积。

**Files:**
- Modify: `src/cli.rs`
- Modify: `src/resume.rs`
- Modify: `src/main.rs`, `src/manager.rs`, `src/task.rs`, `src/downloader.rs`（传递 `resume_max_age_days`）

- [ ] **Step 1: CLI 参数**

`src/cli.rs` 增加字段：
```rust
#[arg(long = "resume-max-age-days", default_value_t = 7)]
pub resume_max_age_days: u64,
```

- [ ] **Step 2: cleanup 函数**

`src/resume.rs` 增加：
```rust
/// 清理 outputDir 下超过 max_age_days 的续传缓存条目
pub fn cleanup_stale_resume(output_dir: &Path, max_age_days: u64) {
    let root = output_dir.join(".SnapAny").join(".resume");
    if !root.exists() { return; }
    let cutoff = std::time::SystemTime::now()
        - std::time::Duration::from_secs(max_age_days * 86400);
    let mut cleaned = 0u32;
    if let Ok(entries) = std::fs::read_dir(&root) {
        for entry in entries.flatten() {
            let meta = entry.path().join("download.partial.meta");
            let stale = std::fs::metadata(&meta)
                .and_then(|m| m.modified())
                .map(|t| t < cutoff)
                .unwrap_or(false);
            if stale {
                if std::fs::remove_dir_all(entry.path()).is_ok() {
                    cleaned += 1;
                }
            }
        }
    }
    if cleaned > 0 {
        tracing::info!(cleaned = cleaned, max_age_days = max_age_days, "清理过期续传缓存");
    }
}
```

- [ ] **Step 3: 管道传递 + 调用**

将 `resume_max_age_days` 从 CLI args → `TaskManager` → `Task` → `download_all_files`。在 `download_all_files` 创建 download_dir 之后、下载循环之前调用：
```rust
crate::resume::cleanup_stale_resume(output_dir, resume_max_age_days);
```

- [ ] **Step 4: 验证**

Run: `cargo build`
Expected: 编译通过

- [ ] **Step 5: Commit**

```bash
git add src/cli.rs src/resume.rs src/downloader.rs src/task.rs src/manager.rs src/main.rs
git commit -m "feat: add TTL-based stale resume cleanup"
```

---

## P2 决策门（分片并行下载）

### 决策结果（2026-08-08 实测）

bilibili CDN 已通过 curl 实测验证，结果已记录在设计文档 1.5：

- `range_supported = true`，206 + content-range 正常
- 单连接 ~9.5-10.9 MB/s，4 连接合计 ~26 MB/s → **2.8x 加速**
- 无 ETag，Last-Modified 稳定（续传验证可行）

**结论**：分片有收益，升级为 **P1**。后续可收集 YouTube 等其他 CDN 数据补充判断。

### 原始决策流程（已执行）


完成 Task 1-8 并部署后，运行多个来源（bilibili、YouTube 等）的实际下载，收集日志中的「下载完成统计」行（`avg_speed_kbps`、`peak_speed_kbps`、`range_supported`）：

1. `avg_speed_kbps ≈ 用户带宽`（如 avg 6000+ KB/s，带宽 50 Mbps）→ CDN 未限单连接 → **分片无收益，不实现**。
2. `avg_speed_kbps << 用户带宽` 且 `range_supported=true` → CDN 限单连接 → **分片有收益，启动分片实现**。
3. `range_supported=false` → 服务器不支持分片 → **不实现**。

P1 分片实现方案见设计文档 1.3。


## Summary

| Task | Description | Complexity |
|------|-------------|------------|
| 1 | 续传元数据类型和路径计算 | Low |
| 2 | Range 探测函数（带详细日志） | Medium |
| 3 | 集成续传到 downloader.rs | High |
| 4 | CleanupGuard 日志补充 | Trivial |
| 5 | 公开 DEFAULT_USER_AGENT | Trivial |
| 6 | 文档更新 | Trivial |
| 7 | 下载完成统计与周期速度日志 | Medium |
| 8 | 续传文件懒清理（TTL） | Low |

**Electron 侧功能**（yt-dlp 自动检测、批量下载增强）已在 `patches/snapany-app/` 中应用，不在本计划内。
