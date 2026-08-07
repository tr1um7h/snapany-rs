use crate::error::SnapfileError;
use crate::output::OutputWriter;
use crate::protocol::codes;
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
            }
        }
        "ogg" => {
            cmd.arg("-c:a").arg("libvorbis");
            if let Some(br) = bitrate {
                cmd.arg("-b:a").arg(format!("{}k", br));
            }
        }
        "m4a" => {
            cmd.arg("-c:a").arg("aac");
            if let Some(br) = bitrate {
                cmd.arg("-b:a").arg(format!("{}k", br));
            }
        }
        _ => {
            cmd.arg("-c:a").arg("copy");
        }
    }

    cmd.arg("-y").arg(output_path);

    let cmd_str = format!("{:?}", cmd);
    tracing::debug!(task_id = task_id, cmd = %cmd_str, "调用 ffmpeg 转码");

    run_ffmpeg_with_progress(cmd, output, task_id, total_input_size, cancel_token).await
}

/// 运行 ffmpeg 并解析进度输出
async fn run_ffmpeg_with_progress(
    mut cmd: Command,
    output: &OutputWriter,
    task_id: &str,
    total_input_size: u64,
    cancel_token: &CancellationToken,
) -> Result<(), SnapfileError> {
    cmd.stdout(Stdio::piped()).stderr(Stdio::piped());

    let mut child = cmd.spawn().map_err(|e| {
        SnapfileError::ConvertFailed(format!("ffmpeg 启动失败: {}", e))
    })?;

    let stdout = child.stdout.take().unwrap();
    let mut reader = BufReader::new(stdout);
    let mut line = String::new();

    // 读取 ffmpeg -progress 输出
    loop {
        tokio::select! {
            biased;
            _ = cancel_token.cancelled() => {
                tracing::info!(task_id = task_id, "ffmpeg 被取消");
                let _ = child.kill().await;
                return Err(SnapfileError::Cancelled);
            }
            result = reader.read_line(&mut line) => {
                match result {
                    Ok(0) => break,
                    Ok(_) => {
                        // ffmpeg -progress 格式: key=value
                        if line.starts_with("out_time_us=") {
                            if let Some(us_str) = line.strip_prefix("out_time_us=") {
                                if let Ok(us) = us_str.trim().parse::<u64>() {
                                    // 粗略估算进度: out_time_us / total_duration_us
                                    // 但我们用 input_size 作为 total, 所以这里用时间估算
                                    let done = us / 1000; // 毫秒
                                    let total = if total_input_size > 0 { total_input_size } else { 1 };
                                    output.send_progress(
                                        codes::TASK_CONVERSION_PROGRESS,
                                        task_id, done, total, 0, 0,
                                    ).await;
                                }
                            }
                        }
                        line.clear();
                    }
                    Err(e) => {
                        tracing::warn!(task_id = task_id, error = %e, "读取 ffmpeg stdout 失败");
                        break;
                    }
                }
            }
        }
    }

    let status = child.wait().await.map_err(|e| {
        SnapfileError::ConvertFailed(format!("ffmpeg wait 失败: {}", e))
    })?;

    if !status.success() {
        // 读取 stderr 获取错误信息
        let stderr = if let Some(stderr) = child.stderr.take() {
            let mut reader = BufReader::new(stderr);
            let mut err_line = String::new();
            let mut err_output = String::new();
            while reader.read_line(&mut err_line).await.unwrap_or(0) > 0 {
                err_output.push_str(&err_line);
                err_line.clear();
                if err_output.len() > 2000 { break; }
            }
            err_output
        } else {
            String::new()
        };
        return Err(SnapfileError::ConvertFailed(format!(
            "ffmpeg 退出码: {:?}, stderr: {}", status.code(), stderr
        )));
    }

    tracing::debug!(task_id = task_id, "ffmpeg 完成");
    Ok(())
}
