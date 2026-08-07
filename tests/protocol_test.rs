use snapfile_rs::protocol::*;

#[test]
fn test_deserialize_start_task_camel_case() {
    let json = r#"{
        "type": "start-task",
        "payload": {
            "taskID": "test-uuid",
            "name": "测试视频",
            "outputDir": "/tmp/output",
            "tempDir": "/tmp/temp",
            "outputType": "audio",
            "outputAudioFormat": "m4a",
            "live": false,
            "embeddedSubtitle": false,
            "proxy": "direct",
            "files": [
                {"url": "https://example.com/audio.m4s", "language": null, "header": {"Referer": "https://example.com"}}
            ]
        }
    }"#;

    let req: Request = serde_json::from_str(json).unwrap();
    match req {
        Request::StartTask(payload) => {
            assert_eq!(payload.task_id, "test-uuid");
            assert_eq!(payload.name, "测试视频");
            assert_eq!(payload.output_dir, "/tmp/output");
            assert_eq!(payload.output_type, "audio");
            assert_eq!(payload.output_audio_format.as_deref(), Some("m4a"));
            assert_eq!(payload.files.len(), 1);
            assert_eq!(payload.files[0].url, "https://example.com/audio.m4s");
            assert!(payload.files[0].language.is_none());
            assert!(payload.files[0].header.is_some());
        }
        _ => panic!("expected StartTask"),
    }
}

#[test]
fn test_deserialize_start_task_missing_optional_fields() {
    let json = r#"{
        "type": "start-task",
        "payload": {
            "taskID": "test",
            "name": "test",
            "outputDir": "/tmp",
            "tempDir": "/tmp",
            "outputType": "video",
            "live": false,
            "embeddedSubtitle": false,
            "proxy": "direct",
            "files": [{"url": "https://example.com"}]
        }
    }"#;

    let req: Request = serde_json::from_str(json).unwrap();
    match req {
        Request::StartTask(payload) => {
            assert!(payload.output_video_format.is_none());
            assert!(payload.output_audio_format.is_none());
            assert!(payload.audio_bitrate.is_none());
            assert!(payload.files[0].language.is_none());
            assert!(payload.files[0].header.is_none());
            assert!(payload.files[0].optional_download.is_none());
        }
        _ => panic!("expected StartTask"),
    }
}

#[test]
fn test_deserialize_delete_task() {
    let json = r#"{"type":"delete-task","payload":{"taskIDs":["a","b"]}}"#;
    let req: Request = serde_json::from_str(json).unwrap();
    match req {
        Request::DeleteTask(payload) => {
            assert_eq!(payload.task_ids, vec!["a", "b"]);
        }
        _ => panic!("expected DeleteTask"),
    }
}

#[test]
fn test_deserialize_update_max_download_task() {
    let json = r#"{"type":"update-max-download-task","payload":{"limit":8}}"#;
    let req: Request = serde_json::from_str(json).unwrap();
    match req {
        Request::UpdateMaxDownloadTask(payload) => {
            assert_eq!(payload.limit, 8);
        }
        _ => panic!("expected UpdateMaxDownloadTask"),
    }
}

#[test]
fn test_deserialize_unknown_type_returns_error() {
    let json = r#"{"type":"unknown-command","payload":{}}"#;
    let result: Result<Request, _> = serde_json::from_str(json);
    assert!(result.is_err());
}

#[test]
fn test_serialize_response_status() {
    let response = Response {
        code: codes::TASK_STARTED,
        data: ResponseData::Status { task_id: "test-uuid".to_string() },
        message: messages::TASK_STARTED.to_string(),
    };

    let json = serde_json::to_string(&response).unwrap();
    assert!(json.contains("\"taskID\":\"test-uuid\""));
    assert!(json.contains("\"code\":\"task_started\""));
    assert!(json.contains("任务已启动"));
}

#[test]
fn test_serialize_response_progress() {
    let response = Response {
        code: codes::TASK_DOWNLOAD_PROGRESS,
        data: ResponseData::Progress {
            task_id: "test".to_string(),
            done: 100,
            total: 1000,
            speed: 50,
            remaining_time: 18,
        },
        message: messages::DOWNLOAD_PROGRESS.to_string(),
    };

    let json = serde_json::to_string(&response).unwrap();
    assert!(json.contains("\"taskID\":\"test\""));
    assert!(json.contains("\"done\":100"));
    assert!(json.contains("\"total\":1000"));
    assert!(json.contains("\"remainingTime\":18"));
}
