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
        "{} -v quiet -print_format json -show_format -show_streams {}",
        ffprobe_path.display(),
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
