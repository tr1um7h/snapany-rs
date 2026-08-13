# SnapAny Electron 架构设计文档

本文档基于 SnapAny 应用打包产物 `out/main/main.js`（9702 行）逆向分析。

---

## 一、整体架构

SnapAny 是一个 Electron 桌面应用，采用**三进程 + 多子进程**架构：

```
┌─────────────────────────────────────────────────────────────┐
│                     Electron 应用                             │
│                                                              │
│  ┌────────────────────────────────────────────────────────┐  │
│  │  主进程（Node.js）                                      │  │
│  │                                                        │  │
│  │  ┌──────────────────────────────────────────────────┐  │  │
│  │  │  服务层（11 个核心服务）                           │  │  │
│  │  │  ProxyService / SnapfileService / FFmpegService  │  │  │
│  │  │  AuthService / YtDlpService / TaskService        │  │  │
│  │  │  SettingService / ResourceSnifferService         │  │  │
│  │  │  SystemService / VideoAudioConverService         │  │  │
│  │  │  VideoAudioMergeService                          │  │  │
│  │  └──────────────────────────────────────────────────┘  │  │
│  │                                                        │  │
│  │  ┌──────────────────────────────────────────────────┐  │  │
│  │  │  数据层                                           │  │  │
│  │  │  SQLite (better-sqlite3 + drizzle-orm)           │  │  │
│  │  │  electron-store × 4                               │  │  │
│  │  └──────────────────────────────────────────────────┘  │  │
│  │                                                        │  │
│  │  ┌──────────────────────────────────────────────────┐  │  │
│  │  │  IPC 层（@egoist/tipc）                           │  │  │
│  │  │  7 个路由模块，40+ 个 procedure                   │  │  │
│  │  │  5 个 renderer handler（事件推送）                │  │  │
│  │  └──────────────────────────────────────────────────┘  │  │
│  └────────────────────────────────────────────────────────┘  │
│                                                              │
│  ┌────────────────────────────────────────────────────────┐  │
│  │  渲染进程（React）                                      │  │
│  │  React 18 + React Router v7 + Vite                      │  │
│  └────────────────────────────────────────────────────────┘  │
│                                                              │
└──────────────────────────────────────────────────────────────┘
         │              │              │
         │ spawn         │ spawn         │ spawn
         ▼              ▼              ▼
   ┌──────────┐  ┌──────────┐  ┌──────────┐
   │ snapfile  │  │ yt-dlp   │  │ ffmpeg   │
   │ (Rust)    │  │ (Python) │  │          │
   │ 长驻进程   │  │ 按需spawn │  │ 按需spawn │
   └──────────┘  └──────────┘  └──────────┘
```

### 进程模型

| 进程 | 生命周期 | 通信方式 | 说明 |
|------|---------|---------|------|
| Electron 主进程 | 应用全程 | — | 服务层、数据层、IPC 层 |
| 渲染进程 | 应用全程 | tipc (ipcRenderer) | React 前端 |
| snapfile (go/rust) | 应用全程（长驻） | stdin/stdout JSON | 下载引擎 |
| yt-dlp | 按需（每次解析 spawn） | stdout | 页面 URL 解析 |
| ffmpeg | 按需（转换/合并时） | stdout (-progress) | 格式转换/合并 |

---

## 二、窗口管理

SnapAny 使用两种窗口：

**主窗口**（`createMainWindow`）
- 尺寸：1000×800，最小 900×600
- 配置：autoHideMenuBar、webviewTag 启用、nodeIntegration 启用、contextIsolation 关闭
- 加载方式：开发模式 `localhost:5173`，生产模式 `renderer/index.html`
- 关闭行为：拦截 close 事件，检查未完成任务，通过 `onAppClose` handler 通知前端弹窗确认
- 启动时清理：清除 defaultSession 的 Service Workers、localStorage、WebSQL

**认证窗口**（`createAuthWindow`）
- 尺寸：800×600
- 配置：modal 模式，parent 为主窗口
- 加载方式：通过 hash 路由 `#/auth?url=<encoded>` 打开
- 用途：第三方平台登录（通过 webview 加载登录页）
- 同时只允许一个认证窗口

---

## 三、服务层详解

### 3.1 TaskService — 任务编排中心

TaskService 是整个应用的**编排核心**，协调 yt-dlp、snapfile-rs、ffmpeg 三个子进程完成完整的下载流水线。

**任务生命周期状态机**

```
extracting → readyDownload → downloading → pendingConversion
     ↓                                    → converting → readyMove → moving → completed
     ↓
   failed（解析失败）
```

