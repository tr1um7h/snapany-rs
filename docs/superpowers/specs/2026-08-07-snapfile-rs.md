# snapany-rs: snapfile-rs 替代实现设计文档

> 本文档定义方案和架构。代码实现细节见 `docs/superpowers/plans/2026-08-07-snapfile-rs.md`。

## 0. 目标

用 Rust 重写 Go snapfile 二进制，作为 drop-in 替换。现有 SnapAny Electron 应用通过 stdin/stdout 与之通信，Rust 实现必须做到协议级兼容：Electron 端 JS 代码零改动即可切换。

**兼容性红线**: 所有 stdin 命令和 stdout 响应的 JSON 字段名、值类型、消息时序必须与 Go snapfile 完全一致。字段名使用 camelCase (如 `taskID`、`remainingTime`)。

**改进项** (不破坏兼容性):
- MP3 转码支持码率参数 (`-b:a {bitrate}k`)
- native arm64 二进制 (Go 版仅 x86_64)
- 分片下载 + 断点续传 (Phase 2)

---

## 1. 总体架构

### 1.1 运行时模型

snapfile-rs 是一个 **长驻进程**，通过 stdin/stdout 与父进程 (Electron) 通信。

```
┌─────────────────────────────────────────────┐
│               main()                        │
│                                             │
│  ┌──────────┐     mpsc      ┌────────────┐ │
│  │ stdin    │──channel──▶   │ command    │ │
│  │ reader   │               │ dispatcher │ │
│  │ (tokio   │               │ (主循环)    │ │
│  │  task)   │               └─────┬──────┘ │
│  └──────────┘                     │        │
│                          ┌────────┼────────┐│
│                          ▼        ▼        ▼│
│                    ┌─────────┐ ┌─────────┐ ││
│                    │ Task A  │ │ Task B  │ ││
│                    │ (tokio  │ │ (tokio  │ ││
│                    │  task)  │ │  task)  │ ││
│                    └────┬────┘ └────┬────┘ ││
│                         │           │      │
│                    ┌────┴───────────┴────┐ ││
│                    │  Semaphore          │ ││
│                    │  (并发下载控制)      │ ││
│                    └─────────────────────┘ ││
│                                             │
│           ┌─────────────────────┐          │
│           │  OutputWriter       │          │
│           │  (Arc<Mutex<        │          │
│           │   BufWriter<Stdout>>)│          │
│           └─────────────────────┘          │
└─────────────────────────────────────────────┘
```

### 1.2 模块划分

```
src/
├── main.rs           # 入口: CLI 解析, tokio runtime, 信号处理
├── cli.rs            # clap 结构体定义
├── protocol.rs       # 全部 serde 类型 (Request/Response 枚举) + 状态码/消息常量
├── output.rs         # OutputWriter: 线程安全 stdout JSON 行写入
├── manager.rs        # TaskManager: 任务注册表, 并发调度, 取消, panic 隔离
├── task.rs           # Task: 状态机 + 生命周期编排 + CleanupGuard
├── downloader.rs     # HttpDownloader: 流式下载, 进度, 重试
├── ffprobe.rs        # FfprobeRunner: 调用 ffprobe 获取流信息
├── converter.rs      # Converter: ffmpeg 合并/转码 + 进度解析
├── mover.rs          # 文件移动 + 临时目录清理
├── proxy.rs          # ProxyConfig: 系统代理 / 直连 / 自定义
├── paths.rs          # 路径计算: 哈希命名, 目录结构, 冲突处理
├── error.rs          # SnapfileError + 到状态码的映射
└── log.rs            # stderr 结构化日志 (tracing)
```

### 1.3 异步模型

- **runtime**: `#[tokio::main]` multi-thread, 工作线程数 = CPU 核心数
- **stdin 读取**: 独立 tokio task, 按行读取, 通过 mpsc channel 发送 `Request`
- **任务执行**: 每个 start-task 对应一个独立 tokio task
- **取消**: 每个 task 持有 `CancellationToken`, delete-task 时触发
- **输出**: `Arc<Mutex<BufWriter<Stdout>>>`, 异步发送 JSON 行

### 1.4 依赖清单

```toml
[dependencies]
tokio = { version = "1", features = ["full"] }
tokio-util = "0.7"                      # CancellationToken
reqwest = { version = "0.12", features = ["stream", "socks"] }
serde = { version = "1", features = ["derive"] }
serde_json = "1"
clap = { version = "4", features = ["derive"] }
anyhow = "1"
thiserror = "1"
uuid = { version = "1", features = ["v4"] }
md-5 = "0.10"
tracing = "0.1"
tracing-subscriber = { version = "0.3", features = ["fmt", "env-filter"] }
futures-util = "0.3"
```

