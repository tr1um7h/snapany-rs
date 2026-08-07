use reqwest::Client;
use std::time::Duration;

/// 根据代理配置字符串构建 reqwest::Client
pub fn build_client(proxy_str: &str) -> Client {
    build_client_with_timeout(proxy_str, Duration::from_secs(30), Duration::from_secs(300))
}

/// 根据代理配置和超时设置构建 reqwest::Client
pub fn build_client_with_timeout(
    proxy_str: &str,
    connect_timeout: Duration,
    read_timeout: Duration,
) -> Client {
    let mut builder = Client::builder()
        .timeout(read_timeout)
        .connect_timeout(connect_timeout);

    match proxy_str {
        "direct" => {
            builder = builder.no_proxy();
        }
        "system" => {
            // macOS 系统代理通过 scutil 读取
            if let Some(proxy_url) = read_macos_system_proxy() {
                tracing::debug!(proxy = %proxy_url, "使用系统代理");
                if let Ok(proxy) = reqwest::Proxy::all(&proxy_url) {
                    builder = builder.proxy(proxy);
                }
            }
        }
        url if url.starts_with("http") => {
            tracing::debug!(proxy = %url, "使用自定义代理");
            if let Ok(proxy) = reqwest::Proxy::all(url) {
                builder = builder.proxy(proxy);
            }
        }
        _ => {
            tracing::warn!(proxy = %proxy_str, "未知代理配置, 使用直连");
            builder = builder.no_proxy();
        }
    }

    builder.build().unwrap_or_else(|e| {
        tracing::error!(error = %e, "Client 构建失败, 使用默认配置");
        Client::new()
    })
}

/// 读取 macOS 系统代理设置
fn read_macos_system_proxy() -> Option<String> {
    let output = std::process::Command::new("scutil")
        .arg("--proxy")
        .output()
        .ok()?;

    let text = String::from_utf8_lossy(&output.stdout);

    // 检查是否启用了 HTTP 代理
    if !text.contains("HTTPEnable : 1") && !text.contains("HTTPSEnable : 1") {
        return None;
    }

    let host = text
        .lines()
        .find(|l| l.contains("HTTPHost :") || l.contains("HTTPSHost :"))
        .and_then(|l| l.split(':').nth(1))?
        .trim();

    let port = text
        .lines()
        .find(|l| l.contains("HTTPPort :") || l.contains("HTTPSPort :"))
        .and_then(|l| l.split(':').nth(1))?
        .trim();

    Some(format!("http://{}:{}", host, port))
}
