# Snapfile-RS 功能设计文档

**日期**: 2026-08-08
**状态**: 已实现

---

## 1. 断点续传和分片（snapfile-rs）

### 1.1 优先级调整

基于实际场景分析和 **2026-08-08 CDN 实测验证**（见 1.5）：

| 功能 | 优先级 | 理由 |
|------|--------|------|
| 断点续传（单连接） | **P0** | 网络中断时避免重下，收益最高 |
| 分片并行下载 | **P1** | bilibili CDN 确认限单连接（~9.5MB/s），4 连接 2.8x 加速，视频文件收益明显 |

**场景分析（Q2）**：

- **断点续传**：价值在网络可靠性，不在速度。500MB 文件 @ 500KB/s ≈ 17 分钟；中途断网时，无续传需从零重下，有续传则从中断点继续。对稳定连接几乎零成本，对不稳定网络价值高，作为保险值得实现。
- **分片并行**：bilibili CDN 已确认限单连接速度（~9.5MB/s），多连接可获得 2.8x 加速。音频文件 <10MB 时单连接 <1s 完成，收益微小；视频文件 30MB+ 时收益明显（3.3s → 1.2s）。

### 1.2 断点续传（P0）

**策略**：单连接下载，失败/取消后保留 `.partial` 文件，下次同 URL 任务自动续传。

**持久化路径**：

Electron 传给 snapfile 的 `tempDir` 是 `{downloadPath}/.SnapAny/{taskId}`，每次任务 UUID 不同。续传文件需要稳定路径，放在：

```
{downloadPath}/.SnapAny/.resume/{url_hash}/
├── {hash}.partial          # 已下载的部分
└── {hash}.partial.meta     # 元数据（已下载字节数、etag、last_modified）
```

snapfile-rs 从 `outputDir` 推导续传路径：`{outputDir}/.SnapAny/.resume/{url_hash}/`。

**元数据格式**（精简版，单连接只需记录已下载字节数）：
```json
{
  "url": "https://...",
  "downloaded_bytes": 52428800,
  "total_size": 104857600,
  "etag": "\"abc123\"",
  "last_modified": "Wed, 08 Aug 2026 10:00:00 GMT"
}
```

**续传流程**：
1. 下载前检查 `.partial` 和 `.meta` 是否存在
2. 如果存在且 `etag`/`last_modified` 匹配，发送 `Range: bytes={downloaded_bytes}-`
3. 服务器返回 206 → 追加写入 `.partial`
4. 服务器返回 200（不支持续传）→ 从头下载，覆盖 `.partial`
5. 每秒更新 `.meta` 中的 `downloaded_bytes`
6. 下载完成后将 `.partial` 移动到任务的 `download/` 目录，删除 `.meta`

**日志要求**（方便确认服务器支持情况）：
```
INFO  探测 Range 支持: HEAD {url}
INFO  Accept-Ranges: bytes | none
INFO  Content-Length: 104857600
INFO  ETag: "abc123", Last-Modified: Wed, 08 Aug 2026 10:00:00 GMT
INFO  续传检查: .partial 存在, downloaded=52428800, total=104857600
INFO  续传验证: ETag 匹配, 发送 Range: bytes=52428800-
INFO  服务器响应: 206 Partial Content, 续传成功
WARN  续传验证: ETag 不匹配, 从头下载
WARN  服务器不支持 Range (返回 200), 从头下载
INFO  下载完成: 移动 .partial 到 {download_dir}
```

**完成统计日志**（每个文件下载完成时输出，P2 决策关键数据）：
- `total_bytes`, `duration_secs`, `avg_speed_kbps`, `peak_speed_kbps`
- `resumed_bytes`（本次续传恢复的字节）, `this_session_bytes`
- `range_supported`, `server_header`, `ttfb_ms`（首字节时间）

**周期速度日志**：每 5 秒输出当前速度到日志文件（KB/s、累计字节、百分比），用于观察速度是否被限速。

**清理逻辑**：
- 任务完成：`.partial` 移动到 download 目录，删除 `.meta`
- 任务取消/失败：保留 `.partial` 和 `.meta`（供下次续传）
- `CleanupGuard` 只清理 `{tempDir}/{taskId}`，不清理 `.resume/` 目录
- 可选：启动时扫描 `.resume/`，清理超过 7 天的过期文件

### 1.3 分片并行下载（P1，已确认收益）

