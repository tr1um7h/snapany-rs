use crate::error::SnapfileError;
use std::path::{Path, PathBuf};

/// 将文件移动到最终输出目录
pub async fn move_to_output(
    source: &Path,
    output_dir: &Path,
    name: &str,
    ext: &str,
) -> Result<PathBuf, SnapfileError> {
    if let Some(parent) = output_dir.parent() {
        tokio::fs::create_dir_all(parent)
            .await
            .map_err(SnapfileError::Io)?;
    }
    tokio::fs::create_dir_all(output_dir)
        .await
        .map_err(SnapfileError::Io)?;

    let safe_name = crate::paths::sanitize_filename(name);
    let base_path = output_dir.join(format!("{}.{}", safe_name, ext));
    let final_dest = resolve_conflict(&base_path).await?;

    tracing::debug!(from = %source.display(), to = %final_dest.display(), "移动文件");

    // 尝试 rename, 跨设备时 fallback 到 copy + delete
    match tokio::fs::rename(source, &final_dest).await {
        Ok(()) => Ok(final_dest),
        Err(_) => {
            tracing::debug!("rename 失败, 尝试 copy + delete");
            tokio::fs::copy(source, &final_dest)
                .await
                .map_err(SnapfileError::Io)?;
            tokio::fs::remove_file(source)
                .await
                .map_err(SnapfileError::Io)?;
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

    Err(SnapfileError::MoveFailed(format!(
        "无法解析文件冲突: {}",
        path.display()
    )))
}

/// 清理临时目录 (best effort)
pub async fn cleanup_temp_dir(dir: &Path) {
    match tokio::fs::remove_dir_all(dir).await {
        Ok(()) => tracing::info!(dir = %dir.display(), "临时目录已清理"),
        Err(e) => tracing::warn!(dir = %dir.display(), error = %e, "清理临时目录失败"),
    }
}
