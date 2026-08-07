# snapfile-go (原 Go snapfile 二进制)

这是从 SnapAny v0.8.1 中提取的原始 Go 编译的 snapfile 二进制文件。

## 基本信息

- **文件**: snapfile
- **语言**: Go (从 stderr 日志确认)
- **架构**: Mach-O 64-bit x86_64 (仅 Intel)
- **大小**: ~23MB
- **开发者路径**: `/Users/zhf/development/code/golang/snapfile/`
- **无源码**: 仅有编译后的二进制

## 启动参数

```bash
snapfile \
  --ffmpeg-path /path/to/ffmpeg \
  --ffprobe-path /path/to/ffprobe \
  --max-downloading-task 5 \
  --log-level debug
```

| 参数 | 说明 |
|---|---|
| `--ffmpeg-path` | ffmpeg 二进制路径 |
| `--ffprobe-path` | ffprobe 二进制路径 |
| `--max-downloading-task` | 最大并发下载数 (默认 5) |
| `--log-level` | 日志级别 (debug/info/warn/error) |

## 输入 (stdin)

JSON 行格式，每行一个 JSON 对象。

### start-task — 启动下载任务

```json
{
  "type": "start-task",
  "payload": {
    "taskID": "uuid",
    "name": "标题",
    "outputDir": "/output/path",
    "tempDir": "/temp/path/{taskID}",
    "outputType": "video|audio",
    "outputVideoFormat": "mp4|mkv",
    "outputAudioFormat": "mp3|m4a|ogg",
    "live": false,
    "embeddedSubtitle": true,
    "proxy": "system|direct|http://...",
    "files": [
      {
        "url": "https://...",
        "language": null,
        "header": {"Referer": "...", "Cookie": "..."}
      }
    ]
  }
}
```

### delete-task — 删除任务

```json
{"type": "delete-task", "payload": {"taskIDs": ["uuid1", "uuid2"]}}
```

### update-max-download-task — 更新并发数

```json
{"type": "update-max-download-task", "payload": {"limit": 8}}
```

### stop-recording-live — 停止直播录制

```json
{"type": "stop-recording-live", "payload": {"taskID": "uuid"}}
```

## 输出 (stdout)

JSON 行格式。

### 状态变更

```
task_started → task_start_prepare → task_prepared →
task_pending_download → task_start_download → [task_download_progress...] →
task_downloaded →
task_pending_conversion → task_start_conversion → [task_conversion_progress...] →
task_converted → task_start_move → task_moved → task_complete
```

### 进度

```json
{"code":"task_download_progress","data":{"taskID":"uuid","done":N,"total":N,"speed":N,"remainingTime":N},"message":"更新下载进度"}
{"code":"task_conversion_progress","data":{"taskID":"uuid","done":N,"total":N,"speed":N,"remainingTime":N},"message":"更新转换进度"}
```

### 完成

```json
{"code":"task_complete","data":{"taskID":"uuid","files":["/path/to/output.mp4"]},"message":"任务完成"}
```

### 错误

```json
{"code":"download_error","data":{"taskID":"uuid"},"message":"..."}
```

错误码: `unknown_event`, `task_already_started`, `unknown_error`, `prepare_error`,
`parse_m3u8_error`, `download_error`, `convert_error`, `move_error`,
`http_status_forbidden_error`, `disk_full`, `os_permission_denied`, `file_download_error`

## 输出 (stderr)

Go slog 结构化日志:

```
time=2026-08-07T16:42:57.669+08:00 level=DEBUG \
  source=.../snapfile/internal/stage/converter/converter.go:139 \
  msg=开始转换 cmd="ffmpeg ..." taskID=uuid
```

## 内部 ffmpeg 调用

### 视频合并

```bash
ffmpeg -i video.m4s -i audio.m4s \
       -progress pipe:1 \
       -map 0:v:0 -map 1:a:0 \
       -movflags +faststart \
       -c:v copy -c:a copy \
       -y output.mp4
```

### 音频转码 MP3

```bash
ffmpeg -i input.m4s \
       -progress pipe:1 \
       -map 0:a:0 \
       -c:a libmp3lame \
       output.mp3 -y
```

注意: 没有 `-b:a` 码率参数。

## 临时目录结构

```
{tempDir}/{taskID}/{taskID}/
├── download/      # 下载的原始文件
├── converting/    # 转码中的文件
└── converted/     # 转码完成的文件
```

## 推断的 Go 源码结构

```
snapfile/
├── internal/
│   ├── stage/
│   │   ├── runner.go              # 任务调度器
│   │   ├── downloader/download.go # HTTP 下载
│   │   ├── converter/converter.go # ffmpeg 转码/合并
│   │   └── move/move.go           # 文件移动
│   └── ...
├── pkg/
│   └── ffmpeg/ffprobe.go          # ffprobe 调用
├── cmd/
│   └── main.go                    # 入口
└── go.mod
```

## 替代目标

`snapany-rs` Rust 项目的目标是用 Rust 重新实现这个二进制，保持相同的 stdin/stdout 协议，
以便被现有 SnapAny Electron 应用直接使用。改进点包括 MP3 码率控制、解析并发限制等。
