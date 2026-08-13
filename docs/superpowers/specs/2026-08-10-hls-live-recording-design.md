# HLS 录制架构设计文档

**日期**: 2026-08-10
**状态**: 已定稿（V1）

> **fMP4 状态**: `docs/fMP4.md` 是后续优化候选，当前 HLS V1 仍采用 TS→remux；不把 fMP4 并入本设计。

## 核心原则

> **变化多的部分必须交给 yt-dlp。**

这三个工具的分工由各自的更新频率决定：

| 工具 | 职责 | 变化频率 | 说明 |
|------|------|----------|------|
| yt-dlp | 页面 URL → 流地址 + Headers | 极高（每日） | 站点 extractor 频繁更新，紧跟平台变化 |
| ffmpeg | 流地址 → 最终文件 | 极低（协议级） | HLS 是 RFC 8216，AES-128 是标准算法，十年不变 |
| snapany-rs | 编排进程 + 翻译进度 | 低 | 纯胶水层，做协议适配和生命周期管理 |

snapany-rs **不实现任何 HLS 客户端逻辑**。m3u8 解析、片段下载、AES-128 解密、密钥轮换、playlist 轮询全部由 ffmpeg 原生处理。snapany-rs 只负责构造 ffmpeg 命令、管理进程生命周期、解析进度输出。

## snapfile-go 逆向分析（修正）

> 之前的分析结论"snapfile-go 不支持 AES 解密"是错误的。以下为修正后的逆向结论。

对 snapfile-go 二进制的 `strings` 分析发现了确凿的 native 解密证据：

**加密类型和密钥管理：**
- `*prepare.CryptMethod` — 专门的加密方法枚举类型
- `*prepare.Key` — 密钥结构体
- `*map[int]*prepare.Key` — **按 segment 序号映射密钥**，即 HLS 密钥轮换的标准实现
- `aesKey` — 明确的 AES 密钥字段

**AES/CBC 运行时：**
- `crypto/aes.NewCipher` — AES 加密器已链接
- `crypto/cipher.NewBCDecrypter` — CBC 解密器已链接

**HLS 加密标签解析：**
- `#EXT-X-KEY` 标签解析
- `invalid EXT-X-KEY method: %s, line: %d` — 加密方法校验（NONE / AES-128）
- `snapfile/pkg/m3u8.extractURI` — 密钥 URI 提取

**结论：snapfile-go 具备 native AES-128 CBC 解密能力。** snapany-rs 的定位不是"第一个支持解密"，而是提供更透明、更可控的实现。

## 架构决策

### 决策 1：HLS 全部委托给 ffmpeg

snapany-rs 不实现 HLS 客户端。VOD 和 Live 都通过 ffmpeg 的原生 HLS 支持完成。

```
VOD:   yt-dlp 解析 -> ffmpeg -i m3u8_url -> 最终 MP4
Live:  yt-dlp 解析 -> ffmpeg -i m3u8_url（持续录制）-> MPEG-TS -> remux MP4
```

**理由：**
- ffmpeg 本身就是完整的 HLS 客户端，原生支持 m3u8 解析、片段下载、AES-128-CBC 解密、密钥轮换、EXT-X-MAP (fMP4)、EXT-X-DISCONTINUITY、直播轮询
- 这些功能全部是 RFC 8216 标准，不需要 snapany-rs 重复造轮子
- 避免了"下载片段到磁盘 -> concat 再合并"的双重 I/O 开销

### 决策 2：防盗链 Headers 通过 ffmpeg `-headers` 传递

ffmpeg 的 `-headers` 参数应用于它发出的**所有** HTTP 请求——包括 playlist、片段、密钥请求。

```
yt-dlp 提取阶段 -> 认证完成（Cookie、Referer、签名 Token）
       |
Electron 传递 m3u8_url + Headers 给 snapany-rs
       |
snapany-rs 构造 ffmpeg 命令，Headers 通过 -headers 传递
       |
ffmpeg 所有 HTTP 请求都带完整 Headers
```

