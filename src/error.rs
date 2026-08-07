use crate::protocol::codes;

#[derive(Debug)]
pub enum TaskError {
    Cancelled,
    Failed { code: &'static str, message: String },
}

impl TaskError {
    pub fn failed(code: &'static str, msg: impl Into<String>) -> Self {
        Self::Failed {
            code,
            message: msg.into(),
        }
    }
}

#[derive(Debug, thiserror::Error)]
pub enum SnapfileError {
    #[error("HTTP 403 Forbidden")]
    HttpStatusForbidden,
    #[error("下载失败: {0}")]
    DownloadFailed(String),
    #[error("转换失败: {0}")]
    ConvertFailed(String),
    #[error("文件移动失败: {0}")]
    MoveFailed(String),
    #[error("IO 错误: {0}")]
    Io(#[from] std::io::Error),
    #[error("任务已取消")]
    Cancelled,
    #[error("Reqwest: {0}")]
    Reqwest(#[from] reqwest::Error),
}

impl SnapfileError {
    pub fn to_status_code(&self) -> &'static str {
        match self {
            Self::HttpStatusForbidden => codes::HTTP_STATUS_FORBIDDEN,
            Self::DownloadFailed(_) => codes::DOWNLOAD_ERROR,
            Self::ConvertFailed(_) => codes::CONVERT_ERROR,
            Self::MoveFailed(_) => codes::MOVE_ERROR,
            Self::Io(e) => {
                let msg = e.to_string();
                if msg.contains("No space left") {
                    codes::DISK_FULL
                } else if msg.contains("Permission denied") {
                    codes::OS_PERMISSION_DENIED
                } else {
                    codes::DOWNLOAD_ERROR
                }
            }
            Self::Cancelled => codes::DOWNLOAD_ERROR,
            Self::Reqwest(_) => codes::DOWNLOAD_ERROR,
        }
    }

    pub fn to_message(&self) -> String {
        self.to_string()
    }
}
