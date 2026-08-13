# SnapAny 逆向分析设计文档

## 1. 程序架构

### 1.1 技术栈

SnapAny 是一个基于 Electron 的视频下载工具，采用以下技术栈：

- **主框架**: Electron (Node.js + Chromium)
- **前端**: React 18 + TypeScript + Tailwind CSS + Flowbite React (编译后为单个 JS 文件)
- **后端逻辑**: Node.js (CommonJS 模块)
- **IPC**: @egoist/tipc (类型安全的 Electron IPC)
- **状态管理**: Zustand (前端) + SWR (数据获取)
- **本地数据库**: SQLite (better-sqlite3 + Drizzle ORM)
- **持久化**: electron-store (JSON 文件存储)
- **日志**: electron-log
- **遥测**: @aptabase/electron (使用统计), @sentry/electron (错误上报)
- **核心二进制**:
  - `yt-dlp` - URL 解析
  - `snapfile` (Go 编译) - 下载 + 转码引擎
  - `ffmpeg` / `ffprobe` - 媒体处理

### 1.2 文件结构

```
SnapAny.app/
├── Contents/
│   ├── MacOS/
│   │   └── SnapAny              # Electron 主程序
│   ├── Resources/
│   │   ├── app/                 # 解包后的 JS 代码（开发模式优先加载）
│   │   │   ├── out/
│   │   │   │   ├── main/
│   │   │   │   │   └── main.js  # 主进程逻辑 (~9524 行)
│   │   │   │   ├── preload/
│   │   │   │   │   └── preload.js
│   │   │   │   └── renderer/
│   │   │   │       └── assets/
│   │   │   │           └── index-*.js  # 前端 UI (~52000 行)
│   │   │   ├── drizzle/
│   │   │   │   ├── 0000_high_la_nuit.sql
│   │   │   │   ├── 0001_add_is_live_field.sql
│   │   │   │   └── meta/         # 迁移元数据
│   │   │   ├── node_modules/
│   │   │   └── package.json
│   │   ├── app.asar.unpacked/
│   │   │   ├── public/
│   │   │   │   └── bin/
│   │   │   │       ├── yt-dlp       # URL 解析器
│   │   │   │       ├── snapfile     # 下载引擎 (Go)
│   │   │   │       ├── ffmpeg       # 媒体转码
│   │   │   │       └── ffprobe      # 媒体信息读取
│   │   │   ├── better-sqlite3/
│   │   │   └── esbuild/
│   │   └── Electron Framework.framework/
│   └── _CodeSignature/
```

### 1.3 应用入口与初始化

主进程启动时并行初始化所有子系统：

```javascript
async function initializeLibs() {
  initLogger();
  await Promise.all([
    initSentry(),          // Sentry 错误监控
    initAptabase(),        // 使用统计 (设备ID + 事件追踪)
    initYtDlp(),           // 检查 yt-dlp 二进制 + 设置权限
    initFFmpeg(),          // 检查 ffmpeg/ffprobe + 设置权限 + 注册路径
    initDatabase(),        // SQLite 数据库迁移
    initTipc(),            // 注册所有 tRPC 路由
    YtDlpService.checkYtDlpUpdate(),  // 检查 yt-dlp 更新
    initSnapfile()         // 启动 snapfile 长驻进程
  ]);
}
```

snapfile 在 app 启动时就启动，作为长驻进程运行，通过 stdin/stdout 通信。

### 1.4 前端页面结构 (4 个 Tab)

```javascript
const applicationMenuRouter = [
  { key: "application.menu.download", path: "/download", element: <DownloadPage /> },
  { key: "application.menu.network",  path: "/network",  element: <NetworkPage /> },
  { key: "application.menu.format",   path: "/format",   element: <FormatPage /> },
  { key: "application.menu.merge",    path: "/merge",    element: <MergePage /> }
];
```

| Tab | 组件 | 功能 |
|---|---|---|
| Download | DownloadPage | 粘贴 URL → yt-dlp 解析 → snapfile 下载 |
| Online (Network) | NetworkPage | 内嵌 Webview 浏览器，嗅探网页中的媒体资源 |
| Convert (Format) | FormatPage | 本地媒体文件格式转换 (视频/音频/图片) |
| Merge | MergePage | 多个本地媒体文件合并 |

### 1.5 模块分工

```
┌──────────────────────────────────────────────────────────┐
│                    前端 (React + Zustand)                │
│                                                          │
│  DownloadPage     NetworkPage     FormatPage    MergePage│
│  - 粘贴URL        - Webview浏览器 - 文件选择    - 文件选择│
│  - 格式选择       - 资源嗅探       - 格式转换    - 流合并 │
│  - 下载进度       - 下载嗅探资源   - 转换进度    - 合并进度│
└──────────┬───────────────────────────────────────────────┘
           │ tRPC IPC (7 个路由组)
           ▼
┌──────────────────────────────────────────────────────────┐
│                 主进程 (Node.js main.js)                 │
│                                                          │
│  ┌─────────────┐  ┌──────────────┐  ┌────────────────┐  │
│  │ TaskService  │  │ AuthService  │  │ ProxyService   │  │
│  │ - 任务CRUD   │  │ - Cookie管理 │  │ - 系统代理设置 │  │
│  │ - 解析调度   │  │ - 登录验证   │  │ - SOCKS5测试   │  │
│  └──────┬──────┘  └──────────────┘  └────────────────┘  │
│         │                                                │
│  ┌──────┴──────┐  ┌──────────────┐  ┌────────────────┐  │
│  │ YtDlpService │  │ SnapfileSvc  │  │ FFmpegService  │  │
│  │ - spawn解析  │  │ - stdin/stdout│  │ - fluent-ffmpeg│  │
│  │ - 进程管理   │  │ - 任务管理    │  │ - 合并/转码    │  │
│  └──────┬──────┘  └──────┬───────┘  └────────────────┘  │
│         │                │                                │
│  ┌──────┴──────────┐    │   ┌───────────────────────┐   │
│  │ FileDownloader   │    │   │ VideoAudioConverSvc   │   │
│  │ - HTTP分片下载   │    │   │ - 格式转换队列         │   │
│  │ - 断点续传       │    │   └───────────────────────┘   │
│  └─────────────────┘    │   ┌───────────────────────┐   │
│                         │   │ VideoAudioMergeSvc    │   │
│  ┌──────────────────┐   │   │ - 流选择 + 合并        │   │
│  │ ResourceSniffer  │   │   └───────────────────────┘   │
│  │ - 网络请求拦截   │   │                                │
│  │ - 媒体类型过滤   │   │   ┌───────────────────────┐   │
│  └──────────────────┘   │   │ SettingService        │   │
│                         │   │ - 配置读写             │   │
│  ┌──────────────────┐   │   └───────────────────────┘   │
│  │ SystemService    │   │                                │
│  │ - 版本检查       │   │   ┌───────────────────────┐   │
│  │ - 软件更新下载   │   │   │ SQLite (Drizzle ORM)  │   │
│  │ - yt-dlp更新     │   │   │ - task 表              │   │
│  └──────────────────┘   │   └───────────────────────┘   │
└─────────────────────────┼────────────────────────────────┘
                          │ stdin/stdout (JSON 行)
                          ▼
┌──────────────────────────────────────────────────────────┐
│              snapfile (Go 二进制, 长驻进程)              │
│                                                          │
│  内部模块 (从 stderr 日志推断):                          │
│  - internal/stage/runner.go        - 任务调度器          │
│  - internal/stage/downloader/      - HTTP 下载           │
│  - internal/stage/converter/       - ffmpeg 转码/合并    │
│  - internal/stage/move/            - 文件移动            │
│  - pkg/ffmpeg/ffprobe.go           - ffprobe 调用        │
│                                                          │
│  功能:                                                   │
│  - HTTP 下载 (分片、断点续传)                            │
│  - 并发控制 (maxDownloadingTasks, 默认 5)                │
│  - 调用 ffmpeg 合并视频+音频                             │
│  - 调用 ffmpeg 转码 (如 AAC → MP3)                      │
│  - 文件移动到最终目录                                    │
│  - 进程崩溃自动重启 (最多 3 次)                          │
└────────────────────────┬─────────────────────────────────┘
                         │ 调用
                         ▼
┌──────────────────────────────────────────────────────────┐
│                  ffmpeg / ffprobe                        │
│  - 视频+音频合并 (-c:v copy -c:a copy)                   │
│  - 格式转换 (AAC → MP3 用 libmp3lame)                    │
│  - 读取媒体元数据 (ffprobe -print_format json)           │
│  - 转换进度上报 (-progress pipe:1)                       │
└──────────────────────────────────────────────────────────┘
```

