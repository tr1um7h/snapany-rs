# SnapAny 复刻方案

> **⚠️ 方案状态：备选方案（暂缓）**
>
> 经全面审查（2026-08-11），当前推荐继续走 patches + snapfile-rs 路线，暂不启动全量复刻。
> 详见第十二章（审查备注）和第十三章（路径建议）。
> 本文档作为备选方案保留，供未来需要时参考。

## 一、项目背景与目标

当前 snapany-rs 项目包含两部分：
1. **snapfile-rs**（`src/`）：Rust 下载引擎，通过 stdin/stdout JSON 与父进程通信
2. **patches/snapany-app/**：对 SnapAny Electron 应用的补丁修改

### 目标

- **复刻 SnapAny Electron 应用的前端**，替换 patches/ 补丁方式
- **保留 snapfile-rs 不改动**，作为独立进程
- **复刻 SnapAny 的全部界面和核心功能**

### 核心约束

snapfile-rs 相比 snapfile-go（原版 Go 二进制）**缺失 HLS/直播录制能力**（详见 vendor/081_design.md 第十三章）。本方案需要处理这个能力差距。

---

## 二、关键决策

### 2.1 框架：Electron（而非 Tauri）

snapfile 作为独立进程后，Tauri 的"直接调用 Rust 函数"优势不存在。Electron 的优势在于可直接参考 SnapAny 原版 main.js 中的完整实现（SnapfileService、YtDlpService、AuthService 等），开发效率显著更高。

### 2.2 snapfile-rs 作为独立进程（不改代码）

| 维度 | 独立进程 | 库调用 |
|------|---------|--------|
| 改动量 | 零改动 | 大幅重构 |
| 重构风险 | 无 | 高 |
| 故障隔离 | 下载引擎崩溃不影响 UI | 崩溃带掉整个应用 |
| 通信开销 | JSON 序列化（可忽略） | 零开销 |

### 2.3 下载引擎选择：snapfile-rs vs snapfile-go

| 场景 | snapfile-rs | snapfile-go |
|------|------------|-------------|
| 点播视频（直接 URL） | ✅ + 分块加速 + 断点续传 | ✅ |
| HLS 直播录制 | ❌ 完全缺失 | ✅ 完整支持 |
| arm64 原生 | ✅ | ❌ 仅 x86_64 |

**推荐方案**：默认使用 snapfile-rs（性能更好，arm64 支持），直播录制功能作为 Phase 2 增强项，届时选择补全 snapfile-rs 的 HLS 能力或集成 snapfile-go。

> **ℹ️ 备注（HLS 已在规划中）**：snapfile-rs 的 HLS 实现已有完整设计文档链路：
> - 设计文档：`docs/superpowers/specs/2025-08-10-hls-live-recording-design.md`
> - 实现计划：`docs/superpowers/plans/2025-08-10-hls-live-recording.md`
> - fMP4 方案：`docs/fMP4.md`
>
> 方案核心：把 HLS 全部委托给 ffmpeg（VOD 一步转 mp4，Live 录制 ts 再 remux），
> `stop-recording-live` 用 LiveStopSignal 触发 ffmpeg SIGINT。
>
> ⚠️ 仅补引擎侧 HLS 能力不够。原版 Electron 层把 `live` 硬编码为 `false`，
> 需同时修改 Electron 层根据 `is_live` 正确设置 live 字段并处理 `task_live_detected` 事件。
> 详见第十二章 12.4 节。

### 2.4 项目组织：在当前仓库中开发

在 snapany-rs 仓库中新建 `frontend/` 目录，不另建项目。

### 2.5 界面：复刻 SnapAny

左侧 Sidebar 四个 Tab（Download / Online / Convert / Merge）+ 左下角 Settings 按钮。

> **⚠️ 备注（React Router 版本）**：arch.md 记载 "React Router v6.28.1" 有误。
> 实际 `app/package.json` 为 `react-router-dom ^7.2.0`（v7）。复刻时需按 v7 API 实现。

### 2.6 解析并发控制（需重新实现）

> **⚠️ 备注**：当前 snapany-rs 项目（含补丁）有解析并发控制，但逻辑在 Electron 补丁层
> （patched main.js 6514-6614 行），不在 snapfile-rs 引擎层。
> snapfile-rs 的 Semaphore 只管**下载**并发（`--max-downloading-task`）。
>
> 复刻时需在新 Electron 层重新实现 `parseQueue` + `activeParses` 队列逻辑：
> - `maxParsingTasks`（默认 3）— 同时运行的 yt-dlp 解析进程数上限
> - `batchSize`（默认 5）— 同时下载的任务数上限
> - `maxConcurrentDownloads`（默认 8）— snapfile 内部下载并发（通过 `--max-downloading-task`）
>
> Settings 设计（第六章）需补上这三个独立参数。

---

## 三、项目结构

```
snapany-rs/
├── src/                          # Rust 下载引擎（保留，不做改动）
│   └── ...                      # 独立进程，通过 stdin/stdout 通信
│
├── frontend/                     # Electron 前端（新建）
│   ├── src/
│   │   ├── main/                # Electron 主进程
│   │   │   ├── index.ts        # 入口：创建窗口、启动 snapfile
│   │   │   ├── ipc/            # IPC 路由（@egoist/tipc）
│   │   │   │   ├── index.ts
│   │   │   │   ├── parse.ts    # URL 解析（yt-dlp）
│   │   │   │   ├── task.ts     # 任务管理（snapfile 转发）
│   │   │   │   ├── auth.ts     # 认证（Cookie 管理）
│   │   │   │   ├── convert.ts  # 格式转换
│   │   │   │   ├── merge.ts    # 音视频合并
│   │   │   │   ├── sniffer.ts  # 资源嗅探
│   │   │   │   └── setting.ts  # 设置
│   │   │   ├── services/       # 业务服务（参考 SnapAny 原版）
│   │   │   │   ├── snapfile.ts # snapfile 进程管理
│   │   │   │   ├── ytdlp.ts    # yt-dlp 进程管理
│   │   │   │   ├── auth.ts     # Cookie 管理
│   │   │   │   ├── format.ts   # 智能格式选择引擎
│   │   │   │   ├── error.ts    # 错误诊断系统
│   │   │   │   ├── proxy.ts    # 代理管理
│   │   │   │   ├── sniffer.ts  # 资源嗅探
│   │   │   │   └── thumbnail.ts# 缩略图处理
│   │   │   ├── database/       # SQLite（better-sqlite3 + drizzle-orm）
│   │   │   │   ├── index.ts
│   │   │   │   └── schema.ts
│   │   │   └── stores/         # electron-store 配置
│   │   │       ├── settingStore.ts
│   │   │       ├── snifferStore.ts
│   │   │       └── urlBookmarkStore.ts
│   │   ├── preload/
│   │   │   └── index.ts        # 预加载脚本
│   │   └── renderer/           # React 前端
│   │       ├── main.tsx
│   │       ├── App.tsx         # 主组件（Sidebar 布局）
│   │       ├── pages/          # 页面组件
│   │       │   ├── Download.tsx
│   │       │   ├── Online.tsx
│   │       │   ├── Convert.tsx
│   │       │   ├── Merge.tsx
│   │       │   └── Settings.tsx
│   │       ├── components/     # UI 组件
│   │       │   ├── Sidebar.tsx
│   │       │   ├── TaskItem.tsx
│   │       │   ├── FormatSelector.tsx
│   │       │   ├── SnifferBrowser.tsx
│   │       │   └── ...
│   │       ├── hooks/          # 自定义 hooks
│   │       ├── store/          # Zustand 状态管理
│   │       └── styles/
│   ├── package.json
│   ├── vite.config.ts
│   ├── tsconfig.json
│   ├── tailwind.config.js
│   └── electron-builder.json   # 打包配置
│
├── vendor/                       # 第三方依赖（保留）
│   ├── snapfile-go/             # Go 原版（备选直播录制）
│   └── 081_design.md            # 逆向分析文档（已更新）
│
├── patches/                      # SnapAny 补丁（完成后删除）
│   └── snapany-app/
│       └── arch.md              # Electron 架构文档（已更新）
│
├── tests/                        # Rust 测试（保留）
├── docs/                         # 文档（保留）
├── Cargo.toml                    # Rust 配置（保留）
└── README.md
```

---

## 四、架构设计

### 4.1 整体架构

```
┌──────────────────────────────────────────────────────────────┐
│                      Electron 应用                             │
│                                                               │
│  ┌─────────────────────────────────────────────────────────┐  │
│  │  主进程（Node.js）                                        │  │
│  │                                                          │  │
│  │  ┌──────────────────────────────────────────────────┐   │  │
│  │  │  服务层                                           │   │  │
│  │  │  SnapfileService  — snapfile 进程管理 + 协议转发   │   │  │
│  │  │  YtDlpService     — yt-dlp 进程管理 + URL 解析    │   │  │
│  │  │  TaskService      — 任务编排中心                   │   │  │
│  │  │  FormatEngine     — 智能格式选择                   │   │  │
│  │  │  AuthService      — Cookie 管理                    │   │  │
│  │  │  ErrorDiagnoser   — 错误诊断分类                   │   │  │
│  │  │  ProxyService     — 代理管理                       │   │  │
│  │  │  ResourceSniffer  — 资源嗅探                       │   │  │
│  │  └──────────────────────────────────────────────────┘   │  │
│  │                                                          │  │
│  │  ┌──────────────────────────────────────────────────┐   │  │
│  │  │  数据层                                           │   │  │
│  │  │  SQLite (better-sqlite3 + drizzle-orm)           │   │  │
│  │  │  electron-store × 3                               │   │  │
│  │  └──────────────────────────────────────────────────┘   │  │
│  │                                                          │  │
│  │  ┌──────────────────────────────────────────────────┐   │  │
│  │  │  IPC 层（@egoist/tipc）                           │   │  │
│  │  │  7 个路由模块，40+ 个 procedure                   │   │  │
│  │  │  5 个 renderer handler（事件推送）                │   │  │
│  │  └──────────────────────────────────────────────────┘   │  │
│  └─────────────────────────────────────────────────────────┘  │
│                                                               │
│  ┌─────────────────────────────────────────────────────────┐  │
│  │  渲染进程（React）                                        │  │
│  │  React 18 + Zustand + Tailwind CSS                        │  │
│  └─────────────────────────────────────────────────────────┘  │
│                                                               │
└──────────────────────────────────────────────────────────────┘
         │              │
         │ spawn         │ spawn
         ▼              ▼
   ┌──────────┐  ┌──────────┐
   │ snapfile  │  │ yt-dlp   │
   │ (Rust)    │  │          │
   │ 长驻进程   │  │ 按需spawn │
   └──────────┘  └──────────┘
```

### 4.2 完整下载流水线

```
用户粘贴页面 URL
  │
  ▼
TaskService 创建任务（状态：extracting）
  │
  ▼
YtDlpService.getParseInfo(url)
  → spawn yt-dlp --dump-json
  → 注入 --cookies（如有认证）
  → 注入 --proxy（如有代理）
  → 返回 VideoInfo JSON（标题、缩略图、formats[]、is_live）
  │
  ├── 解析失败 → ErrorDiagnoser 分类错误 → 推送错误给前端
  │
  ▼  解析成功
FormatEngine.getNeedDownloadItems(task, data, setting)
  → selectVideoBySetting — 按分辨率/编码/FPS 选择视频格式
  → selectAudioBySetting — 按语言/比特率 选择音频格式
  → selectSubtitleBySetting — 按语言/格式优先级 选择字幕
  → 直播特殊处理（过滤 flv+hevc，不附加独立音轨）
  → 缩略图附加（如启用）
  → URL 去重
  → 返回 FileSpec[]
  │
  ▼
TaskService.downloadWithSnapfile(taskId, items, setting)
  → 创建临时目录
  → 检查/启动 snapfile 进程
  → 下载缩略图
  → 构造 StartTaskPayload（proxy、outputDir、tempDir、files[]）
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
  │   ├── task_download_progress → IPC handler → 前端
  │   ├── task_conversion_progress → IPC handler → 前端
  │   ├── task_complete → IPC handler → 前端
  │   └── *_error → ErrorDiagnoser → IPC handler → 前端
```

---

## 五、核心模块设计

### 5.1 TaskService — 任务编排中心

协调 yt-dlp、snapfile、ffmpeg 完成完整下载流水线。参考 SnapAny 原版 TaskService（main.js:3983）。

**核心职责**

| 职责 | 说明 |
|------|------|
| URL 解析编排 | 调用 yt-dlp 解析页面 URL |
| 智能格式选择 | 从几十个格式中按用户设置选择最优组合 |
| 下载任务构造 | 将选中的格式转换为 snapfile 的 FileSpec[] |
| snapfile 调度 | 构造 StartTaskPayload，写入 snapfile stdin |
| 进度转发 | 监听 snapfile stdout，映射为 UI 状态 |
| 错误诊断 | 解析 yt-dlp 错误消息，分类为用户可理解的类型 |
| 中断恢复 | 应用重启后检测未完成任务 |
| 缩略图处理 | 下载缩略图、转 base64 存库 |

> **⚠️ 备注**：TaskService 还遗漏以下职责，复刻时需实现：
> - 批量管理（批量取消 = 同时 kill yt-dlp + snapfile；批量删除）
> - 直播流特殊处理（过滤 flv+hevc，不附加独立音轨）
> - snapfile 进程异常自动重启（原版有 maxRestartAttempts + moveActiveTasksToPending + resendPendingTasks 机制）

### 5.2 FormatEngine — 智能格式选择引擎

从 yt-dlp 返回的几十个格式中选择最优组合。参考 SnapAny 原版（main.js:5000-5160）。

**视频格式选择流水线**

```
所有 formats[]
  ↓ 过滤出有视频流的格式
按分辨率分组（min(width, height) → 标准分辨率）
  ↓ 匹配用户选择的分辨率（找最接近的）
按编码优先级分组（h264 > h265 > vp9 > av1）
  ↓ 选最高优先级编码
优先选含音频的格式
  ↓
选最高 FPS
  ↓
按文件大小过滤异常值
  ↓ 取第一个（最优）格式
```

**音频格式选择**

- 按语言分组，匹配用户设置的语言偏好
- 支持多音轨选择
- 按比特率选最优

**字幕格式选择**

- 合并手动字幕和自动字幕
- 格式优先级：srt > ass > vtt > json3 > ttml

### 5.3 YtDlpService — 页面 URL 解析

参考 SnapAny 原版（main.js:3521）。

- 按需 spawn yt-dlp（每次解析一个 URL）
- `--dump-json` 解析页面
- 注入 `--cookies`（认证）和 `--proxy`（代理）
- 支持取消（SIGINT/SIGTERM）
- 返回 VideoInfo JSON

### 5.4 SnapfileService — 下载引擎通信

参考 SnapAny 原版（main.js:1406）。

- 应用启动时 spawn snapfile，长驻运行
- stdin 写入 JSON 请求
- readline 监听 stdout，解析 JSON 响应
- 状态码映射为 UI 事件
- 响应通过 IPC handler 推送给前端
- 应用退出时关闭 stdin

### 5.5 ErrorDiagnoser — 错误诊断系统

参考 SnapAny 原版（main.js:4060-4210）。

对 yt-dlp 错误消息进行关键词匹配，分类为用户可理解的类型：

| 错误关键词 | 用户提示 |
|-----------|---------|
| `unsupported url` / `drm protection` | 不支持的网址 |
| `authentication` / `logged in` | 需要登录（带登录按钮） |
| `need to purchase` | 需要付费 |
| `no video formats` | 无视频格式 |
| `timeout` / `sslerror` / `403` | 网络/代理问题 |
| `video unavailable` | 视频不可访问 |

### 5.6 AuthService — 认证与 Cookie 管理

参考 SnapAny 原版（main.js:3433）。

**两层 Cookie 注入**

| 层 | 方式 | 用途 |
|----|------|------|
| yt-dlp 解析层 | cookies.txt + `--cookies` 参数 | 解析需要登录的页面 |
| snapfile 下载层 | FileSpec.header Cookie 字段 | 下载需要认证的 CDN 文件 |

**认证站点动态管理**

- 预设站点（YouTube、Instagram、Twitter，不可删除）
- 用户自定义站点（输入 URL → tldjs 提取域名 → 自动添加，可删除）

### 5.7 ResourceSnifferService — 资源嗅探器

参考 SnapAny 原版（main.js:5467）。

- 嵌入式浏览器（webview）浏览网页
- webRequest API 拦截所有网络请求
- 三层过滤（扩展名 30+ 种 / MIME 类型 / 正则表达式）
- 嗅探到的资源可直接下载（跳过 yt-dlp 解析）

### 5.8 Convert/Merge 服务

独立于下载流程，直接 spawn ffmpeg：

- **VideoAudioConverService** — 格式转换（参考 main.js:8910）
- **VideoAudioMergeService** — 音视频合并（参考 main.js:9305）

---

## 六、前端界面设计

### 6.1 界面布局

```
┌─────────────────────────────────────────────────────────┐
│                    SnapAny 主界面                         │
│                                                          │
│  ┌──────────┐  ┌──────────────────────────────────────┐  │
│  │          │  │                                      │  │
│  │ Download │  │                                      │  │
│  │          │  │         页面内容区域                   │  │
│  │ Online   │  │                                      │  │
│  │          │  │    （根据左侧 Tab 切换）               │  │
│  │ Convert  │  │                                      │  │
│  │          │  │                                      │  │
│  │ Merge    │  │                                      │  │
│  │          │  │                                      │  │
│  │──────────│  │                                      │  │
│  │ Settings │  │                                      │  │
│  └──────────┘  └──────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────┘
```

### 6.2 页面功能

**Download 页面**
- 输入页面 URL
- 点击解析 → 显示标题、缩略图、可用格式
- 选择格式/分辨率
- 开始下载 → 任务列表（进度、速度、状态）
- 任务操作（暂停/恢复/删除）

**Online 页面**（浏览器嗅探）
- 嵌入式浏览器（webview）
- 输入网址或从书签选择
- 浏览网页，自动嗅探媒体资源
- 嗅探结果列表（按扩展名/MIME 类型/正则过滤）
- 选择资源下载

**Convert 页面**
- 文件选择（拖拽或浏览）
- 目标格式选择
- 转换进度显示

**Merge 页面**
- 视频文件选择
- 音频文件选择
- 合并进度显示

**Settings 对话框**
- 下载路径、代理配置、语言、并发设置

---

## 七、IPC 接口设计

使用 `@egoist/tipc` 实现类型安全的 IPC。

### 7.1 命令（Renderer → Main）

| 路由 | 命令 | 说明 |
|------|------|------|
| **parse** | parseUrl, cancelParse | URL 解析 |
| **task** | startDownload, resumeDownload, getTasks, deleteTask, deleteTasks, stopRecordingLive | 任务管理 |
| **auth** | openAuthWindow, completeAuth, getAuthSites, addAuthSite, logoutAuthSite, deleteAuthSite | 认证 |
| **convert** | convertFile, getConvertTasks, stopConvert | 格式转换 |
| **merge** | mergeMedia, getMergeTasks, stopMerge | 合并 |
| **sniffer** | setupSniffer, getSniffedResources, clearSniffedResources, downloadSniffedResources | 嗅探 |
| **system** | getSystemInfo, getVersion, testProxy, openFile, openFileDir | 系统 |
| **setting** | getSettings, updateSettings | 设置 |

### 7.2 事件（Main → Renderer）

| 事件 | 数据 | 来源 |
|------|------|------|
| onDownloadProgress | `{ taskId, status, progress, speed, eta }` | snapfile stdout |
| onTaskStatus | `{ taskId, status, message }` | snapfile stdout |
| onDownloadComplete | `{ taskId, files }` | snapfile stdout |
| onDownloadError | `{ taskId, code, message }` | snapfile stdout |
| onResourceSniffed | `MediaResource` | webRequest |
| onParseComplete | `{ parseId, videoInfo }` | yt-dlp stdout |

> **⚠️ 备注**：对比 arch.md 第八章（8 路由 40+ procedure），以上接口遗漏:
>
> **命令遗漏**:
> - snifferRoute 缺 `getUrlBookmarks / addUrlBookmark / deleteUrlBookmark`（书签管理）
> - taskRoute 缺 `interruptTasks`（批量中断，语义不同于 deleteTasks）
> - SystemRoute 缺 `openLogDirectory`、`closeWindow`、软件自更新四件套（checkVersion / download / checkPackage / install）、yt-dlp 更新（getLocalVersion / update）
>
> **事件遗漏**:
> - `onAppClose` — 关闭拦截确认（检测未完成任务，前端弹窗）
> - `onYtDlpUpdateStatus` — yt-dlp 更新进度
> - `onSoftwareUpdateProgress` — 软件更新下载进度
>
> 详见第十二章 12.1 和 12.3 节。

---

## 八、数据结构设计

### 8.1 VideoInfo（URL 解析结果）

| 字段 | 类型 | 说明 |
|------|------|------|
| title | String | 视频标题 |
| thumbnail | String? | 缩略图 URL |
| duration | u64? | 时长（秒） |
| is_live | bool | 是否直播 |
| formats | Format[] | 可用格式列表 |

### 8.2 Task（UI 层任务）

| 字段 | 类型 | 说明 |
|------|------|------|
| id | String | 任务 ID（UUID） |
| url | String | 页面 URL |
| title | String? | 标题 |
| thumbnail | String? | 缩略图（base64） |
| file_path | String? | 最终保存路径 |
| file_size | u64? | 文件大小 |
| status | TaskStatus | 状态枚举 |
| progress | f64 | 进度 0-100 |
| speed | u64? | 下载速度 |
| eta | String? | 剩余时间 |
| error_message | String? | 错误信息 |
| is_live | bool | 是否直播 |
| created_at | i64 | 创建时间戳 |

> **⚠️ 备注**：8.2 节 Task 表对比原版 task 表（arch.md 第七章）缺以下关键字段:
>
> | 缺失字段 | 影响 |
> |---------|------|
> | `temp_task` | JSON 存 yt-dlp 解析结果；readyDownload 状态任务重启后恢复依赖此字段（不重解析） |
> | `error_action` | 驱动前端行为，如值 `"login"` 时显示登录按钮 |
> | `request_headers` | 嗅探下载需要携带的请求头（JSON） |
> | `extension` | 文件扩展名 |
> | `resolution_width` / `resolution_height` | 视频分辨率 |
> | `bitrate` | 音频比特率 |
>
> 另外缺 `yt_dlp_version` 表（yt-dlp 本地/远程版本缓存）。详见第十二章 12.2 节。

### 8.3 TaskStatus

| 状态 | 说明 | 对应 snapfile 状态码 |
|------|------|----------------------|
| Extracting | 解析中 | （yt-dlp 阶段） |
| ReadyDownload | 等待下载 | task_started / task_start_prepare |
| Downloading | 下载中 | task_start_download / task_download_progress |
| PendingConversion | 等待转换 | task_pending_conversion |
| Converting | 转换中 | task_start_conversion |
| Moving | 移动中 | task_start_move |
| Completed | 已完成 | task_complete |
| Failed | 错误 | *_error |

### 8.4 AuthSite

| 字段 | 类型 | 说明 |
|------|------|------|
| name | String | 站点名称（预设或 tldjs 自动提取） |
| url | String | 站点 origin URL |
| auth_url | String | 认证 URL |
| is_authorized | bool | 是否已认证 |
| enable_delete | bool | 是否允许删除（预设 false，自定义 true） |

---

## 九、技术栈

### Electron 主进程

| 用途 | 库 | 说明 |
|------|------|------|
| 桌面框架 | `electron` | 跨平台桌面应用 |
| 类型安全 IPC | `@egoist/tipc` | 参考 SnapAny |
| 数据库 | `better-sqlite3` + `drizzle-orm` | 任务持久化 |
| 配置存储 | `electron-store` | 用户设置 |
| 日志 | `electron-log` | 文件日志 |
| 进程管理 | `node:child_process` | spawn snapfile / yt-dlp |

### React 前端

| 用途 | 库 | 说明 |
|------|------|------|
| UI 框架 | `react` + `react-dom` | React 18 |
| 状态管理 | `zustand` | 轻量状态管理（含 Tab 切换） |
| 样式 | `tailwindcss` | 原子化 CSS |
| 图标 | `lucide-react` | 图标库 |
| 构建 | `vite` + `@vitejs/plugin-react` | 前端构建 |

> **⚠️ 备注**：技术栈对比原版 `app/package.json` 有以下差异和遗漏:
>
> **React Router 版本**: 原版为 `react-router-dom ^7.2.0`（v7），本方案未列。
>
> **UI 组件库**: 原版用 `flowbite-react` + `flowbite-react-icons`，本方案选 tailwindcss + lucide-react。
> 如目标是视觉保真，flowbite 更接近原版外观；如要重做设计语言则需注明取舍理由。
>
> **遗漏的依赖**（原版有、本方案未列）:
> - `i18next` + `react-i18next` + `i18next-browser-languagedetector` — 国际化
> - `swr` — 数据请求/缓存
> - `ahooks` — React hooks 工具集
> - `react-virtuoso` — 长任务列表虚拟滚动
> - `fluent-ffmpeg` — ffmpeg 命令构造
> - `file-type` / `mime-types` — 文件类型检测
> - `tldjs` — 域名解析（认证站点管理）
> - `node-machine-id` — 设备 ID
> - `@sentry/electron` / `@aptabase/electron` — 崩溃上报/使用统计（原版有，已 patch 关闭）
> - `linkifyjs` / `normalize-url` / `classnames` / `tailwind-merge` — URL 解析、样式工具
>
> 详见第十二章 12.8 和 12.9 节。

---

## 十、开发路线图

### Phase 1：基础框架（1-2 天）

- 初始化 Electron + React + Vite + TypeScript 项目
- 配置 Tailwind CSS
- 实现 Sidebar 布局（4 个 Tab + Settings 按钮）
- 实现 snapfile 子进程管理（spawn + stdin/stdout 通信）
- 实现 SQLite 数据库初始化

### Phase 2：核心下载功能（3-4 天）

- 实现 yt-dlp 子进程管理（spawn + --dump-json）
- 实现 parseUrl IPC 接口
- 实现 Download 页面（URL 输入 → 解析 → 格式选择 → 下载）
- 实现 FormatEngine（视频/音频/字幕选择）
- 实现 snapfile 协议转发（stdin 写入 + stdout 解析）
- 实现 ErrorDiagnoser（yt-dlp 错误分类）
- 实现下载进度事件推送

### Phase 3：第三方认证（2 天）

- 实现 Online 页面
- 实现认证窗口（BrowserWindow + session.cookies）
- 实现 Cookie 捕获和存储
- 实现 yt-dlp 层 Cookie 注入（cookies.txt + --cookies）
- 实现 snapfile 层 Cookie 注入（FileSpec.header）
- 实现认证站点动态管理（预设 + 自定义）

### Phase 4：资源嗅探 + 格式转换 + 合并（2-3 天）

- 实现 Online 页面浏览器嗅探（webview + webRequest）
- 实现三层过滤（扩展名 / MIME / 正则）
- 实现 Convert 页面（直接 spawn ffmpeg）
- 实现 Merge 页面（直接 spawn ffmpeg）

### Phase 5：设置与完善（1 天）

- 实现 Settings 对话框
- 完善错误处理和日志
- 配置 electron-builder 打包
- 跨平台测试

### Phase 6（可选）：HLS 直播录制（3-5 天）

snapfile-rs 缺失 HLS 能力，需要以下方案：

**方案**：在 snapfile-rs 中补全 HLS 解析（Rust 实现）
- M3U8 解析器
- 直播轮询 + segment 管理
- #EXT-X-ENDLIST 检测
- 分片合并

**预估总工期：Phase 1-5 = 9-12 天；含 Phase 6 = 12-17 天**

> **⚠️ 备注（HLS 方案修正）**：Phase 6 的 "Rust M3U8 解析器" 方案已过时。
> 实际设计（`docs/superpowers/specs/2025-08-10-hls-live-recording-design.md`）
> 采用 **ffmpeg 委托方案**: VOD 用 ffmpeg -i m3u8 一步转 mp4，Live 用 ffmpeg 录制 ts 再 remux，
> 不在 Rust 中实现 M3U8 解析器。方案更简洁，但需同时修改 Electron 层（见 12.4）。

> **⚠️ 备注（工期修正）**: 以上估算偏乐观。
>
> - Phase 2 仅格式选择引擎忠实移植（分辨率归一化 + 编码优先级 h264>h265>vp9>av1 + FPS 排序
>   + 音频语言分组 + 字幕格式优先级）就需 3-5 天，3-4 天不够
> - Phase 5 未含: 软件自更新实现、yt-dlp 自更新实现、原生模块打包（electron-rebuild）、
>   二进制分发策略、安全模型设计
> - 加上第十二章的高优先级缺口，整体修正为 **15-25 天**

---

## 十一、SnapAny 演进分析与备选架构

### 11.1 SnapAny 的架构演进

通过分析 SnapAny 原版代码，可以看出明显的架构演进痕迹。这对复刻方案有重要意义。

**演进路线推测**

```
阶段 1（早期版本）：Electron 直接下载
  ├── FileDownloader 下载视频/音频文件
  ├── FFmpegService 合并/转码
  └── TaskService 编排

阶段 2（引入 yt-dlp）：Electron + yt-dlp
  ├── yt-dlp 解析页面 URL
  ├── FileDownloader 下载文件
  └── FFmpegService 合并/转码

阶段 3（当前版本，引入 snapfile）：Electron + yt-dlp + snapfile
  ├── yt-dlp 解析页面 URL
  ├── snapfile 下载 + HLS 解析 + 转换（一体化）
  └── FileDownloader 仅用于二进制更新
```

**关键证据**

- FileDownloader（main.js:3033，约 400 行）：完整的 HTTP 分片下载器，包含 Range 请求、断点续传、并发分片（8 连接）、分片合并、重试、进度回调。分片策略（5-50MB 分块）是为大媒体文件设计的，不是为下载几 MB 的二进制更新包设计的。
- FFmpegService（main.js:2054，约 500 行）：完整的 ffmpeg 操作封装（startMergeConvert、mergeMediaFiles、analyzeMediaStreams 等），但除了 cancelFFmpegProcess 外全部是 dead code。
- 这两个类的职责与 snapfile 高度重合，说明它们是被 snapfile 替代后的遗迹。

**snapfile 带来的改进**

- 进程隔离：下载/转换崩溃不影响 Electron 主进程和 UI
- Go 并发模型：比 Node.js 更适合高并发下载
- HLS 直播录制：完整的 M3U8 解析和轮询机制
- 协议统一：通过 stdin/stdout JSON 控制，接口清晰

### 11.2 备选架构：不依赖 snapfile

基于上述演进分析，存在一个备选架构：复刻版可以不依赖 snapfile，由 Electron 自己完成全部下载和转换。这正是 SnapAny 早期版本的架构。

**备选架构 A：Electron 原生下载（参考 SnapAny 早期架构）**

| 组件 | 实现 | 参考 |
|------|------|------|
| 下载 | Node.js HTTP 分片下载（参考 FileDownloader） | Range 请求、并发分片、断点续传 |
| 转换/合并 | 直接 spawn ffmpeg（参考 FFmpegService） | 合并、转码、进度解析 |
| 页面解析 | spawn yt-dlp（不变） | --dump-json |

**优点**

- 无需维护 snapfile（无论 Go 还是 Rust）
- 架构更简单（少一个进程）
- 调试更方便（单进程断点）
- 可以参考 SnapAny 原版 FileDownloader 和 FFmpegService 的现成代码

**缺点**

- 无进程隔离：下载/转换崩溃会拖垮 Electron 主进程
- 无 HLS 直播录制（需要额外实现 M3U8 解析和轮询）
- Node.js 高并发下载性能不如 Rust（事件循环瓶颈）
- 需要重写下载逻辑（工作量约 3-5 天）

**备选架构 B：使用 snapfile-go（默认）**

本文档主方案。使用 snapfile-rs（点播）或 snapfile-goｶｶ）作为独立进程。

**架构对比**

| 维度 | 主方案（snapfile 独立进程） | 备选 A（Electron 原生） |
|------|------|------|
| 进程隔离 | ✅ | ❌ |
| HLS 直播 | snapfile-go 支持 | 需额外实现 |
| 下载性能 | Rust/Go 原生并发 | Node.js 事件循环 |
| 架构复杂度 | 高（多进程通信） | 低（单进程） |
| 开发工作量 | 低（复用 snapfile） | 中（需实现下载器） |
| 可参考性 | 可参考 SnapAny 原版 snapfile 通信层 | 可参考 SnapAny 原版 FileDownloader |

**建议**

主方案使用 snapfile 独立进程（架构 B），理由：
- 复用 snapany-rs 仓库已有的 snapfile-rs，零改动
- 进程隔离提高稳定性
- 协议已成熟（参考 vendor/081_design.md）

如果后续需要简化架构或排除 snapfile 依赖，可以切换到备选架构 A，用 Electron 原生下载。由于参考代码现成，切换成本可控。

---

## 十二、审查备注与待决策项（2026-08-11）

> 以下为对前述各章节的审查发现，按严重程度分级。
> 不展开具体实现设计，仅标注位置、影响和建议。

### 🔴 高优先级（影响核心功能正确性）

**12.1 自更新机制完全缺失**

| 组件 | 原版状态 | 本方案 | 补丁层 |
|------|---------|--------|--------|
| 软件自更新 | SystemService 版本检查→下载→安装 | ❌ 未提及 | N/A（已禁用） |
| yt-dlp 自更新 | 版本检查 + GitHub releases 下载 | ❌ 未提及 | ✅ 已实现 |

yt-dlp 自更新是运维刚需: 视频站点频繁改版，yt-dlp 不更新就批量解析失败。
补丁层已通过 `ytdlp-release.json` + `update-ytdlp.sh` 解决。

**12.2 Task 数据结构缺关键字段**

8.2 节 Task 表对比原版 task 表缺失:

| 缺失字段 | 影响 |
|---------|------|
| `temp_task` | 存 yt-dlp 解析结果，readyDownload 状态任务重启后恢复依赖此字段 |
| `error_action` | 驱动前端"显示登录按钮"（值如 `"login"`） |
| `request_headers` | 嗅探下载需要携带的请求头 |
| `extension` / `resolution_*` / `bitrate` | 文件信息展示 |

另外缺 `yt_dlp_version` 表（yt-dlp 版本缓存）。

**12.3 IPC 接口不完整**

对比 arch.md 第八章（8 路由 40+ procedure），遗漏:

| 遗漏项 | 说明 |
|--------|------|
| snifferRoute 书签三件套 | getUrlBookmarks / addUrlBookmark / deleteUrlBookmark |
| taskRoute `interruptTasks` | 批量中断（kill yt-dlp + snapfile），语义不同于 deleteTasks |
| SystemRoute 多项 | openLogDirectory / closeWindow / 软件自更新四件套 / yt-dlp 更新 |
| 事件 `onAppClose` | 关闭拦截确认（检测未完成任务） |
| 事件 `onYtDlpUpdateStatus` | yt-dlp 更新进度 |
| 事件 `onSoftwareUpdateProgress` | 软件更新进度 |

**12.4 直播录制需两端同时修改**

Phase 6 只提到补 snapfile-rs HLS 能力。但原版 Electron 层把 `live` 硬编码为 `false`，
且 `task_live_detected` 事件在 Electron 层有映射但 snapfile-rs 从不发送。
要真正可用需同时修改引擎侧（加 HLS）和 Electron 侧（设 live=true + 处理 live_detected）。

**12.5 原生模块打包未规划**

| 问题 | 说明 |
|------|------|
| better-sqlite3 原生编译 | 需针对 Electron ABI 用 electron-rebuild 重新编译 |
| .node 文件 asar unpacked | better-sqlite3 的 .node 需要从 asar 中解包 |
| 二进制分发 | ffmpeg / ffprobe / yt-dlp / snapfile 四个二进制的随包分发和运行时路径解析 |
| getBinPath 逻辑 | 原版有运行时二进制路径解析，复刻需重新实现 |

### 🟡 中优先级（需设计决策）

**12.6 安全模型未定义**

原版主窗口和认证窗口: `nodeIntegration: true` + `contextIsolation: false` + `webviewTag: true`。
嗅探页面加载不可信第三方网页时等于全 Node 权限。
→ 需决策: 沿用原版不安全配置，还是借复刻机会收紧（contextBridge + contextIsolation: true）。

**12.7 解析并发控制需重新实现**

见 2.6 节。maxParsingTasks + batchSize 当前在补丁层（patched main.js 6514-6614 行），
snapfile-rs 引擎层 Semaphore 只管下载并发。复刻需在新 Electron 层重新实现。

**12.8 技术选型待定**

| 决策项 | 选项 | 影响 |
|--------|------|------|
| 嵌入式浏览器 | `<webview>` tag vs `WebContentsView` | Electron 正在弃用 webview tag |
| UI 组件库 | flowbite-react（原版） vs tailwind+lucide（本方案） | 视觉保真 vs 重设计 |
| 国际化 | i18next（原版） vs 无 | snapfile-rs message 硬编码中文，多语言需额外处理 |
| 遥测/崩溃上报 | Aptabase+Sentry（原版已 patch 关闭） vs 无 | 是否加回 |

### ⚪ 低优先级（事实修正与估算）

**12.9 arch.md 事实修正**

- React Router 版本: arch.md 写 "v6.28.1"，实际 `app/package.json` 是 `react-router-dom ^7.2.0`（v7）
- 原版额外依赖未在技术栈中列出: flowbite-react / swr / ahooks / i18next 全家桶 / react-virtuoso / fluent-ffmpeg / file-type / mime-types / tldjs / node-machine-id / @sentry/electron / @aptabase/electron 等

**12.10 工期估算偏乐观**

仅格式选择引擎忠实移植约 3-5 天。加上高优先级缺口（自更新、打包、安全模型），
整体应修正为 15-25 天。

---

## 十三、路径建议：补丁路线 vs 复刻路线

> **结论: 当前推荐继续 patches + snapfile-rs 路线，暂不启动全量复刻。**
> 本文档保留为备选方案，在补丁路线不可持续时启用。

### 13.1 补丁路线已解决的核心问题

| 需求 | 实现 | 状态 |
|------|------|------|
| 遥测关闭 | 禁用 Aptabase + Sentry | ✅ |
| SnapAny 自动更新禁用 | checkSoftwareLatestVersion 返回无更新 | ✅ |
| yt-dlp 独立更新 | ytdlp-release.json + update-ytdlp.sh + GitHub releases | ✅ |
| snapfile-go → snapfile-rs | 二进制替换 | ✅ |
| 解析/批量并发控制 | maxParsingTasks + batchSize 队列 | ✅ |
| 断点续传 + 分块加速 | snapfile-rs 内置 | ✅ |
| HLS 直播录制 | snapfile-rs 设计文档已完成 | 🔧 规划中 |

### 13.2 高 churn 组件已解耦

需要频繁更新的组件已从 SnapAny UI 中解耦:

| 组件 | 更新频率 | 解耦方式 |
|------|---------|---------|
| yt-dlp | 高（站点改版） | 已独立，update-ytdlp.sh 可随时更新 |
| ffmpeg | 中 | 可参照 yt-dlp 模式做独立更新脚本 |
| snapfile | 低 | snapfile-rs Rust 实现，HLS 在建 |

UI 层是低 churn 部分——界面逻辑不因 YouTube 改版而需更新。
把高 churn 组件解耦后，UI 层保持原样是合理的。

### 13.3 全量复刻的隐性成本

- 格式选择引擎的错误分支、错误诊断的关键词匹配、嗅探器三层过滤正则、
  认证站点域名归一化规则等边缘逻辑经过大量真实使用打磨，
  复刻时漏掉任何一个都会产生用户可见的回归
- 15-25 天的工期只是"看起来能用"，达到原版稳健程度需更长时间调试

### 13.4 补丁路线的风险与缓解

| 风险 | 缓解 |
|------|------|
| SnapAny 发布新版导致补丁失效（minified 代码结构变化） | 已禁用自动更新，锁 0.8.1 |
| macOS 未来不再兼容当前 Electron 版本 | 届时再考虑复刻，基于已知 final 版本做完整逆向 |
| GitHub releases 速率限制（60 次/小时/IP） | 已知限制，正常使用频率下不触发 |

### 13.5 建议行动项

1. **当前**: 继续投入 patches + snapfile-rs 路线
2. **snapfile-rs 侧**: 优先完成 HLS 实现计划（已有成熟设计文档）
3. **补丁侧**: 可补一个 ffmpeg 独立更新脚本（参照 update-ytdlp.sh 模式）
4. **备选**: 本文档保留为全量复刻备选方案，在补丁路线不可持续时启用