复杂的防盗链（签名 token、旋转 cookie、JS challenge）发生在**提取阶段**，那是 yt-dlp 的职责。yt-dlp 提取出的 URL 和 Headers 已经是认证过的，ffmpeg 直接用即可。

> **实现注意**：ffmpeg `-headers` 参数要求换行符为 `\r\n`（CRLF），不是 `\n`。

### 决策 3：DASH / 直链场景保持现有方案不变

非 HLS 的普通文件下载（DASH 的 m4s 分片、直链文件）仍然走 snapany-rs 的分片并行下载 + 断点续传。这是 snapany-rs 真正有价值的场景——大文件、单连接限速、需要多连接加速。

### 决策 4：Live 录制使用 MPEG-TS 中间格式

Live 录制过程中 ffmpeg 输出 **MPEG-TS**（`.ts`），录制停止后再 remux 为 MP4。

**理由：**
- MPEG-TS 是流式容器，没有 moov atom，对中断天然免疫——即使 ffmpeg 崩溃或被 kill，已写入的 TS 文件仍可播放和 remux
- MP4（fMP4）的 moov atom 在文件末尾，非优雅退出会导致文件损坏不可用
- 停止录制后的 remux 步骤是纯容器转换（`-c copy`），不涉及重新编码，耗时可忽略

```
录制中:  ffmpeg -i live.m3u8 -c copy -progress pipe:1 temp/recording.ts
停止后:  ffmpeg -i temp/recording.ts -c copy -movflags +faststart temp/output.mp4
```

### 为什么不用 snapany-rs 自己做 HLS

在 DASH 场景中，snapany-rs 的价值来源是更好的下载器（分片并行、断点续传）。但 HLS 场景中：
- 片段本身就小（2-10 秒），分片并行下载没有意义
- 单个片段丢了重下即可，断点续传在片段级别不关键
- snapany-rs 被迫实现整套 HLS 客户端，全是在重复 yt-dlp 和 ffmpeg 已做好的事情

## 数据流

### VOD HLS

```
Electron
  |
  |-- yt-dlp: 解析页面 URL
  |     |-- 返回: m3u8_url + http_headers + duration
  |
  |-- snapany-rs: start-task { files: [{ url: m3u8_url, header: {...} }], durationSecs: 3600 }
  |
  |-- snapany-rs -> ffmpeg:
  |     ffmpeg -headers "Referer: ...\r\nCookie: ...\r\nUser-Agent: ...\r\n" \
  |            -i "https://cdn.example.com/master.m3u8" \
  |            -c copy -movflags +faststart \
  |            -progress pipe:1 \
  |            temp/output.mp4
  |
  |     ffmpeg 内部: 读 m3u8 -> 选变体 -> 下载片段 -> 解密 -> remux -> 写 mp4
  |     （一步完成，无中间文件，无 concat 列表）
  |
  |-- snapany-rs: 解析 out_time_us / durationSecs -> task_download_progress
  |-- snapany-rs: mover.move_to_output -> resolve_conflict -> 最终路径
  |-- snapany-rs -> Electron: task_complete
```

### Live HLS

```
Electron
  |
  |-- yt-dlp: 解析页面 URL
  |     |-- 返回: live_m3u8_url + http_headers
  |
  |-- snapany-rs: start-task { live: true, files: [{ url: m3u8_url, ... }] }
  |
  |-- 阶段 1: 录制（MPEG-TS）
  |     snapany-rs -> ffmpeg:
  |       ffmpeg -headers "...\r\n" \
  |              -i "https://cdn.example.com/live.m3u8" \
  |              -c copy \
  |              -progress pipe:1 \
  |              temp/recording.ts
  |
  |     ffmpeg 内部: 持续轮询 playlist -> 下载新片段 -> 解密 -> 追加写 TS
  |     snapany-rs: 解析 out_time_us -> task_download_progress（已录制时长）
  |
  |-- 停止录制（两种触发方式）
  |     用户停止: stop-recording-live -> SIGINT
  |     直播结束: ffmpeg 检测 #EXT-X-ENDLIST -> 自然退出
  |
  |-- 阶段 2: Remux（TS -> MP4）
  |     snapany-rs -> ffmpeg:
  |       ffmpeg -i temp/recording.ts \
  |              -c copy -movflags +faststart \
  |              temp/output.mp4
  |
  |-- snapany-rs: mover.move_to_output -> resolve_conflict -> 最终路径
  |-- snapany-rs -> Electron: task_complete
```