不使用 ffmpeg-sidecar, 直接用 `tokio::process::Command` 调用 ffmpeg/ffprobe。原因: SnapAny 已打包 ffmpeg/ffprobe 且路径固定, 不需要 sidecar 的自动下载功能; 同时需要对命令行参数 (`-map`、`-progress pipe:1`、`-b:a`) 和子进程生命周期 (kill on cancel) 有完全控制。

---

## 2. 输入输出要求 (I/O Contract)

snapfile-rs 是一个长驻进程，与父进程 (Electron) 通过三个通道通信：

| 通道 | 方向 | 格式 | 说明 |
|---|---|---|---|
| **stdin** | 父进程 → snapfile-rs | JSON 行 (每行一个 JSON) | 任务命令 |
| **stdout** | snapfile-rs → 父进程 | JSON 行 (每行一个 JSON) | 状态/进度/结果 |
| **stderr** | snapfile-rs → 终端/日志 | 文本 (tracing 格式) | 调试日志 |

### 2.1 启动参数 (CLI)

```
snapfile-rs \
  --ffmpeg-path <path>       # 必填
  --ffprobe-path <path>      # 必填
  --max-downloading-task <n> # 可选, 默认 5
  --log-level <level>        # 可选: debug|info|warn|error, 默认 info
```

### 2.2 输入命令 (stdin)

每行一个 JSON 对象，`type` 字段区分命令类型，`payload` 携带数据。

#### start-task

```json
{
  "type": "start-task",
  "payload": {
    "taskID": "uuid",
    "name": "视频标题",
    "outputDir": "/Users/steve/Downloads",
    "tempDir": "/Users/steve/Downloads/.snapany/{taskID}",
    "outputType": "video",
    "outputVideoFormat": "mp4",
    "outputAudioFormat": "mp3",
    "live": false,
    "embeddedSubtitle": true,
    "proxy": "system",
    "files": [
      {
        "url": "https://cdn.example.com/video.m4s?token=...",
        "language": null,
        "header": {"Referer": "https://www.bilibili.com/..."},
        "optionalDownload": false
      }
    ]
  }
}
```

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `taskID` | string | 是 | 任务唯一标识 (UUID) |
| `name` | string | 是 | 视频标题, 用于最终文件命名 |
| `outputDir` | string | 是 | 最终输出目录 |
| `tempDir` | string | 是 | 临时文件根目录 |
| `outputType` | string | 是 | `"video"` 或 `"audio"` |
| `outputVideoFormat` | string | 否 | `"mp4"` / `"mkv"` |
| `outputAudioFormat` | string | 否 | `"mp3"` / `"m4a"` / `"ogg"` |
| `live` | bool | 是 | 是否为直播 (当前版本未使用) |
| `embeddedSubtitle` | bool | 是 | 是否嵌入字幕 (当前版本未使用) |
| `proxy` | string | 是 | `"system"` / `"direct"` / `"http://..."` / `"socks5://..."` |
| `files[].url` | string | 是 | 文件下载 URL |
| `files[].language` | string/null | 否 | 语言标签 |
| `files[].header` | object | 否 | HTTP 请求头 |
| `files[].optionalDownload` | bool | 否 | 失败不终止任务, 默认 false |

#### delete-task

```json
{"type": "delete-task", "payload": {"taskIDs": ["uuid1", "uuid2"]}}
```

期望: 取消任务 → 清理临时目录 → 回复 `task_deleted`。即使 taskID 不存在也必须回复。

#### update-max-download-task

```json
{"type": "update-max-download-task", "payload": {"limit": 8}}
```

#### stop-recording-live

```json
{"type": "stop-recording-live", "payload": {"taskID": "uuid"}}
```

### 2.3 输出消息 (stdout)

每行一个 JSON, 固定三字段: `code` + `data` + `message`。

#### 状态变更消息

```json
{"code":"task_started","data":{"taskID":"uuid"},"message":"任务已启动"}
```

必须按以下顺序输出:

