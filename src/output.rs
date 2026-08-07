use crate::protocol::{codes, messages, Response, ResponseData};
use std::io::{BufWriter, Write};
use std::sync::{Arc, Mutex};

#[derive(Clone)]
pub struct OutputWriter {
    inner: Arc<Mutex<BufWriter<std::io::Stdout>>>,
}

impl Default for OutputWriter {
    fn default() -> Self {
        Self::new()
    }
}

impl OutputWriter {
    pub fn new() -> Self {
        Self {
            inner: Arc::new(Mutex::new(BufWriter::new(std::io::stdout()))),
        }
    }

    /// 发送一条响应到 stdout, 返回是否成功
    pub async fn send(&self, response: Response) -> bool {
        let json = match serde_json::to_string(&response) {
            Ok(s) => s,
            Err(e) => {
                tracing::error!(error = %e, "Response 序列化失败");
                return false;
            }
        };

        let inner = self.inner.clone();
        let result = tokio::task::spawn_blocking(move || {
            let mut w = inner.lock().unwrap();
            match writeln!(w, "{}", json) {
                Ok(()) => {
                    let _ = w.flush();
                    true
                }
                Err(e) => {
                    tracing::error!(error = %e, "stdout 写入失败, 父进程可能已关闭管道");
                    false
                }
            }
        })
        .await;

        result.unwrap_or(false)
    }

    /// 发送状态变更消息
    pub async fn send_status(&self, task_id: &str, code: &'static str, message: &'static str) {
        tracing::debug!(task_id = task_id, code = code, "→ stdout");
        self.send(Response {
            code,
            data: ResponseData::Status {
                task_id: task_id.to_string(),
            },
            message: message.to_string(),
        })
        .await;
    }

    /// 发送进度消息
    pub async fn send_progress(
        &self,
        code: &'static str,
        task_id: &str,
        done: u64,
        total: u64,
        speed: u64,
        remaining_time: u64,
    ) {
        self.send(Response {
            code,
            data: ResponseData::Progress {
                task_id: task_id.to_string(),
                done,
                total,
                speed,
                remaining_time,
            },
            message: match code {
                c if c == codes::TASK_DOWNLOAD_PROGRESS => messages::DOWNLOAD_PROGRESS.to_string(),
                _ => messages::CONVERSION_PROGRESS.to_string(),
            },
        })
        .await;
    }

    /// 发送任务完成消息
    pub async fn send_complete(&self, task_id: &str, files: Vec<String>) {
        self.send(Response {
            code: codes::TASK_COMPLETE,
            data: ResponseData::Complete {
                task_id: task_id.to_string(),
                files,
            },
            message: messages::TASK_COMPLETE.to_string(),
        })
        .await;
    }

    /// 发送文件下载错误
    pub async fn send_file_error(&self, task_id: &str, url: &str) {
        self.send(Response {
            code: codes::FILE_DOWNLOAD_ERROR,
            data: ResponseData::FileError {
                task_id: task_id.to_string(),
                url: url.to_string(),
            },
            message: messages::FILE_DOWNLOAD_ERROR.to_string(),
        })
        .await;
    }

    /// 发送任务级错误
    pub async fn send_error(&self, task_id: &str, code: &'static str, message: String) {
        self.send(Response {
            code,
            data: ResponseData::Status {
                task_id: task_id.to_string(),
            },
            message,
        })
        .await;
    }
}
