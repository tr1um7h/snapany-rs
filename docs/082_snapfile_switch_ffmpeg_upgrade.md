# Snapfile 开关 + FFmpeg 版本展示

**日期**: 2026-08-11
**状态**: 已实现

---

## 功能 1：Snapfile Go/Rust 开关

### 背景

snapfile-rs (Rust 重写版) 在点播场景下性能优于原版，但缺少 HLS 直播录制能力。
需要一个开关让用户在必要时回退到原版 snapfile-go。

### 能力对比

| 场景 | snapfile-rs | snapfile-go |
|------|-------------|-------------|
| Bilibili/YouTube 点播 | ✅ 多连接加速 | ✅ 单连接 |
| 直播录制 (HLS) | ❌ | ✅ |
| 断点续传 | ✅ | ❌ |
| arm64 原生 | ✅ | ❌ 仅 x86_64 |

### 设置字段

```json
{
  "useGoSnapfile": false
}
```

- 字段名: `useGoSnapfile`
- 类型: `boolean`
- 默认值: `false` (使用 Rust 版)

### 二进制存放

| 文件 | 路径 | 说明 |
|------|------|------|
| snapfile (Rust) | `app.asar.unpacked/public/bin/snapfile` | 当前默认 |
| snapfile-go (Go) | `app.asar.unpacked/public/bin/snapfile-go` | 新增 |

通过 `getBinPath("snapfile-go")` 解析路径。

### 主进程改动

**SnapfileService 构造函数** (`main.js:1421`):

```javascript
// 当前
this.executablePath = getBinPath("snapfile");

// 改为
const useGo = settingStore.get("useGoSnapfile");
this.executablePath = getBinPath(useGo ? "snapfile-go" : "snapfile");
```

**initSnapfile()** (`main.js:5364`):

- `setFilePermissions` 和 `checkFileExists` 需根据 setting 检查对应路径

### 切换时机

设置保存后重启 snapfile 进程：
1. `snapfileService.stop()` — 停止当前进程
2. 构造函数重新读取 setting
3. `snapfileService.start()` — 用新路径启动

SnapfileService 已有完善的 stop/start 机制，无需额外开发。

### UI 设计

- **位置**: 设置页常规区底部，embedSubtitle 开关下方
- **组件**: `ToggleSwitch`
- **文案**:
  - 中文: `使用原版 snapfile (Go)`
  - 英文: `Use original snapfile (Go)`
- **说明**: `重启下载引擎后生效。原版支持直播录制等功能。`

### 部署脚本改动

`dist/package.sh` 增加:

```bash
# 复制 Go 原版 snapfile
cp "$PROJECT_DIR/vendor/snapfile-go/snapfile" "$SCRIPT_DIR/snapfile-go"
# 部署到 app bundle
cp "$SCRIPT_DIR/snapfile-go" "$APP_PATH/Contents/Resources/app.asar.unpacked/public/bin/snapfile-go"
```

### 已知限制

- snapfile-go 仅 x86_64，Apple Silicon 需 Rosetta 2
- 如果启动失败，用户可关闭开关恢复 Rust 版

---

## 功能 2：FFmpeg 版本展示

About 页只展示本地 FFmpeg 版本，不检测远程版本，也不自动升级。

### IPC 路由

| 方法 | 说明 |
|------|------|
| `getLocalFFmpegVersion()` | 返回 `{ version }`，读取本地 `ffmpeg -version` |

### UI 设计

About 页组件版本行下方显示：

```
FFmpeg Version  6.1.1-tessus  View Releases
```

### 部署

- 不再打包或复制 `ffmpeg-release.json`
- 不调用 GitHub API
- 不替换 `ffmpeg/ffprobe` 二进制

---

## 实现顺序建议

1. **Phase 1**: snapfile 开关 (改动小，风险低)
2. **Phase 2**: FFmpeg 版本展示 (只读本地版本)

---

**文档生成时间**: 2026-08-11
**依赖文档**: `vendor/081_design.md` (snapfile 逆向分析)