> **为什么 Live 不直接输出 MP4**：MP4 的 moov atom 在文件末尾，ffmpeg 录制过程中如果崩溃或网络中断，moov 没写入，文件损坏不可用。MPEG-TS 是流式容器，对中断天然免疫。停止后 remux 是纯容器转换（`-c copy`），不涉及重新编码。

### DASH / 直链（保持不变）

```
Electron -> snapany-rs: start-task { files: [{ url: video.m4s }, { url: audio.m4s }] }

snapany-rs: 分片并行下载（已有实现）-> ffmpeg 合并（已有实现）

snapany-rs -> Electron: task_complete
```

## snapany-rs 职责

snapany-rs 对 HLS 的全部工作：

1. **检测 URL 是否为 HLS 流**。优先使用 Electron 传入的 yt-dlp 元数据（`protocol`、`manifest_url`、`ext`、`is_live`），URL 后缀规则（`.m3u8` / `.m3u8?` / `.m3u8#`）仅作为 fallback。snapany-rs 不发送 HTTP 请求做 Content-Type 探测。
2. **构造 ffmpeg 命令**（拼接 `-headers`、`-i`、输出参数）
3. **管理 ffmpeg 进程生命周期**（启动、停止、超时）
4. **解析 `-progress` 输出**为进度事件
5. **Live 停止后触发 TS -> MP4 remux**（第二阶段 ffmpeg 调用）
6. **协议翻译**（snapfile stdin/stdout JSON <-> 进程管理）

对比需要自行实现的方案：

| 模块 | snapany-rs 自行实现 | ffmpeg 委托方案 |
|------|---------------------|----------------|
| m3u8 解析器 | 需实现 | 不需要 |
| Playlist 轮询器 | 需实现 | 不需要 |
| KeyManager | 需实现 | 不需要 |
| AES-128 解密 | 需实现 | 不需要 |
| SegmentDownloader | 需实现 | 不需要 |
| SegmentWriter | 需实现 | 不需要 |
| concat 列表生成 | 需实现 | 不需要 |
| EXT-X-MAP (fMP4) | 需实现 | ffmpeg 原生支持 |
| EXT-X-DISCONTINUITY | 需实现 | ffmpeg 原生支持 |
| 密钥轮换 | 需实现 | ffmpeg 原生支持 |
| **实际实现** | ~2000 行 | **ffmpeg 进程管理 + 进度解析（已有基础）** |

## 安全原则

> **Headers 中的敏感值不记录到日志。**

`-headers` 参数包含 Cookie、Authorization 等敏感信息，会出现在进程列表（`ps aux`）中。缓解措施：

1. **不记录 Headers 原文到日志**：tracing 日志只记录 header 的 key 名，不记录 value
2. **进程退出后无残留**：Headers 通过命令行参数传递，不写入临时文件
3. **风险可控**：本机用户才能看到进程列表；Cookie 通常有时效性

实现要点：

```rust
// 日志记录 Headers 时只记 key，不记 value
let header_keys: Vec<&str> = headers.keys().map(|k| k.as_str()).collect();
tracing::info!(
    task_id = task_id,
    header_keys = ?header_keys,  // 只记 key 名
    "构造 ffmpeg HLS 命令"
);
```

验证必须覆盖：主 playlist、媒体 playlist、segment、AES 密钥请求和重定向后的请求，确认 `-headers` 在每种请求上都生效。

## 与现有架构集成

### ffmpeg 版本要求

| 项目 | 要求 |
|------|------|
| 最低版本 | ffmpeg 5.1+ |
| 推荐版本 | ffmpeg 6.0+ |
| 必需 demuxer | `hls`（Apple HTTP Live Streaming） |
| 必需协议 | `http`、`https`、`tls` |
| 必需 muxer | `mp4`、`mpegts`（Live 录制 + remux） |
| 内置 m3u8 解析 | ffmpeg 自带，无需 libxml2 |