## 2. Service 类详解

### 2.1 所有 Service 和 Route 一览

| Service 类 | Route 组 | 关联 Tab | 功能 |
|---|---|---|---|
| YtDlpService | taskRoute | Download | spawn yt-dlp 解析 URL |
| SnapfileService | (内部) | Download/Online | 管理 snapfile 进程通信 |
| TaskService | taskRoute | Download/Online | 任务 CRUD + 下载调度 |
| AuthService | authRoute | Settings | Cookie 管理与登录验证 |
| SettingService | settingRoute | Settings | 配置读写 |
| ProxyService | (内部) | Settings | 代理配置 |
| SystemService | systemRoute | Settings/About | 版本检查、更新、文件操作 |
| ResourceSnifferService | snifferRoute | Online | Webview 网络请求嗅探 |
| FFmpegService | (内部) | Download | fluent-ffmpeg 封装 |
| VideoAudioConverService | videoAudioConverRoute | Convert | 本地文件格式转换 |
| VideoAudioMergeService | videoAudioMergeRoute | Merge | 本地媒体流合并 |

### 2.2 YtDlpService

**职责**: 通过本地 yt-dlp 二进制解析视频 URL

**解析参数** (`getParseInfo`):
```bash
yt-dlp <url> \
  --dump-json \
  --no-check-certificates \
  --no-warnings \
  --no-playlist \
  --ignore-errors \
  --ignore-config \
  --no-cache-dir \
  --prefer-insecure \
  --extractor-args "generic:extract_flat=true" \
  --add-header "User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ..." \
  --add-header "Accept: text/html,application/xhtml+xml,..." \
  --add-header "Accept-Language: zh-CN,zh;q=0.9,en;q=0.8" \
  --retries 3 \
  --socket-timeout 10 \
  --format-sort "res,ext:mp4:m4a"
```

**代理**: 读取 settingStore 的 proxy 配置，非 system 模式时追加 `--proxy` 参数
**Cookie**: 读取 cookies.txt 文件路径，存在时追加 `--cookies` 参数
**进程管理**: 每个 taskID 对应一个 yt-dlp 进程，存储在 `ytDlpProcesses` Map 中，可按 taskID 取消

**返回 JSON 结构** (关键字段):
```json
{
  "title": "视频标题",
  "thumbnail": "https://...",
  "formats": [
    {
      "format_id": "30280",
      "url": "https://cdn.../30280.m4s?token=...",
      "ext": "m4a",
      "acodec": "mp4a.40.2",
      "vcodec": "none",
      "abr": 204,
      "http_headers": {"Referer": "https://www.bilibili.com/..."}
    }
  ],
  "is_live": false
}
```

### 2.3 TaskService

**职责**: 任务全生命周期管理

**数据库表** (SQLite `task` 表):
| 字段 | 类型 | 说明 |
|---|---|---|
| id | text PK | UUID |
| text | text | 视频标题 |
| url | text | 原始 URL |
| filePath | text | 最终文件路径 |
| fileSize | integer | 文件大小 (字节) |
| taskStatus | text | extracting/readyDownload/downloading/pendingConversion/converting/completed/failed |
| errorStatus | text | 错误类型 |
| errorMessage | text | 错误消息 |
| tempTask | text | JSON: 临时任务信息 (title, thumbnail, items, setting) |
| thumbnail | text | base64 缩略图 |
| extension | text | 文件扩展名 |
| duration | integer | 时长 (秒) |
| resolutionWidth | integer | 分辨率宽 |
| resolutionHeight | integer | 分辨率高 |
| bitrate | integer | 比特率 (bps) |
| isLive | boolean | 是否直播 |
| createdAt | integer | 创建时间戳 |
| updatedAt | integer | 更新时间戳 |

**关键方法**:
- `saveTaskByUrls(urls)`: 为每个 URL 创建任务，状态 `extracting`
- `parseTask(task)`: 调用 yt-dlp 解析，处理各种错误（不支持URL/需登录/超时/需购买等）
- `getNeedDownloadItems(task, data, setting)`: 从 yt-dlp 结果选择下载项
- `downloadWithSnapfile(taskId, items, setting)`: 构造 snapfile 任务并提交
- `downloadThumbnail(taskId, path)`: 下载缩略图并转 base64

**下载项选择逻辑** (`getNeedDownloadItems`):

1. 如果 `data.direct && data.url`: 直接下载 (直链模式)
2. 视频模式:
   - `selectVideoBySetting()`: 按分辨率选视频轨
   - `selectAudioBySetting()`: 按语言和码率选音频轨
   - `selectSubtitleBySetting()`: 按语言选字幕
   - 如果视频轨无音频 (`acode: none`), 补充音频轨
3. 音频模式: 只选音频轨
4. 缩略图: 如果 `isDownloadThumbnail=true`, 追加为 `optionalDownload` 项

**音频选择逻辑** (`filterAudioFormats`):

```
1. 按 codec 优先级过滤:
   - m4a 格式优先: aac > mp4a > m4a > mp3 > opus
   - mp3 格式优先: mp3 > aac > mp4a > m4a > opus
   - ogg 格式优先: opus > aac > mp4a > m4a > mp3

2. 码率选择:
   - 如果 bitrate 是数字: 选 abr 最接近的格式 (补丁后新增)
   - 如果 bitrate 是 "highest": 选最高码率档
```

### 2.4 SnapfileService

**职责**: 管理 snapfile 进程的启动、通信、容错

**继承**: `extends EventEmitter`

**进程容错**:
- 进程退出时自动重启 (最多 3 次, 间隔 2 秒)
- 重启后将活跃任务移至 pending 队列，重启成功后重新发送
- 主动关闭时不重启 (`isShuttingDown` 标志)

**通信**:
- `sendEvent(event)`: JSON.stringify → stdin.write
- `setupEventHandlers()`: stdout 按行读取 JSON → `handleSnapfileResponse()`
- 非 JSON 行记录为日志

**任务管理**:
- `activeTasks`: Map<taskID, payload>
- `pendingTasks`: Array (进程不可用时排队)
- `taskCallbacks`: Map<taskID, {onProgress, onComplete, onError, onStatusChange}>

### 2.5 AuthService

**职责**: 管理网站登录 Cookie

**Cookie 存储**: `{userData}/cookies.txt` (Netscape Cookie File 格式)

**登录验证** (`verifyLogin`):
- YouTube: 检查 `LOGIN_INFO` / `APISID` / `SID`
- Instagram: 检查 `sessionid` / `ds_user_id`
- Twitter/X: 检查 `auth_token` / `twid`
- 其他: 只要有 Cookie 就算已登录

