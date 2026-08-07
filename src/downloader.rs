use crate::error::SnapfileError;
use crate::output::OutputWriter;
use crate::paths;
use crate::protocol::{codes, FileSpec};
use crate::resume;
use futures_util::StreamExt;
use reqwest::StatusCode;
use std::path::{Path, PathBuf};
use std::time::Duration;
use tokio_util::sync::CancellationToken;

pub const DEFAULT_USER_AGENT: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

pub async fn download_all_files(
    files: &[FileSpec],
    download_dir: &Path,
    proxy_str: &str,
    task_id: &str,
    output: &OutputWriter,
    cancel_token: &CancellationToken,
    output_dir: &Path,
    resume_max_age_days: u64,
) -> Result<Vec<PathBuf>, SnapfileError> {
    let client = crate::proxy::build_client(proxy_str);
    tokio::fs::create_dir_all(download_dir)
        .await
        .map_err(SnapfileError::Io)?;

    // Lazy cleanup of stale resume cache
    resume::cleanup_stale_resume(output_dir, resume_max_age_days);

    let mut results = Vec::new();
    let mut required_failures: Vec<String> = Vec::new();

    for (index, spec) in files.iter().enumerate() {
        if cancel_token.is_cancelled() {
            return Err(SnapfileError::Cancelled);
        }

        let filename = paths::download_filename(&spec.url, index);
        let file_path = download_dir.join(&filename);

        tracing::info!(task_id = task_id, url = %spec.url, file = %filename, "开始下载文件");

        match download_single(
            &client,
            spec,
            &file_path,
            task_id,
            output,
            cancel_token,
            output_dir,
        )
        .await
        {
            Ok(()) => {
                tracing::info!(task_id = task_id, file = %filename, "文件下载完成");
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
        return Err(SnapfileError::DownloadFailed(format!(
            "{} 个必需文件下载失败",
            required_failures.len()
        )));
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
    output_dir: &Path,
) -> Result<(), SnapfileError> {
    // 1. Probe Range support
    let probe = resume::probe_range(client, &spec.url, spec.header.as_ref(), task_id).await?;

    // 2. Check for existing .partial + .meta
    let rdir = resume::resume_dir(output_dir, &spec.url);
    let partial = resume::partial_path(&rdir);
    let mpath = resume::meta_path(&rdir);

    let existing_meta = if partial.exists() && mpath.exists() {
        match resume::ResumeMeta::load(&mpath) {
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

    // 3. Determine resume offset
    let resume_offset: Option<u64> = match (&existing_meta, probe.supports_ranges) {
        (Some(m), true)
            if m.matches_server(probe.etag.as_deref(), probe.last_modified.as_deref()) =>
        {
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
                "续传验证失败: 标识不匹配, 从头下载"
            );
            None
        }
        (Some(_), false) => {
            tracing::warn!(task_id = task_id, "服务器不支持 Range, 从头下载");
            None
        }
        (None, _) => None,
    };

    // 4. Ensure resume directory exists
    tokio::fs::create_dir_all(&rdir).await?;

    // 5. Build HTTP request with headers
    let mut request = client.get(&spec.url);

    let has_user_agent = spec
        .header
        .as_ref()
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

    // 6. Open file: append for resume, create for fresh
    let mut file = if let Some(offset) = resume_offset {
        request = request.header("Range", format!("bytes={}-", offset));
        tracing::info!(
            task_id = task_id,
            range = format!("bytes={}-", offset),
            "发送续传请求"
        );
        tokio::fs::OpenOptions::new()
            .write(true)
            .append(true)
            .open(&partial)
            .await?
    } else {
        tokio::fs::File::create(&partial).await?
    };

    let response = request.send().await?;
    let status = response.status();
    tracing::info!(task_id = task_id, status = %status, "下载响应");

    if status == StatusCode::FORBIDDEN {
        return Err(SnapfileError::HttpStatusForbidden);
    }
    if !status.is_success() {
        return Err(SnapfileError::DownloadFailed(format!("HTTP {}", status)));
    }

    let is_resume_response = status == StatusCode::PARTIAL_CONTENT;

    // Server ignored Range -> truncate and start fresh
    if resume_offset.is_some() && !is_resume_response {
        tracing::warn!(task_id = task_id, "服务器忽略 Range 请求, 从头下载");
        drop(file);
        file = tokio::fs::File::create(&partial).await?;
    }

    // 7. Determine total size and starting bytes
    let total = if is_resume_response {
        response
            .headers()
            .get("content-range")
            .and_then(|v| v.to_str().ok())
            .and_then(|s| s.rsplit('/').next())
            .and_then(|s| s.parse::<u64>().ok())
            .or(probe.total_size)
            .unwrap_or(0)
    } else {
        response
            .content_length()
            .unwrap_or(0)
            .max(probe.total_size.unwrap_or(0))
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

    // 8. Stream download + progress + metadata update
    let mut stream = response.bytes_stream();
    let mut downloaded = initial_bytes;
    let mut last_second_bytes: u64 = 0;
    let mut peak_speed: u64 = 0;
    let mut tick_count: u64 = 0;
    let mut interval = tokio::time::interval(Duration::from_secs(1));
    interval.tick().await;

    // Stats
    let dl_start = std::time::Instant::now();
    let mut ttfb_logged = false;
    let ttfb_start = std::time::Instant::now();

    let mut current_meta = resume::ResumeMeta {
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
                current_meta.downloaded_bytes = downloaded;
                let _ = current_meta.save(&mpath);
                return Err(SnapfileError::Cancelled);
            }
            chunk = stream.next() => {
                match chunk {
                    Some(Ok(bytes)) => {
                        if !ttfb_logged {
                            tracing::info!(
                                task_id = task_id,
                                ttfb_ms = ttfb_start.elapsed().as_millis(),
                                server = %probe.server,
                                "首字节时间 / 服务器标识"
                            );
                            ttfb_logged = true;
                        }
                        tokio::io::AsyncWriteExt::write_all(&mut file, &bytes).await?;
                        let n = bytes.len() as u64;
                        downloaded += n;
                        last_second_bytes += n;
                    }
                    Some(Err(e)) => {
                        current_meta.downloaded_bytes = downloaded;
                        let _ = current_meta.save(&mpath);
                        return Err(SnapfileError::Reqwest(e));
                    }
                    None => break,
                }
            }
            _ = interval.tick() => {
                let speed = last_second_bytes;
                last_second_bytes = 0;
                peak_speed = peak_speed.max(speed);
                tick_count += 1;
                let remaining = if speed > 0 {
                    total.saturating_sub(downloaded) / speed
                } else { 0 };
                output.send_progress(
                    codes::TASK_DOWNLOAD_PROGRESS,
                    task_id, downloaded, total, speed, remaining,
                ).await;

                // Update metadata every second
                current_meta.downloaded_bytes = downloaded;
                if let Err(e) = current_meta.save(&mpath) {
                    tracing::warn!(task_id = task_id, error = %e, "元数据更新失败");
                }

                // Periodic speed log every 5 seconds
                if tick_count % 5 == 0 {
                    tracing::info!(
                        task_id = task_id, downloaded = downloaded, total = total,
                        speed_kbps = speed / 1024, peak_kbps = peak_speed / 1024,
                        pct = if total > 0 { downloaded * 100 / total } else { 0 },
                        "下载进度"
                    );
                }
            }
        }
    }

    tokio::io::AsyncWriteExt::flush(&mut file).await?;
    drop(file);

    // 9. Move .partial to final destination
    match tokio::fs::rename(&partial, dest).await {
        Ok(()) => {}
        Err(e) if e.raw_os_error() == Some(18) => {
            // EXDEV: cross-device rename, fall back to copy+remove
            tracing::warn!(task_id = task_id, "跨设备 rename, 使用 copy+remove");
            tokio::fs::copy(&partial, dest).await?;
            let _ = tokio::fs::remove_file(&partial).await;
        }
        Err(e) => return Err(SnapfileError::Io(e)),
    }

    // 10. Delete metadata
    let _ = tokio::fs::remove_file(&mpath).await;

    // 11. Completion stats
    let duration_secs = dl_start.elapsed().as_secs().max(1);
    let session_bytes = downloaded.saturating_sub(initial_bytes);
    let avg_speed_kbps = (session_bytes / duration_secs) / 1024;

    tracing::info!(
        task_id = task_id,
        total_bytes = downloaded,
        duration_secs = duration_secs,
        avg_speed_kbps = avg_speed_kbps,
        peak_speed_kbps = peak_speed / 1024,
        resumed_bytes = initial_bytes,
        this_session_bytes = session_bytes,
        range_supported = probe.supports_ranges,
        server = %probe.server,
        "下载完成统计"
    );

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;

    #[test]
    fn test_user_agent_detection() {
        // 测试没有 User-Agent 的情况
        let spec_no_ua = FileSpec {
            url: "https://example.com/test.m4s".to_string(),
            language: None,
            header: Some(HashMap::from([(
                "Referer".to_string(),
                "https://bilibili.com".to_string(),
            )])),
            optional_download: None,
        };

        let has_ua = spec_no_ua
            .header
            .as_ref()
            .map(|h| h.keys().any(|k| k.to_lowercase() == "user-agent"))
            .unwrap_or(false);

        assert!(!has_ua, "应该检测到没有 User-Agent");

        // 测试有 User-Agent 的情况
        let spec_with_ua = FileSpec {
            url: "https://example.com/test.m4s".to_string(),
            language: None,
            header: Some(HashMap::from([
                ("Referer".to_string(), "https://bilibili.com".to_string()),
                ("User-Agent".to_string(), "CustomAgent/1.0".to_string()),
            ])),
            optional_download: None,
        };

        let has_ua = spec_with_ua
            .header
            .as_ref()
            .map(|h| h.keys().any(|k| k.to_lowercase() == "user-agent"))
            .unwrap_or(false);

        assert!(has_ua, "应该检测到有 User-Agent");
    }

    #[test]
    fn test_default_user_agent_constant() {
        // 验证默认 User-Agent 是有效的浏览器 UA
        assert!(DEFAULT_USER_AGENT.contains("Mozilla"));
        assert!(DEFAULT_USER_AGENT.contains("Chrome"));
        assert!(DEFAULT_USER_AGENT.contains("Windows NT"));
    }
}