CDN 实测已确认 bilibili 限单连接速度（见 1.5）。实现自适应分片：
- 小文件 (≤10MB) 跳过分片，直接走单连接 + 续传流程（P0）
- 连接数由文件大小自适应决定（见 4.2），上限 `--max-connections-per-file`（默认 4）
- 分片大小 = `ceil(total_size / connection_count)`，不设固定上下限

**分片连接数**（参考实测数据推导）：
```
文件 <= 10MB  → 1 连接（不分片）
文件 <= 50MB  → 2 连接
文件 <= 200MB → 4 连接
文件 > 200MB  → 8 连接（上限）
```

**实现细节**：
- 每个分片独立重试（最多 3 次），失败后标记该分片为 pending，其他分片继续
- 分片完成后将数据写入对应偏移位置，更新元数据 `completed_chunks`


---

### 1.4 续传文件清理（Q1）

续传目录按 URL 哈希存储，跨任务共享同一 URL。

- **任务完成**：`.partial` 移到最终目录，`.meta` 删除
- **任务取消/失败**：保留 `.partial` + `.meta`（供续传）
- **临时目录**：`CleanupGuard` 照常清理，不影响 `.resume/`
- **懒清理（TTL）**：snapfile 处理新任务时，扫描该 outputDir 的 `.resume/`，删除 `.partial.meta` 修改时间超过 `--resume-max-age-days`（默认 7）的条目
- **不同步删除**：任务从 Electron UI 删除时 snapfile 已退出；按 URL 共享意味着同步删除需扩展协议，收益低。TTL 懒清理足够
- **更新时同步更新**：任务重试由续传机制天然覆盖（检查 `.partial` 续传，元数据每秒更新）


### 1.5 CDN 实测验证（2026-08-08）

**测试方法**：yt-dlp 解析 `BV1awRpBQE98` → curl 探测 HEAD/Range + 实际下载测速。

**服务器标识**：`openresty` (bilibili BVC bcache CDN)

| 项目 | 结果 | 数据 |
|------|------|------|
| Accept-Ranges | 支持 | `bytes` |
| 206 Partial Content | 支持 | Range 请求返回 206 + `content-range` |
| Content-Length 一致性 | 稳定 | 音频 6131494, 视频 31604698, 多次请求一致 |
| ETag | **不返回** | bilibili CDN 无 ETag 头 |
| Last-Modified | 稳定 | 多次请求返回同一时间戳 |
| **续传数据完整性** | 通过 | 分段下载合并 MD5 = 直接下载 MD5 |

**速度实测**（音频 6.1MB / 视频 31.6MB）：

| 测试 | 耗时 | 速度 | 加速比 |
|------|------|------|--------|
| 音频 1 连接 | 0.56s | 10.9 MB/s | 基准 |
| 音频 2 连接 | 0.24s | 28.4 MB/s (合计) | 2.3x |
| 视频 1 连接 | 3.33s | 9.5 MB/s | 基准 |
| 视频 4 连接 | 1.21s | 26.1 MB/s (合计) | 2.8x |

**结论**：
- bilibili CDN **确认限单连接速度**（~9.5-10.9 MB/s），多连接可获得 2-3x 加速
- 无 ETag，但 `Last-Modified` 稳定，续传验证依赖 Last-Modified 匹配（当前 `matches_server()` 已支持此回退逻辑）
- bilibili 签名 URL 有 `deadline` 参数（约 2 小时有效），过期后需 yt-dlp 重新解析。新 URL 哈希不同，旧 `.partial` 不会被复用，TTL 清理处理孤儿文件
- 音频文件 <10MB 时单连接 <1s 完成，分片收益微小；视频文件 30MB+ 时分片收益明显

**对 matches_server() 的影响**：bilibili CDN 不返回 ETag，`matches_server()` 的第一判断分支（ETag 比较）两侧均为 None → 跳过；第二判断分支（Last-Modified 比较）命中 → 返回 true。续传验证正常工作。

## 2. yt-dlp 自动检测（Electron 侧）

**归属说明**：此功能在 Electron 侧实现，snapfile-rs 不参与。`checkYtDlpUpdate()` 保留在 `main.js`。

### 2.1 数据库设计

**数据库位置**：`~/Library/Application Support/SnapAny/data.db`（Electron 现有数据库）