**Cookie 文件格式**:
```
# Netscape HTTP Cookie File
# This file is generated by yt-dlp.  Do not edit.
.youtube.com  TRUE  /  TRUE  1234567890  SID  xxx
```

**使用方式**: yt-dlp 解析时追加 `--cookies {cookies.txt}` 参数，获取需要登录才能访问的视频信息。

**与 snapfile 的关系**: snapfile 不直接使用 Cookie。Cookie 只传给 yt-dlp，yt-dlp 解析出的直链 URL 已包含认证签名。

### 2.6 ProxyService

**职责**: 代理配置

**支持的代理类型**:
- `system`: 系统代理 (Electron `session.setProxy`)
- `direct`: 直连
- `http`: HTTP 代理 (`http://host:port` 或 `http://user:pass@host:port`)
- `socks5`: SOCKS5 代理 (`socks5://host:port`)

**代理使用**:
- Electron Webview: `session.defaultSession.setProxy()`
- yt-dlp: `--proxy` 参数
- snapfile: `proxy` 字段 ("system"/"direct"/"http://...")

**代理测试**:
- HTTP: CONNECT 请求测试
- SOCKS5: 完整握手 + 可选认证测试

### 2.7 ResourceSnifferService (Online Tab)

**职责**: 在内置 Webview 浏览器中嗅探媒体资源

**工作原理**:
1. 监听 `webContents.session.webRequest` 事件
2. 拦截所有 HTTP 请求和响应
3. 按扩展名 (mp4, m4a, ts, m3u8...) / MIME 类型 / 正则过滤
4. 去重并展示给用户
5. 用户选择后，调用 `downloadSniffedResource()` → 跳过 yt-dlp → 直接调 snapfile 下载

**过滤规则** (存储在 `sniffer` Store):
- 扩展名过滤: flv, mp4, m4a, m3u8, ts, webm, mkv, avi, mp3, aac, opus 等 30 种
- MIME 类型过滤: audio/\*, video/\*, application/dash+xml 等
- 正则过滤: bilibili 直播流屏蔽等

### 2.8 VideoAudioConverService (Convert Tab)

**职责**: 本地媒体文件格式转换

**支持的转换**:
- 视频: MP4, MKV, MOV, WebM, AVI, MPEG, WMV, FLV, TS
- 音频: MP3, AAC, WAV, FLAC, ALAC, M4A, OGG, WMA
- 图片: JPEG, PNG, GIF, BMP, WebP, TIFF, HEIF

**实现**: 使用 fluent-ffmpeg 库，任务队列串行处理，每次只转换一个文件

### 2.9 VideoAudioMergeService (Merge Tab)

**职责**: 多个本地媒体文件的流合并

**实现**:
1. ffprobe 读取每个文件的流信息
2. 用户选择要合并的流 (视频流/音频流/字幕流)
3. 构造 ffmpeg 命令，`-map` 选择流
4. 智能转码检测: 如果视频非 H.264/HEVC 则转码为 H.264，如果音频非 AAC/MP3 则转码为 AAC
5. MKV 输出使用 `-c:v copy -c:a copy -c:s srt`
6. MP4 输出使用 `-c:s mov_text`

## 3. tRPC IPC 路由完整列表

### 3.1 authRoute (认证路由)

| 方法 | 功能 |
|---|---|
| `openAuthWindow({url})` | 打开登录窗口 (Electron BrowserWindow) |
| `closeAuthWindow()` | 关闭登录窗口 |
| `completeAuth({url})` | 完成登录: 验证 + 保存 Cookie + 更新 authSites |
| `getAuthUrl()` | 获取当前认证 URL |

### 3.2 settingRoute (设置路由)

| 方法 | 功能 |
|---|---|
| `saveSetting(input)` | 保存设置 + 重设代理 |
| `getSetting()` | 获取全部设置 |

### 3.3 taskRoute (任务路由)

| 方法 | 功能 |
|---|---|
| `startDownload({urls})` | 创建任务 + yt-dlp 解析 + snapfile 下载 |
| `resumeDownload({taskId})` | 恢复中断的任务 |
| `getTaskList()` | 获取任务列表 |
| `deleteTask({taskId})` | 删除任务 (取消 yt-dlp + snapfile 进程) |
| `deleteTaskList({isDeleteDownloading})` | 删除所有任务 |
| `cancelTaskList()` | 取消所有进行中的任务 |
| `openFile({filePath})` | 打开文件 |
| `openFileDir({filePath})` | 在 Finder 中显示 |
| `retryTask(task)` | 重试失败的任务 |

### 3.4 systemRoute (系统路由)

| 方法 | 功能 |
|---|---|
| `getAboutInfo()` | 版本信息 + 网站 |
| `openFile({filePath})` | 打开文件 |
| `openFileDir({filePath})` | 在 Finder 中显示 |
| `selectFileDir()` | 选择下载保存目录 |
| `getSystemLanguage()` | 获取系统语言 |
| `openExternalLink({url})` | 打开外部链接 |
| `getAuthSites()` | 获取授权站点列表 |
| `addAuthSite({authUrl})` | 添加授权站点 |
| `logoutAuthSite({url})` | 登出站点 (删除 Cookie) |
| `deleteAuthSite({name})` | 删除授权站点 |
| `checkSoftwareLatestVersion()` | 检查软件更新 |
| `downloadSoftwareUpdate({url})` | 下载更新包 |
| `checkSoftwarePackageExists({version})` | 检查更新包是否已下载 |
| `installSoftwareUpdate({filePath})` | 安装更新 |
| `getLocalYtDlpVersion()` | 获取 yt-dlp 版本和状态 |
| `updateYtDlp()` | 更新 yt-dlp |
| `closeWindow()` | 停止 snapfile + 退出 |
| `testProxyConnection({type, ...})` | 代理连通性测试 |
| `openLogDirectory()` | 打开日志目录 |

### 3.5 snifferRoute (嗅探路由)

| 方法 | 功能 |
|---|---|
| `setupResourceSniffer({webContentsId})` | 为 Webview 设置资源嗅探 |
| `getSniffedResources()` | 获取嗅探到的资源 |
| `clearSniffedResources()` | 清除嗅探资源 |
| `downloadSniffedResources({snifferMediaDownloadInfo})` | 下载嗅探到的资源 |
| `getUrlBookmarks()` | 获取 URL 书签 |
| `addUrlBookmark({url, title})` | 添加 URL 书签 |
| `deleteUrlBookmark({url})` | 删除 URL 书签 |

### 3.6 videoAudioConverRoute (格式转换路由)

| 方法 | 功能 |
|---|---|
| `getMediaFormatConvertInfo({filePaths, format})` | 获取文件信息 |
| `convertMediaFile({filePaths, outputFormat, extraParams})` | 转换文件 |
| `stopConvert()` | 停止转换 |

### 3.7 videoAudioMergeRoute (合并路由)

| 方法 | 功能 |
|---|---|
| `getFilesMediaInfo({filePaths})` | 获取文件流信息 |
| `mergeMedia({input})` | 合并媒体流 |
| `stopMergeTask()` | 停止合并 |

## 4. 持久化存储

### 4.1 electron-store (JSON 文件)

| Store 名称 | 文件路径 | 内容 |
|---|---|---|
| setting | `{userData}/setting.json` | 下载路径、格式、码率、代理、授权站点等 |
| sniffer | `{userData}/sniffer.json` | 资源嗅探过滤规则 |
| urlBookmark | `{userData}/urlBookmark.json` | URL 书签列表 |
| yt-dlp-status | `{userData}/yt-dlp-status.json` | yt-dlp 版本和状态 |

