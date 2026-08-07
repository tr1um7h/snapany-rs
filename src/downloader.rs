use crate::error::SnapfileError;
use crate::output::OutputWriter;
use crate::paths;
use crate::protocol::{codes, FileSpec};
use futures_util::StreamExt;
use reqwest::StatusCode;
use std::path::{Path, PathBuf};
use tokio_util::sync::CancellationToken;
use std::time::Duration;

const DEFAULT_USER_AGENT: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

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

        tracing::info!(task_id = task_id, url = %spec.url, file = %filename, "开始下载文件");

        match download_single(
            &client, spec, &file_path, task_id,
            output, cancel_token,
        ).await {
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
    
    // 检查是否有 User-Agent 头，如果没有则添加默认的
    let has_user_agent = spec.header.as_ref()
        .map(|h| h.keys().any(|k| k.to_lowercase() == "user-agent"))
        .unwrap_or(false);
    
    if !has_user_agent {
        tracing::info!(task_id = task_id, ua = DEFAULT_USER_AGENT, "添加默认 User-Agent");
        request = request.header("User-Agent", DEFAULT_USER_AGENT);
    }
    
    // Apply headers and log each one
    if let Some(headers) = &spec.header {
        tracing::info!(task_id = task_id, header_count = headers.len(), "应用请求头");
        for (key, value) in headers {
            tracing::info!(task_id = task_id, key = %key, value = %value, "设置请求头");
            request = request.header(key, value);
        }
    } else {
        tracing::warn!(task_id = task_id, "无请求头，使用默认");
    }

    tracing::info!(task_id = task_id, "发送 GET 请求");

    let response = request.send().await?;

    let status = response.status();
    tracing::info!(task_id = task_id, status = %status, "收到响应");
    
    if status == StatusCode::FORBIDDEN {
        tracing::error!(task_id = task_id, status = %status, "HTTP 403 Forbidden");
        return Err(SnapfileError::HttpStatusForbidden);
    }
    if !status.is_success() {
        return Err(SnapfileError::DownloadFailed(format!("HTTP {}", status)));
    }

    let total = response.content_length().unwrap_or(0);
    tracing::info!(task_id = task_id, "HTTP {} Content-Length={}", status, total);

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

    tokio::io::AsyncWriteExt::flush(&mut file).await?;
    tracing::info!(task_id = task_id, downloaded = downloaded, total = total, "文件写入完成");
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
            header: Some(HashMap::from([
                ("Referer".to_string(), "https://bilibili.com".to_string()),
            ])),
            optional_download: None,
        };

        let has_ua = spec_no_ua.header.as_ref()
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

        let has_ua = spec_with_ua.header.as_ref()
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
