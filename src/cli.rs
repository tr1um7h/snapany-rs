use clap::Parser;
use std::path::PathBuf;

#[derive(Parser, Debug)]
#[command(name = "snapfile", about = "SnapAny download engine")]
pub struct Args {
    #[arg(long = "ffmpeg-path", required = true)]
    pub ffmpeg_path: PathBuf,

    #[arg(long = "ffprobe-path", required = true)]
    pub ffprobe_path: PathBuf,

    #[arg(long = "max-downloading-task", default_value_t = 5)]
    pub max_downloading_task: usize,

    #[arg(long = "log-level", default_value = "info")]
    pub log_level: String,

    #[arg(long = "resume-max-age-days", default_value_t = 7)]
    pub resume_max_age_days: u64,
}