**setting.json 默认值**:
```json
{
  "downloadPath": "~/Downloads",
  "downloadType": "video",
  "videoConfig": {
    "format": {"format": "mp4", "platform": null},
    "resolution": 1080
  },
  "audioConfig": {
    "format": {"format": "mp3", "platform": null},
    "bitrate": 128
  },
  "maxConcurrentDownloads": 8,
  "createSubfolder": false,
  "addIndexToFile": false,
  "embedSubtitle": true,
  "proxy": {"type": "system"},
  "isDownloadThumbnail": false,
  "language": "system",
  "authSites": [
    {"name": "YouTube", "url": "https://www.youtube.com", "authUrl": "...", "isAuthorized": false},
    {"name": "Instagram", "url": "https://www.instagram.com", ...},
    {"name": "Twitter", "url": "https://x.com", ...}
  ]
}
```

### 4.2 SQLite 数据库

路径: `{userData}/data.db`

只有一张 `task` 表，存储所有下载任务。

### 4.3 Cookie 文件

路径: `{userData}/cookies.txt`

Netscape Cookie File 格式，供 yt-dlp 使用。

## 5. 数据流与生命周期

### 5.1 Download Tab 完整流程

```
用户粘贴 URL
    │
    ├─ 1 个 URL → 直接下载
    └─ 多个 URL → 弹出多选确认框 (最多 10 个)
         │
         ▼
taskRoute.startDownload({urls})
         │
         ▼
TaskService.saveTaskByUrls(urls)
    为每个 URL 创建 task 记录 (status: extracting)
         │
         ▼ (并行，无并发控制)
TaskService.parseTask(task)
         │
         ▼
YtDlpService.getParseInfo(url, taskId)
    spawn yt-dlp --dump-json <url>
         │
         ▼
返回 JSON (title, formats[], thumbnail, ...)
         │
         ▼
TaskService.getNeedDownloadItems(task, data, setting)
    根据设置选择视频轨 + 音频轨 (+ 字幕 + 缩略图)
         │
         ▼
TaskService.downloadWithSnapfile(taskId, items, setting)
    构造 snapfileTask 对象
         │
         ▼
SnapfileService.startTask(snapfileTask, callbacks)
    通过 stdin 发送给 snapfile
         │
         ▼
snapfile 内部: 下载 → [转码/合并] → 移动文件
    通过 stdout 回传进度和状态
         │
         ▼
callbacks.onProgress → 更新 UI 进度条
callbacks.onComplete → 更新数据库 + UI
callbacks.onError → 更新错误状态 + UI
```

### 5.2 Online Tab 流程

```
用户在内置 Webview 中浏览网页
         │
         ▼
ResourceSnifferService 拦截所有网络请求
         │
         ▼
按 扩展名/MIME/正则 过滤媒体资源
         │
         ▼
用户选择资源 → downloadSniffedResources()
         │
         ▼
downloadSniffedResource(url, title, headers)
    跳过 yt-dlp 解析，直接构造 task
         │
         ▼
TaskService.downloadWithSnapfile(taskId, [downloadItem], setting)
```

### 5.3 Convert Tab 流程

```
用户选择本地文件
         │
         ▼
videoAudioConverRoute.getMediaFormatConvertInfo({filePaths, format})
    ffprobe 读取文件信息
         │
         ▼
用户选择输出格式
         │
         ▼
videoAudioConverRoute.convertMediaFile({filePaths, outputFormat, extraParams})
         │
         ▼
VideoAudioConverService.convertMediaFiles()
    任务队列串行处理，每次一个文件
         │
         ▼
fluent-ffmpeg 执行转码
         │
         ▼
进度通过 onVideoAudioConverProgress 回传 UI
```

### 5.4 Merge Tab 流程

```
用户选择多个本地文件
         │
         ▼
videoAudioMergeRoute.getFilesMediaInfo({filePaths})
    ffprobe 读取所有文件的流信息
         │
         ▼
用户选择要合并的流 (视频/音频/字幕)
         │
         ▼
videoAudioMergeRoute.mergeMedia({input})
         │
         ▼
VideoAudioMergeService.mergeMediaStreams()
    智能检测是否需要转码
    构造 ffmpeg 命令 (-map + -c copy/transcode)
         │
         ▼
ffmpeg 执行合并
         │
         ▼
进度通过 onVideoAudioMergeProgress 回传 UI
```

### 5.5 三种下载模式详解

#### 模式 1: 视频下载 (outputType: "video")

**snapfile 输入**:
```json
{
  "outputType": "video",
  "outputVideoFormat": "mp4",
  "files": [
    {"url": "视频轨.m4s", "header": {"Referer": "..."}},
    {"url": "音频轨.m4s", "header": {"Referer": "..."}}
  ]
}
```

**snapfile 行为**:
1. 下载两个文件到 `{tempDir}/{taskID}/download/{md5(url)}.m4s`
2. ffprobe 检查流信息
3. ffmpeg 合并:
   ```bash
   ffmpeg -i video.m4s -i audio.m4s \
          -progress pipe:1 \
          -map 0:v:0 -map 1:a:0 \
          -movflags +faststart \
          -c:v copy -c:a copy \
          -y output.mp4
   ```
4. 移动到 `{outputDir}/{name}.mp4`

#### 模式 2: 音频下载 → M4A

**snapfile 输入**:
```json
{
  "outputType": "audio",
  "outputAudioFormat": "m4a",
  "files": [{"url": "音频轨.m4s", "header": {"Referer": "..."}}]
}
```

**snapfile 行为**:
1. 下载音频文件
2. 直接重命名/封装为 .m4a (不经过转码阶段)
3. 移动到 `{outputDir}/{name}.m4a`

#### 模式 3: 音频下载 → MP3

**snapfile 输入**:
```json
{
  "outputType": "audio",
  "outputAudioFormat": "mp3",
  "files": [{"url": "音频轨.m4s", "header": {"Referer": "..."}}]
}
```

**snapfile 行为**:
1. 下载音频文件
2. ffprobe 检查流信息
3. ffmpeg 转码:
   ```bash
   ffmpeg -i input.m4s \
          -progress pipe:1 \
          -map 0:a:0 \
          -c:a libmp3lame \
          output.mp3 -y
   ```
   **注意**: 没有 `-b:a` 参数，使用 ffmpeg 默认码率 (约 128kbps)
4. 移动到 `{outputDir}/{name}.mp3`

### 5.6 任务状态机

**JS 层状态** (`taskStatus`):
```
extracting → readyDownload → downloading → pendingConversion → converting → completed
                ↓                ↓               ↓                  ↓
              failed           failed         failed             failed
```

**snapfile 层状态** (`SnapfileStatusCode`):
```
task_started
    ↓
task_start_prepare
    ↓
task_prepared
    ↓
task_pending_download
    ↓
task_start_download
    ↓
[多次 task_download_progress]
    ↓
task_downloaded
    ↓
[如果需要转码/合并]
    ↓
task_pending_conversion
    ↓
task_start_conversion
    ↓
[多次 task_conversion_progress]
    ↓
task_converted
    ↓
task_start_move
    ↓
task_moved
    ↓
task_complete
```

**状态映射** (`SnapfileStatusMapping`):
| snapfile 状态 | JS taskStatus |
|---|---|
| task_started, task_start_prepare, task_prepared, task_pending_download | readyDownload |
| task_start_download, task_downloaded | downloading |
| task_pending_conversion | pendingConversion |
| task_start_conversion, task_converted, task_start_move, task_moved | converting |

## 6. snapfile 协议规范

### 6.1 启动参数

```bash
snapfile \
  --ffmpeg-path /path/to/ffmpeg \
  --ffprobe-path /path/to/ffprobe \
  --max-downloading-task 5 \
  --log-level debug
```