> SnapAny 内置的 ffmpeg 6.0-tessus（来源：[evermeet.cx/ffmpeg](https://evermeet.cx/ffmpeg/)）已具备完整 HLS demuxer、mpegts muxer 和 HTTPS 支持，可直接使用。

### 流程分支

snapany-rs 收到 start-task 后，根据 URL 类型走不同路径。**HLS 分支在获取下载许可（信号量）之后**，与普通下载任务共享并发限制：

```
start-task
    |
    |-- TASK_STARTED -> TASK_PREPARE -> TASK_PREPARED
    |
    |-- TASK_PENDING_DOWNLOAD -> 获取信号量 (max_concurrent)
    |
    |-- URL 以 .m3u8 结尾 或 包含 .m3u8? / .m3u8#
    |     |-- HlsRunner: ffmpeg -i m3u8_url（VOD 或 Live）
    |
    |-- 其他（m4s、直链、普通文件）
          |-- 现有 downloader: 分片并行下载 -> ffmpeg 合并
```

> **并发控制**：HLS 任务与普通下载任务共享 `max_concurrent` 信号量。每个 HLS 任务持有 ffmpeg 进程并消耗网络带宽，与普通下载任务没有区别。信号量在 HLS 分支返回时释放（无论成功还是失败）。

> **模块声明**：项目同时有 `src/lib.rs` 和 `src/main.rs`（binary crate）。当前 `lib.rs` 未被 binary 使用，`hls` 模块需要在 `main.rs` 中声明 `mod hls;`。

### HLS 输出路径与冲突处理

HLS 录制（VOD 和 Live）的 ffmpeg 输出先写入 **temp 目录**，录制结束后通过 `mover.move_to_output` 移动到最终目录。

```
ffmpeg 写 temp/output.mp4 -> 录制结束 -> mover.move_to_output -> resolve_conflict -> 最终路径
```

**temp 路径结构**（避免双重 task_id）：

```
{temp_dir}/{task_id}/hls_output.ts    (Live 录制中)
{temp_dir}/{task_id}/hls_output.mp4   (VOD 录制, 或 Live remux 后)
```

> 注意：`hls_temp_output_path` 函数接收的 `temp_root` 已经是 `{temp_dir}/{task_id}`，函数本身只追加 `hls_output.{ext}`，不再重复 task_id。

**为什么需要 temp -> final 两步**：
- ffmpeg 录制过程中直接写最终路径会 O_TRUNC 覆盖已有文件
- 先写 temp， mover 阶段的 `resolve_conflict` 会检测并自动递增文件名
- 复用现有 mover 逻辑，不需要在 HlsRunner 里重复实现

**路径冲突示例**：

| 已存在文件 | 新文件输出 |
|-----------|-----------|
| `output.mp4` | `output(1).mp4` |
| `output.mp4` + `output(1).mp4` | `output(2).mp4` |

### CleanupGuard 与 HLS 异常保留

现有 `run_task` 顶部创建了 `CleanupGuard`，在函数返回时 `remove_dir_all` 整个 temp 目录。这与"中断后旧文件保留"的设计目标冲突。

**HLS 路径的异常处理**：

```
ffmpeg 录制失败 / 崩溃 / 网络中断
    |
    |-- temp 中已有部分录制内容（TS 或 MP4）
    |
    |-- 判断 temp 文件是否可用：
    |     文件存在且 size > 0 -> 先 move 到 outputDir，再返回错误
    |     （用户拿到部分录制内容 + 错误提示）
    |     文件不存在或 size = 0 -> 直接返回错误
    |
    |-- CleanupGuard 仍然清理 temp 目录（此时 temp 已空或只剩碎片）
```

> **实现要点**：HLS 分支在 `run_task` 中通过 early return 跳过后续下载/转码流程，但 `CleanupGuard` 仍然生效。异常时 HLS runner 返回错误前应先把可用的 temp 文件 move 到 outputDir，避免被 CleanupGuard 删除。

### Live 的进程管理

直播录制需要与普通任务不同的进程控制：

- **开始录制**：启动 ffmpeg 进程（输出 MPEG-TS），持续运行
- **停止录制**：发送 SIGINT，ffmpeg 收到信号后优雅退出（TS 文件天然完整，无需 finalize），然后进入 remux -> move -> complete 阶段
- **stop-recording-live 的语义**：不是 cancel（丢弃数据），而是"停止录制 -> remux TS->MP4 -> 输出最终文件"

> **Live 停止流程**：SIGINT -> ffmpeg 退出 -> snapany-rs 启动第二阶段 ffmpeg（TS->MP4 remux） -> move -> complete

### 进程退出码处理

ffmpeg 退出码 -> snapany-rs 行为：

| ffmpeg 退出情况 | exit code | snapany-rs 行为 | 说明 |
|-----------------|-----------|-----------------|------|
| 正常退出 | `Some(0)` | `task_complete` | VOD 结束或 Live ENDLIST |
| 用户 SIGINT 停止 | `Some(0)` 或信号 | 进入 remux 阶段 | TS 文件完整，继续处理 |
| 硬取消 (CancellationToken) | N/A | `task_cancelled` | kill 进程，不保留文件 |
| 网络中断 / ffmpeg crash | 非 0 | 检查 temp 文件 -> `download_error` | 尝试保留部分录制 |
| ffmpeg 启动失败 | N/A | `prepare_error` | 二进制不存在或参数错误 |

> **信号终止的 exit code**：在 Unix 上，进程被信号终止时 `ExitStatus::code()` 返回 `None`，需要用 `ExitStatus::signal()` 判断。对于 Live 的 SIGINT 停止路径，snapany-rs 已知是自己发送的 SIGINT（通过 `stopped` flag），直接进入 remux 阶段，不依赖 exit code 判断。对于 VOD 和自然退出，检查 `status.success()`。

> **硬取消 vs 用户停止的区别**：
> - `delete-task` -> CancellationToken::cancel() -> `child.kill()` -> 进程被 SIGKILL -> TS 可能不完整 -> `task_cancelled`（不保留）
> - `stop-recording-live` -> SIGINT -> ffmpeg 优雅退出 -> TS 完整 -> remux -> `task_complete`

### 直播结束检测

ffmpeg 的 HLS demuxer 原生支持 `#EXT-X-ENDLIST` 标签检测：
- CDN 在直播结束时向 m3u8 追加 `#EXT-X-ENDLIST`
- ffmpeg 轮询读取到该标签后，停止下载新片段，自然退出（exit code 0）
- snapany-rs 收到 ffmpeg 进程退出，视为正常完成，进入 remux 阶段

snapany-rs **不需要**自行解析 m3u8 或检测 ENDLIST——这是 ffmpeg 的职责。

### 直播异常处理

| 场景 | snapany-rs 行为 |
|------|-----------------|
| 短暂网络抖动 | ffmpeg 自身 fragment 级重试，snapany-rs 不干预 |
| 网络中断超过几分钟 | ffmpeg 因持续拿不到 playlist 退出（非 0），snapany-rs 捕获，检查 TS 文件是否可用，报 `download_error` |
| ffmpeg crash / 进程被杀 | 同上，靠进程退出码检测 |

> **设计决策**：snapany-rs **不做自动重连**。直播断了就是断了，自动重连会产生时间戳不连续的碎片文件。把中断当作失败上报，由用户决定是否重新开播录制。

### 直播中断后的恢复

> **核心事实**：ffmpeg HLS live 录制是"追加写"模式，不存在"断点续录"——无法在已有文件末尾继续写入新的 HLS 片段（时间戳不连续、moov atom 需要重写）。

**V1 方案：重新 paste link**

| 决策 | 说明 |
|------|------|
| 不做"重试"按钮 | V1 不做。重新 paste link 走现有 start-task 流程，语义最干净 |
| 部分录制保留 | 中断时如果 TS 文件有内容，先 remux 再 move 到 outputDir，用户拿到部分录制 |
| 新文件自动递增 | mover 阶段 `resolve_conflict` 检测路径冲突，`output.mp4` -> `output(1).mp4` |

> 未来如需要"重试"，只是前端自动填充 page URL + 触发 start-task，后端零改动。

### 进度上报

**VOD HLS**：复用 `task_download_progress`，`done` = ffmpeg 已处理时长（`out_time_us`），`total` = 媒体总时长（来自协议的 `durationSecs` 字段）。

**Live HLS**：使用新的进度语义。直播的 `total` 不存在或持续增长，进度应报：
- `done`：已录制时长（秒）
- `total`：0（表示无限/直播）
- `speed`：0（V1 固定，不解析 ffmpeg `speed=` 行）
- `remainingTime`：0（不适用）

具体字段定义：

| 字段 | 类型 | VOD 语义 | Live 语义 |
|------|------|----------|-----------|
| `done` | u64 | 已处理时长（秒），来自 `out_time_us` | 已录制时长（秒），来自 `out_time_us` |
| `total` | u64 | 媒体总时长（秒），来自 `durationSecs` | 固定 0（无限） |
| `speed` | u64 | 0（V1 不实现） | 0（V1 不实现） |
| `remainingTime` | u64 | `total - done`（不大于 total） | 0（不适用） |

> **speed 字段说明**：ffmpeg `-progress` 输出的 `speed=` 是倍速乘数（如 `2.5x`），不是 bytes/s。V1 不解析此字段，统一报 0。如果未来需要，应将其转换为乘数或实时码率，而非沿用现有的 bytes/s 语义。

> **VOD total 来源**：Electron 在 yt-dlp 解析阶段获取媒体时长，通过 `start-task` 协议的 `durationSecs` 字段传入。如果 `durationSecs` 为 `None`（yt-dlp 未返回时长），VOD 进度的 `total` 报 0，Electron 侧应适配为显示"已处理 XX:XX:XX"而非百分比进度条。

> **下游同步**：Electron 的 `onDownloadProgress` handler 需适配 `total=0` 的语义——此时应显示"已录制 XX:XX:XX"或"已处理 XX:XX:XX"而非进度条或倒计时。

### 协议兼容性

与 snapfile-go 的 stdin/stdout JSON 协议兼容扩展：

**请求消息**：

| 消息 | 用途 | 新增字段 |
|------|------|----------|
| `start-task` | 启动任务 | `live: bool`（区分 VOD / Live），`durationSecs: Option<u64>`（VOD 媒体总时长） |
| `stop-recording-live` | 停止直播录制（SIGINT -> remux -> complete） | 已存在，无变化 |
| `delete-task` | 取消任务（硬取消，kill 进程） | 已存在，无变化 |

**`start-task` payload 新增字段**：

```json
{
    "type": "start-task",
    "payload": {
        "taskID": "...",
        "name": "...",
        "outputDir": "...",
        "tempDir": "...",
        "outputType": "video",
        "live": false,
        "durationSecs": 3600,
        "files": [{"url": "...", "header": {...}}]
    }
}
```

**响应消息**：

| 消息 | VOD 语义 | Live 语义 |
|------|----------|-----------|
| `task_download_progress` | done/total 为秒 | done 为已录制秒，total=0 |
| `task_complete` | 录制完成 | 停止录制 + remux 完成 |

### 磁盘空间检查

直播录制前，snapany-rs 应检查输出目录所在磁盘的剩余空间：
- 低于阈值（如 500MB）时拒绝启动，报 `disk_full`
- 防止无限时直播打满磁盘

实际写入位置是 `temp_root`，因此必须检查 `temp_root` 所在文件系统；当 `tempDir` 与 `outputDir` 不在同一磁盘时，不能只检查 `outputDir`。

## 链路对比总结

| 场景 | 解析 | 下载 + 解密 | 合并 | snapany-rs 代码量 |
|------|------|-------------|------|-------------------|
| DASH / 直链 | yt-dlp | snapany-rs（分片并行 + 续传） | ffmpeg | 已有 |
| VOD HLS | yt-dlp | ffmpeg（原生 HLS） | ffmpeg（remux 一步完成） | 命令构造 + 进度解析 |
| Live HLS | yt-dlp | ffmpeg（原生 live playlist -> TS） | ffmpeg（TS -> MP4 remux） | 命令构造 + 进程控制 + remux + 进度解析 |

三个场景都遵循同一原则：变化多的交给 yt-dlp，稳定的标准协议交给 ffmpeg，snapany-rs 只做编排。

## 已知限制（V1 不做）

| 限制 | 说明 | 未来可能方案 |
|------|------|-------------|
| 直播凭据不刷新 | yt-dlp 提取的 URL/Headers 可能过期，长时直播可能中途失败 | 定时刷新机制：重新调用 yt-dlp 获取新 URL/Headers，ffmpeg 热替换 |
| 不做自动重连 | 网络中断后不恢复录制 | 用户手动重新开播 |
| 不做"重试"按钮 | 中断后用户重新 paste link 创建新任务 | 未来可做前端自动填充 page URL + 触发 start-task |
| 不做 URL 安全校验 | m3u8 URL 直接传给 ffmpeg，不检查 SSRF | 如需，可加内网 IP 段拦截 |
| 不做多路直播 | 暂不支持同时录制多路直播 | 未来按需扩展 |
| 不做字幕/音轨选择 | HLS 中的多音轨/字幕流使用 ffmpeg 默认选择 | 未来按需扩展 |
| speed 固定 0 | 进度中的 speed 字段 V1 不解析 | 未来解析 ffmpeg `speed=` 倍速并转换 |
| outputVideoFormat 忽略 | HLS 永远输出 MP4 | 未来支持自定义容器格式 |

## ffmpeg 升级策略

| 项目 | 决策 |
|------|------|
| V1 是否自动升级 | **否** |
| 内置版本 | ffmpeg 6.0-tessus |
| 升级必要性 | HLS 功能在 6.0 已完整可用，不会因"平台策略变化"失效 |
| 手动升级 | 可随应用更新时替换二进制（参考 `update-ytdlp.sh` 模式） |
| 自动升级 API | evermeet.cx 提供 JSON API：`https://evermeet.cx/ffmpeg/info` |

evermeet.cx API 返回结构：
```json
[{
  "name": "ffmpeg",
  "type": "release",
  "version": "9.0",
  "size": 80729336,
  "download": {
    "7z": {"url": "https://...", "size": 18050701, "sig": "https://..."},
    "zip": {"url": "https://...", "size": 26149673, "sig": "https://..."}
  }
}]
```

## 分工边界

| 层 | 职责 |
|----|------|
| Electron / TaskService | 页面 URL 解析、格式/清晰度选择、构造 FileSpec、传递 durationSecs |
| yt-dlp | 页面 URL -> m3u8 URL + Headers + duration（含认证） |
| snapany-rs | 进程编排、ffmpeg 命令构造、进度解析、生命周期管理、TS->MP4 remux |
| ffmpeg | m3u8 解析、片段下载、AES-128 解密、remux、直播轮询 |

> **变体选择**由 Electron 层的清晰度选择器决定，snapany-rs 只接收已选定的 FileSpec，不参与 master playlist 变体选择。

## 测试策略

- 使用 mock ffmpeg 脚本覆盖，不依赖真实直播流
- mock 脚本从命令行参数最后一个位置参数取 output_path，通过写文件 + 输出 `-progress` 格式行模拟 ffmpeg 行为
- 重点测试：
  - HLS URL 检测（各种后缀、query string、fragment）
  - ffmpeg 命令构造（CRLF headers、VOD vs Live 参数差异）
  - 进度解析（out_time_us -> 秒、progress=end）
  - VOD 完整流程（录制 -> move -> complete）
  - Live 完整流程（录制 TS -> SIGINT -> remux MP4 -> move -> complete）
  - Live 自然结束（ENDLIST -> ffmpeg 退出 -> remux -> complete）
  - Live 硬取消（delete-task -> kill -> cancelled）
  - 进程退出码映射（exit 0 / signal / crash）
  - 路径冲突处理（已存在文件 -> 自动递增）
  - 异常场景：ffmpeg crash / 网络中断 -> 部分录制保留
  - Header 安全（stdout 不泄露 header value）
