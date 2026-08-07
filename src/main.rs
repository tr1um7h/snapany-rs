mod cli;
mod logging;
mod protocol;
mod output;
mod error;
mod paths;
mod proxy;
mod downloader;
mod ffprobe;
mod converter;
mod mover;
mod task;
mod manager;

use clap::Parser;
use tokio::io::{AsyncBufReadExt, BufReader};
use crate::protocol::Request;
use crate::output::OutputWriter;
use crate::manager::TaskManager;

#[tokio::main]
async fn main() {
    let args = cli::Args::parse();
    logging::init(&args.log_level);

    tracing::info!(
        ffmpeg = %args.ffmpeg_path.display(),
        ffprobe = %args.ffprobe_path.display(),
        max_tasks = args.max_downloading_task,
        "snapfile-rs 启动"
    );

    let output = OutputWriter::new();
    let mut manager = TaskManager::new(
        output,
        args.max_downloading_task,
        args.ffmpeg_path.clone(),
        args.ffprobe_path.clone(),
    );

    // stdin 读取循环
    let stdin = tokio::io::stdin();
    let mut reader = BufReader::new(stdin);
    let mut line = String::new();

    loop {
        line.clear();
        match reader.read_line(&mut line).await {
            Ok(0) => {
                tracing::info!("stdin 已关闭, 进程准备退出");
                break;
            }
            Ok(_) => {
                let text = line.trim();
                if text.is_empty() {
                    continue;
                }

                let request: Request = match serde_json::from_str(text) {
                    Ok(r) => r,
                    Err(e) => {
                        tracing::error!(
                            error = %e,
                            raw = %text,
                            "stdin JSON 解析失败, 跳过此行"
                        );
                        continue;
                    }
                };

                match request {
                    Request::StartTask(payload) => {
                        let task_id = payload.task_id.clone();
                        let name = payload.name.clone();
                        let count = payload.files.len();
                        tracing::info!(task_id = %task_id, name = %name, files = count, "收到 start-task");
                        manager.start_task(payload).await;
                    }
                    Request::DeleteTask(payload) => {
                        tracing::info!(task_ids = ?payload.task_ids, "收到 delete-task");
                        manager.delete_tasks(&payload.task_ids).await;
                    }
                    Request::UpdateMaxDownloadTask(payload) => {
                        manager.update_limit(payload.limit);
                    }
                    Request::StopRecordingLive(payload) => {
                        manager.stop_recording_live(&payload.task_id);
                    }
                }
            }
            Err(e) => {
                tracing::error!(error = %e, "stdin 读取错误");
                break;
            }
        }
    }

    tracing::info!("snapfile-rs 退出");
}