### 6.2 输入协议 (stdin)

JSON 行格式，每行一个 JSON 对象。

#### start-task

```json
{
  "type": "start-task",
  "payload": {
    "taskID": "uuid-string",
    "name": "视频标题",
    "outputDir": "/Users/steve/Downloads",
    "tempDir": "/Users/steve/Downloads/.snapany/{taskID}",
    "outputType": "video|audio",
    "outputVideoFormat": "mp4|mkv",
    "outputAudioFormat": "mp3|m4a|ogg",
    "live": false,
    "embeddedSubtitle": true,
    "proxy": "system|direct|http://...",
    "files": [
      {
        "url": "https://cdn.example.com/video.m4s?token=...",
        "language": null,
        "header": {
          "Referer": "https://www.bilibili.com/...",
          "User-Agent": "...",
          "Cookie": "..."
        }
      }
    ]
  }
}
```

#### delete-task

```json
{
  "type": "delete-task",
  "payload": {"taskIDs": ["uuid1", "uuid2"]}
}
```

#### update-max-download-task

```json
{
  "type": "update-max-download-task",
  "payload": {"limit": 8}
}
```

#### stop-recording-live

```json
{
  "type": "stop-recording-live",
  "payload": {"taskID": "uuid"}
}
```

### 6.3 输出协议 (stdout)

#### 状态变更

```json
{"code":"task_started","data":{"taskID":"uuid"},"message":"任务已启动"}
{"code":"task_start_prepare","data":{"taskID":"uuid"},"message":"任务开始预处理"}
{"code":"task_prepared","data":{"taskID":"uuid"},"message":"任务预处理完成"}
{"code":"task_pending_download","data":{"taskID":"uuid"},"message":"等待下载"}
{"code":"task_start_download","data":{"taskID":"uuid"},"message":"任务开始下载"}
{"code":"task_downloaded","data":{"taskID":"uuid"},"message":"任务下载完成"}
{"code":"task_pending_conversion","data":{"taskID":"uuid"},"message":"任务等待转换"}
{"code":"task_start_conversion","data":{"taskID":"uuid"},"message":"任务开始转换"}
{"code":"task_converted","data":{"taskID":"uuid"},"message":"任务转换完成"}
{"code":"task_start_move","data":{"taskID":"uuid"},"message":"任务开始移动"}
{"code":"task_moved","data":{"taskID":"uuid"},"message":"任务移动完成"}
{"code":"task_complete","data":{"taskID":"uuid","files":["/path/to/output.mp4"]},"message":"任务完成"}
{"code":"task_deleted","data":{"taskID":"uuid"},"message":"任务已删除"}
```

#### 下载进度 (每秒)

```json
{
  "code": "task_download_progress",
  "data": {"taskID":"uuid","done":4666945,"total":47592128,"speed":4666945,"remainingTime":9},
  "message": "更新下载进度"
}
```

#### 转换进度 (每秒)

```json
{
  "code": "task_conversion_progress",
  "data": {"taskID":"uuid","done":30172494,"total":492959410,"speed":30172494,"remainingTime":15},
  "message": "更新转换进度"
}
```

#### 错误

```json
{
  "code": "file_download_error",
  "data": {"taskID":"uuid","url":"https://..."},
  "message": "文件下载错误"
}
```

**错误码完整列表**:
- `unknown_event`: 未知事件
- `task_already_started`: 任务已开始
- `unknown_error`: 未知错误
- `prepare_error`: 预处理阶段错误
- `parse_m3u8_error`: M3U8 解析错误
- `download_error`: 下载阶段错误
- `convert_error`: 转换阶段错误
- `move_error`: 文件移动错误
- `http_status_forbidden_error`: HTTP 403
- `disk_full`: 磁盘已满
- `os_permission_denied`: 权限不足
- `file_download_error`: 单个文件下载失败 (不终止任务)

### 6.4 stderr 输出

结构化日志 (Go slog 格式):

```
time=2026-08-07T16:42:57.669+08:00 level=DEBUG \
  source=/Users/zhf/development/code/golang/snapfile/pkg/ffmpeg/ffprobe.go:113 \
  msg=获取流信息 \
  cmd=".../ffprobe -v quiet -print_format json -show_format -show_streams .../download/file.m4s" \
  taskID=uuid
```

**推断的 Go 源码结构**:
```
snapfile/
├── internal/
│   ├── stage/
│   │   ├── runner.go              # 任务调度器
│   │   ├── downloader/
│   │   │   └── download.go        # HTTP 下载
│   │   ├── converter/
│   │   │   └── converter.go       # ffmpeg 转码/合并
│   │   └── move/
│   │       └── move.go            # 文件移动
│   └── ...
├── pkg/
│   └── ffmpeg/
│       └── ffprobe.go             # ffprobe 调用
├── cmd/
│   └── main.go                    # 入口, CLI 参数解析
└── go.mod
```

### 6.5 snapfile 临时目录结构

```
{tempDir}/{taskID}/
├── {taskID}/
│   └── download/
│       ├── {md5(url1)}.m4s           # 下载的文件
│       └── {md5(url2)}.m4s
│   └── converting/
│       └── {md5(name)}.{ext}         # 转码中的文件
│   └── converted/
│       └── {md5(name)}.{ext}         # 转码完成的文件
└── (完成后删除)
```

## 7. 实际日志样本

### 7.1 视频下载完整流程

**stdin**:
```json
{
  "type": "start-task",
  "payload": {
    "taskID": "a83f3966-8070-4d3b-bcd5-19506c1942da",
    "name": "这一年，我把所有想做的事都做完了",
    "outputDir": "/Users/steve/Downloads",
    "tempDir": "/Users/steve/Downloads/.snapany/a83f3966-...",
    "outputType": "video",
    "outputVideoFormat": "mp4",
    "outputAudioFormat": "mp3",
    "live": false,
    "embeddedSubtitle": true,
    "proxy": "system",
    "files": [
      {"url": "https://cn-gdgz-gd-bcache-18.bilivideo.com/.../30032.m4s?...", "header": {"Referer": "..."}},
      {"url": "https://cn-gdgz-gd-live-02.bilivideo.com/.../30216.m4s?...", "language": null, "header": {"Referer": "..."}}
    ]
  }
}
```

**stdout** (完整生命周期):
```json
{"code":"task_started","data":{"taskID":"a83f3966-..."},"message":"任务已启动"}
{"code":"task_start_prepare","data":{"taskID":"a83f3966-..."},"message":"任务开始预处理"}
{"code":"task_prepared","data":{"taskID":"a83f3966-..."},"message":"任务预处理完成"}
{"code":"task_pending_download","data":{"taskID":"a83f3966-..."},"message":"等待下载"}
{"code":"task_start_download","data":{"taskID":"a83f3966-..."},"message":"任务开始下载"}
{"code":"task_download_progress","data":{"done":4666945,"remainingTime":9,"speed":4666945,"taskID":"a83f3966-...","total":47592128},"message":"更新下载进度"}
{"code":"task_download_progress","data":{"done":12727855,"remainingTime":4,"speed":8060910,"taskID":"a83f3966-...","total":47592128},"message":"更新下载进度"}
{"code":"task_download_progress","data":{"done":21232523,"remainingTime":3,"speed":8504668,"taskID":"a83f3966-...","total":47592128},"message":"更新下载进度"}
{"code":"task_download_progress","data":{"done":29637203,"remainingTime":2,"speed":8404680,"taskID":"a83f3966-...","total":47592128},"message":"更新下载进度"}
{"code":"task_download_progress","data":{"done":39623880,"remainingTime":0,"speed":9986677,"taskID":"a83f3966-...","total":47592128},"message":"更新下载进度"}
{"code":"task_downloaded","data":{"taskID":"a83f3966-..."},"message":"任务下载完成"}
{"code":"task_pending_conversion","data":{"taskID":"a83f3966-..."},"message":"任务等待转换"}
{"code":"task_start_conversion","data":{"taskID":"a83f3966-..."},"message":"任务开始转换"}
{"code":"task_converted","data":{"taskID":"a83f3966-..."},"message":"任务转换完成"}
{"code":"task_start_move","data":{"taskID":"a83f3966-..."},"message":"任务开始移动"}
{"code":"task_moved","data":{"taskID":"a83f3966-..."},"message":"任务移动完成"}
{"code":"task_complete","data":{"files":["/Users/steve/Downloads/这一年，我把所有想做的事都做完了.mp4"],"taskID":"a83f3966-..."},"message":"任务完成"}
```