| 顺序 | code | message | 条件 |
|---|---|---|---|
| 1 | `task_started` | 任务已启动 | 总是 |
| 2 | `task_start_prepare` | 任务开始预处理 | 总是 |
| 3 | `task_prepared` | 任务预处理完成 | 目录创建成功后 |
| 4 | `task_pending_download` | 等待下载 | 获取并发许可前 |
| 5 | `task_start_download` | 任务开始下载 | 获取许可后 |
| | *(多条 task_download_progress)* | | 下载过程中, 每秒 |
| 6 | `task_downloaded` | 任务下载完成 | 所有必需文件下载完 |
| 7 | `task_pending_conversion` | 任务等待转换 | 仅当需要转码/合并 |
| 8 | `task_start_conversion` | 任务开始转换 | 仅当需要转码/合并 |
| | *(多条 task_conversion_progress)* | | 转码过程中, 每秒 |
| 9 | `task_converted` | 任务转换完成 | 仅当需要转码/合并 |
| 10 | `task_start_move` | 任务开始移动 | 总是 |
| 11 | `task_moved` | 任务移动完成 | 总是 |
| 12 | `task_complete` | 任务完成 | 总是 |

不需要转码的路径跳过顺序 7-9。例如 audio+m4a 从 `task_downloaded` 直接到 `task_start_move`。

`task_deleted` (取消时): `{"code":"task_deleted","data":{"taskID":"uuid"},"message":"任务已删除"}`

#### 进度消息

```json
{
  "code": "task_download_progress",
  "data": {"taskID":"uuid","done":4666945,"total":47592128,"speed":4666945,"remainingTime":9},
  "message": "更新下载进度"
}
```

| 字段 | 类型 | 说明 |
|---|---|---|
| `done` | u64 | 已处理字节数 |
| `total` | u64 | 总字节数 |
| `speed` | u64 | 当前速度 (bytes/sec) |
| `remainingTime` | u64 | 预计剩余秒数 |

转换进度 (`task_conversion_progress`) 格式相同。`done`/`total` 来自 ffmpeg `-progress pipe:1` 的 `total_size`。

#### 任务完成消息

```json
{
  "code": "task_complete",
  "data": {"taskID":"uuid","files":["/path/to/output.mp4"]},
  "message": "任务完成"
}
```

#### 错误消息

单文件下载错误 (不终止任务):
```json
{"code":"file_download_error","data":{"taskID":"uuid","url":"https://..."},"message":"文件下载错误"}
```

致命错误 (终止任务):
```json
{"code":"<错误码>","data":{"taskID":"uuid"},"message":"..."}
```

| 错误码 | 触发条件 |
|---|---|
| `download_error` | 必需文件下载失败 |
| `convert_error` | ffmpeg 转码/合并失败 |
| `move_error` | 文件移动失败 |
| `http_status_forbidden_error` | HTTP 403 |
| `disk_full` | 磁盘空间不足 |
| `os_permission_denied` | 文件权限不足 |
| `prepare_error` | 预处理阶段错误 |
| `parse_m3u8_error` | M3U8 解析错误 (预留) |
| `unknown_error` | 未分类错误 |

### 2.4 临时目录结构

```
{tempDir}/{taskID}/
└── {taskID}/
    ├── download/
    │   ├── {md5(url1)}_first.m4s     # 第一个文件 (_first 后缀)
    │   └── {md5(url2)}.m4s           # 第二个及之后
    ├── converting/
    │   └── {md5(name)}.{ext}
    └── converted/
        └── {md5(name)}.{ext}
```

**最终输出**: `{outputDir}/{name}.{ext}` (name 需过滤 `/`、`:`、`\0` 等非法字符, 冲突时追加 `(1)`、`(2)`...)

**清理**: 任务完成或失败后删除 `{tempDir}/{taskID}` 整个目录。

---

## 3. 任务状态机

### 3.1 状态定义

```
Created → Started → Preparing → Prepared → PendingDownload → Downloading
→ Downloaded → [PendingConversion → Converting → Converted] → Moving → Moved → Completed
                                                                          ↓
任意阶段 ── error ──▶ Failed                                  (Cancelled 并列)
```

### 3.2 转换决策

- `outputType=audio, format=m4a` → 跳过 conversion 阶段, downloaded 后直接 move
- `outputType=audio, format=mp3/ogg` → 需要 ffmpeg 转码
- `outputType=video, files>1` → 需要 ffmpeg 合并
- `outputType=video, files=1` → 直接 move (假设)

### 3.3 输出扩展名

- video: `outputVideoFormat` (默认 mp4)
- audio: `outputAudioFormat` (默认 mp3)

---

## 4. 错误处理

### 4.1 任务级错误时序