**核心职责**

| 职责 | 说明 |
|------|------|
| **URL 解析编排** | 调用 YtDlpService 解析页面 URL，获取视频信息 |
| **智能格式选择** | 从 yt-dlp 返回的几十个格式中，按用户设置选择最优格式 |
| **下载任务构造** | 将选中的格式转换为 snapfile-rs 的 FileSpec[] |
| **snapfile-rs 调度** | 构造 StartTaskPayload，写入 snapfile stdin |
| **进度转发** | 监听 snapfile-rs stdout，映射为 UI 状态，推送给前端 |
| **错误诊断** | 解析 yt-dlp 错误消息，分类为用户可理解的错误类型 |
| **中断恢复** | 应用重启后检测未完成任务 |
| **批量管理** | 批量取消（同时 kill yt-dlp + ffmpeg + snapfile-rs）、批量删除 |
| **缩略图处理** | 下载缩略图、转 base64 存库、作为可选下载项 |
| **直播处理** | 检测 is_live，调整格式选择策略 |

**任务数据来源**

| 来源 | 流程 |
|------|------|
| **用户粘贴 URL** | saveTaskByUrls → 状态 extracting → parseTask（yt-dlp 解析） |
| **资源嗅探** | saveSnifferTask → 已有直接媒体 URL，跳过解析直接下载 |

### 3.2 YtDlpService — 页面 URL 解析

负责调用 yt-dlp 二进制解析视频页面。

**核心能力**

| 能力 | 说明 |
|------|------|
| **getParseInfo** | yt-dlp --dump-json 解析页面 URL，返回完整视频信息 JSON |
| **execute** | 通用 yt-dlp 命令执行 |
| **cancelYtDlpProcess** | 按 taskId 取消正在运行的 yt-dlp 进程（SIGTERM/SIGINT） |
| **checkYtDlpUpdate** | 检查 yt-dlp 版本，自动下载更新 |

**--dump-json 参数策略**

- `--no-check-certificates` / `--no-warnings`：抑制警告
- `--no-playlist`：只解析单个视频
- `--ignore-errors` / `--ignore-config`：容错
- `--extractor-args generic:extract_flat=true`：通用提取器
- `--format-sort res,ext:mp4:m4a`：按分辨率和格式排序
- 自定义 User-Agent 和 Accept 请求头
- `--retries 3` / `--socket-timeout 10`：重试和超时
- 代理注入：`--proxy`（非 system 模式时）
- Cookie 注入：`--cookies <file>`（有认证 Cookie 时）

**返回数据结构**（yt-dlp --dump-json 标准输出）

| 字段 | 说明 |
|------|------|
| title / fulltitle | 标题 |
| thumbnail | 缩略图 URL |
| duration | 时长 |
| is_live | 是否直播 |
| formats[] | 可用格式列表（含 url、ext、vcodec、acodec、width、height、fps、filesize、language、http_headers） |
| subtitles / automatic_captions | 手动/自动字幕 |
| direct + url | 直接下载链接（无需格式选择） |
| channel / uploader | 频道/上传者 |

**进程管理**

- 每次解析 spawn 一个 yt-dlp 进程
- `ytDlpProcesses` Map 按 taskId 跟踪进程引用
- 取消时按平台发送不同信号：Windows 用 SIGTERM，macOS/Linux 用 SIGINT
- 进程退出后从 Map 清除

### 3.3 SnapfileService — 下载引擎通信

负责与 snapfile（下载引擎）的进程生命周期管理和 stdin/stdout 通信。

**注意**：当前 patches 默认使用 snapfile-rs（Rust），通过 `useGoSnapfile` 设置可切回 snapfile-go（Go 编译的二进制）。snapfile-rs 缺失 HLS/直播录制能力；snapfile-go 具备完整能力。下文描述基于 snapfile-go 的完整能力。

**进程生命周期**

| 阶段 | 说明 |
|------|------|
| **checkExecutable** | 检查 snapfile 二进制是否存在 |
| **start** | spawn 进程，传入 ffmpeg/ffprobe 路径等参数 |
| **长驻运行** | 监听 stdout，解析 JSON 响应 |
| **stop** | 关闭 stdin，等待退出 |
| **restart** | 异常时自动重启 |
| **isProcessRunning** | 检查进程存活 |

**stdin 通信**

| 命令 | 触发时机 |
|------|---------|
| start-task | TaskService 构造好下载任务后 |
| delete-task | 用户删除任务 |
| update-max-download-task | 用户修改并发数 |
| stop-recording-live | 用户停止直播录制 |