**stderr** (ffmpeg 调用):
```
# 1. ffprobe 检查视频流
cmd="ffprobe -v quiet -print_format json -show_format -show_streams video.m4s"

# 2. ffprobe 检查音频流
cmd="ffprobe -v quiet -print_format json -show_format -show_streams audio_first.m4s"

# 3. ffmpeg 合并 (copy 模式，不重新编码)
cmd="ffmpeg -i audio_first.m4s -i video.m4s \
     -progress pipe:1 \
     -map 0:v:0 -map 1:a:0 \
     -movflags +faststart \
     -c:v copy -c:a copy \
     -y output.mp4"

# 4. 移动文件
pending_move_file_path=.../converted/output.mp4
output_file_path=/Users/steve/Downloads/这一年，我把所有想做的事都做完了.mp4
```

### 7.2 音频转码 MP3 流程

**stderr** (ffmpeg 命令):
```
# 1. ffprobe 检查音频流
cmd="ffprobe -v quiet -print_format json -show_format -show_streams input.m4s"

# 2. ffmpeg 转码 (libmp3lame，无码率参数)
cmd="ffmpeg -i input.m4s \
     -progress pipe:1 \
     -map 0:a:0 \
     -c:a libmp3lame \
     output.mp3 -y"
```

**关键发现**: ffmpeg 命令中没有 `-b:a` 参数，使用 ffmpeg 默认码率。

## 8. 网络请求清单

### 8.1 发往远程服务器的请求

| 请求 | 目的地 | 用途 | 触发时机 |
|---|---|---|---|
| `GET api.snapany.com/desktop/info` | SnapAny API | 版本检查 + yt-dlp 下载地址 | 启动时检查更新 |
| `GET api.snapany.com/desktop/favicon/{加密payload}` | SnapAny API | 获取网站 favicon | UI 展示 |
| Sentry SDK | `o849894.ingest.us.sentry.io` | 崩溃/错误上报 | 全局错误捕获 |
| Aptabase SDK | Aptabase 云端 | 使用统计 | 启动、解析成功/失败、下载成功/失败 |

### 8.2 本地请求

| 请求 | 目标 | 用途 |
|---|---|---|
| yt-dlp spawn | 本地二进制 | URL 解析 |
| snapfile stdin/stdout | 本地二进制 | 下载 + 转码 |
| ffmpeg/ffprobe spawn | 本地二进制 | 媒体处理 (Convert/Merge Tab + snapfile 内部) |
| SQLite | `{userData}/data.db` | 任务存储 |
| electron-store | JSON 文件 | 配置存储 |

### 8.3 视频下载请求 (由 snapfile 发起)

| 请求 | 目标 | 用途 |
|---|---|---|
| HTTP GET | bilibili CDN / YouTube CDN / 等 | 下载视频/音频流 |

这些请求使用 yt-dlp 解析出的带签名 URL，附加 Referer 等 header。

## 9. 关键发现与限制

### 9.1 并发控制

- **解析阶段**: 无并发控制。所有 URL 同时启动 yt-dlp 进程。批量导入有触发限流风险。
- **下载阶段**: snapfile 内部通过 `maxDownloadingTasks` 参数控制 (默认 5)。
- **任务间隔**: 无任何间隔逻辑。
- **Convert Tab**: 任务队列串行处理，每次一个文件。
- **Merge Tab**: 同时只允许一个合并任务。

### 9.2 码率控制

- **M4A 模式**: 直接下载原始 AAC 流，不转码。码率由服务器决定。
- **MP3 模式**: snapfile 调用 ffmpeg 转码，但**没有传递码率参数**，使用 ffmpeg 默认值 (约 128kbps)。
- **UI bitrate 设置**: 在 m4a 模式下影响选择哪个音频流 (补丁后新增)。在 mp3 模式下完全不生效。

### 9.3 文件命名

- 临时文件: `{md5(url)}.m4s`
- 最终文件: `{name}.{ext}` (使用视频标题)
- 文件名冲突: snapfile 自动处理

### 9.4 代理支持

- `system`: 使用系统代理
- `direct`: 直连
- `http://host:port`: HTTP 代理
- `socks5://host:port`: SOCKS5 代理
- 代理认证: `http://user:pass@host:port`

### 9.5 错误处理

- 单个文件下载失败: 发送 `file_download_error`，任务继续
- 所有文件失败: 发送 `download_error`，任务终止
- 转码失败: 发送 `convert_error`，任务终止
- snapfile 进程崩溃: JS 层自动重启 (最多 3 次)

### 9.6 bilibili 音频格式

| format_id | 实际码率 | 编码 | 对应 UI 标签 |
|---|---|---|---|
| 30216 | ~44 kbps | mp4a.40.5 (AAC LC) | 64kbps |
| 30232 | ~103 kbps | mp4a.40.2 (AAC LC) | 128kbps |
| 30280 | ~204 kbps | mp4a.40.2 (AAC LC) | 192kbps |

## 10. Rust 实现建议

### 10.1 项目结构

```
snapany-rs/
├── Cargo.toml
├── src/
│   ├── main.rs              # 入口: CLI 解析 + stdin/stdout 循环
│   ├── protocol.rs          # 协议定义 (EventType, StatusCode, Request/Response)
│   ├── task_manager.rs      # 任务队列、并发控制、状态机
│   ├── downloader.rs        # HTTP 下载 (分片、断点续传)
│   ├── converter.rs         # ffmpeg 调用 (合并/转码)
│   ├── misc.rs              # 文件移动
│   ├── proxy.rs             # 代理配置
│   └── error.rs             # 错误类型定义
├── tests/
│   ├── protocol_test.rs     # 协议兼容性测试
│   └── download_test.rs     # 下载测试
└── docs/
    └── 081_design.md        # 本文档
```

### 10.2 依赖库

```toml
[dependencies]
tokio = { version = "1", features = ["full"] }
reqwest = { version = "0.12", features = ["stream"] }
serde = { version = "1", features = ["derive"] }
serde_json = "1"
clap = { version = "4", features = ["derive"] }
anyhow = "1"
uuid = { version = "1", features = ["v4"] }
ffmpeg-sidecar = "0.5"        # 或直接用 tokio::process::Command
futures = "0.3"
md-5 = "0.10"                  # 文件命名
tracing = "0.1"                # 结构化日志
tracing-subscriber = "0.3"
```

### 10.3 核心改进点

1. **码率控制**: ffmpeg 转码时添加 `-b:a {bitrate}k` 参数
2. **解析并发控制**: 信号量限制同时解析的任务数
3. **任务间隔**: 可配置延迟，避免触发限流
4. **进度精度**: 转换进度使用实际文件字节数

### 10.4 兼容性要求

