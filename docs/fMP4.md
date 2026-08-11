# fMP4 评估：替代 TS 中间格式

**日期**: 2025-08-11
**结论**: fMP4 在所有维度优于或等于 TS→remux，建议采用。

## 背景

原方案 (plan v2) 中 Live 录制使用 MPEG-TS 中间格式：

```
录制: ffmpeg -i live.m3u8 -c copy → temp/recording.ts
停止: SIGINT → ffmpeg 退出
转换: ffmpeg -i recording.ts -c copy -movflags +faststart → output.mp4
移动: mover → 最终目录
```

问题：停止录制后需要额外 remux 步骤（数秒~数十秒），用户需等待。临时磁盘占用翻倍（TS + MP4 两份文件）。

fMP4 (fragmented MP4) 方案：录制时直接输出 fMP4，停止后无需转换。

```
录制: ffmpeg -i live.m3u8 -c copy -movflags +empty_moov+default_base_moof+frag_keyframe → output.mp4
停止: SIGINT → ffmpeg 退出 → 文件直接可用
移动: mover → 最终目录
```

## 实验验证

使用 SnapAny 内置 ffmpeg 6.0-tessus，测试 4 个场景。

### 1. VOD 正常完成

```
ffmpeg -i test_stream.m3u8 -c copy -movflags +empty_moov+default_base_moof+frag_keyframe vod_fmp4.mp4
```

结果：可播放。moov 在文件开头 (offset 0x20)。seek 正常。文件 63KB。

### 2. Live + SIGINT（优雅停止）

录制一个无限直播流，5 秒后发送 SIGINT。

结果：
- ffmpeg exit code 255，但输出 `progress=end`
- 文件 147KB，时长 24.97s
- moov 在文件开头，所有 fragment 完整
- ffmpeg 可正常解码播放
- seek 到任意时间点成功

### 3. Live + SIGKILL（硬取消，无数据写入）

启动后立即 kill -9。

结果：28 字节无效文件（只有 ftyp，没有 moov）。此场景对应 `delete-task`，设计上丢弃文件，无影响。

### 4. Live + SIGKILL（硬取消，数据已写入）

录制约 9 秒后文件增长到 262KB 时 kill -9。

结果：
- 文件 262KB，metadata 时长 50s
- 前 N-1 个 fragment 完整：1305 帧可解码 ≈ 43.5s
- 最后一个正在写入的 fragment 截断损坏
- ffmpeg 报 `partial file` + `Invalid NAL unit size`，但 exit code 0（非 fatal）
- seek 到 30s 成功，正常解码

关键：已写入的 fragment 全部完好，只有最后一个截断。与 TS 的行为完全等价——TS 最后一个 packet 同样可能截断。没有任何容器格式能在 SIGKILL 时保证最后一个写入单元完整。

### 5. `+faststart +empty_moov` 组合

测试两者是否冲突。

结果：无冲突，empty_moov 主导，faststart 冗余但不报错。VOD 和 Live 可以用统一的 movflags。

### 6. 文件大小对比

120s 测试视频 (640x360, 30fps, libx264)：

| 格式 | 大小 | muxing overhead |
------|------|----------------|
| 标准 MP4 (`+faststart`) | 699,829 bytes | 6.71% |
| fMP4 (`+empty_moov+...`) | 687,430 bytes | 4.82% |
| fMP4 (`+faststart+empty_moov+...`) | 687,430 bytes | 4.82% |

fMP4 比 +faststart 更小，因为 +faststart 需要第二趟重写文件产生额外开销。

### 7. 兼容性

fMP4 的 ftyp major brand 是 `iso5` (ISO BMFF v5)。

支持的播放器：VLC、QuickTime、Chrome、Safari、Firefox、Edge、IINA、mpv、PotPlayer。

不支持的：极少数上古播放器（如早期 Windows Media Player）。

seek 测试通过（fMP4 和标准 MP4 一样支持随机访问）。

## 方案对比

| 维度 | TS → remux | fMP4 |
|------|-----------|------|
| 录制格式 | TS | fMP4 (.mp4) |
| 停止后 | 需 remux (数秒~数十秒) | 直接可用 |
| ffmpeg 调用次数 (Live) | 2 次 | 1 次 |
| 临时磁盘 | TS + MP4 两份 | MP4 一份 |
| SIGINT 后文件 | 完整 | 完整 |
| SIGKILL 后文件 (有数据) | 已写部分完整 | 已写部分完整 |
| 播放兼容性 | 标准 MP4 | fMP4 (现代播放器全部支持) |
| 实现复杂度 | 两阶段 | 单阶段 |
| 代码量 | run_hls_live + remux_ts_to_mp4 | run_hls_live (简化) |

## 对 Plan 的影响

如果采用 fMP4，plan v2 的变更：

### 删除

- Task 7 (remux_ts_to_mp4 函数) — 整个 Task 删除
- mock_ffmpeg_remux.sh — 删除
- run_hls_task 中的 Live remux 分支 — 删除

### 修改

**build_ffmpeg_hls_args** — movflags 逻辑变更：

```rust
// 原方案 (TS):
if !is_live {
    args.push("-movflags".to_string());
    args.push("+faststart".to_string());
}

// fMP4 方案:
if is_live {
    args.push("-movflags".to_string());
    args.push("+empty_moov+default_base_moof+frag_keyframe".to_string());
} else {
    args.push("-movflags".to_string());
    args.push("+faststart".to_string());
}
```

**run_hls_live** — 输出路径和注释变更：

```rust
// 原: ts_output_path: &Path, 返回 .ts
// 新: output_path: &Path, 返回 .mp4
```

**run_hls_task** — Live 分支简化：

```rust
// 原方案:
// 1. run_hls_live → ts_path
// 2. remux_ts_to_mp4(ts_path → mp4_path)
// 3. move mp4_path → outputDir

// fMP4 方案:
// 1. run_hls_live → mp4_path
// 2. move mp4_path → outputDir
```

### 不变

- Task 1 (基础设施) — 不变
- Task 2 (检测 + 命令构造 + 进度解析) — build_ffmpeg_hls_args 的 movflags 逻辑改
- Task 3 (stderr drainer) — 不变
- Task 4 (VOD runner) — 不变
- Task 5 (LiveStopSignal + manager) — 不变
- Task 6 (Live runner) — 签名改 ts→mp4，逻辑简化
- ~~Task 7 (remux)~~ — 删除
- Task 8 (task.rs 集成) — run_hls_task Live 分支删 remux 步骤
- Task 9 (mock 脚本) — 删 remux mock
- Task 10 (集成测试) — 不变
- Task 11 (全量验证) — 不变

Task 编号从 11 个减少到 10 个。

## 结论

fMP4 在 SIGINT、SIGKILL（有数据）、SIGKILL（无数据）三个场景下数据安全级别与 TS 完全等价，同时省掉了 remux 步骤和临时磁盘开销。代码实现更简单（单阶段）。唯一理论劣势（极老播放器兼容性）在 SnapAny 桌面应用场景中不成立。

建议采用 fMP4，更新 plan v2。
