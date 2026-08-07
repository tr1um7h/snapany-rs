# SnapAny App Patches

对 `/Applications/SnapAny.app` 的 Electron 主进程和渲染进程进行补丁修改。

## 修改内容

### 1. 禁用遥测
- 禁用 Aptabase 使用统计（启动、解析成功/失败、下载成功/失败）
- 禁用 Sentry 错误/崩溃上报

### 2. 保留 yt-dlp 更新
- 从 `ytdlp-release.json` 读取 yt-dlp 版本和下载地址
- 支持从 GitHub releases 下载最新 yt-dlp
- 保留启动时检查和手动更新功能

## 文件结构

```
patches/snapany-app/
├── out/
│   ├── main/
│   │   └── main.js              # 主进程补丁
│   └── renderer/assets/
│       └── index-C602CO1A.js    # 渲染进程补丁
├── ytdlp-release.json           # yt-dlp 版本配置
├── apply.sh                     # 应用补丁脚本
└── README.md
```

## 使用方法

```bash
# 应用补丁到 /Applications/SnapAny.app
cd patches/snapany-app
./apply.sh

# 启动应用
open /Applications/SnapAny.app
```

## yt-dlp 配置

`ytdlp-release.json` 配置 yt-dlp 的版本和下载地址：

```json
{
  "version": "2026.07.04",
  "downloadUrls": {
    "windows": "https://github.com/yt-dlp/yt-dlp/releases/download/2026.07.04/yt-dlp.exe",
    "macOS": "https://github.com/yt-dlp/yt-dlp/releases/download/2026.07.04/yt-dlp_macos"
  }
}
```

更新 yt-dlp 版本时，只需修改此配置文件。

## 注意事项

- 应用补丁后需要重新签名（apply.sh 自动处理）
- 签名是 ad-hoc，严格签名验证会失败，但应用可正常运行
- 原文件会被备份为 `.bak` 后缀
