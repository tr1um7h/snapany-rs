use serde::{Deserialize, Serialize};
use std::collections::HashMap;

// ==================== Request types ====================

#[derive(Debug, Deserialize)]
#[serde(tag = "type", content = "payload")]
pub enum Request {
    #[serde(rename = "start-task")]
    StartTask(StartTaskPayload),
    #[serde(rename = "delete-task")]
    DeleteTask(DeleteTaskPayload),
    #[serde(rename = "update-max-download-task")]
    UpdateMaxDownloadTask(UpdateMaxDownloadTaskPayload),
    #[serde(rename = "stop-recording-live")]
    StopRecordingLive(StopRecordingLivePayload),
}

#[derive(Debug, Deserialize, Clone)]
pub struct StartTaskPayload {
    #[serde(rename = "taskID")]
    pub task_id: String,
    pub name: String,
    #[serde(rename = "outputDir")]
    pub output_dir: String,
    #[serde(rename = "tempDir")]
    pub temp_dir: String,
    #[serde(rename = "outputType")]
    pub output_type: String,
    #[serde(rename = "outputVideoFormat")]
    pub output_video_format: Option<String>,
    #[serde(rename = "outputAudioFormat")]
    pub output_audio_format: Option<String>,
    #[serde(rename = "audioBitrate")]
    pub audio_bitrate: Option<u32>,
    pub live: bool,
    #[serde(rename = "embeddedSubtitle")]
    pub embedded_subtitle: bool,
    pub proxy: String,
    pub files: Vec<FileSpec>,
}

#[derive(Debug, Deserialize, Clone)]
pub struct FileSpec {
    pub url: String,
    pub language: Option<String>,
    pub header: Option<HashMap<String, String>>,
    #[serde(rename = "optionalDownload")]
    pub optional_download: Option<bool>,
}

#[derive(Debug, Deserialize)]
pub struct DeleteTaskPayload {
    #[serde(rename = "taskIDs")]
    pub task_ids: Vec<String>,
}

#[derive(Debug, Deserialize)]
pub struct UpdateMaxDownloadTaskPayload {
    pub limit: usize,
}

#[derive(Debug, Deserialize)]
pub struct StopRecordingLivePayload {
    #[serde(rename = "taskID")]
    pub task_id: String,
}

// ==================== Response types ====================

#[derive(Debug, Serialize)]
pub struct Response {
    pub code: &'static str,
    pub data: ResponseData,
    pub message: String,
}

#[derive(Debug, Serialize)]
#[serde(untagged)]
pub enum ResponseData {
    Status {
        #[serde(rename = "taskID")]
        task_id: String,
    },
    Progress {
        #[serde(rename = "taskID")]
        task_id: String,
        done: u64,
        total: u64,
        speed: u64,
        #[serde(rename = "remainingTime")]
        remaining_time: u64,
    },
    Complete {
        #[serde(rename = "taskID")]
        task_id: String,
        files: Vec<String>,
    },
    FileError {
        #[serde(rename = "taskID")]
        task_id: String,
        url: String,
    },
    Error {
        #[serde(rename = "taskID")]
        task_id: String,
    },
}

// ==================== Status code constants ====================

pub mod codes {
    pub const UNKNOWN_EVENT:            &str = "unknown_event";
    pub const TASK_ALREADY_STARTED:      &str = "task_already_started";
    pub const TASK_STARTED:              &str = "task_started";
    pub const TASK_START_PREPARE:        &str = "task_start_prepare";
    pub const TASK_PREPARED:             &str = "task_prepared";
    pub const TASK_PENDING_DOWNLOAD:     &str = "task_pending_download";
    pub const TASK_START_DOWNLOAD:       &str = "task_start_download";
    pub const TASK_DOWNLOADED:           &str = "task_downloaded";
    pub const TASK_PENDING_CONVERSION:   &str = "task_pending_conversion";
    pub const TASK_START_CONVERSION:     &str = "task_start_conversion";
    pub const TASK_CONVERTED:            &str = "task_converted";
    pub const TASK_START_MOVE:           &str = "task_start_move";
    pub const TASK_MOVED:                &str = "task_moved";
    pub const TASK_COMPLETE:             &str = "task_complete";
    pub const TASK_DELETED:              &str = "task_deleted";

    pub const TASK_DOWNLOAD_PROGRESS:    &str = "task_download_progress";
    pub const TASK_CONVERSION_PROGRESS:  &str = "task_conversion_progress";

    pub const FILE_DOWNLOAD_ERROR:       &str = "file_download_error";
    pub const DOWNLOAD_ERROR:            &str = "download_error";
    pub const CONVERT_ERROR:             &str = "convert_error";
    pub const MOVE_ERROR:                &str = "move_error";
    pub const PREPARE_ERROR:             &str = "prepare_error";
    pub const HTTP_STATUS_FORBIDDEN:     &str = "http_status_forbidden_error";
    pub const DISK_FULL:                 &str = "disk_full";
    pub const OS_PERMISSION_DENIED:      &str = "os_permission_denied";
    pub const UNKNOWN_ERROR:             &str = "unknown_error";
}

// ==================== Message constants ====================

pub mod messages {
    pub const TASK_STARTED:              &str = "任务已启动";
    pub const TASK_START_PREPARE:        &str = "任务开始预处理";
    pub const TASK_PREPARED:             &str = "任务预处理完成";
    pub const TASK_PENDING_DOWNLOAD:     &str = "等待下载";
    pub const TASK_START_DOWNLOAD:       &str = "任务开始下载";
    pub const TASK_DOWNLOADED:           &str = "任务下载完成";
    pub const TASK_PENDING_CONVERSION:   &str = "任务等待转换";
    pub const TASK_START_CONVERSION:     &str = "任务开始转换";
    pub const TASK_CONVERTED:            &str = "转换完成";
    pub const TASK_START_MOVE:           &str = "任务开始移动";
    pub const TASK_MOVED:                &str = "任务移动完成";
    pub const TASK_COMPLETE:             &str = "任务完成";
    pub const TASK_DELETED:              &str = "任务已删除";
    pub const DOWNLOAD_PROGRESS:         &str = "更新下载进度";
    pub const CONVERSION_PROGRESS:       &str = "更新转换进度";
    pub const FILE_DOWNLOAD_ERROR:       &str = "文件下载错误";
}