**stdout 响应处理**

将 snapfile-rs 的状态码映射为 UI 事件：

| snapfile-rs 状态码 | UI 状态 |
|-------------------|---------|
| task_started / task_start_prepare / task_prepared | extracting / readyDownload |
| task_start_download / task_downloaded | downloading |
| task_pending_conversion / task_converted | converting |
| task_start_move / task_moved | moving |
| task_complete | completed |
| task_deleted | deleted |
| *_error | failed |
| task_download_progress | 下载进度推送 |
| task_conversion_progress | 转换进度推送 |
| task_live_detected | 直播检测 |
| stop_recording_live | 直播停止 |

**事件系统**（EventEmitter）

SnapfileService 继承 EventEmitter，通过回调向上层通知：
- onProgress — 下载/转换进度
- onComplete — 任务完成
- onError — 错误
- onStatusChange — 状态变更

### 3.4 FFmpegService — 独立 FFmpeg 操作

独立于 snapfile，直接调用 ffmpeg 二进制完成 Convert/Merge 页面的操作。

**注意**：startMergeConvert 方法在代码中定义了，但在实际下载流程中从未被调用（dead code）。下载流程中的格式转换/合并全部在 snapfile 内部完成。Convert/Merge 页面用的是 VideoAudioConverService 和 VideoAudioMergeService 两个独立服务。

**核心能力**

| 能力 | 说明 |
|------|------|
| startMergeConvert | 合并转换已下载的媒体文件 |
| mergeMediaFiles | 多文件合并为单文件 |
| prepareMediaFiles | 预处理媒体文件（路径整理） |
| convertImagesToPng | 图片转 PNG（兼容性） |
| analyzeMediaStreams | 分析媒体流信息（编码、分辨率、帧率） |
| buildResultArray | 构建输出文件列表 |
| processStandaloneSubtitles | 处理独立字幕文件 |
| getLocalMediaInfo | 获取本地文件媒体信息 |
| moveFiles | 移动文件到最终目录 |

**进程管理**

- `ffmpegProcesses` Map 按 taskId 跟踪进程引用
- 支持取消（cancelFFmpegProcess）
- 通过 `-progress pipe:1` 参数获取进度输出

### 3.5 AuthService — 认证与 Cookie 管理

负责第三方平台的登录认证和 Cookie 生命周期管理。

**核心能力**

| 能力 | 说明 |
|------|------|
| getCookies | 从 Electron session 获取所有 Cookie |
| verifyLogin | 验证指定站点是否已登录（检查特定 Cookie 字段） |
| saveCookieFile | 生成 Netscape 格式 cookies.txt 供 yt-dlp 使用 |
| getCookiesFilePath | 获取 cookies.txt 路径 |
| deleteCookieFile | 删除指定域名的 Cookie |

**登录验证规则**

| 站点 | 关键 Cookie 字段 |
|------|-----------------|
| YouTube | LOGIN_INFO / APISID / SID |
| Instagram | sessionid / ds_user_id |
| Twitter/X | auth_token / twid |
| 其他 | Cookie 数量 > 0 |

**Cookie 文件格式**（Netscape HTTP Cookie File）

供 yt-dlp `--cookies` 参数使用，格式为 TSV：
```
域名	TRUE	路径	secure	过期时间戳	name	value
```

### 3.6 ResourceSnifferService — 资源嗅探器

SnapAny 内置浏览器功能的核心，通过 Electron webRequest API 拦截网页请求，自动发现可下载的媒体资源。

**核心能力**

| 能力 | 说明 |
|------|------|
| init | 初始化，加载过滤规则 |
| setupForWebContents | 为指定 webContents 设置嗅探监听 |
| setupSessionListeners | 设置 webRequest 监听器（请求头、响应头、完成、错误） |
| setupWindowOpenIntercept | 拦截 window.open，阻止弹窗 |
| processResponse | 处理 HTTP 响应，提取媒体资源 |
| applyRegexFilters | 应用正则过滤规则 |
| checkFileExtension | 按扩展名过滤 |
| checkMimeType | 按 MIME 类型过滤 |
| notifyResourceSniffed | 通知前端有新资源 |

**三层过滤机制**

| 过滤层 | 规则 | 示例 |
|--------|------|------|
| **扩展名过滤** | 30+ 种媒体扩展名，可设置最小大小 | mp4、mp3、m3u8、flv、mkv、webm... |
| **MIME 类型过滤** | 按响应头 Content-Type 过滤 | video/\*、audio/\*、application/vnd.apple.mpegurl... |
| **正则过滤** | 自定义 URL 匹配规则 | cache.video.\*.com/dash、bilivideo live-bvc m4s |