Rust 实现必须满足以下兼容性，才能被现有 SnapAny Electron 应用直接使用：

1. **CLI 参数**: `--ffmpeg-path`, `--ffprobe-path`, `--max-downloading-task`, `--log-level`
2. **stdin**: 接收 JSON 行格式的 start-task/delete-task/update-max-download-task/stop-recording-live
3. **stdout**: 输出 JSON 行格式的状态变更/进度/完成/错误
4. **stderr**: 可选，输出结构化日志
5. **临时目录结构**: `{tempDir}/{taskID}/download/`, `{tempDir}/{taskID}/converting/`, `{tempDir}/{taskID}/converted/`
6. **文件命名**: 临时文件用 MD5(url)，最终文件用 task.name

## 11. 附录

### 11.1 yt-dlp 完整解析参数

```bash
yt-dlp <url> \
  --dump-json \
  --no-check-certificates \
  --no-warnings \
  --no-playlist \
  --ignore-errors \
  --ignore-config \
  --no-cache-dir \
  --prefer-insecure \
  --extractor-args "generic:extract_flat=true" \
  --add-header "User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36" \
  --add-header "Accept: text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8" \
  --add-header "Accept-Language: zh-CN,zh;q=0.9,en;q=0.8" \
  --retries 3 \
  --socket-timeout 10 \
  --format-sort "res,ext:mp4:m4a" \
  [--proxy "http://..."] \
  [--cookies "/path/to/cookies.txt"]
```

### 11.2 JS 层错误类型

| errorStatus | errorMessage | 触发条件 |
|---|---|---|
| extractError | extractError | yt-dlp 解析失败 |
| extractError | unsupportedUrl | 不支持的 URL |
| extractError | needLogin | 需要登录 |
| extractError | noVideoFormats | 没有视频格式 |
| extractError | timeout | 超时 |
| extractError | needPurchase | 需要购买 |
| extractError | serverError | 服务器错误 |
| extractError | videoNotAccess | 视频无法访问 |
| extractError | permissionDenied | 文件权限不足 |
| downloadError | downloadError | 下载失败 |
| downloadError | diskFull | 磁盘已满 |
| convertError | convertError | 转换失败 |
| moveError | moveError | 移动失败 |
| interrupted | interrupted | 任务被中断 |

### 11.3 已应用的补丁

| 补丁 | 文件 | 日期 |
|---|---|---|
| 绕过强制更新 | main.js `getSoftwareInfo()` | 2026-08-07 |
| 升级 yt-dlp 至 2026.07.04 | bin/yt-dlp (wrapper → pip) | 2026-08-07 |
| m4a 模式按码率选择音频流 | main.js `filterAudioFormats()` | 2026-08-07 |
| snapfile 日志记录 | main.js `setupEventHandlers()` + `sendEvent()` | 2026-08-07 |

---

**文档生成时间**: 2026-08-07
**分析工具**: 代码逆向 (main.js 9524 行) + 运行时日志抓取
**协议完整性**: 基于实际运行日志 + 源码分析，覆盖全部 4 个 Tab 的功能

---

## 12. snapfile-rs 断点续传 (2026-08-08)

### 12.1 新增模块

| 模块 | 职责 |
|------|------|
| `src/resume.rs` | 续传元数据 (`ResumeMeta`)、URL 哈希路径计算、Range 探测 (`probe_range` / `probe_with_range_get`)、TTL 清理 (`cleanup_stale_resume`) |

### 12.2 续传文件结构

```
{outputDir}/.SnapAny/.resume/{url_hash}/
├── download.partial          # 已下载的部分
└── download.partial.meta     # 元数据 (JSON)
```

路径按 URL 的 MD5 哈希组织，跨任务共享同一 URL。独立于临时目录 `{tempDir}/{taskId}`，不受 `CleanupGuard` 影响。

### 12.3 元数据格式

```json
{
  "url": "https://...",
  "downloaded_bytes": 52428800,
  "total_size": 104857600,
  "etag": "\"abc123\"",
  "last_modified": "Wed, 08 Aug 2026 10:00:00 GMT"
}
```

### 12.4 续传流程

1. **Range 探测**：HEAD 请求获取 `Accept-Ranges`、`ETag`、`Last-Modified`、`Content-Length`。HEAD 返回 405 时回退到 `Range: bytes=0-0` GET。
2. **检查续传**：如果 `.partial` + `.meta` 存在，验证 ETag/Last-Modified 是否匹配。
3. **续传请求**：标识匹配且服务器支持 Range → 发送 `Range: bytes={offset}-`，追加写入 `.partial`。
4. **从头下载**：标识不匹配或不支持 Range → 覆盖 `.partial`。
5. **流式写入**：每秒更新 `.meta` 中的 `downloaded_bytes`，每 5 秒输出周期速度日志。
6. **完成**：`flush` → `rename(.partial → dest)`（跨设备 fallback copy+remove）→ 删除 `.meta`。

### 12.5 统计日志

每个文件下载完成时输出：
- `total_bytes`, `duration_secs`, `avg_speed_kbps`, `peak_speed_kbps`
- `resumed_bytes`（本次续传恢复的字节）, `this_session_bytes`
- `range_supported`, `server` (HTTP Server 头), `ttfb_ms`（首字节时间）

周期日志（每 5 秒）：`speed_kbps`, `peak_kbps`, `downloaded`, `total`, `pct`

这些日志用于确认 CDN 实际能力，为 P2 分片决策提供数据。

### 12.6 清理逻辑

- **任务完成**：`.partial` 移到最终目录，`.meta` 删除
- **任务取消/失败**：保留 `.partial` + `.meta`（供续传）
- **临时目录**：`CleanupGuard` 照常清理 `{tempDir}/{taskId}`，不影响 `.resume/`
- **TTL 懒清理**：snapfile 处理新任务时，扫描 `outputDir/.SnapAny/.resume/`，删除 `.partial.meta` 修改时间超过 `--resume-max-age-days`（默认 7 天）的条目

### 12.7 命令行参数

```bash
snapfile \
  --ffmpeg-path /path/to/ffmpeg \
  --ffprobe-path /path/to/ffprobe \
  --max-downloading-task 5 \
  --log-level info \
  --resume-max-age-days 7
```
### 12.8 CDN 实测验证（2026-08-08）

**测试对象**：bilibili CDN (`openresty` / BVC bcache)，视频 `BV1awRpBQE98`

| 项目 | 结果 |
|------|------|
| Accept-Ranges | `bytes` (支持) |
| 206 Partial Content | 支持，Range 请求返回 206 + `content-range` |
| Content-Length | 多次请求稳定一致 |
| ETag | **不返回** |
| Last-Modified | 稳定，多次请求一致 |
| 续传完整性 | 分段合并 MD5 = 直接下载 MD5 (通过) |
| 单连接限速 | ~9.5-10.9 MB/s |
| 4 连接加速 | 2.8x (31.6MB: 3.3s → 1.2s) |

**关键结论**：
- 续传验证依赖 Last-Modified（无 ETag），当前 `matches_server()` 回退逻辑已支持
- bilibili 签名 URL 有 `deadline`（约 2h），过期后新 URL 哈希不同，旧 `.partial` 不复用，TTL 清理处理
- CDN 确认限单连接速度，多连接分片有 2-3x 收益，已将分片升级为 P1

---

## 13. snapfile-go 完整能力分析（2026-08-09）

基于 snapfile-go 二进制（`vendor/snapfile-go/snapfile`，Go x86_64 编译）的 strings 逆向分析。

> **当前 patches 状态**: 应用默认使用 snapfile-rs；`useGoSnapfile` 开关允许切回 snapfile-go，用于补足直播录制能力。

