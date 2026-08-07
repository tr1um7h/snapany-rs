use md5::{Md5, Digest};
use std::path::{Path, PathBuf};

/// 计算 URL 的 MD5 十六进制表示, 用于临时文件命名
pub fn md5_hex(input: &str) -> String {
    let mut hasher = Md5::new();
    hasher.update(input.as_bytes());
    let result = hasher.finalize();
    result.iter().map(|b| format!("{:02x}", b)).collect()
}

/// 下载文件名: 第一个文件加 _first 后缀
pub fn download_filename(url: &str, index: usize) -> String {
    let hash = md5_hex(url);
    if index == 0 {
        format!("{}_first.m4s", hash)
    } else {
        format!("{}.m4s", hash)
    }
}

/// 下载目录: {temp_dir}/{task_id}/{task_id}/download/
pub fn download_dir(temp_dir: &Path, task_id: &str) -> PathBuf {
    temp_dir.join(task_id).join(task_id).join("download")
}

/// 转码目录: {temp_dir}/{task_id}/{task_id}/converting/
pub fn converting_dir(temp_dir: &Path, task_id: &str) -> PathBuf {
    temp_dir.join(task_id).join(task_id).join("converting")
}

/// 转码完成目录: {temp_dir}/{task_id}/{task_id}/converted/
pub fn converted_dir(temp_dir: &Path, task_id: &str) -> PathBuf {
    temp_dir.join(task_id).join(task_id).join("converted")
}

/// 临时目录根: {temp_dir}/{task_id}
pub fn temp_root(temp_dir: &Path, task_id: &str) -> PathBuf {
    temp_dir.join(task_id)
}

/// 转码中的文件名: {md5(name)}.{ext}
pub fn converting_filename(name: &str, ext: &str) -> String {
    format!("{}.{}", md5_hex(name), ext)
}

/// 最终输出文件路径
pub fn output_path(output_dir: &Path, name: &str, ext: &str) -> PathBuf {
    let safe_name = sanitize_filename(name);
    output_dir.join(format!("{}.{}", safe_name, ext))
}

/// 过滤文件名中的非法字符
pub fn sanitize_filename(name: &str) -> String {
    name.chars()
        .map(|c| match c {
            '/' | ':' | '\0' | '\n' | '\r' => '_',
            _ => c,
        })
        .collect::<String>()
        .trim()
        .to_string()
}

/// 检查输出扩展名
pub fn output_extension<'a>(output_type: &'a str, video_format: Option<&'a str>, audio_format: Option<&'a str>) -> &'a str {
    match output_type {
        "video" => video_format.unwrap_or("mp4"),
        "audio" => audio_format.unwrap_or("mp3"),
        _ => "mp4",
    }
}

/// 判断是否需要转码
pub fn needs_conversion(output_type: &str, audio_format: Option<&str>, file_count: usize) -> bool {
    match output_type {
        "audio" => match audio_format {
            Some("m4a") => false,
            Some("mp3") | Some("ogg") => true,
            _ => false,
        },
        "video" => file_count > 1,
        _ => false,
    }
}