**webRequest 监听链路**

```
onBeforeSendHeaders → 保存请求头到 Map（按 request ID）
      ↓
onHeadersReceived → 处理响应：
  1. 跳过本地请求
  2. 应用正则过滤（isBlocking）
  3. 提取 Content-Type / Content-Length / Content-Disposition
  4. URL 路径提取文件名和扩展名
  5. 扩展名检查 + MIME 检查 + resourceType 判断
  6. 去重（URL → resourceId Map）
  7. 存储 MediaResource
  8. 通知前端
      ↓
onCompleted → 清理请求头 Map
onErrorOccurred → 清理请求头 Map
```

**嗅探结果数据结构**

| 字段 | 说明 |
|------|------|
| url | 资源 URL |
| fileName | 文件名 |
| fileExt | 扩展名 |
| contentType | MIME 类型 |
| contentLength | 文件大小 |
| method | 请求方法 |
| tabId | 来源标签页 |
| requestHeaders | 请求头（用于后续下载） |

### 3.7 VideoAudioConverService — 格式转换

独立于下载流程的格式转换功能，用于 Convert 页面。

**任务队列模型**

- 单线程串行处理（isProcessing 标志 + taskQueue）
- 任务排队等待执行

**核心能力**

| 能力 | 说明 |
|------|------|
| getFilesMediaInfo | 获取文件列表的媒体信息（视频/音频/图片分类） |
| getMediaFormatConvertInfo | 分析文件可转换的格式 |
| convertMediaFile | 执行格式转换 |
| stopConvert | 停止当前转换任务 |

**文件类型识别**

| 类型 | 判断条件 |
|------|---------|
| image | isImageFile 或 nb_frames === 1（排除 .mjpeg） |
| video | 存在 codec_type === "video" 且非 attached_pic |
| audio | 存在 codec_type === "audio" |

### 3.8 VideoAudioMergeService — 音视频合并

独立于下载流程的合并功能，用于 Merge 页面。

**核心能力**

| 能力 | 说明 |
|------|------|
| getFilesMediaInfo | 获取文件列表的媒体流信息（含流列表） |
| mergeMedia | 执行合并 |
| stopMergeTask | 停止当前合并任务 |

**媒体流信息结构**

每个文件返回其包含的流列表：
- video 流：id、codec_type、duration、codec_name（排除 attached_pic）
- audio 流：id、codec_type、duration、codec_name

### 3.9 ProxyService — 代理管理

**代理模式**

| 类型 | 说明 |
|------|------|
| system | 使用系统代理（Electron 默认） |
| direct | 不使用代理 |
| http | HTTP 代理 |
| socks5 | SOCKS5 代理 |

**核心能力**

- getProxyConfig：将设置中的代理配置转换为 Electron session 的 proxyRules 格式
- setupProxy：应用代理到 Electron defaultSession
- 支持 HTTP/HTTPS/SOCKS5 + 用户名密码认证
- 代理同时应用到 Electron session（浏览器/嗅探）和 snapfile-rs（下载）

### 3.10 SettingService — 设置管理

读写 electron-store 中的用户设置。

**设置项**

| 设置 | 类型 | 说明 |
|------|------|------|
| downloadPath | String | 下载路径（默认 ~/Downloads） |
| downloadType | video / audio | 下载类型 |
| videoConfig | { format, resolution } | 视频配置（mp4, 1080） |
| audioConfig | { format, bitrate } | 音频配置（mp3, 128） |
| subtitles | String[] | 选择的字幕语言 |
| audioTracks | String[] | 选择的音轨语言 |
| maxConcurrentDownloads | Number | 最大并发（默认 8） |
| maxParsingTasks | Number | 最大解析任务数（默认 3） |
| batchSize | Number | 批量大小（默认 5） |
| createSubfolder | Boolean | 创建子文件夹 |
| addIndexToFile | Boolean | 文件名添加序号 |
| embedSubtitle | Boolean | 嵌入字幕 |
| useGoSnapfile | Boolean | 使用原版 snapfile-go（默认 false）；任务进行中禁止切换 |
| proxy | ProxyConfig | 代理配置 |
| isDownloadThumbnail | Boolean | 下载缩略图 |
| language | String | 界面语言 |
| authSites | AuthSite[] | 认证站点列表（动态） |

### 3.11 SystemService — 系统服务

**软件更新**