**Schema**：
```sql
CREATE TABLE yt_dlp_version (
    id INTEGER PRIMARY KEY CHECK (id = 1),  -- 单行表
    local_version TEXT NOT NULL,             -- 本地 yt-dlp 版本
    remote_version TEXT,                     -- 上次检查的远程版本
    download_url TEXT,                       -- 对应的下载 URL
    last_check_time INTEGER NOT NULL,        -- Unix timestamp
    created_at INTEGER NOT NULL
);
```

### 2.2 检查流程

```javascript
async function checkYtDlpUpdateWithInterval() {
    const now = Math.floor(Date.now() / 1000);
    const CHECK_INTERVAL_SECS = 90 * 24 * 3600;  // 3 个月

    const record = db.getLatestYtDlpVersion();

    // 1. 未超过 3 个月，使用缓存的远程版本
    if (record && now - record.last_check_time < CHECK_INTERVAL_SECS) {
        if (record.remote_version !== record.local_version) {
            return { action: "download", url: record.download_url, version: record.remote_version };
        }
        return { action: "up_to_date" };
    }

    // 2. 超过 3 个月或首次检查，请求 GitHub API
    try {
        const release = await fetchGitHubLatestRelease();
        db.upsertYtDlpVersion({
            local_version: await getLocalVersion(),
            remote_version: release.version,
            download_url: release.download_url,
            last_check_time: now,
        });

        if (release.version !== local_version) {
            return { action: "download", url: release.download_url, version: release.version };
        }
        return { action: "up_to_date" };

    } catch (e) {
        logError("GitHub API 请求失败", { error: e.message });

        // 3. 尝试使用缓存
        if (record) {
            logInfo("使用缓存版本", { remote_version: record.remote_version });
            if (record.remote_version !== record.local_version) {
                return { action: "download", url: record.download_url, version: record.remote_version };
            }
            return { action: "up_to_date" };
        }

        // 4. 首次检查就失败，提示用户手动更新
        return { action: "manual_required" };
    }
}
```

### 2.3 GitHub API

**端点**：`https://api.github.com/repos/yt-dlp/yt-dlp/releases/latest`

**响应示例**：
```json
{
  "tag_name": "2026.07.04",
  "assets": [
    {
      "name": "yt-dlp_macos",
      "browser_download_url": "https://github.com/yt-dlp/yt-dlp/releases/download/2026.07.04/yt-dlp_macos"
    }
  ]
}
```

**速率限制**：60 次/小时/IP（未认证）

**缓存策略**：
- 3 个月内不请求 API，使用数据库缓存
- API 失败时使用上次缓存的版本信息
- 首次检查失败时提示用户手动更新

---

## 3. 批量下载增强（Electron 侧）

**归属说明**：不新增 Import File 功能。现有 Paste Link 已支持批量链接，只需增强参数控制。

### 3.1 现有行为

Paste Link 读取剪贴板文本，提取 URL 列表：
- 1 个 URL：直接下载
- 多个 URL：弹出选择弹窗（MultipleLinksModal），用户勾选后批量下载

### 3.2 修改内容

1. **限制从 10 提升到 50**：`links.slice(0, 10)` → `links.slice(0, 50)`
2. **超过 50 时提示用户**：显示 warning 通知
3. **跳过选择弹窗**：多链接直接批量下载，不再弹出 MultipleLinksModal
4. **新增并发控制参数**（Electron General 设置）：
   - `max_parsing_task`：同时解析的 URL 数（默认 3，避免触发网站限流）
   - `batch_size`：每批启动的下载任务数（默认 5，充分利用本地资源）

### 3.3 并发控制

两个参数均为 Electron 内部配置，不是 snapfile-rs 命令行参数：

- **max_parsing_task**：控制 yt-dlp 解析并发，避免触发网站限流（默认 3）
- **batch_size**：控制下载并发，充分利用本地资源（默认 5）

### 3.4 流程

```
粘贴链接
  ↓
提取 URL（最多 50 个，超过 50 提示）
  ↓
直接批量下载（不弹选择框）
  ↓
批量解析（并发数 = max_parsing_task）
  - 第 1 批：解析 URL 0-2
  - 第 2 批：解析 URL 3-5
  - ...
  ↓
按 batch_size 分批启动下载
  - 第 1 批：启动任务 0-4
  - 任务 0 完成 → 启动任务 5
  - 任务 1 完成 → 启动任务 6
  - ...
```

## 4. 配置参数汇总

### 4.1 snapfile-rs 命令行

