# snapany-rs

A Rust implementation of the snapfile download engine, serving as a drop-in replacement for the SnapAny Electron application.

## Features

- **Protocol Compatible**: Fully compatible with Go snapfile's stdin/stdout protocol, no Electron-side code changes required
- **High-Performance Downloads**: Async HTTP downloads based on tokio + reqwest with progress tracking
- **Media Processing**: Integrated ffmpeg/ffprobe for video/audio merging and transcoding
- **Concurrency Control**: Semaphore-based concurrent download limit management
- **Proxy Support**: System proxy, direct connection, HTTP/SOCKS5 proxy support
- **Native arm64**: Compiled for arm64 architecture, better performance than x86_64 Go version
- **Bilibili Fix**: Automatically adds User-Agent header to resolve 403 Forbidden errors

## Build

```bash
# Debug build
cargo build

# Release build
cargo build --release
```

The compiled binary will be at `target/release/snapfile`.

## Usage

### Command Line Arguments

```bash
snapfile \
  --ffmpeg-path /path/to/ffmpeg \
  --ffprobe-path /path/to/ffprobe \
  --max-downloading-task 5 \
  --log-level debug
```

| Argument | Description | Default |
|----------|-------------|---------|
| `--ffmpeg-path` | Path to ffmpeg binary | Required |
| `--ffprobe-path` | Path to ffprobe binary | Required |
| `--max-downloading-task` | Maximum concurrent downloads | 5 |
| `--log-level` | Log level (trace/debug/info/warn/error) | info |

### Protocol

snapfile receives JSON commands via stdin and returns JSON responses via stdout.

#### Start Task

```json
{
  "type": "start-task",
  "payload": {
    "taskID": "uuid",
    "name": "Video Title",
    "outputDir": "/output/path",
    "tempDir": "/temp/path",
    "outputType": "video|audio",
    "outputVideoFormat": "mp4|mkv",
    "outputAudioFormat": "mp3|m4a|ogg",
    "live": false,
    "embeddedSubtitle": false,
    "proxy": "system|direct|http://...",
    "files": [
      {
        "url": "https://cdn.example.com/video.m4s",
        "language": null,
        "header": {"Referer": "https://example.com"}
      }
    ]
  }
}
```

#### Response Examples

```json
{"code": "task_started", "data": {"taskID": "uuid"}, "message": "Task started"}
{"code": "task_download_progress", "data": {"taskID": "uuid", "done": 1000, "total": 5000, "speed": 500, "remainingTime": 8}, "message": "Download progress update"}
{"code": "task_complete", "data": {"taskID": "uuid", "files": ["/output/video.mp4"]}, "message": "Task complete"}
```

Full protocol specification is available in `docs/082_spec.md`.

## Testing

```bash
# Run all tests
cargo test

# Run specific test
cargo test downloader::tests::test_user_agent_detection
```

Current test coverage:
- 7 protocol compatibility tests
- 4 integration tests (process startup, command handling, error handling)
- 2 User-Agent detection tests

## Deployment to SnapAny

```bash
# 1. Build release version
cargo build --release

# 2. Copy to dist directory
cp target/release/snapfile dist/snapfile

# 3. Run replacement script
cd dist && ./package.sh
```

The script will automatically:
- Stop SnapAny application
- Replace snapfile binary in `/Applications/SnapAny.app`
- Re-sign the application
- Verify signature

## Architecture

```
snapany-rs/
├── src/
│   ├── main.rs           # Entry point: CLI parsing + stdin loop
│   ├── cli.rs            # clap argument definitions
│   ├── protocol.rs       # Protocol type definitions
│   ├── output.rs         # stdout JSON output
│   ├── manager.rs        # Task manager
│   ├── task.rs           # Task state machine
│   ├── downloader.rs     # HTTP downloader
│   ├── converter.rs      # ffmpeg integration
│   ├── ffprobe.rs        # ffprobe wrapper
│   ├── mover.rs          # File mover
│   ├── paths.rs          # Path calculation
│   ├── proxy.rs          # Proxy configuration
│   ├── error.rs          # Error types
│   └── logging.rs        # Logging initialization
├── tests/
│   ├── protocol_test.rs  # Protocol tests
│   └── integration_test.rs # Integration tests
├── docs/
│   ├── 082_spec.md       # Design specification
│   └── superpowers/      # Implementation plan
└── dist/
    └── package.sh        # Deployment script
```

## Improvements over Go Version

- **MP3 Bitrate Control**: Supports `-b:a` parameter (via `audioBitrate` field)
- **Native arm64**: Compiled for arm64 architecture, no Rosetta translation needed
- **Better Error Handling**: Detailed logging and error messages
- **User-Agent Fix**: Automatically adds browser User-Agent to resolve CDN 403 errors

## License

MIT