| 能力 | 说明 |
|------|------|
| getSoftwareLatestVersion | 从远程检查最新版本，区分强制更新和可选更新 |
| getDownloadUrl | 按平台和架构选择下载链接（macOS arm64/intel、Windows） |
| downloadSoftware | 下载更新包到临时目录 |
| checkSoftwarePackageExists | 检查本地是否已有下载好的安装包 |
| installSoftware | 安装更新（macOS 打开 DMG，Windows 运行安装程序） |

**yt-dlp 更新**

| 能力 | 说明 |
|------|------|
| checkYtDlpUpdate | 比较本地版本和远程版本，自动下载更新 |

**其他**

| 能力 | 说明 |
|------|------|
| getAboutInfo | 应用信息（版本号、远程版本信息、yt-dlp 版本） |
| openFile / openFileDir | 打开文件/文件夹 |
| selectFileDir | 选择文件夹 |
| getSystemLanguage | 获取系统语言 |
| openExternalLink | 打开外部链接 |
| openLogDirectory | 打开日志目录 |
| testProxyConnection | 测试代理连接 |

---

## 四、FileDownloader — 独立文件下载器

独立于 snapfile-rs 的 Node.js 文件下载器，用于软件更新和缩略图下载等场景。

**核心能力**

| 能力 | 说明 |
|------|------|
| download | 下载文件，支持进度回调 |
| downloadFilePart | 分片下载（Range 请求），支持重试 |
| mergeSharding | 合并分片文件 |
| getFileSize | 获取远程文件大小（HEAD 请求） |
| getFileInfo | 获取文件信息（大小、支持 Range） |

**特性**

- 并发分片下载（默认 8 个连接）
- 支持代理
- 支持自定义请求头
- 支持断点续传
- 最大重试次数（默认 1）
- 可配置删除临时文件

---

## 五、智能格式选择引擎

这是 TaskService 中最复杂的逻辑，从 yt-dlp 返回的几十个格式中选择最优组合。

### 5.1 视频格式选择（selectVideoBySetting）

**选择流水线**

```
所有 formats[]
  ↓
过滤出有视频流的格式（vcodec != "none" 或 video_ext 存在）
  ↓
按分辨率分组（min(width, height) → 标准分辨率映射）
  ↓
匹配用户选择的分辨率（找最接近的，如 1080 → 选 1080 而非 720）
  ↓
按编码优先级分组
  ↓
选最高优先级编码（h264 > h265 > vp9 > av1）
  ↓
优先选含音频的格式（避免后续合并）
  ↓
选最高 FPS
  ↓
按文件大小过滤异常值
  ↓
取第一个（最优）格式
```

**编码优先级**

| 优先级 | 编码 | 理由 |
|--------|------|------|
| 1 | h264 / avc1 | 兼容性最好 |
| 2 | h265 / hevc / hev1 | 压缩率高但兼容性一般 |
| 3 | vp9 / vp09 | Google 编码，开源 |
| 4 | av01 / av1 | 最新编码，兼容性差 |
| 5 | 其他 | 最低优先级 |

**标准分辨率映射**

将非标准分辨率值（如 1078）映射到最近的标准化分辨率（1080）。

### 5.2 音频格式选择（selectAudioBySetting）

**选择流水线**

```
所有 formats[]
  ↓
过滤出纯音频格式（acodec != "none" 且 vcodec == "none"）
  ↓
按语言分组
  ↓
匹配用户设置的音轨语言偏好（支持 "all" 选择所有语言）
  ↓
无匹配时回退到默认语言
  ↓
每组内按比特率选最优
```

### 5.3 字幕格式选择（selectSubtitleBySetting）

**选择流水线**

```
合并手动字幕 + 自动字幕
  ↓
按语言匹配用户选择
  ↓
按格式优先级选择（srt > ass > vtt > json3 > ttml > srv1/2/3）
  ↓
URL 去重
```

### 5.4 直播流的特殊处理

当 `is_live === true` 时：
- 过滤掉 flv + hevc 格式（直播流兼容性问题）
- 不附加独立音轨（直接用视频流自带音频）
- 用户可主动停止录制（直播流不会自动结束）

**两种结束方式**

- 用户主动停止：点击停止录制 → 发送 stop-recording-live → snapfile 停止轮询 → 已下载的 segment 进入 ffmpeg 合并 → 输出截止到停止时间点的文件
- 远程端结束直播：主播关闭直播 → CDN 在 m3u8 追加 #EXT-X-ENDLIST → snapfile 轮询检测到 → 自然结束 → 已下载的 segment 进入 ffmpeg 合并 → 输出完整录制文件

