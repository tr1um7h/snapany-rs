use crate::error::{SnapfileError, TaskError};
use crate::output::OutputWriter;
use crate::protocol::{codes, messages, StartTaskPayload, FileSpec};
use crate::{downloader, converter, mover, paths};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use tokio::sync::Semaphore;
use tokio_util::sync::CancellationToken;

pub struct Task {
    pub id: String,
    pub name: String,
    pub output_dir: PathBuf,
    pub temp_dir: PathBuf,
    pub output_type: String,
    pub output_video_format: Option<String>,
    pub output_audio_format: Option<String>,
    pub audio_bitrate: Option<u32>,
    pub proxy: String,
    pub files: Vec<FileSpec>,
    pub cancel_token: CancellationToken,
}

impl Task {
    pub fn from_payload(payload: StartTaskPayload, cancel_token: CancellationToken) -> Self {
        Self {
            id: payload.task_id,
            name: payload.name,
            output_dir: PathBuf::from(payload.output_dir),
            temp_dir: PathBuf::from(payload.temp_dir),
            output_type: payload.output_type,
            output_video_format: payload.output_video_format,
            output_audio_format: payload.output_audio_format,
            audio_bitrate: payload.audio_bitrate,
            proxy: payload.proxy,
            files: payload.files,
            cancel_token,
        }
    }

    fn ext(&self) -> &str {
        paths::output_extension(
            &self.output_type,
            self.output_video_format.as_deref(),
            self.output_audio_format.as_deref(),
        )
    }
}

/// RAII guard: 无论 run_task 以何种方式退出都清理临时目录
struct CleanupGuard {
    dir: PathBuf,
    task_id: String,
}

impl Drop for CleanupGuard {
    fn drop(&mut self) {
        let dir = self.dir.clone();
        let task_id = self.task_id.clone();
        std::thread::spawn(move || {
            match std::fs::remove_dir_all(&dir) {
                Ok(()) => tracing::info!(task_id = %task_id, dir = %dir.display(), "临时目录已清理"),
                Err(e) => tracing::warn!(task_id = %task_id, dir = %dir.display(), error = %e, "清理临时目录失败"),
            }
        });
    }
}

pub async fn run_task(
    task: Task,
    ffmpeg_path: Arc<Path>,
    _ffprobe_path: Arc<Path>,
    output: OutputWriter,
    semaphore: Arc<Semaphore>,
) -> Result<(), TaskError> {
    let _guard = CleanupGuard {
        dir: paths::temp_root(&task.temp_dir, &task.id),
        task_id: task.id.clone(),
    };

    tracing::info!(task_id = %task.id, name = %task.name, files = task.files.len(), "任务开始");

    // 1. Started
    emit_status(&task, codes::TASK_STARTED, messages::TASK_STARTED, &output).await;

    // 2. Prepare
    emit_status(&task, codes::TASK_START_PREPARE, messages::TASK_START_PREPARE, &output).await;
    let dl_dir = paths::download_dir(&task.temp_dir, &task.id);
    let conv_dir = paths::converting_dir(&task.temp_dir, &task.id);
    let conv_done = paths::converted_dir(&task.temp_dir, &task.id);
    tokio::fs::create_dir_all(&dl_dir).await
        .map_err(|e| to_task_error(SnapfileError::Io(e), &task.id))?;
    emit_status(&task, codes::TASK_PREPARED, messages::TASK_PREPARED, &output).await;

    // 3. Acquire download permit
    emit_status(&task, codes::TASK_PENDING_DOWNLOAD, messages::TASK_PENDING_DOWNLOAD, &output).await;
    let _permit = semaphore.acquire_owned().await
        .map_err(|_| TaskError::failed(codes::DOWNLOAD_ERROR, "信号量已关闭"))?;
    tracing::debug!(task_id = %task.id, "获取下载许可");

    // 4. Download
    emit_status(&task, codes::TASK_START_DOWNLOAD, messages::TASK_START_DOWNLOAD, &output).await;
    let downloaded = downloader::download_all_files(
        &task.files, &dl_dir, &task.proxy,
        &task.id, &output, &task.cancel_token,
    ).await.map_err(|e| to_task_error(e, &task.id))?;

    emit_status(&task, codes::TASK_DOWNLOADED, messages::TASK_DOWNLOADED, &output).await;

    // 释放下载许可
    drop(_permit);

    // 5. Convert (optional)
    let source_file = if paths::needs_conversion(
        &task.output_type,
        task.output_audio_format.as_deref(),
        downloaded.len(),
    ) {
        emit_status(&task, codes::TASK_PENDING_CONVERSION, messages::TASK_PENDING_CONVERSION, &output).await;
        emit_status(&task, codes::TASK_START_CONVERSION, messages::TASK_START_CONVERSION, &output).await;

        tokio::fs::create_dir_all(&conv_dir).await
            .map_err(|e| to_task_error(SnapfileError::Io(e), &task.id))?;
        tokio::fs::create_dir_all(&conv_done).await
            .map_err(|e| to_task_error(SnapfileError::Io(e), &task.id))?;

        let conv_name = paths::converting_filename(&task.name, task.ext());
        let conv_path = conv_dir.join(&conv_name);
        let conv_done_path = conv_done.join(&conv_name);

        // 获取输入文件总大小 (用于进度)
        let mut total_input: u64 = 0;
        for f in &downloaded {
            if let Ok(meta) = tokio::fs::metadata(f).await {
                total_input += meta.len();
            }
        }

        match task.output_type.as_str() {
            "video" => {
                converter::merge_video_audio(
                    &ffmpeg_path, &downloaded, &conv_path, task.ext(),
                    &task.id, total_input, &output, &task.cancel_token,
                ).await.map_err(|e| to_task_error(e, &task.id))?;
            }
            "audio" => {
                converter::transcode_audio(
                    &ffmpeg_path, &downloaded[0], &conv_path,
                    task.output_audio_format.as_deref().unwrap_or("mp3"),
                    task.audio_bitrate,
                    &task.id, total_input, &output, &task.cancel_token,
                ).await.map_err(|e| to_task_error(e, &task.id))?;
            }
            _ => {}
        }

        tokio::fs::rename(&conv_path, &conv_done_path).await
            .map_err(|e| to_task_error(SnapfileError::Io(e), &task.id))?;

        emit_status(&task, codes::TASK_CONVERTED, messages::TASK_CONVERTED, &output).await;
        conv_done_path
    } else {
        // 不转码: 直接用第一个下载文件
        downloaded[0].clone()
    };

    // 6. Move
    emit_status(&task, codes::TASK_START_MOVE, messages::TASK_START_MOVE, &output).await;
    let final_path = mover::move_to_output(
        &source_file, &task.output_dir, &task.name, task.ext(),
    ).await.map_err(|e| to_task_error(e, &task.id))?;

    emit_status(&task, codes::TASK_MOVED, messages::TASK_MOVED, &output).await;

    // 7. Complete
    output.send_complete(&task.id, vec![final_path.to_string_lossy().to_string()]).await;
    tracing::info!(task_id = %task.id, "任务完成");

    Ok(())
}

async fn emit_status(task: &Task, code: &'static str, message: &'static str, output: &OutputWriter) {
    output.send_status(&task.id, code, message).await;
}

fn to_task_error(e: SnapfileError, task_id: &str) -> TaskError {
    let code = e.to_status_code();
    let msg = e.to_message();
    tracing::error!(task_id = task_id, code = code, error = %msg, "任务错误");
    TaskError::failed(code, msg)
}
