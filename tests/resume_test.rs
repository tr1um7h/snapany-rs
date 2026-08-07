use snapfile_rs::resume::{meta_path, partial_path, resume_dir, ResumeMeta};
use std::path::PathBuf;

#[test]
fn test_resume_dir_path() {
    let output_dir = PathBuf::from("/home/user/Downloads");
    let url = "https://example.com/video.m4s";
    let dir = resume_dir(&output_dir, url);
    assert!(dir.starts_with("/home/user/Downloads/.SnapAny/.resume/"));
}

#[test]
fn test_partial_and_meta_paths() {
    let output_dir = PathBuf::from("/tmp/test");
    let url = "https://example.com/video.m4s";
    let dir = resume_dir(&output_dir, url);
    let pp = partial_path(&dir);
    let mp = meta_path(&dir);
    assert!(pp.to_string_lossy().ends_with(".partial"));
    assert!(mp.to_string_lossy().ends_with(".partial.meta"));
}

#[test]
fn test_same_url_same_hash() {
    let output_dir = PathBuf::from("/tmp/test");
    let url = "https://example.com/video.m4s";
    let dir1 = resume_dir(&output_dir, url);
    let dir2 = resume_dir(&output_dir, url);
    assert_eq!(dir1, dir2);
}

#[test]
fn test_different_url_different_hash() {
    let output_dir = PathBuf::from("/tmp/test");
    let dir1 = resume_dir(&output_dir, "https://example.com/a.m4s");
    let dir2 = resume_dir(&output_dir, "https://example.com/b.m4s");
    assert_ne!(dir1, dir2);
}

#[test]
fn test_meta_round_trip() {
    let tmp = tempfile::tempdir().unwrap();
    let meta = ResumeMeta {
        url: "https://example.com/test.m4s".to_string(),
        downloaded_bytes: 52428800,
        total_size: 104857600,
        etag: Some("\"abc123\"".to_string()),
        last_modified: Some("Wed, 08 Aug 2026 10:00:00 GMT".to_string()),
        completed_chunks: vec![],
    };
    let path = tmp.path().join("test.partial.meta");
    meta.save(&path).unwrap();
    let loaded = ResumeMeta::load(&path).unwrap();
    assert_eq!(loaded.url, meta.url);
    assert_eq!(loaded.downloaded_bytes, meta.downloaded_bytes);
    assert_eq!(loaded.total_size, meta.total_size);
    assert_eq!(loaded.etag, meta.etag);
    assert_eq!(loaded.last_modified, meta.last_modified);
}

#[test]
fn test_load_meta_missing_file() {
    let result = ResumeMeta::load(&PathBuf::from("/nonexistent/meta.json"));
    assert!(result.is_err());
}

#[test]
fn test_etag_match() {
    let meta = ResumeMeta {
        url: "x".to_string(),
        downloaded_bytes: 100,
        total_size: 200,
        etag: Some("\"abc\"".to_string()),
        last_modified: None,
        completed_chunks: vec![],
    };
    assert!(meta.matches_server(Some("\"abc\""), None));
    assert!(!meta.matches_server(Some("\"xyz\""), None));
}

#[test]
fn test_last_modified_match() {
    let meta = ResumeMeta {
        url: "x".to_string(),
        downloaded_bytes: 50,
        total_size: 200,
        etag: None,
        last_modified: Some("Wed, 08 Aug 2026 10:00:00 GMT".to_string()),
        completed_chunks: vec![],
    };
    assert!(meta.matches_server(None, Some("Wed, 08 Aug 2026 10:00:00 GMT")));
    assert!(!meta.matches_server(None, Some("Thu, 09 Aug 2026 10:00:00 GMT")));
}

#[test]
fn test_no_identifiers_no_match() {
    let meta = ResumeMeta {
        url: "x".to_string(),
        downloaded_bytes: 50,
        total_size: 200,
        etag: None,
        last_modified: None,
        completed_chunks: vec![],
    };
    // No identifiers to compare -> conservatively false
    assert!(!meta.matches_server(None, None));
}