### 13.1 核心发现：snapfile-go 有完整的 HLS 处理能力

snapfile-go 二进制中包含完整的 HLS（HTTP Live Streaming）协议解析符号，这是 snapfile-rs 完全缺失的能力。

**HLS 协议符号（Go 二进制确认）**

| 符号 | 用途 |
|------|------|
| `#EXT-X-VERSION` | 协议版本 |
| `#EXT-X-STREAM-INF` | master playlist 变体选择 |
| `#EXT-X-MEDIA` | 音频/字幕轨道描述 |
| `#EXT-X-TARGETDURATION` | segment 最大时长 |
| `#EXT-X-MEDIA-SEQUENCE` | segment 序号（直播增量检测） |
| `#EXT-X-PLAYLIST-TYPE` | 区分 VOD（点播）/EVENT（直播） |
| `#EXT-X-BYTERANGE` | segment 字节范围 |
| `#EXT-X-KEY` | 加密 segment 的密钥 |
| `#EXT-X-MAP` | 初始化 segment |
| `EndList`（`#EXT-X-ENDLIST`） | 直播结束标记 |
| `SEGMENT URL` | 分段 URL |
| `can not find any TS segment` | 无 segment 错误 |

### 13.2 直播录制完整链路

snapfile-go 实现了完整的直播录制流水线：

| 能力 | 说明 |
|------|------|
| `task_live_detected` | 检测到直播流时发送状态码 |
| `live_cancel_sweep` | 直播取消时的清理机制 |
| `first.part_` / `p%02d.` | 分段文件命名模式 |
| `shard` / `sharding` | 分段合并机制 |
| `download_sem` / `convert_sem` | 下载和转换的信号量控制 |

**直播录制流程**

```
snapfile-go 收到 start-task（FileSpec.url = m3u8 地址）
  │
  ▼
下载 m3u8 → 解析 HLS playlist
  ├── master playlist（含 #EXT-X-STREAM-INF）→ 选最优变体 → GET 变体 media playlist
  └── media playlist → 直接处理
  │
  ▼
检查 #EXT-X-PLAYLIST-TYPE：
  ├── VOD → 点播，一次性下载所有 segment
  └── EVENT 或无此标签 → 直播，进入轮询模式
  │
  ▼
直播模式：
  1. 下载当前所有 segment（TS/M4S 分片）
  2. 记录已下载的 segment（#EXT-X-MEDIA-SEQUENCE）
  3. 定期重新 GET m3u8 检查是否有新 segment
  4. 有新 segment → 继续下载 + 推送进度
  5. 无新 segment → 继续轮询等待
  6. 发送 task_live_detected
  │
  ├── 用户停止（stop-recording-live 命令）：
  │     → 停止轮询
  │     → 已下载的 segment 进入 ffmpeg 合并
  │     → 输出完整视频文件（截止到停止时间点）
  │
  └── 远程端结束直播：
        → CDN 在 m3u8 末尾追加 #EXT-X-ENDLIST
        → snapfile-go 轮询检测到 EndList → 自然结束
        → 已下载的 segment 进入 ffmpeg 合并 → 输出完整视频文件（完整录制）
```

### 13.3 snapfile-go 独有功能

| 功能 | snapfile-go | snapfile-rs |
|------|------------|-------------|
| HLS M3U8 解析 | ✅ 完整协议支持 | ❌ 完全缺失 |
| 直播录制（轮询 + segment 管理） | ✅ | ❌ |
| 远程结束检测（#EXT-X-ENDLIST） | ✅ | ❌ |
| 用户停止录制后的分片合并 | ✅ | ❌（stop-recording-live 只是 cancel token） |
| HLS segment 并行下载（download_sem） | ✅ | ❌ |
| 分段合并（sharding/shard） | ✅ | ❌ |
| `task_live_detected` 状态码发送 | ✅ | ❌（协议定义了但从不发送） |
| `live_cancel_sweep` 直播取消清理 | ✅ | ❌ |
| `param_invalid` 错误码 | ✅ | ❌ |
| `parse_m3u8_error` 错误码发送 | ✅ | ❌（协议定义了但从不发送） |

### 13.4 snapfile-rs 独有增强（Go 版没有）

| 功能 | snapfile-rs | snapfile-go |
|------|------------|-------------|
| HTTP Range 多连接分块下载 | ✅ 自适应（1-8 连接） | ❌ |
| `.partial` 断点续传（meta + partial） | ✅ | ❌ |
| `resume_max_age_days` TTL 清理 | ✅ | ❌ |
| `max_connections_per_file` 参数 | ✅ | ❌ |
| MP3 码率控制（-b:a {bitrate}k） | ✅ | ❌ |
| `connect_timeout_secs` / `read_timeout_secs` | ✅ | ❌ |
| arm64 原生编译 | ✅ | ❌ 仅 x86_64 |

### 13.5 能力对比矩阵

| 场景 | snapfile-go | snapfile-rs | 影响 |
|------|------------|-------------|------|
| Bilibili 点播视频 | ✅ 直接 URL | ✅ 直接 URL + 分块加速 | snapfile-rs 更快 |
| YouTube 点播 | ✅ 直接 URL | ✅ 直接 URL + 分块加速 | snapfile-rs 更快 |
| 资源嗅探下载 | ✅ 直接 URL | ✅ 直接 URL + 断点续传 | snapfile-rs 更好 |
| Bilibili 直播 | ✅ HLS 录制 | ❌ 无法录制 | **snapfile-go 独有** |
| YouTube 直播 | ✅ HLS 录制 | ❌ 无法录制 | **snapfile-go 独有** |
| Twitch 直播 | ✅ HLS 录制 | ❌ 无法录制 | **snapfile-go 独有** |
| 大文件断点续传 | ❌ | ✅ | **snapfile-rs 独有** |

### 13.6 协议空壳字段

snapfile-rs 协议层定义了以下字段/命令，但代码层完全没有实现：

| 协议定义 | snapfile-rs 状态 | snapfile-go 状态 | 说明 |
|---------|-----------------|-----------------|------|
| `live: bool` 字段 | 接收但不用 | ✅ 控制直播行为 | Electron 层硬编码 false，HLS 实现需同步修复 |
| `stop-recording-live` 命令 | cancel token（等同 delete） | ✅ 停止轮询 + 合并分片 | snapfile-rs 没有分片可合并 |
| `task_live_detected` 状态码 | 从不发送 | ✅ 检测到直播时发送 | |
| `stop_recording_live` 状态码 | 从不发送 | ✅ 响应用户停止 | |
| `parse_m3u8_error` 错误码 | 从不发送 | ✅ M3U8 解析失败时发送 | |
| `param_invalid` 错误码 | 从不发送 | ✅ 参数校验失败时发送 | |

### 13.7 架构差异总结

```
snapfile-go（原版）：
  ├── HTTP 直接文件下载（单连接）
  ├── HLS M3U8 解析 ← snapfile-rs 完全缺失
  ├── 直播录制（轮询 + segment 管理 + ENDLIST 检测） ← snapfile-rs 完全缺失
  ├── 分段下载与合并（download_sem + sharding） ← snapfile-rs 完全缺失
  └── ffmpeg 转换/合并

snapfile-rs（Rust 重写版）：
  ├── HTTP 直接文件下载（单连接 + 多连接分块） ← 增强
  ├── 断点续传（partial + meta + TTL） ← 独有增强
  └── ffmpeg 转换/合并
```

snapfile-rs 是一个**更快的直接文件下载器，但丢掉了 snapfile-go 的 HLS/直播录制能力**。对点播场景完全兼容且性能更好，但对直播场景完全不可用。
