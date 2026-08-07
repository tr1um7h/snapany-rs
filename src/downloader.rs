use crate::error::SnapfileError;
use crate::output::OutputWriter;
use crate::paths;
use crate::protocol::{codes, FileSpec};
use crate::resume;
use futures_util::StreamExt;
use reqwest::StatusCode;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Duration;
use tokio_util::sync::CancellationToken;

pub const DEFAULT_USER_AGENT: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

/// File size threshold for chunked download: below this, use single connection (10 MB)
const CHUNK_THRESHOLD: u64 = 10 * 1024 * 1024;

/// Calculate number of connections based on file size
/// min(max_conn, max(1, ceil(file_size_mb / 25)))
pub fn connection_count(total_size: u64, max_connections: usize) -> usize {
    if total_size <= CHUNK_THRESHOLD || max_connections <= 1 {
        return 1;
    }
    let file_mb = (total_size as f64 / (1024.0 * 1024.0)).ceil() as usize;
    let calculated = file_mb.div_ceil(25);
    calculated.clamp(1, max_connections)
}

pub async fn download_all_files(
    files: &[FileSpec],
    download_dir: &Path,
    proxy_str: &str,
    task_id: &str,
    output: &OutputWriter,
    cancel_token: &CancellationToken,
    output_dir: &Path,
    resume_max_age_days: u64,
    max_connections: usize,
    connect_timeout: Duration,
    read_timeout: Duration,
) -> Result<Vec<PathBuf>, SnapfileError> {
    let client = crate::proxy::build_client_with_timeout(proxy_str, connect_timeout, read_timeout);
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
            max_connections,
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

/// Entry point: decide single-connection vs chunked based on file size + Range support
async fn download_single(
    client: &reqwest::Client,
    spec: &FileSpec,
    dest: &Path,
    task_id: &str,
    output: &OutputWriter,
    cancel_token: &CancellationToken,
    output_dir: &Path,
    max_connections: usize,
) -> Result<(), SnapfileError> {
    // Probe Range support first
    let probe = resume::probe_range(client, &spec.url, spec.header.as_ref(), task_id).await?;

    let total = probe.total_size.unwrap_or(0);
    let num_conn = if probe.supports_ranges {
        connection_count(total, max_connections)
    } else {
        1
    };

    if num_conn > 1 {
        tracing::info!(
            task_id = task_id,
            total = total,
            connections = num_conn,
            "使用分片并行下载"
        );
        download_chunked(
            client,
            spec,
            dest,
            task_id,
            output,
            cancel_token,
            output_dir,
            probe,
            num_conn,
        )
        .await
    } else {
        download_single_conn(
            client,
            spec,
            dest,
            task_id,
            output,
            cancel_token,
            output_dir,
            probe,
        )
        .await
    }
}

/// Single-connection download with resume support (P0)
async fn download_single_conn(
    client: &reqwest::Client,
    spec: &FileSpec,
    dest: &Path,
    task_id: &str,
    output: &OutputWriter,
    cancel_token: &CancellationToken,
    output_dir: &Path,
    probe: resume::RangeProbe,
) -> Result<(), SnapfileError> {
    // 1. Probe Range support
    // Check for existing .partial + .meta
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
        completed_chunks: vec![],
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

/// Multi-connection chunked download (P1)
///
/// Splits file into `num_conn` ranges, downloads concurrently,
/// writes each chunk at its offset in .partial, tracks progress atomically.
async fn download_chunked(
    client: &reqwest::Client,
    spec: &FileSpec,
    dest: &Path,
    task_id: &str,
    output: &OutputWriter,
    cancel_token: &CancellationToken,
    output_dir: &Path,
    probe: resume::RangeProbe,
    num_conn: usize,
) -> Result<(), SnapfileError> {
    let total = probe.total_size.unwrap_or(0);
    if total == 0 {
        tracing::warn!(task_id = task_id, "total_size=0, 回退到单连接");
        return download_single_conn(
            client,
            spec,
            dest,
            task_id,
            output,
            cancel_token,
            output_dir,
            probe,
        )
        .await;
    }

    let rdir = resume::resume_dir(output_dir, &spec.url);
    let partial = resume::partial_path(&rdir);
    let mpath = resume::meta_path(&rdir);
    tokio::fs::create_dir_all(&rdir).await?;

    // Calculate chunk boundaries
    let chunk_size = total / num_conn as u64;
    let remainder = total % num_conn as u64;
    let mut chunks: Vec<(u64, u64)> = Vec::with_capacity(num_conn); // (start, end_inclusive)
    let mut offset = 0u64;
    for i in 0..num_conn {
        let size = chunk_size + if i < remainder as usize { 1 } else { 0 };
        chunks.push((offset, offset + size - 1));
        offset += size;
    }

    // Load existing metadata to check completed chunks
    let mut completed = if partial.exists() && mpath.exists() {
        match resume::ResumeMeta::load(&mpath) {
            Ok(m)
                if m.matches_server(probe.etag.as_deref(), probe.last_modified.as_deref())
                    && m.completed_chunks.len() == num_conn =>
            {
                tracing::info!(
                    task_id = task_id,
                    completed = m.completed_chunks.iter().filter(|&&c| c).count(),
                    total_chunks = num_conn,
                    "分片续传: 恢复已完成分片"
                );
                m.completed_chunks
            }
            _ => {
                tracing::info!(task_id = task_id, "无有效分片元数据, 从头下载所有分片");
                vec![false; num_conn]
            }
        }
    } else {
        vec![false; num_conn]
    };

    // Pre-allocate .partial file
    {
        let f = tokio::fs::OpenOptions::new()
            .create(true)
            .write(true)
            .truncate(true)
            .open(&partial)
            .await?;
        f.set_len(total).await?;
    }

    let dl_start = std::time::Instant::now();
    let total_downloaded = Arc::new(AtomicU64::new(0));

    // Calculate already-downloaded bytes from completed chunks
    for (i, &(start, end)) in chunks.iter().enumerate() {
        if completed[i] {
            total_downloaded.fetch_add(end - start + 1, Ordering::Relaxed);
        }
    }
    let initial_bytes = total_downloaded.load(Ordering::Relaxed);

    // Progress reporting task
    let progress_handle = {
        let total_downloaded = total_downloaded.clone();
        let output = output.clone();
        let task_id = task_id.to_string();
        let cancel = cancel_token.clone();
        tokio::spawn(async move {
            let mut interval = tokio::time::interval(Duration::from_secs(1));
            interval.tick().await;
            let mut last_bytes: u64 = initial_bytes;
            loop {
                tokio::select! {
                    biased;
                    _ = cancel.cancelled() => break,
                    _ = interval.tick() => {
                        let current = total_downloaded.load(Ordering::Relaxed);
                        let speed = current.saturating_sub(last_bytes);
                        last_bytes = current;
                        let remaining = if speed > 0 {
                            total.saturating_sub(current) / speed
                        } else { 0 };
                        output.send_progress(
                            codes::TASK_DOWNLOAD_PROGRESS,
                            &task_id, current, total, speed, remaining,
                        ).await;
                    }
                }
            }
        })
    };

    // Download each incomplete chunk concurrently
    let mut chunk_tasks = Vec::new();
    for (i, &(start, end)) in chunks.iter().enumerate() {
        if completed[i] {
            tracing::info!(task_id = task_id, chunk = i, "分片已完成, 跳过");
            continue;
        }

        let client = client.clone();
        let url = spec.url.clone();
        let headers = spec.header.clone();
        let partial = partial.clone();
        let task_id = task_id.to_string();
        let total_dl = total_downloaded.clone();
        let cancel = cancel_token.clone();

        chunk_tasks.push(tokio::spawn(async move {
            download_single_chunk(
                &client,
                &url,
                headers.as_ref(),
                start,
                end,
                i,
                &partial,
                &task_id,
                &total_dl,
                &cancel,
            )
            .await
        }));
    }

    // Wait for all chunk tasks
    let mut had_error = false;
    for task in chunk_tasks {
        match task.await {
            Ok(Ok(chunk_idx)) => {
                completed[chunk_idx] = true;
                // Save metadata after each chunk completes
                let meta = resume::ResumeMeta {
                    url: spec.url.clone(),
                    downloaded_bytes: total_downloaded.load(Ordering::Relaxed),
                    total_size: total,
                    etag: probe.etag.clone(),
                    last_modified: probe.last_modified.clone(),
                    completed_chunks: completed.clone(),
                };
                let _ = meta.save(&mpath);
                tracing::info!(task_id = task_id, chunk = chunk_idx, "分片下载完成");
            }
            Ok(Err(e)) => {
                tracing::error!(task_id = task_id, error = %e, "分片下载失败");
                had_error = true;
            }
            Err(e) => {
                tracing::error!(task_id = task_id, error = %e, "分片任务 join 失败");
                had_error = true;
            }
        }
    }

    // Stop progress reporting
    progress_handle.abort();

    if had_error {
        // Save metadata for resume
        let meta = resume::ResumeMeta {
            url: spec.url.clone(),
            downloaded_bytes: total_downloaded.load(Ordering::Relaxed),
            total_size: total,
            etag: probe.etag.clone(),
            last_modified: probe.last_modified.clone(),
            completed_chunks: completed.clone(),
        };
        let _ = meta.save(&mpath);

        if cancel_token.is_cancelled() {
            return Err(SnapfileError::Cancelled);
        }
        return Err(SnapfileError::DownloadFailed(format!(
            "分片下载失败, 已完成 {}/{}",
            completed.iter().filter(|&&c| c).count(),
            num_conn
        )));
    }

    // Move .partial to dest
    match tokio::fs::rename(&partial, dest).await {
        Ok(()) => {}
        Err(e) if e.raw_os_error() == Some(18) => {
            tracing::warn!(task_id = task_id, "跨设备 rename, 使用 copy+remove");
            tokio::fs::copy(&partial, dest).await?;
            let _ = tokio::fs::remove_file(&partial).await;
        }
        Err(e) => return Err(SnapfileError::Io(e)),
    }
    let _ = tokio::fs::remove_file(&mpath).await;

    // Completion stats
    let duration_secs = dl_start.elapsed().as_secs().max(1);
    let session_bytes = total_downloaded
        .load(Ordering::Relaxed)
        .saturating_sub(initial_bytes);
    let avg_speed_kbps = (session_bytes / duration_secs) / 1024;

    tracing::info!(
        task_id = task_id,
        total_bytes = total,
        connections = num_conn,
        duration_secs = duration_secs,
        avg_speed_kbps = avg_speed_kbps,
        resumed_bytes = initial_bytes,
        this_session_bytes = session_bytes,
        server = %probe.server,
        "分片下载完成统计"
    );

    Ok(())
}

/// Download a single chunk with retry
async fn download_single_chunk(
    client: &reqwest::Client,
    url: &str,
    headers: Option<&std::collections::HashMap<String, String>>,
    start: u64,
    end: u64,
    chunk_idx: usize,
    partial: &Path,
    task_id: &str,
    total_downloaded: &AtomicU64,
    cancel: &CancellationToken,
) -> Result<usize, SnapfileError> {
    let max_retries = 3;
    let mut last_err = None;

    for attempt in 0..max_retries {
        if cancel.is_cancelled() {
            return Err(SnapfileError::Cancelled);
        }

        match download_single_chunk_attempt(
            client,
            url,
            headers,
            start,
            end,
            chunk_idx,
            partial,
            task_id,
            total_downloaded,
            cancel,
        )
        .await
        {
            Ok(()) => {
                if attempt > 0 {
                    tracing::info!(
                        task_id = task_id,
                        chunk = chunk_idx,
                        attempt = attempt + 1,
                        "分片重试成功"
                    );
                }
                return Ok(chunk_idx);
            }
            Err(SnapfileError::Cancelled) => return Err(SnapfileError::Cancelled),
            Err(e) => {
                tracing::warn!(
                    task_id = task_id, chunk = chunk_idx, attempt = attempt + 1,
                    max_retries, error = %e, "分片下载失败, 将重试"
                );
                last_err = Some(e);
            }
        }
    }

    Err(last_err.unwrap_or(SnapfileError::DownloadFailed("未知错误".to_string())))
}

/// Single attempt to download one chunk
async fn download_single_chunk_attempt(
    client: &reqwest::Client,
    url: &str,
    headers: Option<&std::collections::HashMap<String, String>>,
    start: u64,
    end: u64,
    chunk_idx: usize,
    partial: &Path,
    task_id: &str,
    total_downloaded: &AtomicU64,
    cancel: &CancellationToken,
) -> Result<(), SnapfileError> {
    use tokio::io::{AsyncSeekExt, AsyncWriteExt};

    let mut request = client
        .get(url)
        .header("Range", format!("bytes={}-{}", start, end));

    let has_ua = headers
        .map(|h| h.keys().any(|k| k.to_lowercase() == "user-agent"))
        .unwrap_or(false);
    if !has_ua {
        request = request.header("User-Agent", DEFAULT_USER_AGENT);
    }
    if let Some(h) = headers {
        for (key, value) in h {
            request = request.header(key, value);
        }
    }

    tracing::debug!(
        task_id = task_id,
        chunk = chunk_idx,
        range = format!("bytes={}-{}", start, end),
        "分片请求"
    );

    let response = request.send().await?;
    let status = response.status();

    if status != StatusCode::PARTIAL_CONTENT && status != StatusCode::OK {
        return Err(SnapfileError::DownloadFailed(format!(
            "分片 {} HTTP {}",
            chunk_idx, status
        )));
    }

    // Seek to chunk start offset in .partial
    let mut file = tokio::fs::OpenOptions::new()
        .write(true)
        .open(partial)
        .await?;
    file.seek(std::io::SeekFrom::Start(start)).await?;

    let mut stream = response.bytes_stream();
    let mut chunk_bytes: u64 = 0;

    loop {
        if cancel.is_cancelled() {
            return Err(SnapfileError::Cancelled);
        }
        match stream.next().await {
            Some(Ok(bytes)) => {
                file.write_all(&bytes).await?;
                let n = bytes.len() as u64;
                chunk_bytes += n;
                total_downloaded.fetch_add(n, Ordering::Relaxed);
            }
            Some(Err(e)) => return Err(SnapfileError::Reqwest(e)),
            None => break,
        }
    }

    file.flush().await?;
    tracing::debug!(
        task_id = task_id,
        chunk = chunk_idx,
        bytes = chunk_bytes,
        "分片写入完成"
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

    #[test]
    fn test_connection_count_below_threshold() {
        assert_eq!(connection_count(5 * 1024 * 1024, 8), 1); // 5MB -> 1
        assert_eq!(connection_count(10 * 1024 * 1024, 8), 1); // exactly 10MB -> 1
    }

    #[test]
    fn test_connection_count_small_file() {
        assert_eq!(connection_count(50 * 1024 * 1024, 8), 2); // 50MB -> 2
    }

    #[test]
    fn test_connection_count_medium_file() {
        assert_eq!(connection_count(100 * 1024 * 1024, 8), 4); // 100MB -> 4
        assert_eq!(connection_count(200 * 1024 * 1024, 8), 8); // 200MB -> 8
    }

    #[test]
    fn test_connection_count_large_file() {
        assert_eq!(connection_count(1024 * 1024 * 1024, 8), 8); // 1GB -> 8 (capped)
    }

    #[test]
    fn test_connection_count_respects_max() {
        assert_eq!(connection_count(500 * 1024 * 1024, 4), 4); // 500MB but max=4 -> 4
        assert_eq!(connection_count(100 * 1024 * 1024, 2), 2); // 100MB but max=2 -> 2
    }

    #[test]
    fn test_connection_count_max_one() {
        assert_eq!(connection_count(1024 * 1024 * 1024, 1), 1); // always 1
    }
}
