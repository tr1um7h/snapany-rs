use crate::output::OutputWriter;
use crate::protocol::{codes, messages, StartTaskPayload};
use crate::task::{run_task, Task};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::Semaphore;
use tokio_util::sync::CancellationToken;

pub struct TaskManager {
    tasks: HashMap<String, CancellationToken>,
    output: OutputWriter,
    semaphore: Arc<Semaphore>,
    ffmpeg_path: Arc<Path>,
    ffprobe_path: Arc<Path>,
    resume_max_age_days: u64,
    max_connections: usize,
    connect_timeout: Duration,
    read_timeout: Duration,
}

impl TaskManager {
    pub fn new(
        output: OutputWriter,
        max_concurrent: usize,
        ffmpeg_path: PathBuf,
        ffprobe_path: PathBuf,
        resume_max_age_days: u64,
        max_connections: usize,
        connect_timeout: Duration,
        read_timeout: Duration,
    ) -> Self {
        Self {
            tasks: HashMap::new(),
            output,
            semaphore: Arc::new(Semaphore::new(max_concurrent)),
            ffmpeg_path: Arc::from(ffmpeg_path),
            ffprobe_path: Arc::from(ffprobe_path),
            resume_max_age_days,
            max_connections,
            connect_timeout,
            read_timeout,
        }
    }

    pub async fn start_task(&mut self, payload: StartTaskPayload) {
        let task_id = payload.task_id.clone();

        if self.tasks.contains_key(&task_id) {
            tracing::warn!(task_id = %task_id, "任务已存在, 忽略重复 start-task");
            self.output
                .send_error(
                    &task_id,
                    codes::UNKNOWN_ERROR,
                    "task_already_started".to_string(),
                )
                .await;
            return;
        }

        let cancel_token = CancellationToken::new();
        self.tasks.insert(task_id.clone(), cancel_token.clone());

        let task = Task::from_payload(payload, cancel_token.clone());
        let _output = self.output.clone();
        let semaphore = self.semaphore.clone();
        let ffmpeg_path = self.ffmpeg_path.clone();
        let ffprobe_path = self.ffprobe_path.clone();
        let resume_max_age_days = self.resume_max_age_days;
        let max_connections = self.max_connections;
        let connect_timeout = self.connect_timeout;
        let read_timeout = self.read_timeout;
        let _tasks_ref = &mut self.tasks;

        // spawn task in background
        let tid = task_id.clone();
        let out = self.output.clone();
        tokio::spawn(async move {
            // catch_unwind for panic isolation
            let result = std::panic::AssertUnwindSafe(run_task(
                task,
                ffmpeg_path,
                ffprobe_path,
                out.clone(),
                semaphore,
                resume_max_age_days,
                max_connections,
                connect_timeout,
                read_timeout,
            ));

            // We can't easily catch_unwind an async fn, so we use a wrapper
            match tokio::task::spawn(async move { result.await }).await {
                Ok(Ok(())) => {
                    tracing::info!(task_id = %tid, "任务正常完成");
                }
                Ok(Err(e)) => match e {
                    crate::error::TaskError::Cancelled => {
                        tracing::info!(task_id = %tid, "任务已取消");
                        out.send_status(&tid, codes::TASK_DELETED, messages::TASK_DELETED)
                            .await;
                    }
                    crate::error::TaskError::Failed { code, message } => {
                        tracing::error!(task_id = %tid, code = code, error = %message, "任务失败");
                        out.send_error(&tid, code, message).await;
                    }
                },
                Err(join_err) => {
                    // panic caught
                    tracing::error!(task_id = %tid, error = %join_err, "任务 panic");
                    out.send_error(
                        &tid,
                        codes::UNKNOWN_ERROR,
                        format!("task panicked: {}", join_err),
                    )
                    .await;
                }
            }
        });

        tracing::info!(task_id = %task_id, "任务已注册并启动");
    }

    pub async fn delete_tasks(&mut self, task_ids: &[String]) {
        for id in task_ids {
            if let Some(token) = self.tasks.remove(id) {
                tracing::info!(task_id = %id, "取消任务");
                token.cancel();
                self.output
                    .send_status(id, codes::TASK_DELETED, messages::TASK_DELETED)
                    .await;
            } else {
                tracing::warn!(task_id = %id, "任务不存在, 忽略 delete-task");
            }
        }
    }

    pub fn update_limit(&self, new_limit: usize) {
        // Resize semaphore by replacing it
        // Note: Arc<Semaphore> doesn't support resize, so we log and ignore
        // In a real impl we'd use a dynamic semaphore wrapper
        tracing::info!(
            new_limit = new_limit,
            "更新并发限制 (当前实现不支持动态调整)"
        );
    }

    pub fn stop_recording_live(&self, task_id: &str) {
        if let Some(token) = self.tasks.get(task_id) {
            tracing::info!(task_id = task_id, "停止直播录制");
            token.cancel();
        } else {
            tracing::warn!(task_id = task_id, "直播任务不存在");
        }
    }
}
