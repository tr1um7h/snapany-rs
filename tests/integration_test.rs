use std::io::{BufRead, Write};
use std::path::PathBuf;
use std::process::{Command, Stdio};

fn snapfile_binary() -> PathBuf {
    let mut path = std::env::current_exe().unwrap();
    path.pop();
    path.pop();
    path.join("snapfile")
}

/// Test that the binary starts, accepts stdin, and exits on EOF
#[test]
fn test_binary_starts_and_exits() {
    let binary = snapfile_binary();
    assert!(binary.exists(), "snapfile binary not found at {:?}", binary);

    let mut child = Command::new(&binary)
        .args([
            "--ffmpeg-path",
            "/usr/bin/true",
            "--ffprobe-path",
            "/usr/bin/true",
            "--max-downloading-task",
            "1",
            "--log-level",
            "error",
        ])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .expect("failed to start snapfile");

    // Close stdin to signal EOF
    drop(child.stdin.take());

    // Wait for exit
    let status = child.wait().expect("failed to wait");
    assert!(status.success(), "binary should exit cleanly");
}

/// Test delete-task command for non-existent task (no output expected)
#[test]
fn test_delete_nonexistent_task() {
    let binary = snapfile_binary();
    let mut child = Command::new(&binary)
        .args([
            "--ffmpeg-path",
            "/usr/bin/true",
            "--ffprobe-path",
            "/usr/bin/true",
            "--max-downloading-task",
            "1",
            "--log-level",
            "error",
        ])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .expect("failed to start snapfile");

    let stdin = child.stdin.as_mut().unwrap();
    writeln!(
        stdin,
        r#"{{"type":"delete-task","payload":{{"taskIDs":["nonexistent"]}}}}"#
    )
    .unwrap();
    drop(child.stdin.take());

    let stdout = child.stdout.take().unwrap();
    let reader = std::io::BufReader::new(stdout);
    let lines: Vec<String> = reader.lines().map(|l| l.unwrap()).collect();

    let status = child.wait().expect("failed to wait");

    // Deleting non-existent task produces no output (matches Go snapfile behavior)
    assert!(
        lines.is_empty(),
        "should not produce output for non-existent task"
    );
    assert!(status.success(), "binary should exit cleanly");
}

/// Test invalid JSON is handled gracefully
#[test]
fn test_invalid_json_handling() {
    let binary = snapfile_binary();
    let mut child = Command::new(&binary)
        .args([
            "--ffmpeg-path",
            "/usr/bin/true",
            "--ffprobe-path",
            "/usr/bin/true",
            "--max-downloading-task",
            "1",
            "--log-level",
            "error",
        ])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .expect("failed to start snapfile");

    let stdin = child.stdin.as_mut().unwrap();
    writeln!(stdin, "this is not json").unwrap();
    writeln!(
        stdin,
        r#"{{"type":"delete-task","payload":{{"taskIDs":["test"]}}}}"#
    )
    .unwrap();
    drop(child.stdin.take());

    let stdout = child.stdout.take().unwrap();
    let reader = std::io::BufReader::new(stdout);
    let lines: Vec<String> = reader.lines().map(|l| l.unwrap()).collect();

    let status = child.wait().expect("failed to wait");

    // Should exit cleanly after invalid input
    assert!(status.success(), "binary should exit cleanly");
    // Invalid JSON is logged but doesn't produce stdout output
    assert!(lines.is_empty(), "invalid JSON should not produce output");
}

/// Test update-max-download-task command
#[test]
fn test_update_max_download_task() {
    let binary = snapfile_binary();
    let mut child = Command::new(&binary)
        .args([
            "--ffmpeg-path",
            "/usr/bin/true",
            "--ffprobe-path",
            "/usr/bin/true",
            "--max-downloading-task",
            "1",
            "--log-level",
            "error",
        ])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .expect("failed to start snapfile");

    let stdin = child.stdin.as_mut().unwrap();
    writeln!(
        stdin,
        r#"{{"type":"update-max-download-task","payload":{{"limit":8}}}}"#
    )
    .unwrap();
    drop(child.stdin.take());

    let stdout = child.stdout.take().unwrap();
    let reader = std::io::BufReader::new(stdout);
    let lines: Vec<String> = reader.lines().map(|l| l.unwrap()).collect();

    let status = child.wait().expect("failed to wait");

    // update-max-download-task is accepted but produces no output (matches Go snapfile)
    assert!(lines.is_empty(), "should not produce output");
    assert!(status.success(), "binary should exit cleanly");
}
