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
