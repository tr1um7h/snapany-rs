use md5::{Digest, Md5};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::{Path, PathBuf};

pub use crate::error::SnapfileError;

const DEFAULT_USER_AGENT: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

/// 续传元数据，记录已下载字节数和服务器标识
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ResumeMeta {
    pub url: String,
    pub downloaded_bytes: u64,
    pub total_size: u64,
    pub etag: Option<String>,
    pub last_modified: Option<String>,
    /// 分片下载: 每个分片是否完成
    #[serde(default)]
    pub completed_chunks: Vec<bool>,
}

impl ResumeMeta {
    /// 将元数据保存为 JSON 文件
    pub fn save(&self, path: &Path) -> std::io::Result<()> {
        let json = serde_json::to_string_pretty(self).map_err(std::io::Error::other)?;
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
    hasher
        .finalize()
        .iter()
        .map(|b| format!("{:02x}", b))
        .collect()
}

/// 续传缓存目录: {outputDir}/.SnapAny/.resume/{url_hash}/
pub fn resume_dir(output_dir: &Path, url: &str) -> PathBuf {
    output_dir
        .join(".SnapAny")
        .join(".resume")
        .join(url_hash(url))
}

/// .partial 文件路径
pub fn partial_path(dir: &Path) -> PathBuf {
    dir.join("download.partial")
}

/// .partial.meta 文件路径
pub fn meta_path(dir: &Path) -> PathBuf {
    dir.join("download.partial.meta")
}

/// HEAD 请求探测结果
#[derive(Debug)]
pub struct RangeProbe {
    pub supports_ranges: bool,
    pub total_size: Option<u64>,
    pub etag: Option<String>,
    pub last_modified: Option<String>,
    pub server: String,
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

    tracing::info!(task_id = task_id, url = url, "探测 Range 支持: HEAD 请求");

    let response = request.send().await?;
    let status = response.status();

    tracing::info!(task_id = task_id, status = %status, "HEAD 响应状态");

    // 405 -> 回退到 Range GET
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

    let server = response
        .headers()
        .get("server")
        .map(|v| v.to_str().unwrap_or("").to_string())
        .unwrap_or_default();

    tracing::info!(
        task_id = task_id,
        accept_ranges = accept_ranges,
        supports_ranges = supports,
        content_length = ?total_size,
        etag = ?etag,
        last_modified = ?last_modified,
        server = %server,
        "Range 探测结果"
    );

    Ok(RangeProbe {
        supports_ranges: supports,
        total_size,
        etag,
        last_modified,
        server,
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

    let server = response
        .headers()
        .get("server")
        .map(|v| v.to_str().unwrap_or("").to_string())
        .unwrap_or_default();

    tracing::info!(
        task_id = task_id,
        status = %status,
        supports_ranges = supports,
        total_size = ?total_size,
        server = %server,
        "Range GET 探测结果"
    );

    Ok(RangeProbe {
        supports_ranges: supports,
        total_size,
        etag,
        last_modified,
        server,
    })
}

/// 清理 outputDir 下超过 max_age_days 的续传缓存条目
pub fn cleanup_stale_resume(output_dir: &Path, max_age_days: u64) {
    let root = output_dir.join(".SnapAny").join(".resume");
    if !root.exists() {
        return;
    }
    let cutoff =
        std::time::SystemTime::now() - std::time::Duration::from_secs(max_age_days * 86400);
    let mut cleaned = 0u32;
    if let Ok(entries) = std::fs::read_dir(&root) {
        for entry in entries.flatten() {
            let meta = entry.path().join("download.partial.meta");
            let stale = std::fs::metadata(&meta)
                .and_then(|m| m.modified())
                .map(|t| t < cutoff)
                .unwrap_or(false);
            if stale && std::fs::remove_dir_all(entry.path()).is_ok() {
                cleaned += 1;
            }
        }
    }
    if cleaned > 0 {
        tracing::info!(
            cleaned = cleaned,
            max_age_days = max_age_days,
            "清理过期续传缓存"
        );
    }
}