**未完成的功能**

Electron 层构造 StartTaskPayload 时，live 字段被硬编码为 false（代码注释为“根据需要设置”）。task_live_detected 状态码在 Electron 层有映射处理，但 snapfile-rs 从不发送此状态码（仅 snapfile-go 有此能力）。

---

## 六、错误诊断系统

### 6.1 yt-dlp 错误分类

TaskService.parseTask 中对 yt-dlp 的错误消息进行关键词匹配，分类为不同的错误类型。

| 错误关键词 | 错误状态 | 错误消息 | 用户操作 |
|-----------|---------|---------|---------|
| `unsupported url` | unsupportedUrl | 不支持的网址 | 无 |
| `drm protection` | unsupportedUrl | 不支持的网址 | 无 |
| `douyin` + `fresh cookies` | unsupportedUrl | 不支持的网址 | 无 |
| `authentication` / `necessarily logged in` | extractError | 需要登录 | 显示登录按钮 |
| `no video formats found` | extractError | 无视频格式 | 无 |
| `establish a new connection` / `read time out` / `timeout` / `sslerror` / `httperror 403` | extractError | 网络/代理超时 | 检查代理 |
| `need to purchase` | extractError | 需要付费 | 登录付费账号 |
| `object has no attribute` / `request is blocked` | extractError | 服务器错误 | 重试 |
| `video unavailable` | extractError | 视频不可访问 | 检查链接 |
| 其他 | unknown_error | 未知错误 | 无 |

### 6.2 snapfile-rs 状态码映射

将 snapfile-rs 的状态码映射为 UI 层的错误状态枚举。

**错误状态集合**

```
unknown_event, task_already_started, unknown_error, prepare_error,
parse_m3u8_error, download_error, convert_error, move_error,
http_status_forbidden_error, disk_full, os_permission_denied, file_download_error
```

---

## 七、数据层

### 7.1 SQLite 数据库（better-sqlite3 + drizzle-orm）

**task 表**

| 字段 | 类型 | 说明 |
|------|------|------|
| id | TEXT PK | UUID |
| text | TEXT | 标题 |
| url | TEXT | 页面 URL |
| thumbnail | TEXT | 缩略图（base64） |
| request_headers | TEXT | 请求头 JSON |
| extension | TEXT | 文件扩展名 |
| duration | INTEGER | 时长（秒） |
| file_size | INTEGER | 文件大小 |
| file_path | TEXT | 保存路径 |
| resolution_width | INTEGER | 视频宽度 |
| resolution_height | INTEGER | 视频高度 |
| bitrate | INTEGER | 比特率 |
| task_status | TEXT | 任务状态枚举 |
| error_status | TEXT | 错误状态枚举 |
| error_message | TEXT | 错误消息枚举 |
| error_action | TEXT | 错误操作（如 login） |
| temp_task | TEXT | 临时任务数据 JSON |
| is_live | BOOLEAN | 是否直播 |
| created_at | INTEGER | 创建时间戳 |
| updated_at | INTEGER | 更新时间戳 |

**yt_dlp_version 表**

| 字段 | 类型 | 说明 |
|------|------|------|
| id | INTEGER PK | 固定为 1 |
| local_version | TEXT | 本地版本 |
| remote_version | TEXT | 远程最新版本 |
| download_url | TEXT | 下载地址 |
| last_check_time | INTEGER | 上次检查时间 |
| created_at | INTEGER | 创建时间 |

### 7.2 electron-store 配置（4 个）

**settingStore** — 用户设置（见 3.10）

**snifferStore** — 嗅探过滤规则
- extFilters：30+ 种扩展名过滤规则
- typeFilters：MIME 类型过滤规则
- regexFilters：正则表达式过滤规则

**urlBookmarkStore** — 网址书签
- 预设 8 个站点书签（YouTube、Twitter、Facebook、TikTok、Instagram、SoundCloud、Twitch、Spotify）

**ytDlpStore** — yt-dlp 更新状态
- status：idle / checking / downloading / updating / failed
- version：当前版本号

### 7.3 认证站点动态管理

authSites 存储在 settingStore 中，支持动态增删：

**预设站点**（enableDelete: false）
- YouTube、Instagram、Twitter

**用户自定义站点**（enableDelete: true）
- 用户输入 URL → tldjs 提取主域名 → 自动生成站点条目
- 添加时有特殊处理：youtu.be / youtube.com 归一化为 youtube.com，twitter.com / .x.com 归一化为 x.com
- 可删除，预设站点不可删除