```
场景 A: 可选文件下载失败
  → emit file_download_error { taskID, url }
  → 继续下载其他文件, 任务正常完成

场景 B: 必需文件下载失败
  → emit file_download_error { taskID, url }
  → 全部文件尝试完后检查
  → 有必需文件失败: emit download_error { taskID } → cleanup

场景 C: 转码失败 → emit convert_error → cleanup

场景 D: HTTP 403 → emit http_status_forbidden_error → cleanup

场景 E: 磁盘空间不足 → emit disk_full → cleanup

场景 F: 任务取消 (delete-task)
  → 中断下载/转码进程 → cleanup → emit task_deleted { taskID }
```

### 4.2 进程级错误隔离

snapfile-rs 是长驻进程, 单个任务出错绝不拖垮整个进程。JS 层在进程退出时会重启 (最多 3 次 + 2 秒间隔), 但重启意味着所有在途任务丢失。

**设计原则**:

- **任务隔离**: 每个 task 在独立 tokio task 里运行, 用 `catch_unwind` 包裹。panic 被捕获后记录日志 + emit 错误码, 进程不退出。
- **CleanupGuard**: `run_task` 入口创建 RAII guard, 无论函数以何种方式退出 (正常/Err/panic) 都清理临时目录。
- **stdin 容错**: 逐行读取, JSON 解析失败记录 ERROR 日志后 continue, 不退出循环。
- **stdout 写入失败**: 管道断裂时返回 false, 调用方可触发退出。
- **未知命令**: serde tag 自动拒绝, 被 stdin 容错捕获, 记录日志后跳过。

### 4.3 进程崩溃恢复

**重启由 JS 层负责** (已存在于 main.js, 无需修改):

```
进程退出 (非主动关闭)
  → 移动活跃任务到 pending 队列
  → 等待 2 秒 → 重新 spawn (restartAttempts++)
  → 重启成功 → 重发 pending 任务, 重置计数
  → 重启失败 → 如果 < 3 次, 继续重试; 否则 emit "max-restart-reached"
  → 主动关闭 (closeWindow) → isShuttingDown=true, 不重启
```

snapfile-rs 不持久化任务状态, 重启后从空白开始。需要做的:
- 保证进程不因单个任务 panic 而退出
- 保证 stdin 解析错误不导致退出
- 收到 SIGTERM/SIGINT 时清理所有资源后退出

---

## 5. 调用时序

### 5.1 视频下载 (2 文件合并)

```
Electron JS                          snapfile-rs
     │── start-task ──────────────────────▶│
     │◀── task_started ────────────────────│  create Task, spawn tokio task
     │◀── task_start_prepare ──────────────│  mkdir download_dir
     │◀── task_prepared ───────────────────│
     │◀── task_pending_download ───────────│  acquire semaphore
     │◀── task_start_download ─────────────│
     │◀── task_download_progress ×N ───────│  每 1s
     │◀── task_downloaded ─────────────────│
     │                                     │  ffprobe ×2
     │◀── task_pending_conversion ─────────│
     │◀── task_start_conversion ───────────│  ffmpeg -map 0:v:0 -map 1:a:0 -c copy
     │◀── task_conversion_progress ×N ─────│
     │◀── task_converted ──────────────────│
     │◀── task_start_move ─────────────────│  rename → outputDir/title.mp4
     │◀── task_moved ──────────────────────│
     │◀── task_complete { files: [...] } ──│  cleanup temp
```

### 5.2 音频 M4A (不转码)

```
start-task → started → prepare → prepared → pending_download → start_download
→ [progress...] → downloaded → start_move → moved → task_complete
```

### 5.3 音频 MP3 (转码)

```
start-task → started → prepare → prepared → pending_download → start_download
→ [progress...] → downloaded → pending_conversion → start_conversion
→ [conversion_progress...] → converted → start_move → moved → task_complete
```

### 5.4 任务取消

```
delete-task → cancel_token.cancel() → kill ffmpeg (if running)
→ abort HTTP streams → cleanup temp → task_deleted
```

### 5.5 并发场景

```
start-task [A,B,C], semaphore max=2
A,B 获取 permit → start_download
C 等待 → pending_download
A 完成 → 释放 permit → C 获取 permit → start_download
```

---

## 6. 日志规范

### 6.1 日志级别

| 级别 | 用途 |
|---|---|
| `ERROR` | 任务失败、panic 捕获、stdout 写入失败、stdin 解析失败 |
| `WARN` | 可选文件下载失败、磁盘空间低、重试 |
| `INFO` | 任务开始/完成、收到命令、进程启动/退出 |
| `DEBUG` | HTTP 请求、ffmpeg 命令、进度数据、代理配置 |

