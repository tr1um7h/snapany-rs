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
# SnapAny App Patches

对 `/Applications/SnapAny.app` 的 Electron 主进程和渲染进程进行补丁修改。

## 修改内容

### 1. 禁用遥测
- 禁用 Aptabase 使用统计（启动、解析成功/失败、下载成功/失败）
- 禁用 Sentry 错误/崩溃上报

### 2. 禁用 SnapAny 软件更新
- `checkSoftwareLatestVersion` 返回无更新
- `downloadSoftwareUpdate`、`checkSoftwarePackageExists`、`installSoftwareUpdate` 改为 no-op
- 阻止 SnapAny 自动检查和强制更新

### 3. 保留 yt-dlp 更新
- 从 `ytdlp-release.json` 读取 yt-dlp 版本和下载地址
- 支持从 GitHub releases 下载最新 yt-dlp
- 保留启动时检查和手动更新功能

### 4. 禁用 SnapAny API 请求
- 禁用 favicon API 请求（`api.snapany.com/desktop/favicon/*`）
- 禁用 info API 请求（`api.snapany.com/desktop/info`）

## 文件结构

```
patches/snapany-app/
├── out/
│   ├── main/
│   │   └── main.js              # 主进程补丁
│   └── renderer/assets/
│       └── index-C602CO1A.js    # 渲染进程补丁
├── ytdlp-release.json           # yt-dlp 版本配置
├── yt-dlp_macos                 # yt-dlp 独立二进制 (v2026.07.04)
├── apply.sh                     # 应用所有补丁
├── update-ytdlp.sh              # 只更新 yt-dlp
├── revert.sh                    # 回滚所有修改
├── README.md
└── CHANGELOG.md
```

## 使用方法

### 首次部署（asar 布局 → app/ 目录布局）

```bash
cd patches/snapany-app
./init-from-asar.sh
```

一次性转换：解包 `app.asar` → `Resources/app/`，合入 `app.asar.unpacked`，应用全部补丁，
`app.asar` 改名为 `app.asar.disabled`（保留以便回滚），重签名。
之后 Electron 自动从 `app/` 目录加载，补丁只需覆盖 JS 文件。

回滚布局：`rm -rf /Applications/SnapAny.app/Contents/Resources/app && mv .../app.asar.disabled .../app.asar`，再重签名。

### Files Merge（文件拼接）功能

侧边栏新增菜单「文件拼接」：
- 添加/拖入多个视频 → 按文件名自然排序（默认升序，footer 下拉可切降序）→ 合并
- ffmpeg concat demuxer，优先无损流复制（秒级），参数不一致时自动整体重编码
- 输出到设置的下载目录，格式沿用设置的视频格式

### 应用所有补丁

```bash
cd patches/snapany-app
./apply.sh
```

这会备份原文件、应用补丁、重新签名。

### 只更新 yt-dlp

```bash
./update-ytdlp.sh
```

这会将 `yt-dlp_macos` 替换到 app 中并重新签名。

### 回滚所有修改

```bash
./revert.sh
```

这会恢复所有 `.bak` 备份文件并重新签名。

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

更新 yt-dlp 版本时，只需修改此配置文件。下次启动 app 时会自动检测并下载新版本。

## 注意事项

- 应用补丁后需要重新签名（脚本自动处理）
- 签名是 ad-hoc，严格签名验证会失败，但应用可正常运行
- 原文件会被备份为 `.bak` 后缀
- GitHub releases 有速率限制（60 次/小时/IP），频繁更新可能被限流