---

## 八、IPC 通信层

使用 `@egoist/tipc` 实现类型安全的双向 IPC。

### 8.1 路由模块（7 个，40+ procedure）

| 路由模块 | procedure 数 | 核心接口 |
|---------|-------------|---------|
| authRoute | 8 | openAuthWindow, completeAuth, getAuthUrl, getAuthSites, addAuthSite, logoutAuthSite, deleteAuthSite |
| settingRoute | 2 | saveSetting, getSetting |
| snifferRoute | 7 | setupResourceSniffer, getSniffedResources, clearSniffedResources, downloadSniffedResources, getUrlBookmarks, addUrlBookmark, deleteUrlBookmark |
| systemRoute | 15+ | getAboutInfo, openFile, openFileDir, selectFileDir, getSystemLanguage, openExternalLink, checkSoftwareLatestVersion, downloadSoftwareUpdate, checkSoftwarePackageExists, installSoftwareUpdate, getLocalYtDlpVersion, updateYtDlp, closeWindow, testProxyConnection, openLogDirectory |
| taskRoute | 7 | startDownload, resumeDownload, getTaskList, deleteTask, deleteTaskList, interruptTasks, stopRecordingLive |
| videoAudioConverRoute | 3 | getMediaFormatConvertInfo, convertMediaFile, stopConvert |
| videoAudioMergeRoute | 3 | getFilesMediaInfo, mergeMedia, stopMergeTask |

### 8.2 Renderer Handlers（5 个事件推送通道）

主进程向渲染进程主动推送的事件：

| Handler | 数据 | 触发时机 |
|---------|------|---------|
| onDownloadProgress | `{ taskId, taskStatus, progress, speed, eta, errorStatus, errorMessage, isLive }` | 下载/转换进度更新、状态变更、错误 |
| onResourceSniffed | `MediaResource` | 嗅探到新的媒体资源 |
| onAppClose | `hasUnfinishedTasks: boolean` | 用户关闭窗口时 |
| onYtDlpUpdateStatus | `version, status` | yt-dlp 更新进度 |
| onSoftwareUpdateProgress | `{ success, totalSize, downloadedSize, filePath }` | 软件更新下载进度 |

---

## 九、完整下载流水线

### 9.1 正常下载流程

```
用户粘贴 URL
  │
  ▼
TaskService.saveTaskByUrls(urls)
  → 创建 task 记录（状态：extracting）
  │
  ▼
TaskService.parseTask(task)
  → YtDlpService.getParseInfo(url, taskId)
    → spawn yt-dlp --dump-json
    → 注入 --cookies（如有认证）
    → 注入 --proxy（如有代理）
  → 返回 VideoInfo JSON
  │
  ├── 解析失败 → 错误诊断 → 分类错误 → 推送 onDownloadProgress
  │
  ▼  解析成功
TaskService.getNeedDownloadItems(task, data, setting)
  → selectVideoBySetting — 视频格式选择
  → selectAudioBySetting — 音频格式选择
  → selectSubtitleBySetting — 字幕格式选择
  → 直播特殊处理（过滤 flv+hevc，不附加音轨）
  → 缩略图附加（如启用）
  → URL 去重
  → 返回 FileSpec[]
  │
  ▼
TaskService.downloadWithSnapfile(taskId, items, setting)
  → 创建临时目录
  → 检查/启动 snapfile-rs 进程
  → 下载缩略图（downloadThumbnail）
  → 构造 StartTaskPayload（含 proxy、outputDir、tempDir、files[]）
  → SnapfileService.startTask(payload, callbacks)
    → 写入 snapfile stdin
  │
  ▼
snapfile 处理
  → reqwest 多连接下载
  → ffmpeg 格式转换/合并
  → 移动到输出目录
  │
  ├── stdout JSON 事件
  │   ├── task_download_progress → onProgress → onDownloadProgress 推送
  │   ├── task_conversion_progress → onProgress → onDownloadProgress 推送
  │   ├── task_complete → onComplete → onDownloadProgress 推送
  │   └── *_error → onError → onDownloadProgress 推送
  │
  ▼
FFmpegService.startMergeConvert（如需）
  → 合并转换已下载文件
  → moveFiles → 移动到最终目录
  → 更新 task 状态为 completed
```

### 9.2 直播录制流程（需要 snapfile-go 或未来 snapfile-rs HLS）

**注意**：此功能依赖 snapfile-go 的 HLS 能力。snapfile-rs（Rust 重写版）不支持。