`--log-level` CLI 参数控制最低输出级别。

### 6.2 必须记录的环节

**进程**: 启动参数 / 退出原因 / 收到信号

**输入**: 每条命令的 type + taskID (start-task 额外记录 name + files 数量) / 解析失败 (含行号和原始内容) / 未知命令

**任务**: 开始 / 每个状态变更 / 获取/释放并发许可 (含当前活跃数) / 完成 / 失败 (含错误码) / 取消 / panic

**下载**: 每个文件的 URL / HTTP 状态码 / Content-Length / 进度 / 完成 / 失败 (含 HTTP 状态)

**ffmpeg**: ffprobe 完整命令行 / ffmpeg 完整命令行 / 进度 / 完成退出码 / 失败退出码

**文件**: 移动 (from → to) / 冲突重命名 / 临时目录清理

**输出**: 每条 stdout 消息的 code + taskID / stdout 写入失败

**代理**: 配置来源和值

---

## 7. 改进项

### 7.1 MP3 码率控制

Go snapfile 的 ffmpeg 命令缺少 `-b:a`。Rust 版添加 `-b:a {bitrate}k`。

协议扩展: StartTaskPayload 增加可选的 `audioBitrate: Option<u32>` 字段。旧 JS 不发送时为 None, 保持兼容。

### 7.2 arm64 原生支持

`cargo build --release --target aarch64-apple-darwin`

### 7.3 分片下载 (Phase 2)

检测服务器 Range 支持 → 分片并行下载 → 合并。分片大小策略与 JS FileDownloader 一致。

---

## 8. 实现分期

### Phase 1: 核心协议 + 基础下载 (MVP)
- CLI 参数解析
- stdin/stdout JSON 行循环
- OutputWriter
- TaskManager (固定并发数)
- Task 状态机 + emit
- 流式下载 + 进度上报
- 文件移动
- 基本错误处理 + panic 隔离
- **验证**: 能被 SnapAny Electron 正常驱动, 完成 bilibili 音频 m4a 下载

### Phase 2: ffmpeg 集成
- ffprobe 封装
- 视频合并 (2 文件)
- 音频转码 (MP3/M4A/OGG)
- ffmpeg 进度解析
- **验证**: bilibili 视频下载 + MP3 转码

### Phase 3: 健壮性
- 下载重试、分片下载、断点续传
- 代理完整支持
- 动态并发限制调整
- 信号处理
- **验证**: 大文件下载, 网络中断恢复

### Phase 4: 改进项
- MP3 码率控制、arm64 编译、打包脚本验证

---

## 9. 输出 JSON 示例对照

Go snapfile 输出:
```json
{"code":"task_started","data":{"taskID":"a83f3966-8070-4d3b-bcd5-19506c1942da"},"message":"任务已启动"}
```

snapfile-rs 必须输出完全相同的格式。

进度:
```json
{"code":"task_download_progress","data":{"done":4666945,"remainingTime":9,"speed":4666945,"taskID":"a83f3966-...","total":47592128},"message":"更新下载进度"}
```

完成:
```json
{"code":"task_complete","data":{"files":["/Users/steve/Downloads/视频.mp4"],"taskID":"a83f3966-..."},"message":"任务完成"}
```

JSON key 顺序不影响兼容性 (JSON spec 无序), 但 value 类型和 key 名称必须匹配。

---

## 10. 未知项与假设

| 编号 | 假设 | 风险 | 验证方式 |
|---|---|---|---|
| A1 | m4a 模式跳过所有 conversion 阶段 | 低 | 日志中缺失 conversion 状态码 |
| A2 | 视频单文件模式不需要合并, 直接 move | 中 | 无单文件视频日志样本 |
| A3 | 第一个文件始终加 `_first` 后缀 | 低 | 日志中所有首文件都有此后缀 |
| A4 | `system` 代理读取 macOS scutil 设置 | 中 | Go snapfile 可能用不同机制 |
| A5 | 进度的 total 是所有文件 Content-Length 之和 | 低 | 日志 total 与文件大小匹配 |
| A6 | 文件冲突时 Go snapfile 直接覆盖 | 中 | 无冲突场景日志 |
| A7 | 转换进度 total 是输入文件总大小 | 中 | 从日志数值推断 |

---

*文档版本: 2026-08-07*
*基于: vendor/081_design.md + vendor/snapfile-go/README.md + 运行时日志*