参数取值基于 2026-08-08 bilibili CDN 实测数据（单连接 ~9.5MB/s，4 连接 2.8x 加速）。

```bash
snapfile \
  --ffmpeg-path /path/to/ffmpeg \
  --ffprobe-path /path/to/ffprobe \
  --max-downloading-task 5 \
  --log-level info \
  --resume-max-age-days 7 \
  --max-connections-per-file 4 \
  --connect-timeout-secs 30 \
  --read-timeout-secs 60
```

| 参数 | 默认值 | 依据 |
|------|--------|------|
| `--max-downloading-task` | 5 | 用户可调高 `--max-connections-per-file` 至 8，最坏 40 并发连接 |
| `--resume-max-age-days` | 7 | bilibili 签名 URL 有效期 ~2h，但 TTL 用于清理孤儿文件，7 天足够 |
| `--max-connections-per-file` | 4 | 实测 4 连接 2.8x 加速；>200MB 大文件可调至 8（预计 3.5x） |
| `--connect-timeout-secs` | 30 | CDN 建连 ~100ms，30s 足够覆盖代理/网络抖动 |
| `--read-timeout-secs` | 60 | 9.5MB/s 下 60s 无数据 = 异常停滞，需触发重试 |

### 4.2 分片连接数（按文件大小自适应）

基于实测速度推导的分片策略。小文件不分片（HTTP 开销 > 收益）。

| 文件大小 | 连接数 | 推导 | 单连接耗时 |
|----------|--------|------|------------|
| ≤ 10MB | 1 (不分片) | <1s 完成，分片开销占主导 | <1s |
| ≤ 50MB | 2 | ~5s → ~2s，2.3x 加速 | ~5s |
| ≤ 200MB | 4 | ~21s → ~7s，2.8x 加速 | ~21s |
| > 200MB | 8 (上限) | 1GB ~105s → ~30s，预计 3.5x | ~105s |

连接数计算公式：`min(max_connections, max(1, ceil(file_size_mb / 25)))`

### 4.3 Electron General 设置

| 参数 | 默认值 | 依据 |
|------|--------|------|
| Max downloading tasks | 5 | 传给 snapfile 的 `--max-downloading-task` |
| Max parsing tasks | 3 | 避免 bilibili 对 yt-dlp 解析请求限流 |
| Batch size | 5 | 与 max downloading tasks 一致，充分利用下载槽位 |


---

## 5. 错误处理

### 5.1 断点续传（snapfile-rs）

- 服务器不支持 Range → 从头下载，记录 warning
- ETag/Last-Modified 不匹配 → 从头下载，记录 warning
- 元数据写入失败 → 记录错误，继续下载（下次无法续传）
- URL 过期 → snapfile-rs 无法重新解析，返回错误给 Electron
- 任务取消/失败 → 保留 `.partial` 和 `.meta`

### 5.2 yt-dlp 更新（Electron）

- GitHub API 超时 → 使用缓存版本
- 首次检查失败 → 提示用户手动更新
- 下载失败 → 保留旧版本，记录错误

### 5.3 批量下载（Electron）

- URL 解析失败 → 通过 `onDownloadProgress` 推送失败状态给渲染进程，任务显示错误信息，继续解析其他
- 下载失败 → 标记任务为失败，继续下载其他
- 文件名冲突 → 自动添加后缀 `_1`, `_2`

---

## 6. 测试计划

### 6.1 断点续传

- 首次下载（无 .partial 文件）
- 续传（.partial 存在，ETag 匹配）
- 续传失败（ETag 不匹配，从头下载）
- 服务器不支持 Range（从头下载）
- 取消后保留 .partial
- 完成后清理 .partial 和 .meta

### 6.2 yt-dlp 更新

- 首次检查（数据库为空）
- 3 个月内不检查
- 超过 3 个月检查
- GitHub API 失败时使用缓存

### 6.3 批量下载

- 多链接粘贴
- 超过 50 个 URL 时提示
- 并发解析控制
- 批量下载控制

---

## 7. 实现优先级

1. **P0**：断点续传（snapfile-rs，单连接）— **已实现，已验证**
2. **P1**：分片并行下载（snapfile-rs，多连接）— **已实现，已测试**
3. **P1**：yt-dlp 自动检测（Electron 侧）— **已实现**
4. **P2**：批量下载增强（Electron 侧）— **已实现**

---

**文档结束**