```
用户粘贴直播 URL（如 YouTube Live、Twitch）
  │
  ▼
yt-dlp --dump-json → is_live: true
  │
  ▼
格式选择：
  → 过滤 flv + hevc 格式
  → 不附加独立音轨（用视频流自带）
  │
  ▼
snapfile-go 收到 start-task（FileSpec.url = m3u8 地址）
  → 解析 HLS playlist
  → 检测 #EXT-X-PLAYLIST-TYPE
  → 直播模式：轮询下载新 segment（TS/M4S 分片）
  → 持续推送 task_download_progress
  → 发送 task_live_detected
  │
  ├── 结束方式 A：用户点击“停止录制”
  │     → stopRecordingLive(taskId)
  │     → snapfile-go stdin: stop-recording-live
  │     → 停止轮询
  │     → 已下载 segment 进入 ffmpeg 合并
  │     → 输出截止到停止时间点的文件
  │
  └── 结束方式 B：远程端结束直播
        → CDN 在 m3u8 追加 #EXT-X-ENDLIST
        → snapfile-go 轮询检测到 EndList → 自然结束
        → 已下载 segment 进入 ffmpeg 合并
        → 输出完整录制文件
```

### 9.3 资源嗅探下载流程

```
用户在嗅探浏览器中打开网页
  │
  ▼
ResourceSnifferService.setupForWebContents(webContentsId)
  → webRequest.onHeadersReceived 监听
  → 三层过滤（扩展名 / MIME / 正则）
  → 去重存储
  → onResourceSniffed 推送给前端
  │
  ▼
前端显示嗅探到的资源列表
  │
  ▼
用户选择资源点击下载
  → TaskService.saveSnifferTask(taskData)
  → 直接构造 FileSpec[]（已有直接 URL，无需 yt-dlp 解析）
  → downloadWithSnapfile()
  → snapfile-rs 下载
```

### 9.4 应用重启恢复流程

```
应用启动
  │
  ▼
检查中断任务（getInterruptTasks）
  → 查询 task 表中状态为 extracting/readyDownload/downloading/pendingConversion/converting 的任务
  │
  ▼
有中断任务：
  → 推送 onAppClose 逻辑（用户关闭时确认）
  → 弹窗"检测到上次有未完成的任务，是否继续？"
  → 用户确认 → resumeDownload
  → 用户取消 → 标记为 interrupted
```

---

## 十、初始化流程

应用启动时的初始化顺序：

```
app.whenReady()
  │
  ├── initLogger() — 初始化日志（electron-log）
  ├── initializeLibs()
  │   ├── initFFmpeg() — 检查/设置 ffmpeg + ffprobe
  │   ├── initDatabase() — 初始化 SQLite + drizzle-orm
  │   ├── ProxyService.setupProxy() — 设置代理
  │   ├── YtDlpService.checkYtDlpUpdate() — 检查 yt-dlp 更新
  │   └── initSnapfile() — 启动 snapfile 子进程（go 或 rust）
  │
  ▼
createMainWindow() — 创建主窗口
```

---

## 十一、前端架构（渲染进程）

基于打包产物推断：

| 维度 | 技术 |
|------|------|
| UI 框架 | React 18 |
| 路由 | React Router v7.2.0（HashRouter） |
| 构建工具 | Vite |
| IPC 客户端 | @egoist/tipc/renderer |

**路由**

| 路由 | 页面 |
|------|------|
| `/` | 下载页（Download） |
| `/auth?url=<encoded>` | 认证页（Auth，在认证窗口中加载） |

前端通过 tipc client 调用主进程 procedure，通过 tipc handler 接收主进程事件推送。

---

## 十二、服务间依赖关系

```
TaskService（编排中心）
  ├── YtDlpService（URL 解析）
  │     └── AuthService（Cookie 注入）
  │     └── ProxyService（代理）
  ├── SnapfileService（下载引擎）
  │     └── ProxyService（代理参数）
  ├── FFmpegService（合并转换）
  │     └── TaskService（状态更新）
  ├── SettingService（用户设置读取）
  └── TaskService 内部逻辑
        ├── 智能格式选择引擎
        ├── 错误诊断系统
        ├── 缩略图处理
        └── 直播处理

ResourceSnifferService（独立于 TaskService）
  → 嗅探结果通过 saveSnifferTask 交给 TaskService

VideoAudioConverService / VideoAudioMergeService（独立于下载流程）
  → 直接调用 ffmpeg，不走 snapfile-rs

SystemService（独立）
  → 软件更新、yt-dlp 更新、系统操作
```
