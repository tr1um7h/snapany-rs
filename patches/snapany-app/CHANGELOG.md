# Changelog

SnapAny App 补丁修改记录

## [1.3.0] - 2026-08-15

### 修复（Phase 1：登录态）
- `verifyLogin` 增加 bilibili 分支：点名检查 `SESSDATA` + `bili_jct`，修复「仅访问就种匿名 cookie（`buvid3`）导致误判已登录」的问题（此前 bilibili 走 `cookies.length > 0` 回退，误标为已授权且导出的 cookies.txt 无登录态）
- `authSites` 默认列表新增 Bilibili（含幂等迁移：去重旧的无 www 条目、重置误标授权状态，确保恰有一条规范条目）
- `getParseInfo` 每次解析前重新调用 `saveCookieFile()` 导出 cookies.txt，使嗅探页/任意 webview 登录后立即生效（此前只在 `completeAuth` 时导出）

### 说明
- 该期修复「登录态未进下载链路」；yt-dlp bilibili bangumi 提取器缺陷（#13795/#13634）仍待上游修复，见 `arch.md` 第十三章

---

# Changelog

SnapAny App 补丁修改记录

## [1.2.0] - 2026-08-14

### 新增
- **FilesMerge（文件拼接）菜单**：新增第 5 个侧边栏菜单，把多个视频文件按文件名自然排序（默认升序，可切换降序）首尾拼接为一个视频
  - 主进程：`VideoAudioMergeService.filesMergeConcat()`，ffmpeg concat demuxer，先 `-c copy` 无损流复制，失败自动回退 `libx264/aac` 重编码；取消（SIGKILL）不会误触发回退
  - IPC：新增 `filesMerge` procedure（复用 `onVideoAudioMergeProgress` 通道推送进度）；输出目录/格式沿用设置的下载目录和视频格式
  - 渲染层：`FilesMergePage` 组件（添加/拖拽文件、列表、排序切换、进度/成功/失败/重试 UI）；16 种语言的 i18n 注入（`filesMergeNs` + `application.menu.filesMerge`）
- `init-from-asar.sh`：一次性把 app 从 asar 布局转换为 `Resources/app/` 目录布局（解包 + 合入 unpacked + 应用补丁 + 禁用 asar + 重签名）

### 修改
- 部署布局变更：`/Applications/SnapAny.app` 由 `app.asar` 改为 `Resources/app/` 目录（Electron 自动回退加载目录布局；`app.asar` 改名 `app.asar.disabled` 保留以便回滚）

### 已知问题
- 签名是 ad-hoc，严格签名验证会失败，但应用可正常运行
- `-c copy` 要求各视频编码参数一致，不一致时自动整体重编码（速度慢但结果正确）

---
## [1.1.0] - 2026-08-08

### 新增
- 批量下载并发控制（`maxParsingTasks` 和 `batchSize` 配置）
- yt-dlp 版本自动检测（3 个月检查间隔 + GitHub API + 缓存策略）
- 分块并行下载（自适应连接数）
- 断点续传（Range 支持 + 统计日志 + TTL 清理）
- 粘贴 URL 成功提示（显示识别到的 URL 数量）

### 修改
- `startDownload` 改为异步执行，立即返回任务列表，UI 即时更新
- 解析失败时推送状态给渲染进程，用户可见错误信息
- URL 提取正则优化，支持无协议前缀的 URL（如 `bilibili.com/video/...`）
- General 设置面板：`Max Parsing Tasks` 和 `Batch Size` 改为数字输入框
- About 面板：添加 yt-dlp 版本号和 "View Releases" 链接

### 修复
- 修复渲染进程 JS 语法错误（commit 3601a0c 导致的空白启动问题）
- 修复无协议前缀 URL 识别失败问题

### 技术细节
- `main.js` 修改：
  - 添加 `yt_dlp_version` SQLite 表用于版本缓存
  - 实现 `fetchGitHubLatestRelease()` 查询 GitHub API
  - 修改 `getYtDlpLatestVersion()` 支持 3 个月检查间隔
  - 实现解析和下载并发控制队列
  - `startDownload` 改为异步执行，解析失败推送状态
- `index-C602CO1A.js` 修改：
  - 优化 `extractUrlsFromText` 正则表达式
  - 添加粘贴成功通知
  - 数字输入框样式调整
  - About 面板添加 yt-dlp 版本和链接
- 部署脚本：
  - `apply.sh` 移除备份步骤（git 已有版本管理）
  - `package.sh` 合并 snapfile 替换和 JS 补丁应用

### 已知问题
- 签名是 ad-hoc，严格签名验证会失败，但应用可正常运行
- GitHub releases 有速率限制（60 次/小时/IP），频繁更新可能被限流

---

# Changelog

SnapAny App 补丁修改记录

## [1.0.0] - 2026-08-07

### 新增
- yt-dlp 独立二进制更新支持（从 GitHub releases 下载）
- `ytdlp-release.json` 配置文件，用于管理 yt-dlp 版本和下载地址
- `update-ytdlp.sh` 脚本，只更新 yt-dlp 并重新签名
- `revert.sh` 脚本，回滚所有修改到原始状态

### 修改
- 禁用 Aptabase 使用统计遥测
- 禁用 Sentry 错误/崩溃上报
- 禁用 SnapAny 软件更新检查和强制更新
- 禁用 favicon API 请求（`api.snapany.com/desktop/favicon/*`）
- 禁用 info API 请求（`api.snapany.com/desktop/info`）
- yt-dlp 从 Python wrapper 替换为独立二进制（`yt-dlp_macos`）

### 技术细节
- `main.js` 修改：
  - 注释 `initAptabase()` 和 `initSentry()` 调用
  - 注释所有 `main$1.trackEvent()` 调用
  - `getSoftwareInfo()` 改为从 `ytdlp-release.json` 读取 yt-dlp 配置
  - `checkSoftwareLatestVersion` 返回 `hasUpdate: false`
  - 保留 `checkYtDlpUpdate()` 和 `updateYtDlp()` 功能
- `index-C602CO1A.js` 修改：
  - 注释 Sentry 初始化代码
  - 禁用 `FaviconImg` 组件的 API 请求

### 已知问题
- 签名是 ad-hoc，严格签名验证会失败，但应用可正常运行
- GitHub releases 有速率限制（60 次/小时/IP），频繁更新可能被限流

### 文件清单
```
patches/snapany-app/
├── out/
│   ├── main/main.js              # 主进程补丁
│   └── renderer/assets/
│       └── index-C602CO1A.js     # 渲染进程补丁
├── ytdlp-release.json            # yt-dlp 版本配置
├── yt-dlp_macos                  # yt-dlp 独立二进制 (v2026.07.04)
├── apply.sh                      # 应用所有补丁
├── update-ytdlp.sh               # 只更新 yt-dlp
├── revert.sh                     # 回滚所有修改
├── README.md
└── CHANGELOG.md
```
