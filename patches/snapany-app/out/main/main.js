"use strict";
const nodeMachineId = require("node-machine-id");
const electron = require("electron");
const log = require("electron-log/main");
const Store = require("electron-store");
const node_child_process = require("node:child_process");
const node_events = require("node:events");
const fs$2 = require("node:fs/promises");
const ffmpeg = require("fluent-ffmpeg");
const crypto = require("node:crypto");
const path = require("node:path");
const node_util = require("node:util");
const fileType = require("file-type");
const mime = require("mime-types");
const tldjs = require("tldjs");
const main = require("@egoist/tipc/main");
const fs$3 = require("node:fs");
// [PATCH] Aptabase telemetry disabled
const main$1 = require("@aptabase/electron/main");
const Database = require("better-sqlite3");
const betterSqlite3 = require("drizzle-orm/better-sqlite3");
const migrator = require("drizzle-orm/better-sqlite3/migrator");
const sqliteCore = require("drizzle-orm/sqlite-core");
const drizzleOrm = require("drizzle-orm");
const uuid = require("uuid");
// [PATCH] Sentry telemetry disabled
const Sentry = require("@sentry/electron/main");
const node_buffer = require("node:buffer");
const net = require("node:net");
const require$$0$2 = require("fs");
const require$$0 = require("constants");
const require$$0$1 = require("stream");
const require$$4 = require("util");
const require$$5 = require("assert");
const require$$1 = require("path");
function _interopNamespaceDefault(e) {
  const n = Object.create(null, { [Symbol.toStringTag]: { value: "Module" } });
  if (e) {
    for (const k in e) {
      if (k !== "default") {
        const d = Object.getOwnPropertyDescriptor(e, k);
        Object.defineProperty(n, k, d.get ? d : {
          enumerable: true,
          get: () => e[k]
        });
      }
    }
  }
  n.default = e;
  return Object.freeze(n);
}
const fs__namespace = /* @__PURE__ */ _interopNamespaceDefault(fs$2);
const path__namespace = /* @__PURE__ */ _interopNamespaceDefault(path);
// [PATCH] Sentry telemetry disabled
const Sentry__namespace = /* @__PURE__ */ _interopNamespaceDefault(Sentry);
const isDev = process.env.NODE_ENV === "development";
const isMac = process.platform === "darwin";
const isWin = process.platform === "win32";
process.platform === "linux";
const deviceId = nodeMachineId.machineIdSync();
function initLogger() {
  log.transports.file.level = isDev ? "info" : "warn";
  log.transports.file.maxSize = 10 * 1024 * 1024;
  log.transports.file.format = "[{y}-{m}-{d} {h}:{i}:{s}] [{level}] {text}";
  if (isDev) {
    log.transports.console.level = "info";
    log.transports.console.format = "[{h}:{i}:{s}] [{level}] {text}";
  } else {
    log.transports.console.level = false;
  }
  log.transports.ipc.level = false;
  log.errorHandler.startCatching({
    showDialog: false,
    // 不显示错误对话框
    onError: ({ error, processType, versions }) => {
      log.error("未捕获的错误:", {
        message: error.message,
        stack: error.stack,
        processType,
        versions
      });
    }
  });
  log.info("应用启动", {
    version: electron.app.getVersion(),
    platform: process.platform,
    arch: process.arch,
    isDev,
    logPath: log.transports.file.getFile().path
  });
  return log;
}
const logInfo = (message, data) => log.info(message, data);
const logWarn = (message, data) => log.warn(message, data);
const logError = (message, data) => log.error(message, data);
const settingStore = new Store({
  name: "setting",
  defaults: {
    downloadPath: electron.app.getPath("downloads"),
    downloadType: "video",
    videoConfig: {
      format: {
        format: "mp4",
        platform: void 0
      },
      resolution: 1080
    },
    audioConfig: {
      format: {
        format: "mp3",
        platform: void 0
      },
      bitrate: 128
    },
    subtitles: [],
    audioTracks: [],
    maxConcurrentDownloads: 8,
    maxParsingTasks: 3,
    batchSize: 5,
    createSubfolder: false,
    addIndexToFile: false,
    embedSubtitle: true,
    proxy: {
      type: "system"
    },
    isDownloadThumbnail: false,
    language: "system",
    authSites: [
      {
        name: "YouTube",
        url: "https://www.youtube.com",
        authUrl: "https://www.youtube.com/signin",
        isAuthorized: false,
        enableDelete: false
      },
      {
        name: "Instagram",
        url: "https://www.instagram.com",
        authUrl: "https://www.instagram.com",
        isAuthorized: false,
        enableDelete: false
      },
      {
        name: "Twitter",
        url: "https://x.com",
        authUrl: "https://x.com",
        isAuthorized: false,
        enableDelete: false
      }
    ]
  }
});
const defaultExtFilters = [
  { ext: "flv", minSize: 0, enabled: true },
  { ext: "hlv", minSize: 0, enabled: true },
  { ext: "f4v", minSize: 0, enabled: true },
  { ext: "mp4", minSize: 0, enabled: true },
  { ext: "mp3", minSize: 0, enabled: true },
  { ext: "wma", minSize: 0, enabled: true },
  { ext: "wav", minSize: 0, enabled: true },
  { ext: "m4a", minSize: 0, enabled: true },
  { ext: "ts", minSize: 0, enabled: false },
  { ext: "webm", minSize: 0, enabled: true },
  { ext: "ogg", minSize: 0, enabled: true },
  { ext: "ogv", minSize: 0, enabled: true },
  { ext: "acc", minSize: 0, enabled: true },
  { ext: "mov", minSize: 0, enabled: true },
  { ext: "mkv", minSize: 0, enabled: true },
  { ext: "m4s", minSize: 0, enabled: true },
  { ext: "m3u8", minSize: 0, enabled: true },
  { ext: "m3u", minSize: 0, enabled: true },
  { ext: "mpeg", minSize: 0, enabled: true },
  { ext: "avi", minSize: 0, enabled: true },
  { ext: "wmv", minSize: 0, enabled: true },
  { ext: "asf", minSize: 0, enabled: true },
  { ext: "movie", minSize: 0, enabled: true },
  { ext: "divx", minSize: 0, enabled: true },
  { ext: "mpeg4", minSize: 0, enabled: true },
  { ext: "vid", minSize: 0, enabled: true },
  { ext: "aac", minSize: 0, enabled: true },
  { ext: "mpd", minSize: 0, enabled: true },
  { ext: "weba", minSize: 0, enabled: true },
  { ext: "opus", minSize: 0, enabled: true }
];
const defaultTypeFilters = [
  { mime: "audio/*", minSize: 0, enabled: true },
  { mime: "video/*", minSize: 0, enabled: true },
  { mime: "application/ogg", minSize: 0, enabled: true },
  { mime: "application/vnd.apple.mpegurl", minSize: 0, enabled: true },
  { mime: "application/x-mpegurl", minSize: 0, enabled: true },
  { mime: "application/mpegurl", minSize: 0, enabled: true },
  { mime: "application/octet-stream-m3u8", minSize: 0, enabled: true },
  { mime: "application/dash+xml", minSize: 0, enabled: true },
  { mime: "application/m4s", minSize: 0, enabled: true }
];
const defaultRegexFilters = [
  {
    pattern: "https://cache\\.video\\.[a-z]*\\.com/dash\\?tvid=.*",
    flags: "ig",
    specifiedExt: "json",
    isBlocking: false,
    enabled: false
  },
  {
    pattern: ".*\\.bilivideo\\.(com|cn).*\\/live-bvc\\/.*m4s",
    flags: "ig",
    specifiedExt: "",
    isBlocking: true,
    enabled: false
  }
];
const snifferStore = new Store({
  name: "sniffer",
  defaults: {
    resourceSnifferFilters: {
      extFilters: defaultExtFilters,
      typeFilters: defaultTypeFilters,
      regexFilters: defaultRegexFilters
    }
  }
});
const urlBookmarkStore = new Store({
  name: "urlBookmark",
  defaults: {
    bookmarks: [
      {
        url: "https://www.youtube.com",
        title: "YouTube",
        mainDomain: "YouTube"
      },
      {
        url: "https://www.x.com",
        title: "Twitter",
        mainDomain: "Twitter"
      },
      {
        url: "https://www.facebook.com",
        title: "Facebook",
        mainDomain: "Facebook"
      },
      {
        url: "https://www.tiktok.com",
        title: "TikTok",
        mainDomain: "TikTok"
      },
      {
        url: "https://www.instagram.com",
        title: "Instagram",
        mainDomain: "Instagram"
      },
      {
        url: "https://www.soundcloud.com",
        title: "SoundCloud",
        mainDomain: "SoundCloud"
      },
      {
        url: "https://www.twitch.tv",
        title: "Twitch",
        mainDomain: "Twitch"
      },
      {
        url: "https://www.spotify.com",
        title: "Spotify",
        mainDomain: "Spotify"
      }
    ]
  }
});
const ytDlpStore = new Store({
  name: "yt-dlp-status",
  defaults: {
    status: "idle",
    version: "2025.03.27"
  }
});
class ProxyService {
  constructor() {
  }
  getProxyConfig(proxySettings) {
    let auth = "";
    let proxyUrl = "";
    let mode = "fixed_servers";
    let proxyRules = "";
    if (proxySettings.username && proxySettings.password) {
      auth = `${proxySettings.username}:${proxySettings.password}@`;
    }
    switch (proxySettings.type) {
      case "direct":
      case "system":
        mode = proxySettings.type;
        break;
      case "http":
        proxyUrl = `${auth}${proxySettings.host}:${proxySettings.port}`;
        proxyRules = `http://${proxyUrl}`;
        break;
      case "socks5":
        proxyUrl = `${auth}${proxySettings.host}:${proxySettings.port}`;
        proxyRules = `socks5://${proxyUrl}`;
        break;
    }
    return {
      mode,
      proxyRules
    };
  }
  // 设置代理
  async setupProxy() {
    try {
      const proxySettings = await settingStore.get("proxy");
      const config = {
        mode: "fixed_servers",
        proxyBypassRules: "<local>,localhost,127.0.0.1,::1"
      };
      const proxyConfig = this.getProxyConfig(proxySettings);
      config.mode = proxyConfig.mode;
      config.proxyRules = proxyConfig.proxyRules;
      await electron.session.defaultSession.setProxy(config);
      console.log("代理设置成功:", {
        type: proxySettings.type,
        mode: config.mode,
        rules: config.proxyRules || "无"
      });
    } catch (error) {
      console.error("代理设置失败:", error);
      await electron.session.defaultSession.setProxy({
        mode: "direct"
      });
    }
  }
}
const ProxyService$1 = new ProxyService();
const taskStatus = {
  extracting: "extracting",
  // 提取中
  readyDownload: "readyDownload",
  // 准备下载
  downloading: "downloading",
  // 下载中
  pendingConversion: "pendingConversion",
  // 等待转换
  converting: "converting",
  // 转换中
  completed: "completed",
  // 已完成
  failed: "failed"
  // 失败
};
const errorStatusEnum = {
  extractError: "extractError",
  // 解析错误
  downloadError: "downloadError",
  // 下载错误
  convertError: "convertError",
  // 转换错误
  moveError: "moveError",
  // 移动错误
  unsupportedUrl: "unsupportedUrl",
  // 不支持的URL
  interrupted: "interrupted"
  // 中断
};
const errorMessageEnum = {
  extractError: "extractError",
  // 解析错误
  downloadError: "downloadError",
  // 下载错误
  convertError: "convertError",
  // 转换错误
  moveError: "moveError",
  // 移动错误
  unsupportedUrl: "unsupportedUrl",
  // 不支持的URL
  needLogin: "needLogin",
  // 需要登录
  interrupted: "interrupted",
  // 中断
  cancel: "cancel",
  // 取消
  timeout: "timeout",
  // 超时
  noVideoFormats: "noVideoFormats",
  // 没有视频格式
  serverError: "serverError",
  // 服务器错误
  videoNotAccess: "videoNotAccess",
  // 视频无法访问
  needPurchase: "needPurchase",
  // 需要购买
  diskFull: "diskFull",
  // 磁盘已满
  permissionDenied: "permissionDenied"
  // 文件权限不足
};
const actionEnum = {
  login: "login"
  // 登录
};
const SnapfileEventType = {
  /** 开始任务 */
  START_TASK: "start-task",
  /** 删除任务 */
  DELETE_TASK: "delete-task",
  /** 更新最大下载任务数 */
  UPDATE_MAX_DOWNLOAD_TASK: "update-max-download-task",
  /** 停止录制直播 */
  STOP_RECORDING_LIVE: "stop-recording-live"
};
const SnapfileCallbackEvent = {
  /** 通用响应事件 */
  RESPONSE: "response",
  /** 状态变更事件 */
  STATUS_CHANGE: "status-change",
  /** 进度更新事件 */
  PROGRESS: "progress",
  /** 任务完成事件 */
  COMPLETE: "complete",
  /** 错误事件 */
  ERROR: "error"
};
const SnapfileCallbackType = {
  /** 状态变更回调 */
  ON_STATUS_CHANGE: "onStatusChange",
  /** 进度更新回调 */
  ON_PROGRESS: "onProgress",
  /** 任务完成回调 */
  ON_COMPLETE: "onComplete",
  /** 通用响应回调 */
  ON_RESPONSE: "onResponse"
};
const SnapfileStatusCode = {
  // ==================== 任务状态码 ====================
  /** 任务完成 */
  task_complete: "task_complete",
  /** 更新任务下载进度 */
  task_download_progress: "task_download_progress",
  /** 更新任务转换进度 */
  task_conversion_progress: "task_conversion_progress",
  /** 任务开始 */
  task_started: "task_started",
  /** 任务已删除 */
  task_deleted: "task_deleted",
  /** 任务开始预处理/预处理中 */
  task_start_prepare: "task_start_prepare",
  /** 任务预处理完成 */
  task_prepared: "task_prepared",
  /** 任务开始下载/下载中 */
  task_start_download: "task_start_download",
  /** 任务下载完成 */
  task_downloaded: "task_downloaded",
  /** 任务等待转换 */
  task_pending_conversion: "task_pending_conversion",
  /** 任务开始转换/转换中 */
  task_start_conversion: "task_start_conversion",
  /** 任务转换完成 */
  task_converted: "task_converted",
  /** 任务开始移动/移动中 */
  task_start_move: "task_start_move",
  /** 任务移动完成 */
  task_moved: "task_moved",
  /** 停止下载直播，进度转换阶段 */
  stop_recording_live: "stop_recording_live",
  /** 等待下载 */
  task_pending_download: "task_pending_download",
  /** 检测到任务是直播 */
  task_live_detected: "task_live_detected",
  // ==================== 客户端错误 ====================
  /** 未知事件 */
  unknown_event: "unknown_event",
  /** 任务已开始 */
  task_already_started: "task_already_started",
  // ==================== 服务端错误 ====================
  /** 未知错误 */
  unknown_error: "unknown_error",
  /** 准备阶段错误 */
  prepare_error: "prepare_error",
  /** 准备阶段 m3u8 解析错误 */
  parse_m3u8_error: "parse_m3u8_error",
  /** 下载阶段错误 */
  download_error: "download_error",
  /** 转换阶段错误 */
  convert_error: "convert_error",
  /** 移动阶段错误 */
  move_error: "move_error",
  /** HTTP 403 错误 */
  http_status_forbidden_error: "http_status_forbidden_error",
  /** 磁盘已满 */
  disk_full: "disk_full",
  /** 文件权限不足 */
  os_permission_denied: "os_permission_denied",
  /** 某个文件下载失败 */
  file_download_error: "file_download_error"
};
const SnapfileErrorStatusCodes = /* @__PURE__ */ new Set([
  // ==================== 客户端错误 ====================
  SnapfileStatusCode.unknown_event,
  SnapfileStatusCode.task_already_started,
  // ==================== 服务端错误 ====================
  SnapfileStatusCode.unknown_error,
  SnapfileStatusCode.prepare_error,
  SnapfileStatusCode.parse_m3u8_error,
  SnapfileStatusCode.download_error,
  SnapfileStatusCode.convert_error,
  SnapfileStatusCode.move_error,
  SnapfileStatusCode.http_status_forbidden_error,
  SnapfileStatusCode.disk_full,
  SnapfileStatusCode.os_permission_denied,
  SnapfileStatusCode.file_download_error
]);
const SnapfileStatusMapping = {
  /** 任务开始和预处理阶段 → 准备下载 */
  READY_DOWNLOAD_STATUSES: [
    SnapfileStatusCode.task_started,
    SnapfileStatusCode.task_start_prepare,
    SnapfileStatusCode.task_prepared,
    SnapfileStatusCode.task_pending_download
  ],
  /** 下载阶段 → 下载中 */
  DOWNLOADING_STATUSES: [
    SnapfileStatusCode.task_start_download,
    SnapfileStatusCode.task_downloaded
  ],
  /** 等待转换阶段 → 等待转换 */
  PENDING_CONVERSION_STATUSES: [
    SnapfileStatusCode.task_pending_conversion
  ],
  /** 转换和移动阶段 → 转换中 */
  CONVERTING_STATUSES: [
    SnapfileStatusCode.task_start_conversion,
    SnapfileStatusCode.task_converted,
    SnapfileStatusCode.task_start_move,
    SnapfileStatusCode.task_moved
  ]
};
const SnapfileErrorMapping = {
  // 客户端错误映射
  [SnapfileStatusCode.unknown_event]: errorStatusEnum.downloadError,
  [SnapfileStatusCode.task_already_started]: errorStatusEnum.downloadError,
  // 服务端错误映射
  [SnapfileStatusCode.unknown_error]: errorStatusEnum.downloadError,
  [SnapfileStatusCode.prepare_error]: errorStatusEnum.downloadError,
  [SnapfileStatusCode.parse_m3u8_error]: errorStatusEnum.downloadError,
  [SnapfileStatusCode.download_error]: errorStatusEnum.downloadError,
  [SnapfileStatusCode.convert_error]: errorStatusEnum.convertError,
  [SnapfileStatusCode.move_error]: errorStatusEnum.moveError,
  [SnapfileStatusCode.http_status_forbidden_error]: errorStatusEnum.downloadError,
  [SnapfileStatusCode.disk_full]: errorStatusEnum.downloadError,
  [SnapfileStatusCode.os_permission_denied]: errorStatusEnum.downloadError,
  [SnapfileStatusCode.file_download_error]: errorStatusEnum.downloadError
};
const SnapfileStatusHandlers = {
  // 状态变更处理器
  [SnapfileStatusCode.task_started]: {
    event: SnapfileCallbackEvent.STATUS_CHANGE,
    callbackType: SnapfileCallbackType.ON_STATUS_CHANGE
  },
  [SnapfileStatusCode.task_start_prepare]: {
    event: SnapfileCallbackEvent.STATUS_CHANGE,
    callbackType: SnapfileCallbackType.ON_STATUS_CHANGE
  },
  [SnapfileStatusCode.task_prepared]: {
    event: SnapfileCallbackEvent.STATUS_CHANGE,
    callbackType: SnapfileCallbackType.ON_STATUS_CHANGE
  },
  [SnapfileStatusCode.task_pending_download]: {
    event: SnapfileCallbackEvent.STATUS_CHANGE,
    callbackType: SnapfileCallbackType.ON_STATUS_CHANGE
  },
  [SnapfileStatusCode.task_start_download]: {
    event: SnapfileCallbackEvent.STATUS_CHANGE,
    callbackType: SnapfileCallbackType.ON_STATUS_CHANGE
  },
  [SnapfileStatusCode.task_downloaded]: {
    event: SnapfileCallbackEvent.STATUS_CHANGE,
    callbackType: SnapfileCallbackType.ON_STATUS_CHANGE
  },
  [SnapfileStatusCode.task_pending_conversion]: {
    event: SnapfileCallbackEvent.STATUS_CHANGE,
    callbackType: SnapfileCallbackType.ON_STATUS_CHANGE
  },
  [SnapfileStatusCode.task_start_conversion]: {
    event: SnapfileCallbackEvent.STATUS_CHANGE,
    callbackType: SnapfileCallbackType.ON_STATUS_CHANGE
  },
  [SnapfileStatusCode.task_converted]: {
    event: SnapfileCallbackEvent.STATUS_CHANGE,
    callbackType: SnapfileCallbackType.ON_STATUS_CHANGE
  },
  [SnapfileStatusCode.task_start_move]: {
    event: SnapfileCallbackEvent.STATUS_CHANGE,
    callbackType: SnapfileCallbackType.ON_STATUS_CHANGE
  },
  [SnapfileStatusCode.task_moved]: {
    event: SnapfileCallbackEvent.STATUS_CHANGE,
    callbackType: SnapfileCallbackType.ON_STATUS_CHANGE
  },
  [SnapfileStatusCode.task_live_detected]: {
    event: SnapfileCallbackEvent.STATUS_CHANGE,
    callbackType: SnapfileCallbackType.ON_STATUS_CHANGE
  },
  // 进度处理器
  [SnapfileStatusCode.task_download_progress]: {
    event: SnapfileCallbackEvent.PROGRESS,
    callbackType: SnapfileCallbackType.ON_PROGRESS
  },
  [SnapfileStatusCode.task_conversion_progress]: {
    event: SnapfileCallbackEvent.PROGRESS,
    callbackType: SnapfileCallbackType.ON_PROGRESS
  },
  // 完成处理器
  [SnapfileStatusCode.task_complete]: {
    event: SnapfileCallbackEvent.COMPLETE,
    callbackType: SnapfileCallbackType.ON_COMPLETE,
    shouldCleanup: true
  },
  // 删除处理器
  [SnapfileStatusCode.task_deleted]: {
    event: SnapfileCallbackEvent.STATUS_CHANGE,
    callbackType: SnapfileCallbackType.ON_STATUS_CHANGE,
    shouldCleanup: true
  },
  // 特殊操作处理器
  [SnapfileStatusCode.stop_recording_live]: {
    event: SnapfileCallbackEvent.RESPONSE,
    callbackType: SnapfileCallbackType.ON_RESPONSE
  }
};
async function getFilePathMediaInfo(filePath) {
  try {
    return await new Promise((resolve, reject) => {
      ffmpeg.ffprobe(filePath, (err, data) => {
        if (err)
          reject(err);
        else
          resolve(data);
      });
    });
  } catch {
    return {
      streams: [],
      format: {},
      chapters: []
    };
  }
}
const imageExt = [
  ".sgi",
  ".svg",
  ".ras",
  ".orf",
  ".ppm",
  ".pnm",
  ".pict",
  ".picon",
  ".pgm",
  ".pfm",
  ".pes",
  ".pcx",
  ".pcd",
  ".pam",
  ".mng",
  ".fts",
  ".exr",
  ".erf",
  ".dds",
  ".hdr",
  ".xwd",
  ".xpm",
  ".xbm",
  ".wbmp"
];
const execAsync$1 = node_util.promisify(node_child_process.exec);
async function checkFileExists(filePath) {
  try {
    await fs$2.access(filePath);
    return true;
  } catch {
    return false;
  }
}
async function checkDirectoryExists(dirPath) {
  try {
    const stats = await fs$2.stat(dirPath);
    return stats.isDirectory();
  } catch {
    return false;
  }
}
async function setFilePermissions(filePath) {
  if (isMac) {
    const mode = 493;
    await fs$2.chmod(filePath, mode);
  }
}
function getBinPath(fileName, subdir = "bin") {
  const executableName = isWin ? `${fileName}.exe` : fileName;
  if (isDev) {
    return path.join(__dirname, "../../public", subdir, executableName);
  }
  const basePath = electron.app.isPackaged ? path.join(process.resourcesPath, "app.asar.unpacked") : path.join(__dirname, "..", "..");
  return path.join(basePath, "public", subdir, executableName);
}
async function getBase64Image(filePath) {
  const exists = await checkFileExists(filePath);
  if (!exists) {
    return "";
  }
  const buffer = await fs$2.readFile(filePath);
  return buffer.toString("base64");
}
async function isImageFile(filePath) {
  const file2 = await fileType.fromFile(filePath);
  if (file2 && file2.mime && file2.mime.startsWith("image/")) {
    return true;
  } else {
    const ext = path.extname(filePath).toLowerCase();
    return imageExt.includes(ext);
  }
}
function getNewPngPath(imgFile) {
  const imgDir = path.dirname(imgFile);
  const imgBaseName = path.basename(imgFile, path.extname(imgFile));
  return path.join(imgDir, `${imgBaseName}.png`);
}
async function ensureDirectoryExists(dirPath) {
  try {
    if (!await checkFileExists(dirPath)) {
      await fs$2.mkdir(dirPath, { recursive: true });
    }
    return { success: true };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "未知错误";
    console.error("创建目录失败:", error);
    return { success: false, error: `${errorMessage}` };
  }
}
function updateFilePath(inputDirs, oldPath, newPath) {
  const index = inputDirs.findIndex((item) => item.filePath === oldPath);
  if (index !== -1) {
    inputDirs[index].filePath = newPath;
    inputDirs[index].type = "thumbnail";
  }
}
function getDirectoryPath(filePath) {
  return path.dirname(filePath);
}
function sanitizeFileName(fileName) {
  let sanitizedFileName = fileName.replace(/[<>:"/\\|?*]/g, "");
  const extname = path.extname(sanitizedFileName);
  if (extname) {
    sanitizedFileName = sanitizedFileName.slice(0, -extname.length);
  }
  sanitizedFileName = sanitizedFileName.replace(/[<>:"/\\|?*]/g, "").replace(/[^a-z0-9\u0080-\uFFFF\s.-]/gi, "").replace(/\s+/g, " ").trim().substring(0, 200);
  return sanitizedFileName;
}
async function isFileLockedWin(filePath) {
  try {
    if (!await checkFileExists(filePath)) {
      console.log(`文件不存在: ${filePath}`);
      return false;
    }
    const fd = await fs$2.open(filePath, "r+");
    await fd.close();
    console.log(`Windows: 文件 ${filePath} 未被占用`);
    return false;
  } catch (error) {
    const errCode = error.code;
    if (errCode === "EBUSY" || errCode === "EPERM" || errCode === "EACCES") {
      console.log(`Windows: 文件 ${filePath} 被占用，错误代码: ${errCode}`);
      return true;
    }
    console.error(`Windows: 检查文件占用状态出错，错误类型: ${errCode}`, error);
    return false;
  }
}
async function isFileLockedMac(filePath) {
  try {
    if (!await checkFileExists(filePath)) {
      console.log(`文件不存在: ${filePath}`);
      return false;
    }
    const escapedPath = filePath.replace(/'/g, "'\\''");
    const { stdout } = await execAsync$1(`lsof '${escapedPath}'`);
    const isLocked = stdout.trim().length > 0;
    console.log(`macOS: 文件 ${filePath} ${isLocked ? "被占用" : "未被占用"}`);
    return isLocked;
  } catch {
    console.log(`macOS: lsof命令执行结果表明文件 ${filePath} 未被占用`);
    return false;
  }
}
function md5(str) {
  return crypto.createHash("md5").update(str).digest("hex");
}
function getExtensionFromHeaders(url, headers) {
  let extension = "";
  const contentType = headers["content-type"];
  if (contentType && !Array.isArray(contentType)) {
    extension = mime.extension(contentType) || "";
    if (extension === "") {
      extension = contentType.split("/").pop();
    }
  }
  if (extension === "") {
    const contentDisposition = headers["content-disposition"];
    if (contentDisposition && !Array.isArray(contentDisposition)) {
      extension = contentDisposition.replace(/"/g, "").split(".").pop() || "";
    }
  }
  if (extension === "" || extension === "bin") {
    const urlObj = new URL(url);
    extension = path.extname(urlObj.pathname).split(".").pop() || "";
  }
  return extension;
}
async function forceRemoveWithExec(dirPath) {
  try {
    const stats = await fs$2.stat(dirPath);
    const isDirectory = stats.isDirectory();
    const command = isWin ? isDirectory ? `rmdir /s /q "${path.resolve(dirPath)}"` : `del /f /q "${path.resolve(dirPath)}"` : `rm -rf "${path.resolve(dirPath)}"`;
    console.log(`Executing command: ${command}`);
    const { stderr } = await execAsync$1(command);
    if (stderr) {
      console.warn(`Stderr output (may not indicate failure): ${stderr}`);
    }
    console.log(`Successfully executed command to remove ${isDirectory ? "directory" : "file"}: ${dirPath}`);
    try {
      await fs$2.access(dirPath);
      console.warn(`Path ${dirPath} might still exist after command execution.`);
    } catch (accessErr) {
      if (accessErr.code === "ENOENT") {
        console.log(`Verified path ${dirPath} no longer exists.`);
      } else {
        console.warn(`Error checking path existence after removal attempt:`, accessErr);
      }
    }
  } catch (err) {
    console.error(`Failed to execute command for removal of ${dirPath}:`, err);
    throw err;
  }
}
const SYSTEM_TO_APP_LANGUAGE_MAP = {
  "en": "en",
  "zh-Hans": "zh-Hans",
  "zh-Hant": "zh-Hant",
  "ja": "ja",
  "ko": "ko",
  "hi": "hi",
  "es": "es",
  "fr": "fr",
  "ru": "ru",
  "id": "id",
  "bn": "bn",
  "pt": "pt",
  "de": "de",
  "vi": "vi",
  "tr": "tr",
  "it": "it"
};
const LANGUAGE_CODES = {
  // 完整语言代码映射
  "zh-hans": "chi",
  "zh-hant": "chi",
  "zh-cn": "chi",
  "zh-tw": "chi",
  "zh-hk": "chi",
  "zh-sg": "chi",
  "zh-mo": "chi",
  "en-us": "eng",
  "en-gb": "eng",
  "en-ca": "eng",
  "en-au": "eng",
  "ja-jp": "jpn",
  "ko-kr": "kor",
  "fr-fr": "fra",
  "fr-ca": "fra",
  "de-de": "deu",
  "es-es": "spa",
  "es-mx": "spa",
  "it-it": "ita",
  "ru-ru": "rus",
  "pt-pt": "por",
  "pt-br": "por",
  "ar-sa": "ara",
  "hi-in": "hin",
  "th-th": "tha",
  "vi-vn": "vie",
  // 简单语言代码映射
  "zh": "chi",
  "en": "eng",
  "ja": "jpn",
  "ko": "kor",
  "fr": "fra",
  "de": "deu",
  "es": "spa",
  "it": "ita",
  "ru": "rus",
  "pt": "por",
  "ar": "ara",
  "hi": "hin",
  "th": "tha",
  "vi": "vie",
  "nl": "dut",
  "sv": "swe",
  "no": "nor",
  "fi": "fin",
  "da": "dan",
  "pl": "pol",
  "tr": "tur",
  "cs": "cze",
  "hu": "hun",
  "el": "gre",
  "he": "heb",
  "id": "ind",
  "ms": "may",
  "ro": "rum",
  "uk": "ukr",
  "bg": "bul",
  "hr": "hrv",
  "sr": "srp",
  "sk": "slo",
  "sl": "slv",
  "et": "est",
  "lv": "lav",
  "lt": "lit",
  "fa": "per",
  "ur": "urd",
  "bn": "ben",
  "ta": "tam",
  "te": "tel",
  "ml": "mal",
  "kn": "kan",
  "mr": "mar",
  "gu": "guj",
  "pa": "pan",
  "si": "sin",
  "km": "khm",
  "lo": "lao",
  "my": "bur",
  "am": "amh",
  "sw": "swa",
  "af": "afr",
  "fil": "fil",
  // 菲律宾语
  "und": "und"
};
const SUBTITLE_LANGUAGES = {
  // 英语 (1397百万)
  "en": "English",
  "en-GB": "English(GB)",
  "en-US": "English(US)",
  // 中文 (1159.2百万，简体+繁体)
  "zh": "中文",
  "zh-CN": "中文(中国)",
  "zh-HK": "中文(香港粵語)",
  "zh-Hans": "中文(简体)",
  "zh-Hant": "中文(繁体字)",
  "zh-SG": "中文(新加坡)",
  "zh-TW": "中文(薹灣話)",
  // 粤语 (约8百万)
  "yue": "廣東話",
  // 印地语 (342百万)
  "hi": "हिन्दी",
  // 西班牙语 (441.6百万)
  "es": "Español(Spanish)",
  "es-419": "Español(Latinoamérica)",
  "es-MX": "Español(México)",
  "es-US": "Español(Estados Unidos)",
  // 法语 (154.56百万)
  "fr": "Français",
  "fr-BE": "Français(Belgique)",
  "fr-CA": "Français(Canada)",
  // 俄语 (110百万)
  "ru": "Русский",
  // 印尼语 (98.9百万)
  "id": "Bahasa Indonesia",
  // 孟加拉语 (77.7百万)
  "bn": "বাংলা",
  // 葡萄牙语 (250百万)
  "pt": "Português",
  "pt-BR": "Português(Brasil)",
  // 德语 (121.44百万)
  "de": "Deutsch",
  "de-AT": "Deutsch(Österreich)",
  "de-CH": "Deutsch(Schweiz)",
  "de-DE": "Deutsch(Deutschland)",
  // 日语 (114.9百万)
  "ja": "日本語",
  // 韩语 (48百万)
  "ko": "한국어",
  // 越南语 (79.8百万)
  "vi": "Tiếng Việt",
  // 土耳其语 (77.3百万)
  "tr": "Türkçe",
  // 意大利语 (52百万)
  "it": "Italiano",
  // 阿拉伯语 (168.1百万)
  "ar": "العربية",
  // 波兰语 (约44百万)
  "pl": "Język polski",
  // 荷兰语 (约29百万)
  "nl": "Nederlands",
  // 泰语 (约27百万)
  "th": "ไทย",
  // 波斯语 (约25百万)
  "fa": "فارسی",
  // 乌克兰语 (约24百万)
  "uk": "Українська мова",
  // 罗马尼亚语 (约17百万)
  "ro": "Limba română",
  // 马来语 (约15百万)
  "ms": "بهاس ملايو",
  // 乌尔都语 (约14百万)
  "ur": "اردو",
  // 泰米尔语 (约12百万)
  "ta": "தமிழ்",
  // 希伯来语 (约9百万)
  "he": "עברית",
  // 马拉地语 (约7百万)
  "mr": "मराठी",
  // 菲律宾语 (约6百万)
  "fil": "Wikang Filipino",
  // 匈牙利语 (约6百万)
  "hu": "Magyar",
  // 希腊语 (约5百万)
  "el": "Ελληνικά",
  // 捷克语 (约5百万)
  "cs": "Čeština",
  // 瑞典语 (约5百万)
  "sv": "Svenska",
  // 丹麦语 (约4百万)
  "da": "dansk",
  // 芬兰语 (约4百万)
  "fi": "Suomi",
  // 斯洛伐克语 (约3百万)
  "sk": "Slovenčina",
  // 挪威语 (约3百万)
  "no": "Norsk",
  // 克罗地亚语 (约2百万)
  "hr": "Hrvatski jezik",
  // 塞尔维亚语 (约2百万)
  "sr": "Српски језик",
  "sr-Latn": "Srpski",
  // 保加利亚语 (约2百万)
  "bg": "Български език",
  // 立陶宛语 (约1百万)
  "lt": "Lietuvių kalba",
  // 斯洛文尼亚语 (约1百万)
  "sl": "Slovenščina",
  // 爱沙尼亚语 (约0.5百万)
  "et": "Eesti keel",
  // 拉脱维亚语 (约0.5百万)
  "lv": "Latviešu valoda",
  // 以下语言无明确数据，按原始顺序排列
  "af": "Afrikaans",
  "be": "Беларуская мова",
  "ca": "català",
  "fo": "Føroyskt",
  "gl": "Gaelgo",
  "gu": "ગુજરાતી",
  "hy": "Հայերեն",
  "is": "íslenska",
  "km": "ភាសាខ្មែរ",
  "kn": "ಕನ್ನಡ",
  "lo": "ພາສາລາວ",
  "mk": "Македонски јазик",
  "ml": "മലയാളം",
  "mn": "Монгол хэл",
  "mt": "Malti",
  "my": "ဗမာစာ",
  "ne": "नेपाली",
  "sd": "सिधी",
  "si": "සිංහල",
  "sq": "Gjuha shqipe",
  "uz": "Ўзбек",
  "yi": "יידיש",
  "zu": "isiZulu"
};
const FILE_RENAME_LANGUAGES = [
  // 英语 (1397百万)
  { value: "en", label: "English" },
  { value: "en-GB", label: "English(GB)" },
  { value: "en-US", label: "English(US)" },
  // 中文 (1159.2百万，简体+繁体)
  { value: "zh", label: "中文" },
  { value: "zh-CN", label: "中文(中国)" },
  { value: "zh-HK", label: "中文(香港粵語)" },
  { value: "zh-Hans", label: "中文(简体)" },
  { value: "zh-Hant", label: "中文(繁体字)" },
  { value: "zh-SG", label: "中文(新加坡)" },
  { value: "zh-TW", label: "中文(薹灣話)" },
  // 粤语 (约8百万)
  { value: "yue", label: "廣東話" },
  // 印地语 (342百万)
  { value: "hi", label: "हिन्दी" },
  // 西班牙语 (441.6百万)
  { value: "es", label: "Español" },
  { value: "es-419", label: "Español(Latinoamérica)" },
  { value: "es-MX", label: "Español(México)" },
  { value: "es-US", label: "Español(Estados Unidos)" },
  // 法语 (154.56百万)
  { value: "fr", label: "Français" },
  { value: "fr-BE", label: "Français(Belgique)" },
  { value: "fr-CA", label: "Français(Canada)" },
  // 俄语 (110百万)
  { value: "ru", label: "Русский" },
  // 印尼语 (98.9百万)
  { value: "id", label: "Bahasa Indonesia" },
  // 孟加拉语 (77.7百万)
  { value: "bn", label: "বাংলা" },
  // 葡萄牙语 (250百万)
  { value: "pt", label: "Português" },
  { value: "pt-BR", label: "Português(Brasil)" },
  // 德语 (121.44百万)
  { value: "de", label: "Deutsch" },
  { value: "de-AT", label: "Deutsch(Österreich)" },
  { value: "de-CH", label: "Deutsch(Schweiz)" },
  { value: "de-DE", label: "Deutsch(Deutschland)" },
  // 日语 (114.9百万)
  { value: "ja", label: "日本語" },
  // 韩语 (48百万)
  { value: "ko", label: "한국어" },
  // 越南语 (79.8百万)
  { value: "vi", label: "Tiếng Việt" },
  // 土耳其语 (77.3百万)
  { value: "tr", label: "Türkçe" },
  // 意大利语 (52百万)
  { value: "it", label: "Italiano" },
  // 阿拉伯语 (168.1百万)
  { value: "ar", label: "العربية" },
  // 波兰语 (约44百万)
  { value: "pl", label: "Język polski" },
  // 荷兰语 (约29百万)
  { value: "nl", label: "Nederlands" },
  // 泰语 (约27百万)
  { value: "th", label: "ไทย" },
  // 波斯语 (约25百万)
  { value: "fa", label: "فارسی" },
  // 乌克兰语 (约24百万)
  { value: "uk", label: "Українська мова" },
  // 罗马尼亚语 (约17百万)
  { value: "ro", label: "Limba română" },
  // 马来语 (约15百万)
  { value: "ms", label: "بهاس ملايو" },
  // 乌尔都语 (约14百万)
  { value: "ur", label: "اردو" },
  // 泰米尔语 (约12百万)
  { value: "ta", label: "தமிழ்" },
  // 希伯来语 (约9百万)
  { value: "he", label: "עברית" },
  // 马拉地语 (约7百万)
  { value: "mr", label: "मराठी" },
  // 菲律宾语 (约6百万)
  { value: "fil", label: "Wikang Filipino" },
  // 匈牙利语 (约6百万)
  { value: "hu", label: "Magyar" },
  // 希腊语 (约5百万)
  { value: "el", label: "Ελληνικά" },
  // 捷克语 (约5百万)
  { value: "cs", label: "Čeština" },
  // 瑞典语 (约5百万)
  { value: "sv", label: "Svenska" },
  // 丹麦语 (约4百万)
  { value: "da", label: "dansk" },
  // 芬兰语 (约4百万)
  { value: "fi", label: "Suomi" },
  // 斯洛伐克语 (约3百万)
  { value: "sk", label: "Slovenčina" },
  // 挪威语 (约3百万)
  { value: "no", label: "Norsk" },
  // 克罗地亚语 (约2百万)
  { value: "hr", label: "Hrvatski jezik" },
  // 塞尔维亚语 (约2百万)
  { value: "sr", label: "Српски језик" },
  { value: "sr-Latn", label: "Srpski" },
  // 保加利亚语 (约2百万)
  { value: "bg", label: "Български език" },
  // 立陶宛语 (约1百万)
  { value: "lt", label: "Lietuvių kalba" },
  // 斯洛文尼亚语 (约1百万)
  { value: "sl", label: "Slovenščina" },
  // 爱沙尼亚语 (约0.5百万)
  { value: "et", label: "Eesti keel" },
  // 拉脱维亚语 (约0.5百万)
  { value: "lv", label: "Latviešu valoda" },
  // 以下语言无明确数据，按原始顺序排列
  { value: "af", label: "Afrikaans" },
  { value: "be", label: "Беларуская мова" },
  { value: "ca", label: "català" },
  { value: "da", label: "Dansk" },
  { value: "fo", label: "Føroyskt" },
  { value: "gl", label: "Gaelgo" },
  { value: "gu", label: "ગુજરાતી" },
  { value: "hy", label: "Հայերեն" },
  { value: "is", label: "íslenska" },
  { value: "km", label: "ភាសាខ្មែរ" },
  { value: "kn", label: "ಕನ್ನಡ" },
  { value: "lo", label: "ພາສາລາວ" },
  { value: "mk", label: "Македонски јазик" },
  { value: "ml", label: "മലയാളം" },
  { value: "mn", label: "Монгол хэл" },
  { value: "mt", label: "Malti" },
  { value: "my", label: "ဗမာစာ" },
  { value: "ne", label: "नेपाली" },
  { value: "pl", label: "Polski" },
  { value: "ro", label: "Română" },
  { value: "sd", label: "सिधी" },
  { value: "si", label: "සිංහල" },
  { value: "sq", label: "Gjuha shqipe" },
  { value: "te", label: "తెలుగు" },
  { value: "uk", label: "Українská" },
  { value: "uz", label: "Ўзбек" },
  { value: "yi", label: "יידיש" },
  { value: "zu", label: "isiZulu" }
];
function getISOLanguageCode(language) {
  if (!language)
    return "und";
  const lowerLang = language.toLowerCase();
  if (LANGUAGE_CODES[lowerLang]) {
    return LANGUAGE_CODES[lowerLang];
  }
  const parts = lowerLang.split("-");
  if (parts.length > 1 && LANGUAGE_CODES[parts[0]]) {
    return LANGUAGE_CODES[parts[0]];
  }
  for (const part of parts) {
    if (LANGUAGE_CODES[part]) {
      return LANGUAGE_CODES[part];
    }
  }
  return "und";
}
function getLanguageName(language) {
  let foundLanguage = FILE_RENAME_LANGUAGES.find(
    (lang) => lang.value.toLowerCase() === language.toLowerCase()
  );
  if (!foundLanguage) {
    foundLanguage = FILE_RENAME_LANGUAGES.find(
      (lang) => {
        const [audioLang] = lang.value.toLowerCase().split("-");
        const [languageTag] = language.toLowerCase().split("-");
        return audioLang === languageTag;
      }
    );
  }
  if (foundLanguage) {
    return foundLanguage.label;
  }
  return language;
}
function isSnapfileErrorCode(statusCode) {
  return SnapfileErrorStatusCodes.has(statusCode);
}
function mapSnapfileStatusToTaskStatus(snapfileStatus) {
  if (SnapfileStatusMapping.READY_DOWNLOAD_STATUSES.includes(snapfileStatus)) {
    return "readyDownload";
  }
  if (SnapfileStatusMapping.DOWNLOADING_STATUSES.includes(snapfileStatus)) {
    return "downloading";
  }
  if (SnapfileStatusMapping.PENDING_CONVERSION_STATUSES.includes(snapfileStatus)) {
    return "pendingConversion";
  }
  if (SnapfileStatusMapping.CONVERTING_STATUSES.includes(snapfileStatus)) {
    return "converting";
  }
  return "downloading";
}
function mapSnapfileErrorToErrorStatus(errorCode) {
  return SnapfileErrorMapping[errorCode] || errorStatusEnum.downloadError;
}
function compareSoftwareVersions(v1, v2) {
  const v1Parts = v1.split(".").map(Number);
  const v2Parts = v2.split(".").map(Number);
  for (let i = 0; i < Math.max(v1Parts.length, v2Parts.length); i++) {
    const v1Part = v1Parts[i] || 0;
    const v2Part = v2Parts[i] || 0;
    if (v1Part > v2Part)
      return 1;
    if (v1Part < v2Part)
      return -1;
  }
  return 0;
}
// [PATCH] 读取 yt-dlp release 配置
function getYtDlpReleaseConfig() {
  try {
    const configPath = path.join(__dirname, "../../ytdlp-release.json");
    const config = JSON.parse(fs$3.readFileSync(configPath, "utf8"));
    return config;
  } catch (error) {
    logError("读取 yt-dlp release 配置失败", { error: error.message });
    return { version: "2026.07.04", downloadUrls: { windows: "", macOS: "" } };
  }
}
async function getSoftwareInfo() {
  const ytdlpConfig = getYtDlpReleaseConfig();
  return {
    latestVersion: "0.8.1",
    normalUpgradeVersion: "0.0.1",
    forcedUpgradeVersion: "0.0.1",
    upgradeContent: "",
    downloadUrls: {
      windows: "",
      macAppleSilicon: "",
      macIntel: ""
    },
    ytdlpLatestRelease: {
      version: ytdlpConfig.version,
      downloadUrls: {
        windows: ytdlpConfig.downloadUrls.windows,
        macOS: ytdlpConfig.downloadUrls.macOS
      }
    }
  };
}
function formatTime(seconds) {
  if (Number.isNaN(seconds) || !Number.isFinite(seconds) || seconds < 0) {
    return "00:00";
  }
  if (seconds > 86400 * 365) {
    return "--:--";
  }
  seconds = Math.floor(seconds);
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor(seconds % 3600 / 60);
  const remainingSeconds = seconds % 60;
  if (hours > 0) {
    return `${hours.toString().padStart(2, "0")}:${minutes.toString().padStart(2, "0")}:${remainingSeconds.toString().padStart(2, "0")}`;
  }
  return `${minutes.toString().padStart(2, "0")}:${remainingSeconds.toString().padStart(2, "0")}`;
}
function getHttpHeaders(obj) {
  const headers = {};
  if (!obj) {
    return headers;
  }
  if (obj.http_headers && typeof obj.http_headers === "object") {
    Object.assign(headers, obj.http_headers);
  }
  if (obj.cookies) {
    headers.Cookie = handleCookies(obj.cookies);
  }
  return headers;
}
function handleCookies(cookies) {
  const cookiesObj = cookies.split(";").reduce((acc, cookie) => {
    const cookieStr = cookie.trim();
    const firstEqualIndex = cookieStr.indexOf("=");
    if (firstEqualIndex === -1)
      return acc;
    const key = cookieStr.slice(0, firstEqualIndex).trim();
    const value = cookieStr.slice(firstEqualIndex + 1).trim();
    if (value) {
      const cleanValue = value.replace(/^["']|["']$/g, "");
      acc[key] = cleanValue;
    }
    return acc;
  }, {});
  return Object.entries(cookiesObj).map(([key, value]) => `${key}=${value}`).join("; ");
}
function isUrlDuplicate(urlList, newUrl) {
  return urlList.some((item) => item.url === newUrl);
}
function getTopLevelMainDomain(url) {
  return tldjs.getDomain(url).split(".")[0];
}
function getVideoResolution(number) {
  const standardResolutions = [
    "144",
    // 144p
    "240",
    // 240p
    "360",
    // 360p
    "480",
    // 480p
    "720",
    // 720p HD
    "1080",
    // 1080p HD
    "1440",
    // 1440p 2K
    "2160",
    // 2160p 4K
    "4320"
    // 4320p 8K
  ];
  if (number <= Number.parseInt(standardResolutions[0])) {
    return Number.parseInt(standardResolutions[0]);
  }
  if (number >= Number.parseInt(standardResolutions[standardResolutions.length - 1])) {
    return Number.parseInt(standardResolutions[standardResolutions.length - 1]);
  }
  let closest = Number.parseInt(standardResolutions[0]);
  let minDiff = Math.abs(number - closest);
  for (const resolution of standardResolutions) {
    const diff = Math.abs(number - Number.parseInt(resolution));
    if (diff < minDiff) {
      minDiff = diff;
      closest = Number.parseInt(resolution);
    }
  }
  return closest;
}
class SnapfileService extends node_events.EventEmitter {
  process = null;
  isRunning = false;
  executablePath;
  maxDownloadingTasks;
  activeTasks = /* @__PURE__ */ new Map();
  taskCallbacks = /* @__PURE__ */ new Map();
  // 进程恢复机制
  restartAttempts = 0;
  maxRestartAttempts = 3;
  pendingTasks = [];
  // 标记是否正在主动关闭服务（用于禁用自动重启）
  isShuttingDown = false;
  constructor(options) {
    super();
    this.executablePath = getBinPath("snapfile");
    this.maxDownloadingTasks = options?.maxDownloadingTasks || 5;
  }
  /**
   * 检查snapfile可执行文件是否存在
   */
  async checkExecutable() {
    try {
      await fs$2.access(this.executablePath);
      return true;
    } catch {
      return false;
    }
  }
  /**
   * 启动snapfile进程
   */
  async start() {
    if (this.isRunning) {
      logInfo("Snapfile进程已在运行", {
        executablePath: this.executablePath,
        maxDownloadingTasks: this.maxDownloadingTasks
      });
      return;
    }
    const executableExists = await this.checkExecutable();
    if (!executableExists) {
      throw new Error(`Snapfile可执行文件不存在: ${this.executablePath}`);
    }
    return new Promise((resolve, reject) => {
      const args = [
        "--ffmpeg-path",
        getBinPath("ffmpeg"),
        "--ffprobe-path",
        getBinPath("ffprobe"),
        "--max-downloading-task",
        this.maxDownloadingTasks.toString(),
        "--log-level",
        "debug"
      ];
      logInfo("启动Snapfile进程", {
        executablePath: this.executablePath,
        args: args.join(" "),
        maxDownloadingTasks: this.maxDownloadingTasks
      });
      this.process = node_child_process.spawn(this.executablePath, args, {
        stdio: ["pipe", "pipe", "pipe"]
      });
      this.process.on("spawn", () => {
        logInfo("Snapfile进程启动成功", {
          executablePath: this.executablePath,
          pid: this.process?.pid,
          activeTasks: this.activeTasks.size,
          pendingTasks: this.pendingTasks.length
        });
        this.isRunning = true;
        this.isShuttingDown = false;
        this.setupEventHandlers();
        this.resetRestartAttempts();
        resolve();
      });
      this.process.on("error", (error) => {
        logError("Snapfile进程启动失败", {
          executablePath: this.executablePath,
          error: error.message,
          stack: error.stack,
          activeTasks: this.activeTasks.size,
          pendingTasks: this.pendingTasks.length
        });
        this.isRunning = false;
        reject(error);
      });
      this.process.on("exit", (code, signal) => {
        logInfo("Snapfile进程退出", {
          exitCode: code,
          signal,
          activeTasks: this.activeTasks.size,
          pendingTasks: this.pendingTasks.length,
          isShuttingDown: this.isShuttingDown,
          restartAttempts: this.restartAttempts
        });
        this.emit("process-exit", { code, signal });
        if (this.isShuttingDown) {
          logInfo("正在主动关闭snapfile服务，跳过自动重启", {
            activeTasks: this.activeTasks.size,
            pendingTasks: this.pendingTasks.length
          });
          return;
        }
        this.isRunning = false;
        this.process = null;
        if (this.restartAttempts < this.maxRestartAttempts) {
          logInfo("尝试重启snapfile进程", {
            currentAttempt: this.restartAttempts + 1,
            maxAttempts: this.maxRestartAttempts,
            activeTasks: this.activeTasks.size,
            pendingTasks: this.pendingTasks.length
          });
          this.moveActiveTasksToPending();
          setTimeout(async () => {
            this.restartAttempts += 1;
            try {
              await this.start();
              this.resendPendingTasks();
            } catch (error) {
              logError("重启snapfile进程失败", {
                attempt: this.restartAttempts,
                maxAttempts: this.maxRestartAttempts,
                error: error instanceof Error ? error.message : String(error),
                stack: error instanceof Error ? error.stack : void 0
              });
            }
          }, 2e3);
        } else {
          logError("达到最大重启次数，放弃重启snapfile进程", {
            maxAttempts: this.maxRestartAttempts,
            activeTasks: this.activeTasks.size,
            pendingTasks: this.pendingTasks.length
          });
          this.emit("max-restart-reached");
        }
      });
    });
  }
  /**
   * 停止snapfile进程
   */
  async stop() {
    if (!this.process || !this.isRunning) {
      return;
    }
    this.isShuttingDown = true;
    return new Promise((resolve) => {
      const onExit = () => {
        this.isRunning = false;
        this.process = null;
        resolve();
      };
      this.process.once("exit", onExit);
      this.process.kill("SIGTERM");
    });
  }
  /**
   * 重启snapfile进程
   */
  async restart() {
    await this.stop();
    this.isShuttingDown = false;
    await this.start();
  }
  /**
   * 设置事件处理器
   */
  setupEventHandlers() {
    if (!this.process)
      return;
    const fs$3 = require("node:fs");
    const logFile = fs$3.createWriteStream("/tmp/snapfile-stdout.log", { flags: "a" });
    const errFile = fs$3.createWriteStream("/tmp/snapfile-stderr.log", { flags: "a" });
    this.process.stdout?.on("data", (data) => {
      logFile.write(`\n--- ${new Date().toISOString()} ---\n`);
      logFile.write(data.toString());
      const lines = data.toString().trim().split("\n");
      for (const line of lines) {
        const trimmedLine = line.trim();
        if (trimmedLine) {
          if (trimmedLine.startsWith("{") && trimmedLine.endsWith("}")) {
            try {
              const response = JSON.parse(trimmedLine);
              this.handleSnapfileResponse(response);
            } catch (error) {
              logError("解析Snapfile响应失败", {
                rawResponse: trimmedLine,
                error: error instanceof Error ? error.message : String(error),
                stack: error instanceof Error ? error.stack : void 0
              });
            }
          } else {
            logInfo("Snapfile原始日志", {
              message: trimmedLine
            });
          }
        }
      }
    });
    this.process.stderr?.on("data", (data) => {
      errFile.write(`\n--- ${new Date().toISOString()} ---\n`);
      errFile.write(data.toString());
      logError("Snapfile stderr输出", {
        message: data.toString().trim(),
        activeTasks: this.activeTasks.size
      });
    });
  }
  /**
   * 清理任务相关信息
   */
  cleanupTask(taskID) {
    this.activeTasks.delete(taskID);
    this.taskCallbacks.delete(taskID);
  }
  /**
   * 处理错误响应
   */
  handleErrorResponse(response, callbacks, taskID) {
    if (response.code === SnapfileStatusCode.file_download_error) {
      logWarn("单个文件下载失败", {
        taskID: taskID || "unknown",
        errorCode: response.code,
        errorMessage: response.message,
        errorData: JSON.stringify(response.data)
      });
      return;
    }
    const errorStatus = mapSnapfileErrorToErrorStatus(response.code);
    let finalTaskID = taskID;
    if (!finalTaskID && this.activeTasks.size > 0) {
      if (this.activeTasks.size === 1) {
        finalTaskID = Array.from(this.activeTasks.keys())[0];
        logWarn("错误响应缺少taskID，假设错误属于唯一活跃任务", {
          assumedTaskID: finalTaskID,
          errorCode: response.code,
          errorMessage: response.message
        });
      } else {
        logWarn("错误响应缺少taskID，且有多个活跃任务，无法确定错误归属", {
          activeTasksCount: this.activeTasks.size,
          activeTaskIDs: Array.from(this.activeTasks.keys()),
          errorCode: response.code,
          errorMessage: response.message
        });
      }
    }
    const enhancedErrorData = {
      ...response,
      errorStatus,
      taskID: finalTaskID
    };
    this.emit(SnapfileCallbackEvent.ERROR, enhancedErrorData);
    if (finalTaskID) {
      const taskCallbacks = this.taskCallbacks.get(finalTaskID);
      taskCallbacks?.onError?.(enhancedErrorData);
      this.cleanupTask(finalTaskID);
    } else {
      callbacks?.onError?.(enhancedErrorData);
    }
  }
  /**
   * 处理snapfile响应
   */
  handleSnapfileResponse(response) {
    if (response.code !== SnapfileStatusCode.task_download_progress && response.code !== SnapfileStatusCode.task_conversion_progress) {
      logInfo("收到Snapfile响应", {
        responseContent: JSON.stringify(response)
        // 记录完整的响应内容
      });
    }
    this.emit(SnapfileCallbackEvent.RESPONSE, response);
    const taskID = response.data?.taskID;
    const callbacks = taskID ? this.taskCallbacks.get(taskID) : null;
    const isErrorCode = isSnapfileErrorCode(response.code);
    if (isErrorCode) {
      this.handleErrorResponse(response, callbacks, taskID);
      return;
    }
    const handler = SnapfileStatusHandlers[response.code];
    if (!handler) {
      logWarn("未知的状态码", {
        code: response.code,
        message: response.message,
        taskID: response.data?.taskID
      });
      return;
    }
    this.emit(handler.event, response.data);
    switch (handler.callbackType) {
      case SnapfileCallbackType.ON_STATUS_CHANGE:
        callbacks?.onStatusChange?.(response.code, response.data);
        break;
      case SnapfileCallbackType.ON_PROGRESS: {
        const progressData = response.data;
        let progressType = "download";
        if (response.code === SnapfileStatusCode.task_download_progress) {
          progressType = "download";
        } else if (response.code === SnapfileStatusCode.task_conversion_progress) {
          progressType = "conversion";
        }
        const enhancedProgressData = {
          ...progressData,
          progressType
        };
        callbacks?.onProgress?.(enhancedProgressData);
        break;
      }
      case SnapfileCallbackType.ON_COMPLETE:
        callbacks?.onComplete?.(response.data);
        break;
      case SnapfileCallbackType.ON_RESPONSE:
        logInfo("收到特殊响应事件", {
          event: handler.event,
          code: response.code,
          taskID: response.data?.taskID
        });
        break;
    }
    if ("shouldCleanup" in handler && handler.shouldCleanup && taskID) {
      this.cleanupTask(taskID);
    }
  }
  /**
   * 发送事件到snapfile进程
   */
  sendEvent(event) {
    if (!this.process || !this.isRunning) {
      logError("Snapfile进程未运行，无法发送事件", {
        eventType: event.type,
        taskID: event.payload?.taskID,
        isRunning: this.isRunning,
        hasProcess: !!this.process
      });
      return false;
    }
    try {
      const eventJson = `${JSON.stringify(event)}
`;
      const fs$3 = require("node:fs");
      fs$3.appendFileSync("/tmp/snapfile-stdin.log", `\n--- ${new Date().toISOString()} ---\n${eventJson}`);
      logInfo("发送事件到Snapfile", {
        eventType: event.type,
        taskID: event.payload?.taskID,
        payloadSize: eventJson.length,
        eventContent: eventJson.trim()
        // 记录完整的事件内容
      });
      return this.process.stdin?.write(eventJson) || false;
    } catch (error) {
      logError("发送事件到Snapfile失败", {
        eventType: event.type,
        taskID: event.payload?.taskID,
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : void 0
      });
      return false;
    }
  }
  /**
   * 开始任务（带回调）
   */
  startTask(payload, callbacks) {
    this.activeTasks.set(payload.taskID, payload);
    if (callbacks) {
      this.taskCallbacks.set(payload.taskID, callbacks);
    }
    if (!this.isProcessRunning()) {
      logWarn("Snapfile进程未运行，任务已加入待处理队列", {
        taskID: payload.taskID,
        pendingTasksCount: this.pendingTasks.length + 1,
        activeTasks: this.activeTasks.size
      });
      this.pendingTasks.push(payload);
      return false;
    }
    this.pendingTasks.push(payload);
    const success = this.sendEvent({
      type: SnapfileEventType.START_TASK,
      payload
    });
    if (success) {
      const index = this.pendingTasks.findIndex((task2) => task2.taskID === payload.taskID);
      if (index > -1) {
        this.pendingTasks.splice(index, 1);
      }
      logInfo("Snapfile任务启动成功", {
        taskID: payload.taskID,
        filesCount: payload.files?.length || 0,
        activeTasks: this.activeTasks.size,
        pendingTasks: this.pendingTasks.length
      });
    } else {
      logError("Snapfile任务启动失败", {
        taskID: payload.taskID,
        filesCount: payload.files?.length || 0,
        activeTasks: this.activeTasks.size,
        pendingTasks: this.pendingTasks.length
      });
    }
    return success;
  }
  /**
   * 删除任务
   */
  deleteTask(taskIDs) {
    logInfo("删除Snapfile任务", {
      taskIDs,
      taskCount: taskIDs.length,
      activeTasks: this.activeTasks.size
    });
    taskIDs.forEach((taskID) => {
      this.activeTasks.delete(taskID);
      this.taskCallbacks.delete(taskID);
    });
    const success = this.sendEvent({
      type: SnapfileEventType.DELETE_TASK,
      payload: { taskIDs }
    });
    if (success) {
      logInfo("Snapfile任务删除成功", {
        taskIDs,
        remainingActiveTasks: this.activeTasks.size
      });
    } else {
      logError("Snapfile任务删除失败", {
        taskIDs,
        activeTasks: this.activeTasks.size
      });
    }
    return success;
  }
  /**
   * 更新最大下载任务数
   */
  updateDownloadTaskLimit(limit) {
    logInfo("更新Snapfile最大下载任务数", {
      newLimit: limit,
      oldLimit: this.maxDownloadingTasks,
      activeTasks: this.activeTasks.size
    });
    return this.sendEvent({
      type: SnapfileEventType.UPDATE_MAX_DOWNLOAD_TASK,
      payload: { limit }
    });
  }
  /**
   * 停止录制直播
   */
  stopRecordingLive(taskID) {
    logInfo("停止Snapfile直播录制", {
      taskID,
      activeTasks: this.activeTasks.size
    });
    const success = this.sendEvent({
      type: SnapfileEventType.STOP_RECORDING_LIVE,
      payload: { taskID }
    });
    if (success) {
      logInfo("停止直播录制命令发送成功", { taskID });
    } else {
      logError("停止直播录制命令发送失败", { taskID });
    }
    return success;
  }
  /**
   * 检查进程是否运行
   */
  isProcessRunning() {
    return this.isRunning && this.process !== null;
  }
  /**
   * 获取活跃任务列表
   */
  getActiveTasks() {
    return new Map(this.activeTasks);
  }
  /**
   * 获取任务信息
   */
  getTask(taskID) {
    return this.activeTasks.get(taskID);
  }
  /**
   * 取消任务（删除单个任务的便捷方法）
   */
  cancelTask(taskID) {
    return this.deleteTask([taskID]);
  }
  /**
   * 清理所有任务
   */
  clearAllTasks() {
    const taskIDs = Array.from(this.activeTasks.keys());
    if (taskIDs.length > 0) {
      this.deleteTask(taskIDs);
    }
  }
  /**
   * 将活跃任务移动到待处理队列（进程异常退出时调用）
   */
  moveActiveTasksToPending() {
    if (this.activeTasks.size === 0) {
      return;
    }
    logInfo("将活跃任务移动到待处理队列", {
      activeTasksCount: this.activeTasks.size,
      currentPendingCount: this.pendingTasks.length
    });
    for (const [taskID, payload] of this.activeTasks) {
      const existsInPending = this.pendingTasks.some((task2) => task2.taskID === taskID);
      if (!existsInPending) {
        this.pendingTasks.push(payload);
        logInfo("任务已移动到待处理队列", {
          taskID,
          pendingTasksCount: this.pendingTasks.length
        });
      }
    }
  }
  /**
   * 重新发送待处理任务（进程重启后调用）
   */
  resendPendingTasks() {
    if (this.pendingTasks.length === 0) {
      return;
    }
    logInfo("重新发送待处理任务", {
      pendingTasksCount: this.pendingTasks.length,
      activeTasks: this.activeTasks.size
    });
    const tasksToResend = [...this.pendingTasks];
    this.pendingTasks.length = 0;
    for (const task2 of tasksToResend) {
      const callbacks = this.taskCallbacks.get(task2.taskID);
      const success = this.startTask(task2, callbacks);
      logInfo("重新发送任务", {
        taskID: task2.taskID,
        success
      });
    }
  }
  /**
   * 重置重启计数器（成功启动后调用）
   */
  resetRestartAttempts() {
    this.restartAttempts = 0;
  }
}
const snapfileService = new SnapfileService();
const dbPath = isDev ? path.join(__dirname, "../../drizzle/data.db") : path.join(electron.app.getPath("userData"), "data.db");
const migrationsPath = isDev ? path.join(__dirname, "../../drizzle") : path.join(process.resourcesPath, "app.asar.unpacked", "drizzle");
const sqlite = new Database(dbPath, {
  verbose: isDev ? console.log : void 0
});
const db = betterSqlite3.drizzle(sqlite);
async function initDatabase() {
  try {
    await migrator.migrate(db, { migrationsFolder: migrationsPath });
    console.log("数据库迁移成功", migrationsPath);
  } catch (error) {
    console.error("数据库迁移失败:", error);
    throw error;
  }
}
const task = sqliteCore.sqliteTable("task", {
  id: sqliteCore.text("id").primaryKey(),
  // 任务id
  text: sqliteCore.text("text").notNull(),
  // 任务文案
  url: sqliteCore.text("url").notNull(),
  // 任务url
  thumbnail: sqliteCore.text("thumbnail"),
  // 任务封面图
  requestHeaders: sqliteCore.text("request_headers"),
  // 任务http请求头
  extension: sqliteCore.text("extension"),
  // 任务扩展名
  duration: sqliteCore.integer("duration"),
  // 任务时长，单位秒
  fileSize: sqliteCore.integer("file_size"),
  // 任务文件大小，单位字节
  filePath: sqliteCore.text("file_path"),
  // 任务文件路径
  resolutionWidth: sqliteCore.integer("resolution_width"),
  // 任务分辨率宽度
  resolutionHeight: sqliteCore.integer("resolution_height"),
  // 任务分辨率高度
  bitrate: sqliteCore.integer("bitrate"),
  // 比特率，单位：bps
  taskStatus: sqliteCore.text("task_status").notNull(),
  // 任务状态
  errorStatus: sqliteCore.text("error_status"),
  // 错误状态
  errorMessage: sqliteCore.text("error_message"),
  // 错误信息
  errorAction: sqliteCore.text("error_action"),
  // 错误操作
  tempTask: sqliteCore.text("temp_task"),
  // 临时任务信息
  isLive: sqliteCore.integer("is_live", { mode: "boolean" }).default(false),
  // 是否为直播任务
  createdAt: sqliteCore.integer("created_at").notNull(),
  // 任务创建时间
  updatedAt: sqliteCore.integer("updated_at").notNull()
  // 任务更新时间
});
// [PATCH] yt-dlp 版本缓存表
const ytDlpVersion = sqliteCore.sqliteTable("yt_dlp_version", {
  id: sqliteCore.integer("id").primaryKey(),
  localVersion: sqliteCore.text("local_version").notNull(),
  remoteVersion: sqliteCore.text("remote_version"),
  downloadUrl: sqliteCore.text("download_url"),
  lastCheckTime: sqliteCore.integer("last_check_time").notNull(),
  createdAt: sqliteCore.integer("created_at").notNull()
});
async function fetch$1({
  url,
  method = "GET",
  timeout = 1e4,
  headers = {},
  abortController = new AbortController()
}) {
  return await new Promise(
    (resolve, reject) => {
      const request = electron.net.request({
        method,
        url,
        headers,
        session: electron.session.defaultSession,
        referrerPolicy: "unsafe-url"
      });
      if (abortController.signal.aborted) {
        request.abort();
        reject(new Error("Request aborted"));
        return;
      }
      abortController.signal.addEventListener("abort", () => {
        request.abort();
        reject(new Error("Request aborted"));
      }, { once: true });
      request.on("response", resolve);
      request.on("error", reject);
      request.end();
    }
  );
}
class FFmpegService {
  ffmpegProcesses = /* @__PURE__ */ new Map();
  constructor() {
  }
  // 开始合并转换
  async startMergeConvert(downloadedInfoList, setting, taskId) {
    const mergeOutputDir = path__namespace.join(
      setting.downloadPath,
      `.${electron.app.getName()}`,
      taskId,
      `merged`
    );
    const task2 = await taskService.getTaskById(taskId);
    return await new Promise((resolve, reject) => {
      let lastPercent = 0;
      const mainWindow2 = getMainWindow();
      const handlers = main.getRendererHandlers(mainWindow2.webContents);
      this.mergeMediaFiles(
        downloadedInfoList,
        mergeOutputDir,
        setting,
        // true,
        setting.embedSubtitle,
        (progress) => {
          console.log("merge progress:", progress.percent);
          const precent = progress.percent > lastPercent ? progress.percent : lastPercent;
          handlers.onDownloadProgress.send({
            ...task2,
            taskId,
            taskStatus: taskStatus.converting,
            totalSize: null,
            downloadedSize: null,
            speed: null,
            eta: null,
            percent: precent,
            isLive: task2.isLive || false
          });
          const tempProgress = tempTaskProgressMap.get(taskId);
          if (progress) {
            tempTaskProgressMap.set(taskId, {
              ...tempProgress,
              percent: precent
            });
          }
          lastPercent = progress.percent;
        },
        (completeList) => {
          handlers.onDownloadProgress.send({
            ...task2,
            taskId,
            taskStatus: taskStatus.converting,
            totalSize: null,
            downloadedSize: null,
            speed: null,
            eta: null,
            percent: 100,
            isLive: task2.isLive || false
          });
          let list = completeList.map((item) => ({
            ...item,
            url: downloadedInfoList.find((info) => info.filePath === item.filePath)?.url
          }));
          list = list.filter(
            (item, index, self2) => index === self2.findIndex((t2) => t2.filePath === item.filePath)
          );
          resolve(list);
        },
        (error) => {
          reject(error);
        },
        taskId
      );
    });
  }
  async moveFiles(completeList, setting, title) {
    try {
      console.log("completeList:", completeList);
      let taskMediaInfo = {
        mediaType: "other"
      };
      const movedFilePaths = [];
      for (const [index, item] of completeList.entries()) {
        const filePath = item.filePath;
        const language = item.language;
        const targetDir = setting.downloadPath;
        await fs$2.mkdir(targetDir, { recursive: true });
        const fileExt = path__namespace.extname(filePath);
        const extension = fileExt.split(".").pop();
        let mediaInfo = {
          mediaType: "other"
        };
        try {
          mediaInfo = await this.getLocalMediaInfo(item.filePath);
        } catch (error) {
          console.warn("获取文件信息时出错:", error);
        }
        if (index === 0) {
          const stats = await fs$2.stat(filePath);
          taskMediaInfo = {
            ...mediaInfo,
            extension,
            filePath,
            fileSize: stats.size
          };
        }
        const sanitizedTitle = sanitizeFileName(title);
        let newFileName = language ? `${sanitizedTitle}.${getLanguageName(language)}${fileExt}` : `${sanitizedTitle}${fileExt}`;
        let targetFilePath = path__namespace.join(targetDir, newFileName);
        const fileExists = await checkFileExists(targetFilePath);
        if (fileExists) {
          const ext = path__namespace.extname(newFileName);
          const baseFilename = newFileName.slice(0, -ext.length);
          let counter = 1;
          while (true) {
            const newFileNameWithCounter = `${baseFilename}(${counter})${ext}`;
            targetFilePath = path__namespace.join(targetDir, newFileNameWithCounter);
            try {
              const exists = await checkFileExists(targetFilePath);
              if (!exists) {
                newFileName = newFileNameWithCounter;
                break;
              }
              counter++;
            } catch (error) {
              console.error("检查文件是否存在时出错:", error);
              newFileName = newFileNameWithCounter;
              break;
            }
          }
        }
        try {
          await fs$2.access(filePath, fs$2.constants.F_OK);
          await fs$2.rename(filePath, targetFilePath);
          console.log(
            "Downloader: 移动文件成功，文件名:",
            newFileName,
            "源文件路径:",
            filePath,
            "目标文件路径:",
            targetFilePath
          );
          movedFilePaths.push(targetFilePath);
          if (taskMediaInfo.filePath === filePath) {
            taskMediaInfo.filePath = targetFilePath;
          }
        } catch (error) {
          console.log("Downloader: 源文件不存在或移动失败:", filePath, error);
        }
      }
      if (movedFilePaths.length > 0) {
        taskMediaInfo.filePath = movedFilePaths.join(",");
      }
      return taskMediaInfo;
    } catch (error) {
      console.error("移动文件失败:", error);
      throw error;
    }
  }
  /**
   * 获取本地视频文件信息
   * @param filePath 视频文件路径
   * @returns 视频信息对象，包含宽度、高度、时长、帧率和音频比特率
   */
  async getLocalMediaInfo(filePath) {
    try {
      return new Promise((resolve, reject) => {
        const mediaInfo = {
          mediaType: "other"
        };
        ffmpeg.ffprobe(filePath, (err, metadata) => {
          if (err) {
            console.error("获取视频信息时发生错误:", err);
            reject(err);
            return;
          }
          const videoStream = metadata.streams?.find(
            (stream) => stream.codec_type === "video" && stream.codec_name !== "mjpeg"
          );
          if (videoStream) {
            mediaInfo.mediaType = "video";
            mediaInfo.resolutionWidth = videoStream.width;
            mediaInfo.resolutionHeight = videoStream.height;
            if (videoStream.duration) {
              mediaInfo.duration = Math.ceil(Number.parseFloat(videoStream.duration));
            }
          }
          if (!mediaInfo.duration && metadata.format && metadata.format.duration) {
            mediaInfo.duration = Math.ceil(metadata.format.duration);
          }
          const audioStream = metadata.streams?.find(
            (stream) => stream.codec_type === "audio"
          );
          if (audioStream && audioStream.bit_rate) {
            const bitrate = Math.ceil(Number.parseFloat(audioStream.bit_rate));
            mediaInfo.bitrate = bitrate;
            mediaInfo.mediaType = videoStream ? "video" : "audio";
          }
          const subtitleStream = metadata.streams?.find(
            (stream) => stream.codec_type === "subtitle"
          );
          if (subtitleStream && !audioStream && !videoStream) {
            mediaInfo.mediaType = "subtitle";
          }
          console.log("解析结果:", mediaInfo);
          if (!mediaInfo.resolutionWidth || !mediaInfo.resolutionHeight) {
            console.warn("无法解析视频尺寸");
          }
          resolve(mediaInfo);
        });
      });
    } catch {
      return {
        mediaType: "other"
      };
    }
  }
  /**
   * 根据合并目录合并所有媒体流
   */
  async mergeMediaFiles(inputDirs, outputFilename, setting, embedSubtitles, onProgress, onComplete, onError, taskId) {
    try {
      const {
        mediaInfo,
        imageFiles,
        allInputFiles,
        updatedInputDirs,
        originalImageFiles
      } = await this.prepareMediaFiles(inputDirs, taskId);
      if (this.checkNoProcessableStreams(mediaInfo, embedSubtitles)) {
        const result = this.createUnusedFilesResult(allInputFiles, updatedInputDirs, setting.isDownloadThumbnail);
        onComplete?.(result);
        return;
      }
      const { command, isAudioFormat } = this.prepareFFmpegCommand(
        mediaInfo,
        setting.downloadType === "audio" ? setting.audioConfig.format.format : setting.videoConfig.format.format,
        taskId
      );
      const outputFilenames = this.configureOutputFormat(command, mediaInfo, imageFiles, embedSubtitles, isAudioFormat, outputFilename, setting);
      await this.executeFFmpegCommand(
        command,
        isAudioFormat,
        inputDirs,
        outputFilenames,
        mediaInfo,
        embedSubtitles,
        allInputFiles,
        updatedInputDirs,
        originalImageFiles,
        setting,
        onProgress,
        onComplete,
        onError
      );
    } catch (error) {
      this.handleError(error, "合并媒体文件失败", onError);
    }
  }
  async prepareMediaFiles(inputDirs, taskId, outputFilename) {
    const { updatedInputDirs, originalImageFiles } = await this.convertImagesToPng(inputDirs, taskId);
    if (outputFilename) {
      const data = await ensureDirectoryExists(outputFilename);
      if (!data.success) {
        logError("创建输出目录失败", { taskId, error: data.error });
        if (data.error.includes("not permitted") || data.error.includes("permission denied")) {
          await taskService.updateTask(taskId, {
            taskStatus: taskStatus.failed,
            errorStatus: errorStatusEnum.extractError,
            errorMessage: errorMessageEnum.permissionDenied
          });
        } else {
          logError("创建输出目录失败", { taskId, error: data.error });
          await taskService.updateTask(taskId, {
            taskStatus: taskStatus.failed,
            errorStatus: errorStatusEnum.extractError,
            errorMessage: errorMessageEnum.extractError
          });
        }
        return;
      }
    }
    const { mediaInfo, imageFiles, allInputFiles } = await this.analyzeMediaStreams(updatedInputDirs);
    return { mediaInfo, imageFiles, allInputFiles, updatedInputDirs, originalImageFiles };
  }
  async convertImagesToPng(inputDirs, taskId) {
    const updatedInputDirs = [...inputDirs];
    const imageFiles = await Promise.all(
      updatedInputDirs.map(async (item) => ({
        item,
        isImage: await isImageFile(item.filePath)
      }))
    );
    const originalImageFiles = imageFiles.filter(({ isImage }) => isImage).map(({ item }) => item.filePath);
    const conversionPromises = imageFiles.filter(({ isImage }) => isImage).map(({ item }) => this.handleImageConversion(
      item.filePath,
      updatedInputDirs,
      taskId
    ));
    await Promise.all(conversionPromises);
    return { updatedInputDirs, originalImageFiles };
  }
  async handleImageConversion(imgFile, updatedInputDirs, taskId) {
    const newImgPath = getNewPngPath(imgFile);
    if (await checkFileExists(newImgPath)) {
      updateFilePath(updatedInputDirs, imgFile, newImgPath);
      return;
    }
    const isAnimated = await this.isAnimatedImage(imgFile);
    if (isAnimated) {
      console.log(`检测到动图，保留原始格式: ${imgFile}`);
      return;
    }
    try {
      await this.convertImageToPng(imgFile, newImgPath, updatedInputDirs, taskId);
    } catch (error) {
      console.error(`图片转换失败，继续使用原始图片: ${imgFile}`, error);
    }
  }
  configureOutputFormat(command, mediaInfo, imageFiles, embedSubtitles, isAudioFormat, outputFilename, setting) {
    if (isAudioFormat) {
      const outputFormat = setting.audioConfig.format.format;
      return this.configureAudioOutput(command, mediaInfo, imageFiles, outputFormat, outputFilename);
    } else {
      const outputFormat = setting.videoConfig.format.format;
      return this.configureVideoOutput(command, mediaInfo, embedSubtitles, outputFormat, outputFilename);
    }
  }
  async executeFFmpegCommand(command, isAudioFormat, inputDirs, outputFilenames, mediaInfo, embedSubtitles, allInputFiles, updatedInputDirs, imageFiles, setting, onProgress, onComplete, onError) {
    if (outputFilenames.length === 0) {
      return;
    }
    try {
      await ensureDirectoryExists(getDirectoryPath(outputFilenames[0]));
    } catch (error) {
      this.handleError(error, "创建输出目录失败", onError);
      return;
    }
    command.addOption("-allowed_extensions ALL").on("start", (commandLine) => console.log("FFmpeg 命令:", commandLine)).on("progress", (progress) => onProgress?.(progress)).on("end", () => this.handleFFmpegComplete(
      isAudioFormat,
      inputDirs,
      outputFilenames,
      mediaInfo,
      embedSubtitles,
      allInputFiles,
      updatedInputDirs,
      imageFiles,
      setting,
      onComplete,
      onError
    )).on("error", (error) => this.handleFFmpegError(
      error,
      allInputFiles,
      updatedInputDirs,
      setting,
      onComplete,
      onError
    )).run();
  }
  handleError(error, context, onError) {
    console.error(`${context}:`, error);
    onError?.(error);
  }
  handleFFmpegComplete(isAudioFormat, inputDirs, outputFilenames, mediaInfo, embedSubtitles, allInputFiles, updatedInputDirs, imageFiles, setting, onComplete, onError) {
    try {
      this.buildResultArray(
        isAudioFormat,
        inputDirs,
        outputFilenames,
        mediaInfo,
        embedSubtitles,
        allInputFiles,
        updatedInputDirs,
        imageFiles,
        setting
      ).then((result) => {
        onComplete?.(result);
      }).catch((error) => {
        this.handleError(error, "处理FFmpeg结果时出错", onError);
        const fallbackResult = outputFilenames.map((filename) => ({ filePath: filename }));
        onComplete?.(fallbackResult);
      });
    } catch (error) {
      this.handleError(error, "处理FFmpeg结果时出错", onError);
      const fallbackResult = outputFilenames.map((filename) => ({ filePath: filename }));
      onComplete?.(fallbackResult);
    }
  }
  handleFFmpegError(error, allInputFiles, updatedInputDirs, setting, onComplete, onError) {
    let fallbackResult = [];
    if (error.message.includes("SIGKILL")) {
      fallbackResult = this.createUnusedFilesResult(allInputFiles, updatedInputDirs, setting.isDownloadThumbnail);
    }
    console.warn("FFmpeg执行出错:", error);
    onComplete?.(fallbackResult);
    onError?.(error);
  }
  createUnusedFilesResult(allInputFiles, updatedInputDirs, isDownloadThumbnail) {
    console.log("\n没有找到任何可处理的媒体流，返回所有文件作为未使用的文件");
    return allInputFiles.map((file2) => {
      const fileInfo = updatedInputDirs.find((info) => info.filePath === file2);
      return {
        filePath: file2,
        ...fileInfo?.language ? { language: fileInfo.language } : {}
      };
    }).filter((item) => {
      if (/\.(?:jpg|jpeg|png|gif|bmp|webp)$/i.test(item.filePath) && !isDownloadThumbnail) {
        return false;
      }
      return true;
    });
  }
  checkNoProcessableStreams(mediaInfo, embedSubtitles) {
    return mediaInfo.video.length === 0 && mediaInfo.audio.length === 0 && (!embedSubtitles || mediaInfo.subtitle.length === 0);
  }
  async analyzeMediaStreams(updatedInputDirs) {
    const mediaInfo = {
      video: [],
      audio: [],
      subtitle: [],
      image: []
    };
    const imageFiles = [];
    console.log("\n开始分析媒体流...");
    const allInputFiles = [];
    for (const fileInfo of updatedInputDirs) {
      const filePath = fileInfo.filePath;
      allInputFiles.push(filePath);
      const isFileExists = await checkFileExists(filePath);
      if (!isFileExists) {
        console.warn(`文件不存在: ${filePath}`);
        continue;
      }
      const stat2 = await fs$2.stat(filePath);
      if (stat2.isDirectory())
        continue;
      try {
        if (await isImageFile(filePath)) {
          console.log(`  检测到图片文件: ${filePath}`);
          imageFiles.push(filePath);
          continue;
        }
        const info = await new Promise((resolve, reject) => {
          ffmpeg.ffprobe(filePath, (err, data) => {
            if (err)
              reject(err);
            else resolve(data);
          });
        });
        if (info.streams) {
          info.streams.forEach((stream) => {
            const streamInfo = {
              file: filePath,
              // 使用完整路径
              index: stream.index,
              codec: stream.codec_name || "",
              language: fileInfo.language || stream.tags?.language || "und",
              duration: info.format?.duration ? Number(info.format.duration).toString() : void 0
            };
            switch (stream.codec_type) {
              case "video":
                streamInfo.resolution = `${stream.width}x${stream.height}`;
                mediaInfo.video.push(streamInfo);
                console.log(
                  `  视频流: ${streamInfo.codec} (${streamInfo.resolution}, ${streamInfo.fps}fps)`
                );
                break;
              case "audio":
                streamInfo.channels = stream.channels;
                streamInfo.sample_rate = stream.sample_rate;
                mediaInfo.audio.push(streamInfo);
                console.log(
                  `  音频流: ${streamInfo.codec} (${streamInfo.language}, ${streamInfo.channels}ch, ${streamInfo.sample_rate}Hz)`
                );
                break;
              case "subtitle":
                mediaInfo.subtitle.push(streamInfo);
                console.log(
                  `  字幕流: ${streamInfo.codec} (${streamInfo.language})`
                );
                break;
            }
          });
        } else if (path__namespace.extname(filePath).match(/\.(srt|ass|ssa|vtt)$/i)) {
          mediaInfo.subtitle.push({
            file: filePath,
            // 使用完整路径
            type: "external",
            language: fileInfo.language || path__namespace.basename(filePath).match(/\.(zh-Hans|zh-Hant|en|ja|ko)/i)?.[1] || "und",
            codec: "",
            index: 0
          });
          console.log(
            `  外部字幕文件: ${filePath} (${fileInfo.language || "und"})`
          );
        }
      } catch (error) {
        console.error(`  分析失败: ${filePath}`, error.message);
      }
    }
    console.log("媒体流统计：");
    console.log(`视频流: ${mediaInfo.video.length} 个`);
    console.log(`音频流: ${mediaInfo.audio.length} 个`);
    console.log(`字幕流: ${mediaInfo.subtitle.length} 个`);
    return { mediaInfo, imageFiles, allInputFiles };
  }
  filterRealVideoStreams(videoStreams) {
    return videoStreams.filter((stream) => {
      const ext = path__namespace.extname(stream.file).toLowerCase();
      const isImageFile2 = [
        ".jpg",
        ".jpeg",
        ".png",
        ".gif",
        ".bmp",
        ".webp"
      ].includes(ext);
      const isImageCodec = stream.codec?.toLowerCase().includes("mjpeg") || stream.codec?.toLowerCase().includes("png") || stream.codec?.toLowerCase().includes("jpeg");
      const isZeroResolution = stream.resolution === "0x0";
      const isRealVideo = !isImageFile2 && !isImageCodec && !isZeroResolution;
      if (!isRealVideo) {
        console.log(
          `排除非真实视频流: ${stream.file} (${stream.codec}, ${stream.resolution})`
        );
      }
      return isRealVideo;
    });
  }
  prepareFFmpegCommand(mediaInfo, outputFormat, taskId) {
    const command = ffmpeg();
    console.log(`为媒体处理注册主要FFmpeg进程, taskId: ${taskId}`);
    this.registerFFmpegProcess(taskId, command);
    const isAudioFormat = ["m4a", "mp3", "ogg"].includes(outputFormat.toLowerCase()) || mediaInfo.video.length === 0;
    if (isAudioFormat && outputFormat !== "mp3" && outputFormat !== "m4a" && outputFormat !== "ogg") {
      outputFormat = settingStore.get("audioConfig").format.format;
    }
    return { command, isAudioFormat };
  }
  async convertImageToPng(imgFile, newImgPath, updatedInputDirs, taskId) {
    const command = ffmpeg(imgFile);
    if (taskId) {
      console.log(
        `为图片转换注册FFmpeg进程: ${imgFile} -> ${newImgPath}, taskId: ${taskId}`
      );
      this.registerFFmpegProcess(taskId, command);
    } else {
      console.log(
        `图片转换未提供taskId，无法注册进程: ${imgFile} -> ${newImgPath}`
      );
    }
    return new Promise((resolve, reject) => {
      command.outputOptions(["-c:v", "png"]).on("end", () => {
        const index = updatedInputDirs.findIndex(
          (item) => item.filePath === imgFile
        );
        if (index !== -1) {
          updatedInputDirs[index].filePath = newImgPath;
          updatedInputDirs[index].type = "thumbnail";
          console.log(`图片已转换: ${imgFile} -> ${newImgPath}`);
        }
        resolve();
      }).on("error", (err) => {
        console.error(`图片转换失败: ${imgFile}`, err);
        reject(err);
      }).save(newImgPath);
    });
  }
  /**
   * 取消指定任务ID关联的所有FFmpeg进程
   * @param {string} taskId - 要取消的任务ID
   * @description
   * 该方法会终止所有与指定taskId关联的FFmpeg进程，并从进程管理器中移除相关记录。
   * 如果找不到对应的进程记录，将输出提示信息。
   */
  cancelFFmpegProcess(taskId, signal = "SIGKILL") {
    console.log("取消合并任务:", taskId);
    const processes = this.ffmpegProcesses.get(taskId);
    if (processes && processes.length > 0) {
      for (const process2 of processes) {
        try {
          process2.kill(signal);
          console.log(`已终止taskId ${taskId}的一个FFmpeg进程`);
        } catch (error) {
          console.error("终止FFmpeg进程失败:", error);
        }
      }
      this.ffmpegProcesses.delete(taskId);
      console.log(`已清除taskId ${taskId}的所有FFmpeg进程记录`);
    } else {
      console.log(`没有找到taskId ${taskId}的FFmpeg进程记录，无法取消`);
    }
  }
  /**
   * 注册FFmpeg进程到任务管理器
   * @param {string} taskId - 任务ID
   * @param {ffmpeg.FfmpegCommand} process - FFmpeg进程实例
   * @description
   * 该方法将FFmpeg进程实例注册到指定taskId的进程队列中。
   * 如果taskId不存在，会先创建一个新的进程队列。
   * 每次注册都会更新进程计数并输出日志信息。
   * @private
   */
  registerFFmpegProcess(taskId, process2) {
    if (!this.ffmpegProcesses.has(taskId)) {
      this.ffmpegProcesses.set(taskId, []);
      console.log(`已为任务 ${taskId} 创建新的FFmpeg进程队列`);
    }
    this.ffmpegProcesses.get(taskId)?.push(process2);
    console.log(
      `任务 ${taskId} 已注册FFmpeg进程，当前进程数: ${this.ffmpegProcesses.get(taskId)?.length}`
    );
  }
  isAnimatedImage(filePath) {
    return new Promise((resolve) => {
      try {
        ffmpeg.ffprobe(filePath, (err, data) => {
          if (err) {
            console.error("检查图片是否为动图时发生错误:", err);
            resolve(false);
            return;
          }
          const ext = path__namespace.extname(filePath).toLowerCase();
          if (ext === ".gif") {
            resolve(true);
            return;
          }
          const videoStream = data.streams.find(
            (stream) => stream.codec_type === "video"
          );
          if (!videoStream) {
            resolve(false);
            return;
          }
          const frameCount = videoStream.nb_frames;
          resolve(frameCount !== void 0 && Number.parseInt(frameCount) > 1);
        });
      } catch (error) {
        console.error("判断是否为动图时发生未知错误:", error);
        resolve(false);
      }
    });
  }
  configureAudioOutput(command, mediaInfo, imageFiles, outputFormat, outputFilename) {
    if (mediaInfo.video.length === 0 && mediaInfo.audio.length === 0) {
      console.log("没有找到任何音视频流，无法处理");
      return [];
    }
    const sourceFiles = mediaInfo.audio.map((item) => item.file);
    console.log(
      `选择 ${mediaInfo.audio.length > 0 ? "音频文件" : "视频文件"} 作为源：${sourceFiles}`
    );
    const finalOutputFilenames = [];
    for (const [index, sourceFile] of sourceFiles.entries()) {
      const outputOptions = [];
      command.input(sourceFile);
      this.configureAudioCodec(index, outputFormat, outputOptions);
      const finalOutputFilename = index === 0 ? `${outputFilename}.${outputFormat}` : `${outputFilename}(${index + 1}).${outputFormat}`;
      finalOutputFilenames.push(finalOutputFilename);
      this.handleAudioCover(command, imageFiles, index, sourceFiles.length, outputFormat, outputOptions, finalOutputFilename);
    }
    if (imageFiles.length > 0) {
      console.log(`添加图片作为音频封面: ${imageFiles[0]}`);
      command.input(imageFiles[0]);
    }
    return finalOutputFilenames;
  }
  configureVideoOutput(command, mediaInfo, embedSubtitles, outputFormat, outputFilename) {
    const realVideoStreams = this.filterRealVideoStreams(mediaInfo.video);
    const outputOptions = [];
    this.addVideoInputs(command, realVideoStreams, mediaInfo);
    this.addAudioInputs(command, mediaInfo);
    this.addSubtitleInputs(command, mediaInfo, embedSubtitles);
    const { videoInputIndices, audioInputIndices, subtitleInputIndices } = this.calculateInputIndices(realVideoStreams, mediaInfo, embedSubtitles);
    this.configureVideoCodec(outputFormat, outputOptions, videoInputIndices, mediaInfo);
    this.configureAudioStreams(outputOptions, audioInputIndices, mediaInfo);
    this.configureSubtitleStreams(outputOptions, subtitleInputIndices, mediaInfo, embedSubtitles);
    command.outputOptions(outputOptions);
    const finalOutputFilename = `${outputFilename}.${outputFormat}`;
    command.output(finalOutputFilename);
    return [finalOutputFilename];
  }
  async buildResultArray(isAudioFormat, inputDirs, outputFilenames, mediaInfo, embedSubtitles, allInputFiles, updatedInputDirs, imageFiles, setting) {
    const result = [];
    const outputLanguages = [];
    inputDirs.forEach((dir) => {
      if (dir.language) {
        outputLanguages.push(dir.language);
      }
    });
    for (const [index, outputFilename] of outputFilenames.entries()) {
      result.push({ filePath: outputFilename, language: isAudioFormat ? outputLanguages[index] : void 0 });
    }
    const usedFiles = [
      // 参与合并的文件列表
      ...mediaInfo.video.map((stream) => stream.file),
      ...mediaInfo.audio.map((stream) => stream.file),
      ...mediaInfo.subtitle.map((stream) => stream.file),
      ...mediaInfo.image
    ];
    if (!embedSubtitles && mediaInfo.subtitle.length > 0) {
      const subtitleFiles = await this.processStandaloneSubtitles(mediaInfo.subtitle, outputFilenames[0]);
      result.push(...subtitleFiles);
    }
    if (setting.isDownloadThumbnail && imageFiles.length > 0) {
      result.push({ filePath: imageFiles[0] });
    }
    const unusedFiles = allInputFiles.filter((file2) => !usedFiles.includes(file2));
    console.log("未使用的文件:", unusedFiles);
    unusedFiles.forEach((file2) => {
      const fileInfo = updatedInputDirs.find((info) => info.filePath === file2);
      if (fileInfo?.type === "thumbnail") {
        return;
      }
      result.push({
        filePath: file2,
        ...fileInfo?.language ? { language: fileInfo.language } : {}
      });
    });
    return result;
  }
  /**
   * 处理独立的字幕文件（当不嵌入字幕时）
   *
   * @param subtitles - 字幕流信息数组
   * @param outputVideoPath - 输出视频文件的路径
   * @returns 处理后的字幕文件信息数组
   */
  async processStandaloneSubtitles(subtitles, outputVideoPath) {
    const result = [];
    const outputDir = path__namespace.dirname(outputVideoPath);
    for (const subtitle of subtitles) {
      try {
        const outputSubtitleName = path__namespace.basename(subtitle.file, path__namespace.extname(subtitle.file));
        const language = subtitle.language || "und";
        const languageName = getLanguageName(language);
        const subtitleExt = ".srt";
        const newSubtitleFileName = `[${languageName}]${outputSubtitleName}${subtitleExt}`;
        const newSubtitlePath = path__namespace.join(outputDir, newSubtitleFileName);
        const sourceExt = path__namespace.extname(subtitle.file).toLowerCase();
        if (sourceExt === ".srt") {
          try {
            await fs$2.copyFile(subtitle.file, newSubtitlePath);
            console.log(`字幕文件已保存: ${newSubtitlePath}`);
            result.push({
              filePath: newSubtitlePath,
              language
            });
          } catch (err) {
            console.error(`复制字幕文件失败: ${subtitle.file} -> ${newSubtitlePath}`, err);
          }
        } else {
          try {
            await this.convertSubtitleToSrt(subtitle.file, newSubtitlePath);
            console.log(`字幕文件已转换并保存: ${newSubtitlePath}`);
            result.push({
              filePath: newSubtitlePath,
              language
            });
          } catch (err) {
            console.error(`转换字幕文件失败: ${subtitle.file} -> ${newSubtitlePath}`, err);
            try {
              await fs$2.copyFile(subtitle.file, newSubtitlePath.replace(subtitleExt, sourceExt));
              const originalFormatPath = newSubtitlePath.replace(subtitleExt, sourceExt);
              console.log(`字幕文件已以原始格式保存: ${originalFormatPath}`);
              result.push({
                filePath: originalFormatPath,
                language
              });
            } catch (copyErr) {
              console.error(`复制原始字幕文件也失败: ${subtitle.file}`, copyErr);
            }
          }
        }
      } catch (error) {
        console.error(`处理字幕文件时出错: ${subtitle.file}`, error);
      }
    }
    return result;
  }
  /**
   * 将字幕文件转换为SRT格式
   *
   * @param inputPath - 输入字幕文件路径
   * @param outputPath - 输出SRT文件路径
   * @returns 转换成功的Promise
   */
  convertSubtitleToSrt(inputPath, outputPath) {
    return new Promise((resolve, reject) => {
      ffmpeg(inputPath).outputOptions(["-c:s", "srt"]).on("end", () => {
        console.log(`字幕转换成功: ${inputPath} -> ${outputPath}`);
        resolve();
      }).on("error", (err) => {
        console.error(`字幕转换失败: ${inputPath}`, err);
        reject(err);
      }).save(outputPath);
    });
  }
  handleAudioCover(command, imageFiles, index, total, outputFormat, outputOptions, outputFilename) {
    command.output(outputFilename);
    if (imageFiles.length > 0) {
      let coverOptions = [
        "-map",
        `${total}:v:0`
      ];
      if (outputFormat.toLowerCase() === "ogg") {
        coverOptions = [];
      }
      coverOptions = [
        ...coverOptions,
        "-c:v",
        "mjpeg",
        "-disposition:v",
        "attached_pic"
      ];
      outputOptions.push(...coverOptions);
    }
    command.outputOptions(outputOptions);
  }
  configureAudioCodec(index, outputFormat, outputOptions) {
    let codec = "";
    let options = [];
    switch (outputFormat.toLowerCase()) {
      case "mp3":
        codec = "libmp3lame";
        break;
      case "m4a":
        codec = "aac";
        break;
      case "ogg":
        codec = "libvorbis";
        options = ["-map_metadata", "-1"];
        break;
    }
    outputOptions.push("-map", `${index}:a:0`, "-c:a", codec, ...options);
  }
  /**
   * 添加视频输入
   *
   * @param command - FFmpeg 命令实例
   * @param realVideoStreams - 经过过滤的真实视频流数组（排除了可能被误识别为视频的图片）
   * @param mediaInfo - 包含所有媒体流信息的对象（视频、音频、字幕）
   */
  addVideoInputs(command, realVideoStreams, mediaInfo) {
    if (realVideoStreams.length > 0) {
      for (const stream of realVideoStreams) {
        console.log("添加真实视频输入:", stream.file);
        command.input(stream.file);
      }
    } else if (mediaInfo.video.length > 0) {
      for (const stream of mediaInfo.video) {
        console.log("添加视频输入 (可能是图片):", stream.file);
        command.input(stream.file);
      }
    }
  }
  /**
   * 添加音频输入
   *
   * @param command - FFmpeg 命令实例
   * @param mediaInfo - 包含所有媒体流信息的对象（视频、音频、字幕）
   */
  addAudioInputs(command, mediaInfo) {
    for (const stream of mediaInfo.audio) {
      console.log("添加音频输入:", stream.file);
      command.input(stream.file);
    }
  }
  /**
   * 添加字幕输入
   *
   * @param command - FFmpeg 命令实例
   * @param mediaInfo - 包含所有媒体流信息的对象（视频、音频、字幕）
   * @param embedSubtitles - 是否需要嵌入字幕的标志
   */
  addSubtitleInputs(command, mediaInfo, embedSubtitles) {
    if (embedSubtitles) {
      for (const stream of mediaInfo.subtitle) {
        console.log("添加字幕输入:", stream.file);
        command.input(stream.file);
      }
    }
  }
  /**
   * 计算 FFmpeg 命令中不同媒体流（视频、音频、字幕）的输入索引
   * 这些索引用于在 FFmpeg 命令中通过 -map 参数正确映射各个媒体流
   *
   * @param realVideoStreams - 经过过滤的真实视频流数组（排除了可能被误识别为视频的图片）
   * @param mediaInfo - 包含所有媒体流信息的对象（视频、音频、字幕）
   * @param embedSubtitles - 是否需要嵌入字幕的标志
   *
   * @returns 包含三种媒体流索引数组的对象
   *          - videoInputIndices: 视频流的输入索引数组
   *          - audioInputIndices: 音频流的输入索引数组
   *          - subtitleInputIndices: 字幕流的输入索引数组
   */
  calculateInputIndices(realVideoStreams, mediaInfo, embedSubtitles) {
    let inputIndex = 0;
    const videoInputIndices = (realVideoStreams.length > 0 ? realVideoStreams : mediaInfo.video).map(() => inputIndex++);
    const audioInputIndices = mediaInfo.audio.map(() => inputIndex++);
    const subtitleInputIndices = embedSubtitles ? mediaInfo.subtitle.map(() => inputIndex++) : [];
    return { videoInputIndices, audioInputIndices, subtitleInputIndices };
  }
  configureVideoCodec(outputFormat, outputOptions, videoInputIndices, mediaInfo) {
    if (videoInputIndices.length > 0) {
      switch (outputFormat) {
        case "mp4": {
          const videoStream = mediaInfo.video[0];
          const supportedCodecs = ["h264", "h256", "avc1", "hevc", "vp09", "vp9", "av1", "av01"];
          if (videoStream.codec && supportedCodecs.some((codec) => videoStream.codec.toLowerCase().includes(codec))) {
            outputOptions.push("-c:v", "copy");
          } else {
            outputOptions.push("-c:v", "libx264");
          }
          const audioStreamList = mediaInfo.audio;
          const audioCodecs = ["aac"];
          const canCopyAllAudio = audioStreamList.every(
            (audioStream) => audioStream.codec && audioCodecs.some(
              (codec) => audioStream.codec?.toLowerCase().includes(codec)
            )
          );
          if (canCopyAllAudio) {
            outputOptions.push("-c:a", "copy");
          } else {
            outputOptions.push("-c:a", "aac");
          }
          outputOptions.push("-c:s", "mov_text");
          break;
        }
        case "mkv":
          outputOptions.push("-c:v", "copy");
          outputOptions.push("-c:a", "copy");
          outputOptions.push("-c:s", "copy");
          break;
        default:
          outputOptions.push("-c:v", "copy");
          outputOptions.push("-c:a", "copy");
          outputOptions.push("-c:s", "copy");
          break;
      }
      outputOptions.push("-map", `${videoInputIndices[0]}:v:0`);
    }
  }
  configureAudioStreams(outputOptions, audioInputIndices, mediaInfo) {
    audioInputIndices.forEach((inputIdx, index) => {
      outputOptions.push("-map", `${inputIdx}:a:0`);
      const audioStream = mediaInfo.audio[index];
      if (audioStream.language) {
        this.addLanguageMetadata(outputOptions, "a", index, audioStream.language);
      }
    });
  }
  configureSubtitleStreams(outputOptions, subtitleInputIndices, mediaInfo, embedSubtitles) {
    if (embedSubtitles) {
      subtitleInputIndices.forEach((inputIdx, index) => {
        outputOptions.push("-map", `${inputIdx}:s?`);
        const stream = mediaInfo.subtitle[index];
        if (stream.language) {
          this.addLanguageMetadata(outputOptions, "s", index, stream.language);
        }
      });
    }
  }
  addLanguageMetadata(outputOptions, streamType, index, language) {
    const langCode = getISOLanguageCode(language);
    console.log(`设置${streamType === "a" ? "音频" : "字幕"}流 ${index} 的语言为: ${language} -> ${langCode}`);
    outputOptions.push(`-metadata:s:${streamType}:${index}`, `language=${langCode}`);
    const langKey = language.toLowerCase();
    const simpleLangKey = langKey.split("-")[0];
    let title = SUBTITLE_LANGUAGES[langKey] || SUBTITLE_LANGUAGES[simpleLangKey] || "";
    if (!title) {
      const capitalizedKey = langKey.split("-").map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join("-");
      title = SUBTITLE_LANGUAGES[capitalizedKey] || "";
    }
    if (title) {
      const escapedTitle = title.replace(/'/g, "'\\''");
      outputOptions.push(`-metadata:s:${streamType}:${index}`, `title=${escapedTitle}`);
    }
  }
}
const ffmpegService = new FFmpegService();
class FileDownloader {
  constructor(proxyUrl = "", tempDir = "./temp", headers, taskId) {
    this.proxyUrl = proxyUrl;
    this.tempDir = tempDir;
    this.headers = headers;
    this.taskId = taskId;
    if (this.taskId) {
      this.tempDir = path.join(this.tempDir, this.taskId);
    }
  }
  concurrentTaskCount = 8;
  maxRetryCount = 1;
  deleteTempFile = false;
  setTempDir(tempDir) {
    this.tempDir = tempDir;
  }
  setDeleteTempFile(deleteTempFile) {
    this.deleteTempFile = deleteTempFile;
  }
  async getFileInfo(url, headers, controller) {
    const fileInfo = {
      totalBytes: 0,
      extension: "",
      isSupportSharding: false
    };
    try {
      const response = await fetch$1({
        url,
        headers: {
          range: "bytes=0-0",
          ...headers,
          ...this.headers
        },
        abortController: controller
      });
      const acceptRanges = response.headers["accept-ranges"];
      if (acceptRanges === "bytes" || response.statusCode === 206 && response.headers["content-range"]) {
        const contentRange = response.headers["content-range"];
        if (contentRange && !Array.isArray(contentRange)) {
          fileInfo.totalBytes = Number.parseInt(contentRange.split("/")[1] ?? "0");
          if (fileInfo.totalBytes > 0) {
            fileInfo.isSupportSharding = true;
          }
        }
      }
      if (!fileInfo.isSupportSharding) {
        const contentLength = response.headers["content-length"];
        if (contentLength && !Array.isArray(contentLength)) {
          fileInfo.totalBytes = Number.parseInt(contentLength);
        }
      }
      const contentType = response.headers["content-type"];
      if (contentType && !Array.isArray(contentType)) {
        fileInfo.extension = mime.extension(contentType) || "";
      }
      if (fileInfo.extension === "") {
        const contentDisposition = response.headers["content-disposition"];
        if (contentDisposition && !Array.isArray(contentDisposition)) {
          fileInfo.extension = contentDisposition.replace(/"/g, "").split(".").pop() || "";
        }
      }
      if (fileInfo.extension === "" || fileInfo.extension === "bin") {
        const urlObj = new URL(url);
        fileInfo.extension = path.extname(urlObj.pathname).split(".").pop() || "";
      }
      response.on("data", () => {
      });
      response.on("end", () => {
      });
    } catch (error) {
      console.log("[fetch error]", error);
      throw new Error(`获取文件信息失败${error}`);
    }
    return fileInfo;
  }
  async isFileExists(filePath) {
    return fs$3.promises.access(filePath).then(() => true).catch(() => false);
  }
  async downloadFilePart(url, start, end, tempFilePath, retryCount = 0, controller, onProgress, customHeaders) {
    const writer = fs$3.createWriteStream(tempFilePath, { flags: "a" });
    try {
      const fileExists = await this.isFileExists(tempFilePath);
      if (!fileExists) {
        await fs$3.promises.writeFile(tempFilePath, "");
      }
      const shardingSize = end - start + 1;
      const stats = await fs$3.promises.stat(tempFilePath);
      const fileSize = stats.size;
      if (fileSize === shardingSize) {
        return;
      }
      const newStart = start + fileSize;
      let headers = {
        ...this.headers,
        ...customHeaders
      };
      if (newStart > end) {
        return;
      }
      if (start >= 0 && end >= 0) {
        headers = {
          ...headers,
          range: `bytes=${newStart}-${end}`
        };
      }
      const response = await fetch$1({
        url,
        headers,
        abortController: controller
      });
      if (response.statusCode !== 200 && response.statusCode !== 206) {
        throw new Error(`下载失败，状态码: ${response.statusCode}`);
      }
      await new Promise((resolve, reject) => {
        response.on("data", (chunk) => {
          try {
            writer.write(chunk);
            onProgress?.(chunk.length);
          } catch (error) {
            console.error("写入数据时发生错误:", error);
            reject(error);
          }
        });
        response.on("end", () => {
          writer.end(() => resolve());
        });
        response.on("error", (error) => {
          writer.end();
          reject(error);
        });
      });
    } catch (error) {
      if (error instanceof Error && (error.message === "请求被取消" || error.message === "Request aborted" || error.message === "net::ERR_TIMED_OUT")) {
        throw error;
      }
      console.log(`[分片下载错误] 范围: ${start}-${end}`, error);
      if (retryCount < this.maxRetryCount) {
        console.log(`[重试下载] 范围: ${start}-${end}`);
        return this.downloadFilePart(
          url,
          start,
          end,
          tempFilePath,
          retryCount + 1,
          controller,
          onProgress,
          customHeaders
        );
      }
      const errorMessage = error instanceof Error ? error.message : String(error);
      throw new Error(`分片下载失败 [${start}-${end}]: ${errorMessage}`);
    } finally {
      if (writer && !writer.destroyed) {
        try {
          await new Promise((resolve) => {
            writer.end(() => {
              writer.destroy();
              resolve();
            });
          });
        } catch (err) {
          console.error("关闭流时发生错误:", err);
        }
      }
    }
  }
  getShardingCount(totalBytes) {
    const MB_SIZE = 1024 * 1024;
    let partSize = 0;
    if (totalBytes < 100 * MB_SIZE) {
      partSize = 5 * MB_SIZE;
    } else if (totalBytes < 200 * MB_SIZE) {
      partSize = 10 * MB_SIZE;
    } else if (totalBytes < 2e3 * MB_SIZE) {
      partSize = 20 * MB_SIZE;
    } else {
      partSize = 50 * MB_SIZE;
    }
    const totalParts = Math.ceil(totalBytes / partSize);
    const parts = Array.from({ length: totalParts }, (_, i) => [
      i * partSize,
      Math.min((i + 1) * partSize - 1, totalBytes - 1)
    ]);
    return {
      totalParts,
      parts
    };
  }
  md5(str) {
    return crypto.createHash("md5").update(str).digest("hex");
  }
  async mergeSharding(partFolderName, extension, parts) {
    const filePath = path.join(this.tempDir, `${partFolderName}.${extension}`);
    const writeStream = fs$3.createWriteStream(filePath);
    for (const part of parts) {
      const tempFilePath = path.join(
        this.tempDir,
        partFolderName,
        `${part[0]}-${part[1]}`
      );
      try {
        const tempFileExists = await this.isFileExists(tempFilePath);
        if (tempFileExists) {
          const readStream = fs$3.createReadStream(tempFilePath);
          await new Promise((resolve, reject) => {
            readStream.pipe(writeStream, { end: false });
            readStream.on("end", resolve);
            readStream.on("error", (err) => {
              readStream.destroy();
              reject(err);
            });
          });
        }
      } catch (error) {
        console.error(`处理分片失败: ${part[0]}-${part[1]}`, error);
      }
    }
    await new Promise((resolve, reject) => {
      writeStream.end();
      writeStream.on("finish", resolve);
      writeStream.on("error", reject);
    });
  }
  async cleanupShardingFolder(folderPath) {
    try {
      await fs$3.promises.rm(folderPath, { recursive: true, force: true });
      console.log(`清理分片文件夹成功: ${folderPath}`);
    } catch (error) {
      console.error(`清理分片文件夹失败: ${folderPath}`, error);
      throw new Error(`清理分片文件夹失败: ${folderPath} + ${error}`);
    }
  }
  async download(url, headers, controller, callbacks) {
    let progressTimer;
    let downloadedBytes = 0;
    let currentSecondBytes = 0;
    let lastProgressTime = 0;
    let totalBytes = 0;
    if (!controller) {
      controller = new AbortController();
    }
    try {
      const res = await this.getFileInfo(url, headers, controller);
      totalBytes = res.totalBytes;
      progressTimer = setInterval(() => {
        callbacks?.onProgress?.({
          totalBytes,
          downloadedBytes,
          speedBytes: currentSecondBytes
        });
        currentSecondBytes = 0;
        lastProgressTime = Date.now();
      }, 1e3);
      const tempDirExists = await this.isFileExists(this.tempDir);
      if (!tempDirExists) {
        await fs$3.promises.mkdir(this.tempDir, { recursive: true });
      }
      const partFolderName = this.md5(url);
      if (res.isSupportSharding) {
        const partFolderPath = path.join(this.tempDir, partFolderName);
        const partFolderExists = await this.isFileExists(partFolderPath);
        if (!partFolderExists) {
          await fs$3.promises.mkdir(partFolderPath, { recursive: true });
        }
        const sharding = this.getShardingCount(res.totalBytes);
        for (const part of sharding.parts) {
          const tempFilePath = path.join(
            partFolderPath,
            `${part[0]}-${part[1]}`
          );
          const tempFileExists = await this.isFileExists(tempFilePath);
          if (tempFileExists) {
            const stats = await fs$3.promises.stat(tempFilePath);
            downloadedBytes += stats.size;
          }
          await this.downloadFilePart(
            url,
            part[0],
            part[1],
            tempFilePath,
            0,
            controller,
            (bytes) => {
              currentSecondBytes += bytes;
              downloadedBytes = downloadedBytes + bytes;
            },
            headers
          );
        }
        console.log("所有分片下载完成，开始合并文件");
        if (progressTimer) {
          clearInterval(progressTimer);
          progressTimer = void 0;
        }
        await this.mergeSharding(
          partFolderName,
          res.extension,
          sharding.parts
        );
        callbacks?.onProgress?.({
          totalBytes,
          downloadedBytes,
          speedBytes: currentSecondBytes / (Date.now() - lastProgressTime)
        });
        callbacks?.onComplete?.(
          path.join(this.tempDir, `${partFolderName}.${res.extension}`)
        );
        if (this.deleteTempFile) {
          await this.cleanupShardingFolder(partFolderPath);
        }
      } else {
        const filePath = path.join(
          this.tempDir,
          `${partFolderName}.${res.extension}`
        );
        if (await this.isFileExists(filePath)) {
          await fs$3.promises.unlink(filePath);
        }
        await this.downloadFilePart(
          url,
          -1,
          -1,
          filePath,
          0,
          controller,
          (bytes) => {
            currentSecondBytes += bytes;
            downloadedBytes = downloadedBytes + bytes;
          },
          headers
        );
        if (progressTimer) {
          clearInterval(progressTimer);
          progressTimer = void 0;
        }
        callbacks?.onProgress?.({
          totalBytes,
          downloadedBytes,
          speedBytes: currentSecondBytes / (Date.now() - lastProgressTime)
        });
        callbacks?.onComplete?.(filePath);
      }
    } catch (error) {
      if (progressTimer) {
        clearInterval(progressTimer);
        progressTimer = void 0;
      }
      const finalError = error instanceof Error ? error : new Error(`下载失败${error}`);
      if (controller.signal.aborted) {
        const abortError = new Error("下载已取消");
        callbacks?.onError?.(abortError);
        throw abortError;
      }
      callbacks?.onError?.(finalError);
      throw finalError;
    } finally {
      if (progressTimer) {
        clearInterval(progressTimer);
        progressTimer = void 0;
      }
    }
  }
  /**
   * 获取下载链接的文件大小
   * @param url 下载链接
   * @param customHeaders 可选的请求头
   * @returns 文件大小（字节）
   */
  async getFileSize(url, customHeaders, controller) {
    try {
      const response = await fetch$1({
        url,
        headers: {
          range: "bytes=0-0",
          ...this.headers,
          ...customHeaders
        },
        abortController: controller
      });
      let fileSize = 0;
      const contentRange = response.headers["content-range"];
      if (contentRange && !Array.isArray(contentRange)) {
        fileSize = Number.parseInt(contentRange.split("/")[1] ?? "0");
      }
      if (!fileSize) {
        const contentLength = response.headers["content-length"];
        if (contentLength && !Array.isArray(contentLength)) {
          fileSize = Number.parseInt(contentLength);
        }
      }
      response.on("data", () => {
      });
      response.on("end", () => {
      });
      return fileSize;
    } catch (error) {
      throw new Error(`获取文件大小失败：${error}`);
    }
  }
}
class AuthService {
  cookiesFilePath;
  constructor() {
    this.cookiesFilePath = path__namespace.join(electron.app.getPath("userData"), "cookies.txt");
  }
  async getCookies() {
    const session = getAuthSession();
    return session.cookies.get({});
  }
  async verifyLogin(url) {
    const cookies = await this.getCookies();
    const domain = new URL(url).hostname.replace(/^www\./, "");
    if (domain.includes("youtube.com")) {
      const youtubeCookies = cookies.filter(
        (cookie) => cookie.domain && cookie.domain.includes("youtube.com")
      );
      return youtubeCookies.some(
        (cookie) => cookie.name === "LOGIN_INFO" || cookie.name === "APISID" || cookie.name === "SID"
      );
    }
    if (domain.includes("instagram.com")) {
      const instagramCookies = cookies.filter(
        (cookie) => cookie.domain && cookie.domain.includes("instagram.com")
      );
      return instagramCookies.some(
        (cookie) => cookie.name === "sessionid" || cookie.name === "ds_user_id"
      );
    }
    if (domain.includes("x.com") || domain.includes("twitter.com")) {
      const twitterCookies = cookies.filter(
        (cookie) => cookie.domain && (cookie.domain.includes("twitter.com") || cookie.domain.includes("x.com"))
      );
      return twitterCookies.some(
        (cookie) => cookie.name === "auth_token" || cookie.name === "twid"
      );
    }
    return cookies.length > 0;
  }
  async getCookiesFilePath() {
    const exists = await checkFileExists(this.cookiesFilePath);
    if (!exists) {
      return "";
    }
    return this.cookiesFilePath;
  }
  async saveCookieFile() {
    const cookies = await this.getCookies();
    const cookieStr = this.formatCookies(cookies);
    const fileContent = this.updateCookiesContent(
      cookieStr
    );
    await fs__namespace.writeFile(this.cookiesFilePath, fileContent, "utf8");
    return this.cookiesFilePath;
  }
  async deleteCookieFile(domain) {
    try {
      const session = getAuthSession();
      const cookies = await session.cookies.get({});
      const domainWithoutWWW = domain.replace(/^https?:\/\//, "").replace(/^www\./, "");
      const isTwitterDomain = domainWithoutWWW.includes("x.com") || domainWithoutWWW.includes("twitter.com");
      for (const cookie of cookies) {
        if (isTwitterDomain && (cookie.domain?.includes("x.com") || cookie.domain?.includes("twitter.com")) || cookie.domain && cookie.domain.includes(domainWithoutWWW)) {
          const cookieUrl = `http${cookie.secure ? "s" : ""}://${cookie.domain.startsWith(".") ? cookie.domain.slice(1) : cookie.domain}${cookie.path || "/"}`;
          console.log("移除 cookie", cookieUrl, cookie.name);
          await session.cookies.remove(cookieUrl, cookie.name);
        }
      }
      await this.saveCookieFile();
    } catch (error) {
      console.error("移除 Cookie 失败", error);
      throw new Error("移除 Cookie 失败");
    }
  }
  updateCookiesContent(cookieStr) {
    const header = "# Netscape HTTP Cookie File\n# This file is generated by yt-dlp.  Do not edit.\n";
    return header + cookieStr;
  }
  formatCookies(cookies) {
    return cookies.map((cookie) => {
      const domain = cookie.domain ? cookie.domain.startsWith(".") ? cookie.domain : `.${cookie.domain}` : ".localhost";
      const expirationDate = cookie.expirationDate ? Math.floor(cookie.expirationDate) : Math.floor(Date.now() / 1e3 + 365 * 24 * 60 * 60);
      return `${domain}	TRUE	${cookie.path || "/"}	${cookie.secure}	${expirationDate}	${cookie.name}	${cookie.value}`;
    }).join("\n");
  }
}
const authService = new AuthService();
const execAsync = node_util.promisify(node_child_process.exec);
const ytDlpProcesses = /* @__PURE__ */ new Map();
class YtDlpService {
  constructor() {
  }
  /**
   * 执行 yt-dlp 命令
   * @param args - 命令参数
   * @returns 命令输出
   */
  async execute(args) {
    return new Promise((resolve, reject) => {
      const ytDlpPath = getBinPath("yt-dlp");
      const ytDlp = node_child_process.spawn(ytDlpPath, args);
      let output = "";
      let errorOutput = "";
      ytDlp.stdout.on("data", (data) => {
        output += data.toString();
      });
      ytDlp.stderr.on("data", (data) => {
        const message = data.toString();
        if (!message.includes("WARNING:")) {
          errorOutput += message;
        }
      });
      ytDlp.on("close", (code) => {
        if (code === 0 && output) {
          resolve(output);
        } else {
          reject(new Error(errorOutput));
        }
      });
      ytDlp.on("error", (error) => {
        reject(error);
      });
    });
  }
  /**
   * 通过 yt-dlp 获取解析信息
   * @param url - 视频 URL
   * @param taskId - 任务ID
   * @returns 视频信息
   */
  async getParseInfo(url, taskId) {
    const args = [
      url,
      "--dump-json",
      "--no-check-certificates",
      "--no-warnings",
      "--no-playlist",
      "--ignore-errors",
      "--ignore-config",
      "--no-cache-dir",
      "--prefer-insecure",
      "--extractor-args",
      "generic:extract_flat=true",
      "--add-header",
      "User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      "--add-header",
      "Accept: text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
      "--add-header",
      "Accept-Language: zh-CN,zh;q=0.9,en;q=0.8",
      "--retries",
      "3",
      "--socket-timeout",
      "10",
      "--format-sort",
      "res,ext:mp4:m4a"
    ];
    const setting = await settingStore.get("proxy");
    const proxyConfig = ProxyService$1.getProxyConfig(setting);
    if (proxyConfig.mode !== "system") {
      args.push("--proxy", proxyConfig.proxyRules);
    }
    const cookiePath = await authService.getCookiesFilePath();
    if (cookiePath !== "") {
      args.push("--cookies", cookiePath);
    }
    let output = "";
    try {
      const ytDlpPath = getBinPath("yt-dlp");
      const ytDlpProcess = node_child_process.spawn(ytDlpPath, args);
      if (taskId) {
        ytDlpProcesses.set(taskId, ytDlpProcess);
      }
      output = await new Promise((resolve, reject) => {
        let outputData = "";
        let errorData = "";
        ytDlpProcess.stdout.on("data", (data) => {
          outputData += data.toString();
        });
        ytDlpProcess.stderr.on("data", (data) => {
          const message = data.toString();
          if (!message.includes("WARNING:")) {
            errorData += message;
          }
        });
        ytDlpProcess.on("close", (code) => {
          if (taskId) {
            ytDlpProcesses.delete(taskId);
          }
          if (code === 0 && outputData) {
            resolve(outputData);
          } else {
            reject(new Error(errorData));
          }
        });
        ytDlpProcess.on("error", (error) => {
          if (taskId) {
            ytDlpProcesses.delete(taskId);
          }
          reject(error);
        });
      });
      return JSON.parse(output);
    } catch (error) {
      throw new Error(`获取解析信息失败，${output}, ${error}`);
    }
  }
  /**
   * 取消yt-dlp进程
   * @param taskId - 任务ID
   */
  cancelYtDlpProcess(taskId) {
    if (!taskId) {
      logWarn("尝试取消无效的yt-dlp进程", { reason: "taskId为空" });
      return;
    }
    logInfo("尝试取消yt-dlp进程", { taskId });
    const ytdlpProcess = ytDlpProcesses.get(taskId);
    if (ytdlpProcess) {
      try {
        const signal = process.platform === "win32" ? "SIGTERM" : "SIGINT";
        ytdlpProcess.kill(signal);
        logInfo("yt-dlp进程已成功终止", {
          taskId,
          signal,
          platform: process.platform
        });
      } catch (error) {
        logError("终止yt-dlp进程失败", {
          taskId,
          error: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : void 0
        });
      } finally {
        ytDlpProcesses.delete(taskId);
      }
    } else {
      logWarn("未找到yt-dlp进程", { taskId });
    }
  }
  /**
   * 检查 yt-dlp 更新
   * @returns 是否需要更新 true 需要更新 , false 不需要更新
   */
  async checkYtDlpUpdate() {
    try {
      ytDlpStore.set("status", "idle");
      const localVersion = await this.getYtDlpLocalVersion();
      ytDlpStore.set("version", localVersion);
      const latestVersion = await this.getYtDlpLatestVersion();
      console.log("localVersion", localVersion);
      console.log("latestVersion", latestVersion);
      if (latestVersion !== localVersion) {
        try {
          await this.updateYtDlp();
          ytDlpStore.set("status", "idle");
        } catch (error) {
          console.error("检查更新失败:", error);
          ytDlpStore.set("status", "failed");
        }
      } else {
        ytDlpStore.set("status", "idle");
      }
    } catch {
      ytDlpStore.set("status", "failed");
    }
  }
  /**
   * 更新 yt-dlp
   * @returns 是否更新成功
   */
  async updateYtDlp() {
    const ytDlpPath = getBinPath("yt-dlp");
    const tempPath = `${ytDlpPath}.temp`;
    const handlers = main.getRendererHandlers(getMainWindow().webContents);
    const softwareInfo = await getSoftwareInfo();
    const platform = process.platform;
    const downloadUrl = platform === "win32" ? softwareInfo.ytdlpLatestRelease.downloadUrls.windows : softwareInfo.ytdlpLatestRelease.downloadUrls.macOS;
    const updateStatus = (status) => {
      ytDlpStore.set("status", status);
      handlers.onYtDlpUpdateStatus.send(ytDlpStore.get("version"), status);
    };
    try {
      const isDownloadSuccess = await this.downloadYtDlp(downloadUrl, tempPath);
      if (!isDownloadSuccess) {
        console.error("下载yt-dlp失败");
        updateStatus("failed");
        return;
      }
      try {
        await this.replaceYtDlp(ytDlpPath, tempPath);
        const latestVersion = await this.getYtDlpLocalVersion();
        ytDlpStore.set("version", latestVersion);
        updateStatus("idle");
      } catch (error) {
        console.error("替换文件失败:", error);
        updateStatus("failed");
      }
    } catch (error) {
      console.error("yt-dlp更新失败:", error);
      updateStatus("failed");
    }
  }
  /**
   * 下载 yt-dlp
   * @param downloadUrl - 下载地址
   * @param downloadYtDlpPath - 下载路径
   * @returns 是否下载成功
   */
  async downloadYtDlp(downloadUrl, downloadYtDlpPath, retryCount = 0) {
    try {
      const checkYtDlpIsTrue = await this.checkYtDlp(downloadYtDlpPath);
      if (checkYtDlpIsTrue) {
        console.log("yt-dlp已下载且可执行，准备替换");
        return true;
      }
      const fileDownloader = new FileDownloader();
      fileDownloader.setTempDir(path.dirname(downloadYtDlpPath));
      fileDownloader.setDeleteTempFile(true);
      return new Promise((resolve, reject) => {
        let isCompleted = false;
        fileDownloader.download(downloadUrl, {}, null, {
          onComplete: async (filePath) => {
            try {
              await fs$2.rename(filePath, downloadYtDlpPath);
              if (process.platform === "darwin") {
                await fs$2.chmod(downloadYtDlpPath, 493);
              }
              const checkYtDlpIsTrue2 = await this.checkYtDlp(downloadYtDlpPath);
              if (checkYtDlpIsTrue2) {
                console.log(downloadYtDlpPath, "可用");
                if (!isCompleted) {
                  isCompleted = true;
                  resolve(true);
                }
              } else {
                if (!isCompleted) {
                  isCompleted = true;
                  reject(new Error("yt-dlp可行性验证失败"));
                }
              }
            } catch (error) {
              console.error("yt-dlp下载处理失败:", error);
              if (!isCompleted) {
                isCompleted = true;
                reject(error);
              }
            }
          },
          onError: async (error) => {
            console.error("yt-dlp下载失败:", error);
            if (!isCompleted) {
              isCompleted = true;
              reject(error);
            }
          }
        }).catch((error) => {
          if (!isCompleted) {
            isCompleted = true;
            reject(error);
          }
        });
      });
    } catch (error) {
      console.error(`yt-dlp下载失败 (尝试 ${retryCount + 1}/2):`, error);
      if (retryCount === 0) {
        console.log("正在尝试重新下载 yt-dlp...");
        return this.downloadYtDlp(downloadUrl, downloadYtDlpPath, 1);
      }
      return false;
    }
  }
  /**
   * 检查二进制文件是否存在且可用
   * @param ytDlpPath - ytdlp原目录
   * @returns 是否存在且可用
   */
  async checkYtDlp(ytDlpPath) {
    try {
      await execAsync(`"${ytDlpPath}" --version`);
      return true;
    } catch {
      return false;
    }
  }
  /**
   * 替换yt-dlp
   * @param ytDlpPath - ytdlp原目录
   * @param ytDlpTempPath - 新版本ytdlp目录
   * @returns 是否下载成功
   */
  async replaceYtDlp(ytDlpPath, ytDlpTempPath) {
    return new Promise((resolve, reject) => {
      let retries = 0;
      let timerId = null;
      const replaceFile = async () => {
        try {
          const fileExists = await fs$2.access(ytDlpPath).then(() => true).catch(() => false);
          if (fileExists) {
            let isLocked = false;
            if (process.platform === "win32") {
              isLocked = await isFileLockedWin(ytDlpPath);
            } else if (process.platform === "darwin") {
              isLocked = await isFileLockedMac(ytDlpPath);
            } else {
              try {
                await fs$2.rename(ytDlpTempPath, ytDlpPath);
                console.log("yt-dlp 替换成功");
                await fs$2.chmod(ytDlpPath, 493);
                if (timerId) {
                  clearInterval(timerId);
                }
                resolve();
                return;
              } catch (error) {
                isLocked = true;
                console.log("文件无法替换，可能被占用:", error);
              }
            }
            if (isLocked) {
              retries++;
              console.log(`yt-dlp文件被占用，已尝试${retries}次，将在1分钟后继续重试`);
              return;
            }
          }
          await fs$2.rename(ytDlpTempPath, ytDlpPath);
          console.log("yt-dlp 替换成功");
          await fs$2.chmod(ytDlpPath, 493);
          ytDlpStore.set("status", "idle");
          if (timerId) {
            clearInterval(timerId);
          }
          resolve();
        } catch (error) {
          console.error("替换yt-dlp失败:", error);
          ytDlpStore.set("status", "failed");
          if (timerId) {
            clearInterval(timerId);
          }
          reject(error);
        }
      };
      replaceFile().catch((error) => {
        console.log("首次替换尝试未成功，将启动定时器重试:", error);
      });
      timerId = setInterval(replaceFile, 60 * 1e3);
    });
  }
  /**
   * 获取本地 yt-dlp 版本
   * @returns 本地版本
   */
  async getYtDlpLocalVersion() {
    const version = await this.execute(["--version"]);
    return version.trim();
  }
  // [PATCH] GitHub API 调用获取最新版本
  async fetchGitHubLatestRelease() {
    const url = "https://api.github.com/repos/yt-dlp/yt-dlp/releases/latest";
    const response = await fetch$1({ url, timeout: 15000 });
    if (response.statusCode !== 200) {
      throw new Error(`GitHub API 返回 ${response.statusCode}`);
    }
    const chunks = [];
    for await (const chunk of response) {
      chunks.push(chunk);
    }
    const data = JSON.parse(Buffer.concat(chunks).toString());
    const version = data.tag_name;
    const macAsset = data.assets.find(a => a.name === "yt-dlp_macos");
    const winAsset = data.assets.find(a => a.name === "yt-dlp.exe");
    return {
      version,
      downloadUrls: {
        macOS: macAsset ? macAsset.browser_download_url : "",
        windows: winAsset ? winAsset.browser_download_url : ""
      }
    };
  }
  // [PATCH] 获取缓存的版本记录
  getCachedVersion() {
    try {
      const record = sqlite.prepare("SELECT * FROM yt_dlp_version WHERE id = 1").get();
      return record || null;
    } catch {
      return null;
    }
  }
  // [PATCH] 更新缓存的版本记录
  upsertCachedVersion(localVersion, remoteVersion, downloadUrl, lastCheckTime) {
    try {
      const now = Math.floor(Date.now() / 1000);
      sqlite.prepare(`
        INSERT INTO yt_dlp_version (id, local_version, remote_version, download_url, last_check_time, created_at)
        VALUES (1, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          local_version = excluded.local_version,
          remote_version = excluded.remote_version,
          download_url = excluded.download_url,
          last_check_time = excluded.last_check_time
      `).run(localVersion, remoteVersion, downloadUrl, lastCheckTime, now);
    } catch (error) {
      console.error("更新 yt-dlp 版本缓存失败:", error);
    }
  }
  /**
   * 获取最新版本
   * @returns 最新版本
   */
  async getYtDlpLatestVersion() {
    // [PATCH] 实现 3 个月检查间隔 + GitHub API + 缓存策略
    const CHECK_INTERVAL_SECS = 90 * 24 * 3600; // 3 个月
    const now = Math.floor(Date.now() / 1000);
    const localVersion = await this.getYtDlpLocalVersion();
    const cached = this.getCachedVersion();

    // 1. 未超过 3 个月，使用缓存的远程版本
    if (cached && (now - cached.lastCheckTime) < CHECK_INTERVAL_SECS) {
      console.log("yt-dlp: 使用缓存版本", { remote: cached.remoteVersion, lastCheck: cached.lastCheckTime });
      return cached.remoteVersion || localVersion;
    }

    // 2. 超过 3 个月或首次检查，请求 GitHub API
    try {
      console.log("yt-dlp: 请求 GitHub API 检查更新");
      const release = await this.fetchGitHubLatestRelease();
      const platform = process.platform;
      const downloadUrl = platform === "win32" ? release.downloadUrls.windows : release.downloadUrls.macOS;

      // 更新缓存
      this.upsertCachedVersion(localVersion, release.version, downloadUrl, now);
      console.log("yt-dlp: 更新缓存成功", { version: release.version });

      return release.version;
    } catch (error) {
      console.error("yt-dlp: GitHub API 请求失败", { error: error.message });

      // 3. 尝试使用缓存
      if (cached && cached.remoteVersion) {
        console.log("yt-dlp: 使用缓存版本（API 失败）", { remote: cached.remoteVersion });
        return cached.remoteVersion;
      }

      // 4. 首次检查就失败，返回本地版本
      console.warn("yt-dlp: 首次检查失败，使用本地版本");
      return localVersion;
    }
  }
}
const YtDlpService$1 = new YtDlpService();
const tempTaskMap = /* @__PURE__ */ new Map();
const tempTaskProgressMap = /* @__PURE__ */ new Map();
class TaskService {
  constructor() {
  }
  // 获取任务列表
  async getTaskList() {
    const tasks = await db.select().from(task).orderBy(drizzleOrm.desc(task.createdAt)).all();
    const list = tasks.map((item) => {
      return {
        ...item,
        ...tempTaskProgressMap.get(item.id)
      };
    });
    return list;
  }
  // 删除任务
  async deleteTask(taskId) {
    await db.delete(task).where(drizzleOrm.eq(task.id, taskId));
  }
  async getInterruptTasks() {
    const tasks = await db.select().from(task).where(
      drizzleOrm.inArray(
        task.taskStatus,
        [taskStatus.extracting, taskStatus.readyDownload, taskStatus.downloading, taskStatus.pendingConversion, taskStatus.converting]
      )
    ).all();
    return tasks;
  }
  // 删除所有任务
  async deleteTaskList(isDeleteDownloading) {
    if (isDeleteDownloading) {
      const tasksToDelete = await db.select().from(task).all();
      await db.delete(task).execute();
      return tasksToDelete;
    } else {
      const downloadingTasks = await db.select().from(task).where(
        drizzleOrm.and(
          drizzleOrm.inArray(task.taskStatus, [
            taskStatus.extracting,
            taskStatus.downloading,
            taskStatus.pendingConversion,
            taskStatus.converting,
            taskStatus.readyDownload
          ]),
          drizzleOrm.isNull(task.errorMessage)
        )
      ).all();
      const tasksToDelete = await db.select().from(task).where(drizzleOrm.not(drizzleOrm.inArray(task.id, downloadingTasks.map((item) => item.id)))).all();
      await db.delete(task).where(drizzleOrm.not(drizzleOrm.inArray(task.id, downloadingTasks.map((item) => item.id)))).execute();
      return tasksToDelete;
    }
  }
  async parseTask(task2) {
    const handlers = main.getRendererHandlers(getMainWindow().webContents);
    let ytDlpResponse = { url: task2.url };
    let status = taskStatus.extracting;
    let errorMessage = errorMessageEnum.extractError;
    let errorStatus = null;
    let errorAction = null;
    let isError = false;
    try {
      const response = await YtDlpService$1.getParseInfo(task2.url, task2.id);
      if (response) {
        ytDlpResponse = response;
        logInfo("yt-dlp解析成功", {
          taskId: task2.id,
          url: task2.url,
          title: response.title,
          formatCount: response.formats?.length,
          isLive: response.is_live
        });
      }
      // [PATCH] Aptabase telemetry disabled
      // main$1.trackEvent("提取成功", {
      //   url: task2.url
      // });
    } catch (error) {
      isError = true;
      // [PATCH] Aptabase telemetry disabled
      // main$1.trackEvent("提取失败", {
      //   url: task2.url
      // });
      status = taskStatus.failed;
      logError("获取yt-dlp解析信息失败", {
        taskId: task2.id,
        url: task2.url,
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : void 0
      });
      let parseErrorMessage = error instanceof Error ? error.message : error;
      parseErrorMessage = parseErrorMessage.toLowerCase();
      if (parseErrorMessage.includes("unsupported url") || parseErrorMessage.includes("drm protection") || parseErrorMessage.includes("douyin") && parseErrorMessage.includes("fresh cookies")) {
        status = taskStatus.failed;
        errorMessage = errorMessageEnum.unsupportedUrl;
        errorStatus = errorStatusEnum.unsupportedUrl;
      } else if (parseErrorMessage.includes("authentication") || parseErrorMessage.includes("necessarily logged in")) {
        status = taskStatus.extracting;
        errorStatus = errorStatusEnum.extractError;
        errorMessage = errorMessageEnum.needLogin;
        errorAction = actionEnum.login;
      } else if (parseErrorMessage.includes("no video formats found")) {
        status = taskStatus.failed;
        errorStatus = errorStatusEnum.extractError;
        errorMessage = errorMessageEnum.noVideoFormats;
      } else if (parseErrorMessage.includes("establish a new connection") || parseErrorMessage.includes("read time out") || parseErrorMessage.includes("read timed out") || parseErrorMessage.includes("timeout was reached") || parseErrorMessage.includes("sslerror") || parseErrorMessage.includes("httperror 403") || parseErrorMessage.includes("pornhub") && parseErrorMessage.includes("getaddrinfo failed")) {
        status = taskStatus.extracting;
        errorStatus = errorStatusEnum.extractError;
        errorMessage = errorMessageEnum.timeout;
      } else if (parseErrorMessage.includes("need to purchase")) {
        status = taskStatus.extracting;
        errorStatus = errorStatusEnum.extractError;
        errorMessage = errorMessageEnum.needPurchase;
      } else if (parseErrorMessage.includes("object has no attribute") || parseErrorMessage.includes("request is blocked")) {
        status = taskStatus.extracting;
        errorStatus = errorStatusEnum.extractError;
        errorMessage = errorMessageEnum.serverError;
      } else if (parseErrorMessage.includes("video unavailable")) {
        status = taskStatus.extracting;
        errorStatus = errorStatusEnum.extractError;
        errorMessage = errorMessageEnum.videoNotAccess;
      }
      await this.updateTask(task2.id, {
        taskStatus: status,
        errorStatus,
        errorMessage,
        errorAction
      });
      handlers.onDownloadProgress.send({
        ...task2,
        taskStatus: status,
        taskId: task2.id,
        totalSize: null,
        downloadedSize: null,
        speed: null,
        eta: null,
        errorStatus,
        errorMessage,
        errorAction,
        isLive: task2.isLive || false
      });
    }
    if (isError) {
      return null;
    }
    return ytDlpResponse;
  }
  // 保存下载任务
  async saveTaskByUrls(urls) {
    const taskList = [];
    for (const url of urls) {
      const tempTask = {
        text: url,
        thumbnail: null,
        items: [],
        setting: settingStore.store
      };
      taskList.push({
        id: uuid.v4(),
        text: "",
        url,
        filePath: null,
        fileSize: null,
        taskStatus: taskStatus.extracting,
        thumbnail: null,
        extension: null,
        resolutionWidth: null,
        resolutionHeight: null,
        bitrate: null,
        duration: null,
        errorStatus: null,
        errorMessage: null,
        errorAction: null,
        tempTask: JSON.stringify(tempTask),
        requestHeaders: null,
        isLive: false,
        createdAt: Date.now(),
        updatedAt: Date.now()
      });
    }
    await db.insert(task).values(taskList);
    return taskList;
  }
  // 保存嗅探任务
  async saveSnifferTask(taskData) {
    await db.insert(task).values(taskData);
  }
  async cancelTaskList() {
    try {
      const tasks = await db.select().from(task).where(
        drizzleOrm.and(
          drizzleOrm.ne(task.taskStatus, taskStatus.completed),
          drizzleOrm.ne(task.taskStatus, taskStatus.failed)
        )
      ).all();
      const mainWindow2 = getMainWindow();
      const handlers = main.getRendererHandlers(mainWindow2.webContents);
      for (const task2 of tasks) {
        try {
          YtDlpService$1.cancelYtDlpProcess(task2.id);
          ffmpegService.cancelFFmpegProcess(task2.id);
          snapfileService.cancelTask(task2.id);
          await this.updateTask(task2.id, {
            errorStatus: errorStatusEnum.interrupted,
            errorMessage: errorMessageEnum.interrupted
          });
          handlers.onDownloadProgress.send({
            ...task2,
            taskStatus: task2.taskStatus,
            taskId: task2.id,
            eta: null,
            totalSize: null,
            downloadedSize: null,
            speed: null,
            errorAction: null,
            errorStatus: errorStatusEnum.interrupted,
            errorMessage: errorMessageEnum.interrupted,
            isLive: task2.isLive || false
          });
        } catch (err) {
          logError("取消任务失败", {
            taskId: task2.id,
            error: err instanceof Error ? err.message : String(err),
            stack: err instanceof Error ? err.stack : void 0
          });
          continue;
        }
      }
    } catch (err) {
      logError("批量取消任务失败", {
        error: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : void 0
      });
    }
  }
  // 更新任务
  async updateTask(taskId, data) {
    await db.update(task).set(data).where(drizzleOrm.eq(task.id, taskId));
  }
  // 获取需要下载的下载项列表
  async getNeedDownloadItems(task2, data, setting) {
    if (!data) {
      logWarn("getNeedDownloadItems: data为空，返回空数组", {
        taskId: task2.id,
        url: task2.url
      });
      return [];
    }
    if (data.is_live === true) {
      data.formats = data.formats.filter((item) => !(item.ext === "flv" && item.vcodec === "hevc"));
    }
    const downloadItems = [];
    const headers = getHttpHeaders(data);
    const text = data.title || data.fulltitle || data.description || data.channel || data.uploader;
    if (data.direct && data.url) {
      downloadItems.push({
        url: data.url,
        headers
      });
      const thumbnail2 = data?.thumbnail;
      const tempTask2 = {
        text,
        thumbnail: thumbnail2,
        items: downloadItems,
        setting
      };
      await this.updateTask(task2.id, {
        text,
        tempTask: JSON.stringify(tempTask2)
      });
      tempTaskMap.set(task2.id, tempTask2);
      return downloadItems;
    }
    if (!data.formats || data.formats.length === 0) {
      return downloadItems;
    }
    const thumbnail = data.thumbnail ? data.thumbnail : data.url;
    const audio = this.selectAudioBySetting(data, setting);
    if (setting.downloadType === "video") {
      const video = this.selectVideoBySetting(data, setting);
      if (video) {
        downloadItems.push({
          ...video,
          headers
        });
      }
      const subtitle = this.selectSubtitleBySetting(data, setting);
      if (subtitle) {
        downloadItems.push(...subtitle.map((item) => ({
          ...item,
          headers,
          optionalDownload: true
          // 字幕下载失败不影响整个任务
        })));
      }
    }
    if (downloadItems.length === 0) {
      downloadItems.push(...audio.map((item) => ({
        ...item,
        headers
      })));
    } else {
      if (data.is_live !== true) {
        const notAudio = downloadItems.every((item) => !item.acode || ["none", "undefined", "null"].includes(item.acode));
        const existingLanguages = new Set(
          downloadItems.filter((item) => item.acode && !["none", "undefined", "null"].includes(item.acode)).map((item) => item.language || "default")
        );
        const audioLanguages = audio.map((item) => item.language || "default");
        const hasUncoveredLanguages = audioLanguages.some((lang) => !existingLanguages.has(lang));
        if (notAudio || hasUncoveredLanguages) {
          downloadItems.push(...audio.map((item) => ({
            ...item,
            headers
          })));
        }
      }
    }
    logInfo("生成下载项列表", {
      taskId: task2.id,
      url: task2.url,
      downloadItemsCount: downloadItems.length
    });
    const uniqueDownloadItems = downloadItems.reduce((acc, current) => {
      const isDuplicate = acc.some((item) => item.url === current.url);
      if (!isDuplicate) {
        acc.push(current);
      }
      return acc;
    }, []);
    if (thumbnail && setting.isDownloadThumbnail) {
      console.log("添加封面图到下载列表最后:", thumbnail);
      uniqueDownloadItems.push({
        url: thumbnail,
        headers,
        optionalDownload: true
        // 封面图下载失败不影响整个任务
      });
    } else {
      console.log("跳过封面图下载:", {
        hasThumbnail: !!thumbnail,
        isDownloadThumbnail: setting.isDownloadThumbnail
      });
    }
    const tempTask = {
      text,
      thumbnail,
      items: uniqueDownloadItems,
      setting
    };
    await this.updateTask(task2.id, {
      text,
      tempTask: JSON.stringify(tempTask)
    });
    tempTaskMap.set(task2.id, tempTask);
    return uniqueDownloadItems;
  }
  // 下载封面并保存
  async downloadThumbnail(taskId, downloadTempPath) {
    let tempTask = tempTaskMap.get(taskId);
    if (!tempTask) {
      const task2 = await this.getTaskById(taskId);
      if (!task2.tempTask) {
        return null;
      }
      tempTask = JSON.parse(task2.tempTask);
    }
    if (!tempTask.thumbnail) {
      return;
    }
    const { thumbnail, text, items } = tempTask;
    const filePathDir = path.join(downloadTempPath, "temp");
    const data = await ensureDirectoryExists(filePathDir);
    if (!data.success) {
      if (data.error) {
        logError("封面图下载失败", { taskId, error: data.error });
        if (data.error.includes("not permitted") || data.error.includes("permission denied")) {
          await this.updateTask(taskId, {
            taskStatus: taskStatus.failed,
            errorStatus: errorStatusEnum.extractError,
            errorMessage: errorMessageEnum.permissionDenied
          });
          const updatedTask = await this.getTaskById(taskId);
          const handlers = main.getRendererHandlers(getMainWindow().webContents);
          handlers.onDownloadProgress.send({
            ...updatedTask,
            taskId: updatedTask.id,
            taskStatus: taskStatus.failed,
            totalSize: null,
            downloadedSize: null,
            speed: null,
            eta: null,
            errorAction: null,
            errorStatus: errorStatusEnum.extractError,
            errorMessage: errorMessageEnum.permissionDenied,
            isLive: updatedTask.isLive || false
          });
        } else {
          logError("封面图下载失败", { taskId, error: data.error });
          await this.updateTask(taskId, {
            taskStatus: taskStatus.failed,
            errorStatus: errorStatusEnum.extractError,
            errorMessage: errorMessageEnum.extractError
          });
          const updatedTask = await this.getTaskById(taskId);
          const handlers = main.getRendererHandlers(getMainWindow().webContents);
          handlers.onDownloadProgress.send({
            ...updatedTask,
            taskId: updatedTask.id,
            taskStatus: taskStatus.failed,
            totalSize: null,
            downloadedSize: null,
            speed: null,
            eta: null,
            errorAction: null,
            errorStatus: errorStatusEnum.extractError,
            errorMessage: errorMessageEnum.extractError,
            isLive: updatedTask.isLive || false
          });
        }
      }
      return;
    }
    let headers = {};
    if (items.length > 0) {
      headers = items[0].headers;
    }
    const resp = await fetch$1({ url: thumbnail, method: "GET", headers });
    if (resp.statusCode !== 200) {
      return null;
    }
    const ext = getExtensionFromHeaders(thumbnail, resp.headers);
    const filePath = path.join(filePathDir, `${md5(thumbnail)}.${ext}`);
    const writer = fs$3.createWriteStream(filePath);
    await new Promise((resolve, reject) => {
      resp.on("data", (chunk) => {
        writer.write(chunk);
      });
      resp.on("end", () => {
        writer.end(() => resolve());
      });
      resp.on("error", (error) => {
        writer.end();
        reject(error);
      });
      writer.on("error", (error) => {
        writer.end();
        reject(error);
      });
    });
    const base64Image = await getBase64Image(filePath);
    const extension = ext.split(".").pop();
    await this.updateTask(taskId, {
      text,
      thumbnail: `data:image/${extension};base64,${base64Image}`,
      extension
    });
    return {
      url: thumbnail,
      tempFilePath: filePath
    };
  }
  // 获取任务
  async getTaskById(taskId) {
    const tasks = await db.select().from(task).where(drizzleOrm.eq(task.id, taskId)).limit(1).all();
    if (tasks.length === 0) {
      throw new Error("任务不存在");
    }
    return tasks[0];
  }
  // public async download(taskId: string, items: DownloadItem[], setting: SettingStoreType) {
  //   // 使用snapfile进行下载
  //   await this.downloadWithSnapfile(taskId, items, setting)
  // }
  /**
   * 使用snapfile进行下载
   */
  async downloadWithSnapfile(taskId, items, setting) {
    const handlers = main.getRendererHandlers(getMainWindow().webContents);
    const appName = electron.app.getName();
    const downloadPath = setting.downloadPath;
    const downloadTempPath = path.join(downloadPath, `.${appName}`, taskId);
    const tempDirResult = await ensureDirectoryExists(downloadTempPath);
    if (!tempDirResult.success) {
      if (tempDirResult.error) {
        logError("创建临时目录失败", { taskId, error: tempDirResult.error });
        if (tempDirResult.error.includes("not permitted") || tempDirResult.error.includes("permission denied")) {
          await this.updateTask(taskId, {
            taskStatus: taskStatus.readyDownload,
            errorStatus: errorStatusEnum.extractError,
            errorMessage: errorMessageEnum.permissionDenied
          });
          const updatedTask = await this.getTaskById(taskId);
          handlers.onDownloadProgress.send({
            ...updatedTask,
            taskId: updatedTask.id,
            taskStatus: taskStatus.readyDownload,
            totalSize: null,
            downloadedSize: null,
            speed: null,
            eta: null,
            errorAction: null,
            errorStatus: errorStatusEnum.extractError,
            errorMessage: errorMessageEnum.permissionDenied,
            isLive: updatedTask.isLive || false
          });
        } else {
          logError("创建临时目录失败", { taskId, error: tempDirResult.error });
          await this.updateTask(taskId, {
            taskStatus: taskStatus.readyDownload,
            errorStatus: errorStatusEnum.extractError,
            errorMessage: errorMessageEnum.extractError
          });
          const updatedTask = await this.getTaskById(taskId);
          handlers.onDownloadProgress.send({
            ...updatedTask,
            taskId: updatedTask.id,
            taskStatus: taskStatus.readyDownload,
            totalSize: null,
            downloadedSize: null,
            speed: null,
            eta: null,
            errorAction: null,
            errorStatus: errorStatusEnum.extractError,
            errorMessage: errorMessageEnum.extractError,
            isLive: updatedTask.isLive || false
          });
        }
      }
      return;
    }
    if (process.platform === "win32") {
      fs$2.chmod(downloadTempPath, 256);
    }
    const task2 = await this.getTaskById(taskId);
    if (!snapfileService.isProcessRunning()) {
      try {
        await snapfileService.start();
      } catch (error) {
        logError("启动snapfile进程失败", {
          taskId,
          error: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : void 0
        });
        await this.updateTask(taskId, {
          taskStatus: taskStatus.failed,
          errorStatus: errorStatusEnum.downloadError,
          errorMessage: errorMessageEnum.downloadError
        });
        handlers.onDownloadProgress.send({
          ...task2,
          taskId: task2.id,
          taskStatus: taskStatus.failed,
          totalSize: null,
          downloadedSize: null,
          speed: null,
          eta: null,
          errorStatus: errorStatusEnum.downloadError,
          errorMessage: errorMessageEnum.downloadError,
          errorAction: null,
          isLive: task2.isLive || false
        });
        return;
      }
    }
    await this.downloadThumbnail(taskId, downloadTempPath);
    logInfo("任务下载开始", {
      taskId,
      startTime: (/* @__PURE__ */ new Date()).toLocaleString("zh-CN", { hour12: false }),
      downloadItemsCount: items.length
    });
    const proxyConfig = ProxyService$1.getProxyConfig(setting.proxy);
    let proxyParam = "system";
    proxyParam = proxyConfig.mode === "direct" ? "direct" : proxyConfig.mode === "system" ? "system" : proxyConfig.proxyRules || "system";
    const snapfileTask = {
      taskID: taskId,
      name: task2.text || "download",
      outputDir: downloadPath,
      // 最终输出目录
      tempDir: downloadTempPath,
      // 临时目录
      outputType: setting.downloadType,
      outputVideoFormat: setting.downloadType === "video" ? setting.videoConfig.format.format : "mp4",
      outputAudioFormat: setting.downloadType === "audio" ? setting.audioConfig.format.format : "mp3",
      live: false,
      // 根据需要设置
      embeddedSubtitle: setting.embedSubtitle || false,
      proxy: proxyParam,
      // 添加代理配置
      files: items.map((item) => ({
        url: item.url,
        language: item.language,
        header: item.headers,
        optionalDownload: item.optionalDownload
        // 传递optionalDownload属性到snapfile
      }))
    };
    const success = snapfileService.startTask(snapfileTask, {
      onProgress: async (progressData) => {
        const { done, total, speed, remainingTime, progressType } = progressData;
        let etaDisplay = "00:00";
        if (remainingTime > 0) {
          if (remainingTime <= 86400) {
            etaDisplay = formatTime(remainingTime);
          } else {
            etaDisplay = "24:00:00+";
          }
        }
        const progressPercent = total > 0 ? Math.round(done / total * 100) : 0;
        const currentTask = await this.getTaskById(taskId);
        const currentTaskStatus = currentTask.taskStatus;
        let progressInfo;
        let progressMessage;
        if (progressType === "download") {
          progressInfo = {
            totalSize: total,
            downloadedSize: done,
            speed,
            eta: etaDisplay,
            percent: null
          };
          progressMessage = {
            ...currentTask,
            taskId: currentTask.id,
            taskStatus: currentTaskStatus,
            totalSize: total,
            downloadedSize: done,
            speed,
            eta: etaDisplay,
            percent: null,
            errorAction: null,
            errorStatus: null,
            errorMessage: null,
            isLive: currentTask.isLive || false
          };
        } else if (progressType === "conversion") {
          progressInfo = {
            totalSize: null,
            downloadedSize: null,
            speed: null,
            eta: etaDisplay,
            percent: progressPercent
          };
          progressMessage = {
            ...currentTask,
            taskId: currentTask.id,
            taskStatus: currentTaskStatus,
            totalSize: null,
            downloadedSize: null,
            speed: null,
            eta: etaDisplay,
            percent: progressPercent,
            errorAction: null,
            errorStatus: null,
            errorMessage: null,
            isLive: currentTask.isLive || false
          };
        }
        tempTaskProgressMap.set(currentTask.id, progressInfo);
        handlers.onDownloadProgress.send(progressMessage);
      },
      onStatusChange: async (status, _data) => {
        if (status === SnapfileStatusCode.task_live_detected) {
          await this.updateTask(taskId, {
            isLive: true
          });
          const liveTask = await this.getTaskById(taskId);
          handlers.onDownloadProgress.send({
            ...liveTask,
            taskId: liveTask.id,
            taskStatus: "downloading",
            // 保持下载中状态
            totalSize: tempTaskProgressMap.get(liveTask.id)?.totalSize || null,
            downloadedSize: tempTaskProgressMap.get(liveTask.id)?.downloadedSize || null,
            speed: tempTaskProgressMap.get(liveTask.id)?.speed || null,
            eta: tempTaskProgressMap.get(liveTask.id)?.eta || null,
            errorAction: null,
            errorStatus: null,
            errorMessage: null,
            isLive: true
            // 添加直播标识
          });
          return;
        }
        const currentTaskStatus = mapSnapfileStatusToTaskStatus(status);
        await this.updateTask(taskId, {
          taskStatus: currentTaskStatus,
          errorStatus: null,
          errorMessage: null,
          errorAction: null
        });
        const latestTask = await this.getTaskById(taskId);
        const shouldClearProgress = (
          // 从下载阶段进入等待转换阶段
          status === SnapfileStatusCode.task_pending_conversion || // 从下载阶段进入转换阶段
          status === SnapfileStatusCode.task_start_conversion || // 从转换阶段进入移动阶段
          status === SnapfileStatusCode.task_start_move
        );
        handlers.onDownloadProgress.send({
          ...latestTask,
          taskId: latestTask.id,
          taskStatus: currentTaskStatus,
          totalSize: shouldClearProgress ? null : tempTaskProgressMap.get(latestTask.id)?.totalSize || null,
          downloadedSize: shouldClearProgress ? null : tempTaskProgressMap.get(latestTask.id)?.downloadedSize || null,
          speed: shouldClearProgress ? null : tempTaskProgressMap.get(latestTask.id)?.speed || null,
          eta: shouldClearProgress ? null : tempTaskProgressMap.get(latestTask.id)?.eta || null,
          errorAction: null,
          errorStatus: null,
          errorMessage: null,
          isLive: latestTask.isLive || false
          // 添加直播标识
        });
      },
      onComplete: async (data) => {
        logInfo("snapfile任务完成", {
          taskId: task2.id,
          url: task2.url,
          snapfileTaskId: data.taskID,
          filesCount: data.files?.length || 0
        });
        // [PATCH] Aptabase telemetry disabled
        // main$1.trackEvent("下载成功", {
        //   url: task2.url
        // });
        const mainFile = data.files[0];
        let mediaInfo = {
          mediaType: "other"
        };
        try {
          const fileExt = path.extname(mainFile);
          const extension = fileExt.split(".").pop();
          const detailedMediaInfo = await getFilePathMediaInfo(mainFile);
          const videoStream = detailedMediaInfo.streams?.find(
            (stream) => stream.codec_type === "video" && stream.codec_name !== "mjpeg"
          );
          if (videoStream) {
            mediaInfo.mediaType = "video";
            mediaInfo.resolutionWidth = videoStream.width;
            mediaInfo.resolutionHeight = videoStream.height;
            if (videoStream.duration) {
              mediaInfo.duration = Math.ceil(Number.parseFloat(videoStream.duration));
            }
          }
          if (!mediaInfo.duration && detailedMediaInfo.format && detailedMediaInfo.format.duration) {
            mediaInfo.duration = Math.ceil(Number(detailedMediaInfo.format.duration));
          }
          const audioStream = detailedMediaInfo.streams?.find(
            (stream) => stream.codec_type === "audio"
          );
          if (audioStream && audioStream.bit_rate) {
            const bitrate = Math.ceil(Number.parseFloat(audioStream.bit_rate));
            mediaInfo.bitrate = bitrate;
            mediaInfo.mediaType = videoStream ? "video" : "audio";
          }
          const subtitleStream = detailedMediaInfo.streams?.find(
            (stream) => stream.codec_type === "subtitle"
          );
          if (subtitleStream && !audioStream && !videoStream) {
            mediaInfo.mediaType = "subtitle";
          }
          const stats = await fs$2.stat(mainFile);
          mediaInfo = {
            ...mediaInfo,
            extension,
            filePath: mainFile,
            fileSize: stats.size
          };
          console.log("解析的媒体信息:", mediaInfo);
        } catch (error) {
          logWarn("获取文件信息失败", {
            taskId: task2.id,
            filePath: mainFile,
            error: error instanceof Error ? error.message : String(error)
          });
          try {
            const stats = await fs$2.stat(mainFile);
            const fileExt = path.extname(mainFile);
            const extension = fileExt.split(".").pop();
            mediaInfo = {
              mediaType: "other",
              extension,
              filePath: mainFile,
              fileSize: stats.size
            };
          } catch (statError) {
            logWarn("获取文件基本信息也失败", {
              taskId: task2.id,
              filePath: mainFile,
              error: statError instanceof Error ? statError.message : String(statError)
            });
            mediaInfo = {
              mediaType: "other",
              filePath: mainFile,
              fileSize: 0
            };
          }
        }
        await this.updateTask(taskId, {
          taskStatus: taskStatus.completed,
          ...mediaInfo,
          tempTask: null,
          errorStatus: null,
          errorMessage: null,
          errorAction: null
        });
        const completedTask = await this.getTaskById(taskId);
        handlers.onDownloadProgress.send({
          ...completedTask,
          taskId: completedTask.id,
          taskStatus: taskStatus.completed,
          filePath: mediaInfo.filePath,
          duration: mediaInfo.duration,
          bitrate: mediaInfo.bitrate,
          extension: mediaInfo.extension,
          totalSize: mediaInfo.fileSize,
          resolutionWidth: mediaInfo.resolutionWidth,
          resolutionHeight: mediaInfo.resolutionHeight,
          eta: null,
          downloadedSize: null,
          speed: null,
          errorAction: null,
          errorStatus: null,
          errorMessage: null,
          isLive: completedTask.isLive || false
        });
        tempTaskProgressMap.delete(completedTask.id);
        if (!isDev) {
          try {
            await fs$2.rm(downloadTempPath, { recursive: true, force: true });
          } catch (error) {
            logWarn("删除临时文件失败", {
              taskId: task2.id,
              tempPath: downloadTempPath,
              error: error instanceof Error ? error.message : String(error)
            });
          }
        }
      },
      onError: async (error) => {
        logError("snapfile任务失败", {
          taskId: task2.id,
          url: task2.url,
          errorCode: error.code,
          errorMessage: error.message,
          retryable: error.retryable
        });
        tempTaskProgressMap.delete(task2.id);
        // [PATCH] Aptabase telemetry disabled
        // main$1.trackEvent("下载失败", {
        //   url: task2.url
        // });
        const errorStatus = mapSnapfileErrorToErrorStatus(error.code);
        let errorMessage = errorMessageEnum.downloadError;
        let finalTaskStatus = taskStatus.downloading;
        switch (error.code) {
          case SnapfileStatusCode.http_status_forbidden_error:
            errorMessage = errorMessageEnum.videoNotAccess;
            finalTaskStatus = taskStatus.downloading;
            break;
          case SnapfileStatusCode.prepare_error:
          // 准备阶段错误
          case SnapfileStatusCode.parse_m3u8_error:
          // m3u8解析错误
          case SnapfileStatusCode.download_error:
            errorMessage = errorMessageEnum.downloadError;
            finalTaskStatus = taskStatus.downloading;
            break;
          case SnapfileStatusCode.convert_error:
            errorMessage = errorMessageEnum.convertError;
            finalTaskStatus = taskStatus.failed;
            break;
          case SnapfileStatusCode.move_error:
            errorMessage = errorMessageEnum.moveError;
            finalTaskStatus = taskStatus.converting;
            break;
          case SnapfileStatusCode.unknown_event:
          // 未知事件
          case SnapfileStatusCode.task_already_started:
            errorMessage = errorMessageEnum.downloadError;
            finalTaskStatus = taskStatus.downloading;
            break;
          case SnapfileStatusCode.disk_full:
            errorMessage = errorMessageEnum.diskFull;
            finalTaskStatus = taskStatus.downloading;
            break;
          case SnapfileStatusCode.os_permission_denied:
            errorMessage = errorMessageEnum.permissionDenied;
            finalTaskStatus = taskStatus.downloading;
            break;
          case SnapfileStatusCode.unknown_error:
            errorMessage = errorMessageEnum.downloadError;
            finalTaskStatus = taskStatus.failed;
            break;
          default:
            errorMessage = errorMessageEnum.downloadError;
            finalTaskStatus = taskStatus.downloading;
            break;
        }
        const finalTaskId = error.taskID || taskId;
        await this.updateTask(finalTaskId, {
          taskStatus: finalTaskStatus,
          errorStatus,
          errorMessage,
          errorAction: null
        });
        const updatedTask = await this.getTaskById(finalTaskId);
        handlers.onDownloadProgress.send({
          ...updatedTask,
          taskId: updatedTask.id,
          taskStatus: finalTaskStatus,
          totalSize: null,
          downloadedSize: null,
          speed: null,
          eta: null,
          errorAction: null,
          errorStatus,
          errorMessage,
          isLive: updatedTask.isLive || false
        });
      }
    });
    if (!success) {
      logError("启动snapfile任务失败", {
        taskId,
        itemsCount: items.length
      });
      await this.updateTask(taskId, {
        taskStatus: taskStatus.failed,
        errorStatus: errorStatusEnum.downloadError,
        errorMessage: errorMessageEnum.downloadError
      });
      const updatedTask = await this.getTaskById(taskId);
      handlers.onDownloadProgress.send({
        ...updatedTask,
        taskId: updatedTask.id,
        taskStatus: taskStatus.failed,
        totalSize: null,
        downloadedSize: null,
        speed: null,
        eta: null,
        errorStatus: errorStatusEnum.downloadError,
        errorMessage: errorMessageEnum.downloadError,
        errorAction: null,
        isLive: updatedTask.isLive || false
      });
    }
  }
  filterFormatsBySize(formats) {
    const formatsWithSize = formats.filter((f) => f.filesize != null);
    if (formatsWithSize.length > 0) {
      const maxSize = Math.max(...formatsWithSize.map((f) => f.filesize));
      return formatsWithSize.filter((f) => f.filesize === maxSize);
    }
    const formatsWithApproxSize = formats.filter((f) => f.filesize_approx != null);
    if (formatsWithApproxSize.length > 0) {
      const maxSize = Math.max(...formatsWithApproxSize.map((f) => f.filesize_approx));
      return formatsWithApproxSize.filter((f) => f.filesize_approx === maxSize);
    }
    return formats;
  }
  // 过滤音频格式
  filterAudioFormats(formats, setting) {
    let audioFormats = formats.filter((format) => format.acodec && format.acodec !== "none");
    if (audioFormats.length === 0) {
      return formats[formats.length - 1];
    }
    const codecMap = /* @__PURE__ */ new Map([
      ["mp3", ["mp3", "aac", "mp4a", "m4a", "opus"]],
      ["ogg", ["opus", "aac", "mp4a", "m4a", "mp3"]],
      ["m4a", ["aac", "mp4a", "m4a", "mp3", "opus"]]
    ]);
    const userFormat = setting.audioConfig.format.format || "mp3";
    const codecPriorities = codecMap.get(userFormat) || codecMap.get("m4a");
    for (const codec of codecPriorities) {
      const isAacFamily = ["aac", "mp4a", "m4a"].includes(codec);
      const filtered = audioFormats.filter((format) => {
        const acodec = format.acodec?.toLowerCase();
        return isAacFamily ? ["aac", "mp4a", "m4a"].some((c) => acodec?.startsWith(c)) : acodec?.startsWith(codec);
      });
      if (filtered.length > 0) {
        audioFormats = filtered;
        break;
      }
    }
    const bitrateRanges = [
      { min: 289, label: "320+" },
      { min: 225, max: 288, label: "256-288" },
      { min: 161, max: 224, label: "192-224" },
      { min: 97, max: 160, label: "128-160" },
      { min: 0, max: 96, label: "0-96" }
    ];

    const targetBitrate = setting.audioConfig.bitrate;
    if (typeof targetBitrate === "number") {
      let best = audioFormats[0];
      let bestDiff = Infinity;
      for (const f of audioFormats) {
        const diff = Math.abs((f.abr || 0) - targetBitrate);
        if (diff < bestDiff) {
          bestDiff = diff;
          best = f;
        }
      }
      return best;
    }
    const groups = audioFormats.reduce((acc, format) => {
      const abr = format.abr;
      const range = bitrateRanges.find(
        (r) => abr >= r.min && (!r.max || abr <= r.max)
      );
      if (range) {
        acc[range.label] = acc[range.label] || [];
        acc[range.label].push(format);
      }
      return acc;
    }, {});
    const highestGroup = Object.keys(groups)[0];
    return (groups[highestGroup] || audioFormats)[0];
  }
  // 选择视频
  selectVideoBySetting(data, setting) {
    let videoFormats = data.formats.filter((format) => format.vcodec && format.vcodec !== "none" || format.video_ext);
    if (videoFormats.length === 0) {
      return null;
    }
    const resolutionGroups = videoFormats.reduce((groups, format) => {
      if (format.width || format.height) {
        const resolution = Math.min(
          format.width || Number.MAX_SAFE_INTEGER,
          format.height || Number.MAX_SAFE_INTEGER
        );
        const standardRes = getVideoResolution(resolution);
        groups[standardRes] = groups[standardRes] || [];
        groups[standardRes].push(format);
      }
      return groups;
    }, {});
    const availableResolutions = Object.keys(resolutionGroups).map(Number).sort((a, b) => b - a);
    if (availableResolutions.length > 0) {
      const preferredResolution = setting.videoConfig.resolution ?? "1080";
      const numericResolution = Number(preferredResolution);
      if (!Number.isNaN(numericResolution) && preferredResolution !== "highest") {
        const selectedResolution = availableResolutions.reduce(
          (prev, curr) => Math.abs(curr - numericResolution) < Math.abs(prev - numericResolution) ? curr : prev
        );
        videoFormats = resolutionGroups[selectedResolution] || videoFormats;
      } else {
        videoFormats = resolutionGroups[availableResolutions[0]] || videoFormats;
      }
    }
    const codecPriorityMap = /* @__PURE__ */ new Map([
      ["h264", 1],
      ["avc1", 1],
      ["h265", 2],
      ["hevc", 2],
      ["hev1", 2],
      ["vp9", 3],
      ["vp09", 3],
      ["av01", 4],
      ["av1", 4]
    ]);
    const getCodecPriority = (format) => {
      const vcodec = (format.vcodec || "").toLowerCase();
      let priority = 5;
      codecPriorityMap.forEach((value, codec) => {
        if (vcodec.startsWith(codec)) {
          priority = value;
        }
      });
      return priority;
    };
    const priorityGroups = videoFormats.reduce((acc, format) => {
      const priority = getCodecPriority(format);
      acc[priority] = acc[priority] || [];
      acc[priority].push(format);
      return acc;
    }, {});
    const minPriority = Math.min(...Object.keys(priorityGroups).map(Number));
    videoFormats = priorityGroups[minPriority] || videoFormats;
    const formatsWithAudio = videoFormats.filter((format) => format.acodec && format.acodec !== "none");
    if (formatsWithAudio.length > 0) {
      videoFormats = formatsWithAudio;
    }
    const maxFps = Math.max(...videoFormats.map((f) => f.fps || 0));
    videoFormats = videoFormats.filter((f) => (f.fps || 0) === maxFps);
    videoFormats = this.filterFormatsBySize(videoFormats);
    const bestFormat = videoFormats[0];
    return {
      url: bestFormat.url,
      headers: bestFormat.http_headers,
      acode: bestFormat.acodec,
      language: bestFormat.language,
      type: "video"
    };
  }
  // 选择音频
  selectAudioBySetting(data, setting) {
    let audioFormats = data.formats.filter(
      (format) => (format.acodec && format.acodec !== "none" || format.resolution === "audio only") && (format.vcodec === "none" || format.video_ext === "none")
    );
    if (audioFormats.length === 0) {
      audioFormats = data.formats.filter((format) => format.acodec && format.acodec !== "none" || format.video_ext);
      if (audioFormats.length === 0) {
        return [];
      }
    }
    const languageGroups = audioFormats.reduce((acc, format) => {
      const lang = format.language || "default";
      acc[lang] = acc[lang] || [];
      acc[lang].push(format);
      return acc;
    }, {});
    const availableLanguages = Object.keys(languageGroups);
    let targetLanguages = [];
    if (setting.audioTracks.length > 0) {
      if (setting.audioTracks.includes("all")) {
        targetLanguages = availableLanguages;
      } else {
        targetLanguages = availableLanguages.filter(
          (availableLang) => setting.audioTracks.some(
            (selectedLang) => selectedLang !== "default" && availableLang.toLowerCase().startsWith(selectedLang.toLowerCase())
          )
        );
      }
    }
    let isSelectDefault = false;
    if (targetLanguages.length === 0 && audioFormats.length > 0) {
      targetLanguages = availableLanguages;
      isSelectDefault = true;
    }
    const items = targetLanguages.map((language) => {
      const formats = languageGroups[language];
      const bestFormat = this.filterAudioFormats(formats, setting);
      return {
        url: bestFormat.url,
        headers: bestFormat.http_headers,
        acode: bestFormat.acodec,
        language: language === "default" ? null : language,
        type: "audio"
      };
    });
    if (isSelectDefault && items.length > 0) {
      return [items[items.length - 1]];
    }
    return items;
  }
  // 选择字幕
  selectSubtitleBySetting(data, setting) {
    const downloadItems = [];
    console.log("选择的字幕", setting.subtitles);
    if (setting.downloadType !== "video" || !setting.subtitles.length || setting.subtitles.includes("none")) {
      return downloadItems;
    }
    const selectedSubtitleLanguages = setting.subtitles;
    const manualSubtitles = data?.subtitles || {};
    const autoSubtitles = data?.automatic_captions || {};
    const allSubtitles = {};
    Object.entries(manualSubtitles).forEach(([lang, formats]) => {
      allSubtitles[lang] = formats;
    });
    Object.entries(autoSubtitles).forEach(([lang, formats]) => {
      if (!allSubtitles[lang]) {
        allSubtitles[lang] = formats;
      }
    });
    if (Object.keys(allSubtitles).length === 0) {
      console.log("No subtitles available");
      return downloadItems;
    }
    for (const [subtitleLang, subtitleFormats] of Object.entries(allSubtitles)) {
      const matchedLanguage = selectedSubtitleLanguages.find((selectedLang) => {
        const selectedLangLower = selectedLang.toLowerCase();
        const subtitleLangLower = subtitleLang.toLowerCase();
        if (selectedLangLower === subtitleLangLower) {
          return true;
        }
        const [mainSubLang] = subtitleLangLower.split("-");
        const [mainSelectedLang] = selectedLangLower.split("-");
        return mainSubLang === mainSelectedLang;
      });
      if (matchedLanguage) {
        const preferredFormats = [
          "srt",
          "ass",
          "vtt",
          "json3",
          "ttml",
          "srv1",
          "srv2",
          "srv3"
        ];
        let selectedFormat = null;
        for (const format of preferredFormats) {
          selectedFormat = subtitleFormats.find(
            (f) => f.ext === format
          );
          if (selectedFormat)
            break;
        }
        if (!selectedFormat && subtitleFormats.length > 0) {
          selectedFormat = subtitleFormats[subtitleFormats.length - 1];
        }
        if (selectedFormat) {
          const headers = getHttpHeaders(data);
          if (!isUrlDuplicate(downloadItems, selectedFormat.url)) {
            downloadItems.push({
              url: selectedFormat.url,
              headers,
              language: subtitleLang,
              type: "subtitle",
              ext: selectedFormat.ext,
              optionalDownload: true
              // 字幕下载失败不影响整个任务
            });
            console.log(
              `Added subtitle: ${subtitleLang} (${selectedFormat.ext})`
            );
          } else {
            console.log(
              `Skipped duplicate subtitle: ${subtitleLang} (${selectedFormat.ext})`
            );
          }
        }
      }
    }
    return downloadItems;
  }
}
const taskService = new TaskService();
const windows = {
  mainWindow: null,
  authWindow: null
};
function createMainWindow() {
  const ses = electron.session.defaultSession;
  ses.clearStorageData({
    storages: ["serviceworkers", "localstorage", "websql"]
  });
  const window2 = new electron.BrowserWindow({
    width: 1e3,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    autoHideMenuBar: true,
    frame: true,
    webPreferences: {
      preload: path.join(__dirname, "../preload/preload.js"),
      devTools: isDev,
      // 修改为始终允许devTools
      sandbox: false,
      webSecurity: !isDev,
      webviewTag: true,
      nodeIntegration: true,
      contextIsolation: false
    }
  });
  if (isDev) {
    window2.loadURL("http://localhost:5173");
  } else {
    const rendererPath = path.join(__dirname, "../renderer/index.html");
    window2.loadFile(rendererPath);
  }
  window2.on("close", async (event) => {
    event.preventDefault();
    const handlers = main.getRendererHandlers(window2.webContents);
    const existUnfinishedTask = await taskService.getInterruptTasks();
    let exist = false;
    for (const task2 of existUnfinishedTask) {
      if (!task2.errorMessage) {
        exist = true;
        break;
      }
    }
    handlers.onAppClose.send(exist);
  });
  window2.on("closed", () => {
    windows.mainWindow = null;
    electron.app.quit();
  });
  process.on("uncaughtException", async (error) => {
    if (isDev) {
      logError("未捕获异常", {
        error: error.message,
        stack: error.stack,
        name: error.name
      });
    }
  });
  process.on("unhandledRejection", async (reason) => {
    if (isDev) {
      logError("未处理异常", {
        reason: reason instanceof Error ? reason.message : String(reason),
        stack: reason instanceof Error ? reason.stack : void 0
      });
    }
  });
  windows.mainWindow = window2;
  return window2;
}
const getMainWindow = () => windows.mainWindow;
function getMainWindowOrCreate() {
  if (!windows.mainWindow) {
    windows.mainWindow = createMainWindow();
  }
  return windows.mainWindow;
}
function destroyMainWindow() {
  windows.mainWindow?.destroy();
  windows.mainWindow = null;
}
function createAuthWindow(url) {
  if (windows.authWindow) {
    windows.authWindow.close();
    windows.authWindow = null;
  }
  const window2 = new electron.BrowserWindow({
    width: 800,
    height: 600,
    minWidth: 800,
    minHeight: 600,
    autoHideMenuBar: true,
    modal: true,
    parent: getMainWindowOrCreate(),
    webPreferences: {
      preload: path.join(__dirname, "../preload/preload.js"),
      // 使用主应用的预加载脚本
      devTools: isDev,
      webSecurity: !isDev,
      webviewTag: true,
      nodeIntegration: true,
      contextIsolation: false
    }
  });
  const encodedUrl = encodeURIComponent(url);
  if (isDev) {
    window2.loadURL(`http://localhost:5173/#/auth?url=${encodedUrl}`);
  } else {
    const rendererPath = path.join(__dirname, "../renderer/index.html");
    window2.loadFile(rendererPath, { hash: `auth?url=${encodedUrl}` });
  }
  window2.on("closed", () => {
    windows.authWindow = null;
  });
  windows.authWindow = window2;
  return window2;
}
const getAuthWindow = () => windows.authWindow;
function getAuthSession() {
  return electron.session.defaultSession;
}
async function initAptabase() {
  // [PATCH] Aptabase telemetry disabled
}
async function initFFmpeg() {
  try {
    const ffmpegPath = getBinPath("ffmpeg");
    const ffprobePath = getBinPath("ffprobe");
    const [ffmpegExists, ffprobeExists] = await Promise.all([
      checkFileExists(ffmpegPath),
      checkFileExists(ffprobePath)
    ]);
    if (!ffmpegExists || !ffprobeExists) {
      throw new Error("FFmpeg 或 FFprobe 文件不存在");
    }
    if (isMac) {
      try {
        setFilePermissions(ffmpegPath);
        setFilePermissions(ffprobePath);
        console.log("已设置 FFmpeg 工具执行权限");
      } catch (error) {
        console.error("设置 FFmpeg 工具执行权限失败:", error);
      }
    }
    ffmpeg.setFfmpegPath(ffmpegPath);
    ffmpeg.setFfprobePath(ffprobePath);
    return { ffmpegPath, ffprobePath };
  } catch (error) {
    console.error("初始化 FFmpeg 工具失败:", error);
    throw error;
  }
}
async function initSentry() {
  // [PATCH] Sentry telemetry disabled
}
async function initSnapfile() {
  try {
    const snapfilePath = getBinPath("snapfile");
    await setFilePermissions(snapfilePath);
    const exists = await checkFileExists(snapfilePath);
    if (!exists) {
      throw new Error("snapfile 可执行文件不存在，请重新安装应用");
    }
    snapfileService.on("error", (error) => {
      logError("Snapfile服务错误", {
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : void 0
      });
    });
    await snapfileService.start();
    logInfo("Snapfile服务启动成功", {
      executablePath: snapfilePath
    });
  } catch (error) {
    logError("Snapfile服务启动失败", {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : void 0,
      executablePath: getBinPath("snapfile")
    });
    throw error;
  }
}
async function initYtDlp() {
  try {
    const ytDlpPath = getBinPath("yt-dlp");
    await setFilePermissions(ytDlpPath);
    const exists = await checkFileExists(ytDlpPath);
    if (!exists) {
      throw new Error("yt-dlp 可执行文件不存在，请重新安装应用");
    }
    return ytDlpPath;
  } catch (error) {
    console.error("yt-dlp 初始化失败:", error);
    throw error;
  }
}
const t = main.tipc.create();
let lastAuthUrl = "";
const authRoute = {
  // 打开授权窗口
  openAuthWindow: t.procedure.input().action(async ({ input }) => {
    console.log("openAuthWindow", input);
    lastAuthUrl = input.url;
    createAuthWindow(input.url).show();
  }),
  // 关闭授权窗口
  closeAuthWindow: t.procedure.action(async () => {
    console.log("closeAuthWindow");
    getAuthWindow()?.close();
  }),
  // 完成授权
  completeAuth: t.procedure.input().action(async ({ input }) => {
    console.log("completeAuth");
    const { url } = input;
    const urlObj = new URL(url);
    console.log(urlObj);
    const isLogin = await authService.verifyLogin(url);
    console.log(isLogin);
    if (!isLogin) {
      return {
        success: false
      };
    }
    await authService.saveCookieFile();
    settingStore.set("authSites", settingStore.get("authSites").map((site) => site.url === urlObj.origin ? { ...site, isAuthorized: true } : site));
    getAuthWindow()?.close();
    return {
      success: true
    };
  }),
  // 获取当前授权URL API
  getAuthUrl: t.procedure.action(async () => {
    console.log("getAuthUrl 被调用, 返回:", lastAuthUrl);
    return lastAuthUrl;
  })
};
class SettingService {
  // 获取设置
  getSetting() {
    return settingStore.store;
  }
  // 保存设置
  async saveSetting(setting) {
    await settingStore.set(setting);
    ProxyService$1.setupProxy();
  }
}
const SettingService$1 = new SettingService();
const settingRoute = {
  // 保存设置
  saveSetting: t.procedure.input().action(async ({ input }) => {
    await SettingService$1.saveSetting(input);
  }),
  // 获取设置
  getSetting: t.procedure.action(async () => {
    return SettingService$1.getSetting();
  })
};
class ResourceSnifferService {
  // 存储所有嗅探到的媒体资源
  mediaResources = /* @__PURE__ */ new Map();
  // 存储URL到资源ID的映射，用于去重
  urlToResourceId = /* @__PURE__ */ new Map();
  // 存储请求头信息，用于后续匹配响应
  requestHeadersMap = /* @__PURE__ */ new Map();
  // 是否已初始化
  initialized = false;
  // 文件扩展名过滤规则
  extFilters = [...defaultExtFilters];
  // MIME类型过滤规则
  typeFilters = [...defaultTypeFilters];
  // 正则表达式过滤规则
  regexFilters = [...defaultRegexFilters];
  /**
   * 初始化资源嗅探服务
   */
  init() {
    if (this.initialized) {
      return;
    }
    this.loadFilterRules();
    this.initialized = true;
    console.log("资源嗅探服务已初始化");
  }
  /**
   * 为特定的WebContents设置资源嗅探
   * @param webContentsId WebContents的ID
   */
  setupForWebContents(webContentsId) {
    const targetWebContents = electron.webContents.fromId(webContentsId);
    if (!targetWebContents) {
      console.error(`找不到ID为${webContentsId}的WebContents`);
      return;
    }
    this.setupSessionListeners(targetWebContents.session);
    this.setupWindowOpenIntercept(targetWebContents);
    console.log(`已为WebContents(ID: ${webContentsId})设置资源嗅探和window.open拦截`);
  }
  /**
   * 设置window.open拦截
   * @param targetWebContents 目标WebContents
   */
  setupWindowOpenIntercept(targetWebContents) {
    targetWebContents.setWindowOpenHandler((details) => {
      console.log(`拦截到window.open请求: ${details.url}`);
      try {
        this.notifyWindowOpenIntercept(
          details.url
        );
      } catch (error) {
        console.error("通知window.open拦截失败:", error);
      }
      return { action: "deny" };
    });
    console.log(`已为WebContents(ID: ${targetWebContents.id})设置window.open拦截`);
  }
  /**
   * 为会话设置请求监听器
   * @param session 要监听的会话
   */
  setupSessionListeners(session) {
    session.webRequest.onBeforeSendHeaders((details, callback) => {
      if (details.requestHeaders) {
        this.requestHeadersMap.set(details.id, {
          requestHeaders: details.requestHeaders,
          url: details.url,
          method: details.method,
          timestamp: Date.now(),
          resourceType: details.resourceType
        });
      }
      callback({ requestHeaders: details.requestHeaders });
    });
    session.webRequest.onHeadersReceived((details, callback) => {
      try {
        this.processResponse(details);
      } catch (error) {
        console.error("资源嗅探处理错误:", error);
      }
      callback({ responseHeaders: details.responseHeaders });
    });
    session.webRequest.onCompleted((details) => {
      this.requestHeadersMap.delete(details.id);
    });
    session.webRequest.onErrorOccurred((details) => {
      this.requestHeadersMap.delete(details.id);
    });
  }
  /**
   * 处理响应数据
   * @param details 响应详情
   */
  processResponse(details) {
    const requestInfo = this.requestHeadersMap.get(details.id);
    const url = details.url;
    if (this.isLocalRequest(url)) {
      return;
    }
    const regexResult = this.applyRegexFilters(url);
    if (regexResult.isBlocked) {
      return;
    }
    const normalizedHeaders = this.normalizeResponseHeaders(details.responseHeaders);
    const contentType = normalizedHeaders["content-type"];
    const contentLength = normalizedHeaders["content-length"];
    const contentDisposition = normalizedHeaders["content-disposition"];
    const urlObj = new URL(url);
    const pathname = urlObj.pathname;
    let fileName = pathname.split("/").pop() || "";
    let fileExt = fileName.split(".").pop()?.toLowerCase() || "";
    if (regexResult.matchedExt) {
      fileExt = regexResult.matchedExt;
    }
    let dispositionMatch = null;
    if (contentDisposition) {
      dispositionMatch = contentDisposition.match(/filename=["']?([^"']+)["']?/);
      if (dispositionMatch && dispositionMatch[1]) {
        fileName = dispositionMatch[1];
        const extFromDisposition = fileName.split(".").pop()?.toLowerCase();
        if (extFromDisposition) {
          fileExt = extFromDisposition;
        }
      }
    }
    const extResult = this.checkFileExtension(fileExt, Number.parseInt(contentLength) || 0);
    const mimeResult = this.checkMimeType(contentType, Number.parseInt(contentLength) || 0);
    if (contentType.startsWith("video/") || contentType.startsWith("audio/")) {
      fileExt = contentType.split("/")[1];
    }
    const isMediaRequest = details.resourceType === "media";
    const isSpecialFormatRequest = fileExt === "ts";
    if ((extResult || mimeResult || isMediaRequest) && !isSpecialFormatRequest) {
      const mediaInfo = {
        url: details.url,
        contentType,
        contentLength: Number.parseInt(contentLength) || null,
        fileName,
        fileExt,
        timestamp: Date.now(),
        requestHeaders: this.formatRequestHeaders(requestInfo?.requestHeaders || {}),
        responseHeaders: details.responseHeaders,
        method: details.method,
        resourceType: details.resourceType,
        referrer: requestInfo?.url || "",
        tabId: details.webContentsId,
        id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
      };
      this.mediaResources.set(mediaInfo.id, mediaInfo);
      const existingResourceId = this.urlToResourceId.get(mediaInfo.url);
      if (existingResourceId && existingResourceId !== mediaInfo.id) {
        this.mediaResources.delete(existingResourceId);
        console.log("移除重复URL的旧资源:", existingResourceId);
      }
      this.urlToResourceId.set(mediaInfo.url, mediaInfo.id);
      this.notifyRenderer(mediaInfo);
    }
    this.cleanupRequestHeaders();
  }
  /**
   * 判断是否为本地请求
   */
  isLocalRequest(url) {
    try {
      const parsedUrl = new URL(url);
      if (parsedUrl.hostname === "localhost" || parsedUrl.hostname === "127.0.0.1" || parsedUrl.hostname.startsWith("192.168.") || parsedUrl.hostname.startsWith("10.") || parsedUrl.hostname === "[::1]") {
        return true;
      }
      if (parsedUrl.protocol === "file:") {
        return true;
      }
      const fileExtensions = [".js", ".css", ".html", ".ts", ".tsx", ".jsx", ".vue", ".map", ".json", ".wasm"];
      const pathname = parsedUrl.pathname.toLowerCase();
      if (fileExtensions.some((ext) => pathname.endsWith(ext))) {
        const frontendDirIndicators = ["/src/", "/assets/", "/dist/", "/public/", "/static/", "/js/", "/css/"];
        if (frontendDirIndicators.some((dir) => pathname.includes(dir))) {
          return true;
        }
      }
      return false;
    } catch (error) {
      console.error("解析URL失败:", error);
      return false;
    }
  }
  /**
   * 应用正则表达式过滤规则
   * @returns 包含是否屏蔽和匹配的扩展名
   */
  applyRegexFilters(url) {
    for (const filter of this.regexFilters) {
      if (!filter.enabled)
        continue;
      const regex = new RegExp(filter.pattern, filter.flags);
      if (regex.test(url)) {
        if (filter.isBlocking) {
          return { isBlocked: true, matchedExt: "" };
        }
        return { isBlocked: false, matchedExt: filter.specifiedExt };
      }
    }
    return { isBlocked: false, matchedExt: "" };
  }
  /**
   * 检查文件扩展名是否符合过滤规则
   */
  checkFileExtension(fileExt, contentLength) {
    for (const filter of this.extFilters) {
      if (!filter.enabled)
        continue;
      if (filter.ext.toLowerCase() === fileExt.toLowerCase()) {
        if (filter.minSize === 0) {
          return contentLength > 0;
        } else {
          return contentLength >= filter.minSize * 1024;
        }
      }
    }
    return false;
  }
  /**
   * 检查MIME类型是否符合过滤规则
   */
  checkMimeType(contentType, contentLength) {
    if (!contentType)
      return false;
    const lowerContentType = contentType.toLowerCase();
    for (const filter of this.typeFilters) {
      if (!filter.enabled)
        continue;
      if (filter.mime.endsWith("/*")) {
        const prefix = filter.mime.slice(0, -2);
        if (lowerContentType.startsWith(`${prefix}/`)) {
          return filter.minSize === 0 || contentLength >= filter.minSize * 1024;
        }
      } else if (lowerContentType === filter.mime.toLowerCase()) {
        return filter.minSize === 0 || contentLength >= filter.minSize * 1024;
      }
    }
    return false;
  }
  /**
   * 格式化请求头
   */
  formatRequestHeaders(headers) {
    const result = {};
    for (const key in headers) {
      if (typeof headers[key] === "string") {
        result[key.toLowerCase()] = headers[key];
      }
    }
    return result;
  }
  /**
   * 清理过期的请求头信息
   */
  cleanupRequestHeaders() {
    const now = Date.now();
    this.requestHeadersMap.forEach((value, key) => {
      if (now - value.timestamp > 5 * 60 * 1e3) {
        this.requestHeadersMap.delete(key);
      }
    });
  }
  /**
   * 从设置中加载过滤规则
   */
  loadFilterRules() {
    try {
      const savedFilters = snifferStore.get("resourceSnifferFilters");
      if (savedFilters) {
        if (savedFilters.extFilters && Array.isArray(savedFilters.extFilters))
          this.extFilters = savedFilters.extFilters;
        if (savedFilters.typeFilters && Array.isArray(savedFilters.typeFilters))
          this.typeFilters = savedFilters.typeFilters;
        if (savedFilters.regexFilters && Array.isArray(savedFilters.regexFilters))
          this.regexFilters = savedFilters.regexFilters;
      }
      console.log("成功从设置中加载过滤规则");
    } catch (error) {
      console.error("加载资源嗅探过滤规则失败:", error);
      this.extFilters = [...defaultExtFilters];
      this.typeFilters = [...defaultTypeFilters];
      this.regexFilters = [...defaultRegexFilters];
    }
  }
  /**
   * 保存过滤规则到设置
   */
  saveFilterRules() {
    try {
      snifferStore.set("resourceSnifferFilters", {
        extFilters: this.extFilters,
        typeFilters: this.typeFilters,
        regexFilters: this.regexFilters
      });
      console.log("过滤规则已保存到设置");
    } catch (error) {
      console.error("保存资源嗅探过滤规则失败:", error);
    }
  }
  /**
   * 通知渲染进程有新的媒体资源
   */
  notifyRenderer(mediaInfo) {
    try {
      const handlers = main.getRendererHandlers(getMainWindow().webContents);
      handlers.onResourceSniffed.send(mediaInfo);
    } catch (error) {
      console.error("通知渲染进程失败:", error);
    }
  }
  /**
   * 通知渲染进程有新的window.open请求
   * @param data window.open拦截数据
   */
  notifyWindowOpenIntercept(url) {
    try {
      const handlers = main.getRendererHandlers(getMainWindow().webContents);
      handlers.onWindowOpenIntercept.send(url);
      console.log("已通知渲染进程window.open拦截:", url);
    } catch (error) {
      console.error("通知渲染进程window.open拦截失败:", error);
    }
  }
  /**
   * 获取所有嗅探到的媒体资源
   */
  getAllMediaResources() {
    return Array.from(this.mediaResources.values());
  }
  /**
   * 清除所有嗅探到的媒体资源
   */
  clearAllMediaResources() {
    this.mediaResources.clear();
    this.urlToResourceId.clear();
  }
  /**
   * 更新文件扩展名过滤规则
   */
  updateExtFilters(filters) {
    this.extFilters = filters;
    this.saveFilterRules();
  }
  /**
   * 更新MIME类型过滤规则
   */
  updateTypeFilters(filters) {
    this.typeFilters = filters;
    this.saveFilterRules();
  }
  /**
   * 更新正则表达式过滤规则
   */
  updateRegexFilters(filters) {
    this.regexFilters = filters;
    this.saveFilterRules();
  }
  /**
   * 获取文件扩展名过滤规则
   */
  getExtFilters() {
    return this.extFilters;
  }
  /**
   * 获取MIME类型过滤规则
   */
  getTypeFilters() {
    return this.typeFilters;
  }
  /**
   * 获取正则表达式过滤规则
   */
  getRegexFilters() {
    return this.regexFilters;
  }
  /**
   * 下载嗅探到的资源
   * @param snifferMediaDownload 需要下载的媒体资源信息
   * @returns 创建的任务ID数组
   */
  async downloadSniffedResource(snifferMediaDownload) {
    try {
      const setting = settingStore.store;
      const { url, title, fileExt, httpHeaders } = snifferMediaDownload;
      const headers = { ...httpHeaders };
      delete headers.range;
      const taskId = uuid.v4();
      const downloadItem = {
        url,
        headers,
        ext: fileExt
      };
      const task2 = {
        id: taskId,
        text: title,
        url,
        filePath: null,
        fileSize: null,
        taskStatus: taskStatus.readyDownload,
        thumbnail: null,
        extension: fileExt,
        resolutionWidth: null,
        resolutionHeight: null,
        bitrate: null,
        duration: null,
        errorStatus: null,
        errorMessage: null,
        errorAction: null,
        tempTask: JSON.stringify({
          text: title || url,
          thumbnail: null,
          items: [downloadItem],
          setting
        }),
        requestHeaders: JSON.stringify(headers),
        createdAt: Date.now(),
        updatedAt: Date.now()
      };
      await taskService.saveSnifferTask(task2);
      taskService.downloadWithSnapfile(taskId, [downloadItem], setting);
      return taskId;
    } catch (error) {
      console.error("下载嗅探资源失败:", error);
      throw error;
    }
  }
  /**
   * 将响应头的键名统一转换为小写
   */
  normalizeResponseHeaders(headers) {
    const normalized = {};
    for (const key in headers) {
      const lowerKey = key.toLowerCase();
      normalized[lowerKey] = headers[key]?.[0] || "";
    }
    return normalized;
  }
}
const resourceSnifferService = new ResourceSnifferService();
const snifferRoute = {
  // 为特定WebContents设置资源嗅探
  setupResourceSniffer: t.procedure.input().action(async ({ input }) => {
    try {
      resourceSnifferService.init();
      if (input.id) {
        resourceSnifferService.setupForWebContents(input.id);
      }
      return { success: true, message: "资源嗅探已启动" };
    } catch (error) {
      console.error("设置资源嗅探失败:", error);
      return { success: false, message: "资源嗅探启动失败" };
    }
  }),
  // 获取所有嗅探到的媒体资源
  getSniffedResources: t.procedure.action(async () => {
    try {
      const resources = resourceSnifferService.getAllMediaResources();
      return { success: true, resources };
    } catch (error) {
      console.error("获取嗅探资源失败:", error);
      return { success: false, resources: [] };
    }
  }),
  // 清除所有嗅探到的媒体资源
  clearSniffedResources: t.procedure.action(async () => {
    try {
      resourceSnifferService.clearAllMediaResources();
      return { success: true };
    } catch (error) {
      console.error("清除嗅探资源失败:", error);
      return { success: false };
    }
  }),
  // 下载嗅探资源
  downloadSniffedResources: t.procedure.input().action(async ({ input }) => {
    try {
      const { snifferMediaDownloadInfo } = input;
      const result = await resourceSnifferService.downloadSniffedResource(snifferMediaDownloadInfo);
      return { success: true, taskId: result };
    } catch (error) {
      console.error("下载嗅探资源失败:", error);
      return { success: false };
    }
  }),
  // 获取所有url书签
  getUrlBookmarks: t.procedure.action(async () => {
    return urlBookmarkStore.get("bookmarks");
  }),
  // 添加url书签
  addUrlBookmark: t.procedure.input().action(async ({ input }) => {
    const { url, title } = input;
    const rawMainDomain = getTopLevelMainDomain(url);
    const mainDomain = rawMainDomain.charAt(0).toUpperCase() + rawMainDomain.slice(1);
    if (!title) {
      urlBookmarkStore.set("bookmarks", [{ url, title: mainDomain, mainDomain }, ...urlBookmarkStore.get("bookmarks")]);
    } else {
      urlBookmarkStore.set("bookmarks", [{ url, title, mainDomain }, ...urlBookmarkStore.get("bookmarks")]);
    }
  }),
  // 删除url书签
  deleteUrlBookmark: t.procedure.input().action(async ({ input }) => {
    const { url } = input;
    urlBookmarkStore.set("bookmarks", urlBookmarkStore.get("bookmarks").filter((bookmark) => bookmark.url !== url));
  })
};
class SystemService {
  constructor() {
  }
  /**
   * 获取下载链接
   * @param updateInfo 更新信息
   * @returns 适合当前系统的下载链接
   */
  getDownloadUrl(updateInfo) {
    if (process.platform === "darwin") {
      const isArm64 = process.arch === "arm64";
      return isArm64 ? updateInfo.downloadUrls.macAppleSilicon : updateInfo.downloadUrls.macIntel;
    } else if (process.platform === "win32") {
      return updateInfo.downloadUrls.windows;
    }
    throw new Error("不支持的操作系统");
  }
  /**
   * 获取软件最新版本
   * @returns 软件最新版本
   */
  async getSoftwareLatestVersion() {
    try {
      const updateInfo = await getSoftwareInfo();
      const currentVersion = electron.app.getVersion();
      const upgradeContent = updateInfo.upgradeContent;
      let updateType = "optional";
      let hasUpdate = false;
      if (compareSoftwareVersions(currentVersion, updateInfo.forcedUpgradeVersion) <= 0) {
        updateType = "force";
        hasUpdate = true;
      } else if (compareSoftwareVersions(currentVersion, updateInfo.normalUpgradeVersion) <= 0) {
        updateType = "optional";
        hasUpdate = true;
      }
      return {
        hasUpdate,
        currentVersion,
        latestVersion: updateInfo.latestVersion,
        normalUpgradeVersion: updateInfo.normalUpgradeVersion,
        updateType,
        upgradeContent,
        downloadUrl: this.getDownloadUrl(updateInfo)
      };
    } catch (error) {
      console.error("检查更新失败:", error);
      return {
        hasUpdate: false,
        error: error instanceof Error ? error.message : "检查更新失败"
      };
    }
  }
  async downloadSoftware(downloadUrl) {
    const tempDir = path.join(electron.app.getPath("temp"), "updates");
    try {
      await fs$2.access(tempDir);
    } catch {
      const data = await ensureDirectoryExists(tempDir);
      if (!data.success) {
        logError("下载软件二进制依赖包创建临时目录失败", { error: data.error });
        return;
      }
    }
    const fileName = path.basename(downloadUrl);
    const finalFilePath = path.join(tempDir, fileName);
    const fileDownloader = new FileDownloader();
    fileDownloader.setTempDir(tempDir);
    fileDownloader.setDeleteTempFile(true);
    const handlers = main.getRendererHandlers(getMainWindow().webContents);
    fileDownloader.download(downloadUrl, {}, null, {
      onProgress: async (progress) => {
        console.log("软件更新下载进度:", progress);
        handlers.onSoftwareUpdateProgress.send({
          success: true,
          totalSize: progress.totalBytes,
          downloadedSize: progress.downloadedBytes
        });
      },
      onComplete: async (filePath) => {
        try {
          console.log("软件更新下载完成临时路径:", filePath);
          console.log("软件更新下载完成最终路径:", finalFilePath);
          await fs$2.rename(filePath, finalFilePath);
          await fs$2.chmod(finalFilePath, 493);
          handlers.onSoftwareUpdateProgress.send({
            success: true,
            filePath: finalFilePath
          });
        } catch (error) {
          console.error("软件更新下载失败:", error);
          handlers.onSoftwareUpdateProgress.send({
            success: false
          });
        }
      },
      onError: async (error) => {
        console.error("软件更新下载失败:", error);
        handlers.onSoftwareUpdateProgress.send({
          success: false
        });
      }
    });
  }
  async checkSoftwarePackageExists(version) {
    try {
      const tempDir = path.join(electron.app.getPath("temp"), "updates");
      const suffix = isMac ? process.arch === "arm64" ? "arm64.dmg" : "x64.dmg" : "x64.exe";
      const installerName = `SnapAny_${version}_${suffix}`;
      const installerPath = path.join(tempDir, installerName);
      const exists = await checkFileExists(installerPath);
      return {
        exists,
        filePath: exists ? installerPath : ""
      };
    } catch (error) {
      console.warn("检查本地安装包失败:", error);
      return {
        exists: false,
        filePath: ""
      };
    }
  }
  async installSoftware(filePath) {
    try {
      if (filePath) {
        if (process.platform === "darwin") {
          await electron.shell.openPath(filePath);
          setTimeout(() => electron.app.quit(), 1e3);
        } else if (process.platform === "win32") {
          const child = node_child_process.spawn(filePath, [], {
            detached: true,
            stdio: ["ignore", "ignore", "ignore"]
          });
          child.unref();
          setTimeout(() => electron.app.quit(), 1e3);
        }
      } else {
        electron.app.quit();
      }
    } catch (error) {
      console.error("安装更新失败:", error);
      setTimeout(() => electron.app.quit(), 2e3);
    }
  }
}
const systemService = new SystemService();
async function testSocks5ProxyConnection(proxyConfig) {
  return new Promise((resolve, reject) => {
    try {
      const connectOptions = {
        port: proxyConfig.port,
        host: proxyConfig.url
      };
      const proxyTest = net.connect(connectOptions);
      proxyTest.on("error", (err) => {
        console.log("SOCKS5代理: 连接错误", err.message);
        proxyTest.destroy();
        reject(err);
      });
      proxyTest.on("connect", () => {
        console.log("SOCKS5代理: 已建立TCP连接");
        let handshakePacket;
        if (proxyConfig.username && proxyConfig.password) {
          handshakePacket = node_buffer.Buffer.from([
            5,
            // SOCKS版本
            2,
            // 认证方法数量
            0,
            // 无认证方法 (作为备选)
            2
            // 用户名/密码认证方法
          ]);
          console.log("SOCKS5代理: 发送握手包 (支持用户名/密码认证)");
        } else {
          handshakePacket = node_buffer.Buffer.from([
            5,
            // SOCKS版本
            1,
            // 认证方法数量
            0
            // 无认证方法
          ]);
          console.log("SOCKS5代理: 发送握手包 (无认证)");
        }
        proxyTest.write(handshakePacket);
        let dataBuffer = node_buffer.Buffer.alloc(0);
        let authSent = false;
        proxyTest.on("data", (chunk) => {
          console.log("SOCKS5代理: 收到数据", chunk.length, "字节, authSent:", authSent);
          dataBuffer = node_buffer.Buffer.concat([dataBuffer, chunk]);
          console.log("SOCKS5代理: 当前缓冲区", dataBuffer.length, "字节，内容:", [...dataBuffer]);
          if (!authSent && dataBuffer.length >= 2) {
            const version = dataBuffer[0];
            const authMethod = dataBuffer[1];
            console.log("SOCKS5代理: 握手响应 - 版本:", version, "认证方法:", authMethod);
            if (version !== 5) {
              console.log("SOCKS5代理: 不是有效的SOCKS5代理");
              proxyTest.destroy();
              reject(new Error("不是有效的SOCKS5代理"));
              return;
            }
            if (authMethod === 2 && proxyConfig.username && proxyConfig.password) {
              console.log("SOCKS5代理: 服务器要求用户名/密码认证");
              const usernameBuffer = node_buffer.Buffer.from(proxyConfig.username);
              const passwordBuffer = node_buffer.Buffer.from(proxyConfig.password);
              const authPacket = node_buffer.Buffer.alloc(3 + usernameBuffer.length + passwordBuffer.length);
              authPacket[0] = 1;
              authPacket[1] = usernameBuffer.length;
              usernameBuffer.copy(authPacket, 2);
              authPacket[2 + usernameBuffer.length] = passwordBuffer.length;
              passwordBuffer.copy(authPacket, 3 + usernameBuffer.length);
              console.log("SOCKS5代理: 发送认证包", [...authPacket]);
              proxyTest.write(authPacket);
              dataBuffer = node_buffer.Buffer.alloc(0);
              authSent = true;
            } else if (authMethod === 0) {
              console.log("SOCKS5代理: 无需认证，连接成功");
              proxyTest.destroy();
              resolve(true);
            } else {
              console.log("SOCKS5代理: 服务器不支持提供的认证方法");
              proxyTest.destroy();
              reject(new Error("代理认证失败: 不支持的认证方法"));
            }
          } else if (authSent && dataBuffer.length >= 2) {
            const authVersion = dataBuffer[0];
            const authStatus = dataBuffer[1];
            console.log("SOCKS5代理: 认证响应 - 版本:", authVersion, "状态:", authStatus);
            if (authStatus === 0) {
              console.log("SOCKS5代理: 认证成功");
              proxyTest.destroy();
              resolve(true);
            } else {
              console.log("SOCKS5代理: 认证失败");
              proxyTest.destroy();
              reject(new Error("代理认证失败: 用户名或密码错误"));
            }
          }
        });
      });
      proxyTest.setTimeout(1e4, () => {
        console.log("SOCKS5代理: 连接超时");
        proxyTest.destroy();
        reject(new Error("连接超时"));
      });
    } catch (error) {
      reject(error);
    }
  });
}
async function testHttpProxyConnection(proxyConfig) {
  return new Promise((resolve, reject) => {
    try {
      const connectOptions = {
        port: proxyConfig.port,
        host: proxyConfig.url
      };
      console.log("HTTP代理: 尝试连接");
      if (proxyConfig.username && proxyConfig.password) {
        const proxyTest = net.connect(connectOptions, () => {
          console.log("HTTP代理: 已建立TCP连接 (需要认证)");
          const auth = node_buffer.Buffer.from(`${proxyConfig.username}:${proxyConfig.password}`).toString("base64");
          const connectRequest = `CONNECT ${proxyConfig.url}:${proxyConfig.port} HTTP/1.1\r
Host: ${proxyConfig.url}:${proxyConfig.port}\r
Proxy-Authorization: Basic ${auth}\r
\r
`;
          console.log("HTTP代理: 发送带认证的CONNECT请求");
          proxyTest.write(connectRequest);
          let response = "";
          proxyTest.on("data", (chunk) => {
            response += chunk.toString();
            console.log("HTTP代理: 收到响应:", response);
            if (response.includes("200 Connection established") || response.includes("HTTP/1.1 200")) {
              console.log("HTTP代理: 连接成功");
              proxyTest.destroy();
              resolve(true);
            } else if (response.includes("407 Proxy Authentication Required") || response.includes("401 Unauthorized")) {
              console.log("HTTP代理: 认证失败");
              proxyTest.destroy();
              reject(new Error("代理认证失败"));
            }
          });
        });
        proxyTest.on("error", (err) => {
          console.log("HTTP代理: 连接错误", err.message);
          proxyTest.destroy();
          reject(err);
        });
        proxyTest.setTimeout(1e4, () => {
          console.log("HTTP代理: 连接超时");
          proxyTest.destroy();
          reject(new Error("连接超时"));
        });
      } else {
        console.log("HTTP代理: 尝试无认证连接");
        const proxyTest = net.connect(connectOptions, () => {
          console.log("HTTP代理: 连接成功 (无需认证)");
          proxyTest.destroy();
          resolve(true);
        });
        proxyTest.on("error", (err) => {
          console.log("HTTP代理: 连接错误", err.message);
          proxyTest.destroy();
          reject(err);
        });
        proxyTest.setTimeout(1e4, () => {
          console.log("HTTP代理: 连接超时");
          proxyTest.destroy();
          reject(new Error("连接超时"));
        });
      }
    } catch (e) {
      reject(e);
    }
  });
}
const systemRoute = {
  // 获取关于信息
  getAboutInfo: t.procedure.action(async () => {
    return {
      componentVersion: {
        version: "2025.03.26",
        latestVersion: "2025.04.14"
      },
      softwareVersion: {
        version: electron.app.getVersion(),
        latestVersion: "0.4.0"
      },
      website: "https://snapany.com"
    };
  }),
  // 打开文件
  openFile: t.procedure.input().action(async ({ input }) => {
    if (await checkFileExists(input.filePath)) {
      try {
        electron.shell.openPath(input.filePath);
        return { success: true };
      } catch {
        return { success: false };
      }
    } else {
      console.log("文件不存在", { filePath: input.filePath });
      return { success: false };
    }
  }),
  // 打开文件所在位置
  openFileDir: t.procedure.input().action(async ({ input }) => {
    if (await checkFileExists(input.filePath)) {
      electron.shell.showItemInFolder(input.filePath);
      return { success: true };
    } else {
      return { success: false, error: "fileNotFound" };
    }
  }),
  // 选择文件存储的目录
  selectFileDir: t.procedure.action(async () => {
    const mainWindow2 = getMainWindow();
    const result = await electron.dialog.showOpenDialog(mainWindow2, {
      properties: ["openDirectory"]
    });
    if (!result.canceled && result.filePaths.length > 0) {
      return { success: true, path: result.filePaths[0] };
    }
    return { success: false, error: "canceled" };
  }),
  // 获取系统语言
  getSystemLanguage: t.procedure.action(async () => {
    const langs = electron.app.getPreferredSystemLanguages();
    let locale;
    for (const lang of langs) {
      locale = lang.split("-")[0];
      if (locale.startsWith("zh")) {
        locale = lang.includes("Hant") ? "zh-Hant" : "zh-Hans";
      }
      const mappedLocale = SYSTEM_TO_APP_LANGUAGE_MAP[locale];
      if (mappedLocale) {
        return mappedLocale;
      }
    }
    return "en";
  }),
  // 打开外部链接
  openExternalLink: t.procedure.input().action(async ({ input }) => {
    electron.shell.openExternal(input.url);
  }),
  // 获取授权站点列表
  getAuthSites: t.procedure.action(async () => {
    return settingStore.get("authSites");
  }),
  // 添加授权站点
  addAuthSite: t.procedure.input().action(async ({ input }) => {
    const { authUrl } = input;
    let newAuthUrl = authUrl;
    if (newAuthUrl.includes("youtu.be") || newAuthUrl.includes("youtube.com")) {
      newAuthUrl = "https://www.youtube.com";
    } else if (newAuthUrl.includes("twitter.com") || newAuthUrl.includes(".x.com")) {
      newAuthUrl = "https://x.com";
    } else if (newAuthUrl.includes("instagram.com")) {
      newAuthUrl = "https://www.instagram.com";
    }
    if (!newAuthUrl.startsWith("http")) {
      newAuthUrl = `https://${newAuthUrl}`;
    }
    const url = new URL(newAuthUrl);
    const originUrl = url.origin;
    const mainDomain = getTopLevelMainDomain(originUrl);
    const savedTitle = mainDomain.charAt(0).toUpperCase() + mainDomain.slice(1);
    const authSites = settingStore.get("authSites");
    const exist = authSites.find((site) => site.url === originUrl);
    if (exist) {
      return { success: false, authUrl: exist.authUrl };
    }
    const authSite = {
      name: savedTitle,
      url: originUrl,
      authUrl: originUrl,
      isAuthorized: false,
      enableDelete: true
    };
    settingStore.set("authSites", [...settingStore.get("authSites"), authSite]);
    return { success: true, authUrl: authSite.authUrl };
  }),
  // 登出授权站点
  logoutAuthSite: t.procedure.input().action(async ({ input }) => {
    const { url } = input;
    const urlObj = new URL(url);
    const domain = urlObj.origin.replace("www.", "");
    settingStore.set("authSites", settingStore.get("authSites").map((site) => site.url === urlObj.origin ? { ...site, isAuthorized: false } : site));
    await authService.deleteCookieFile(domain);
  }),
  // 删除授权站点
  deleteAuthSite: t.procedure.input().action(async ({ input }) => {
    const { name } = input;
    const authSites = settingStore.get("authSites");
    const authSite = authSites.find((site) => site.name === name);
    if (authSite) {
      if (authSite.enableDelete) {
        settingStore.set("authSites", authSites.filter((site) => site.name !== name));
      }
      const urlObj = new URL(authSite.url);
      const domain = urlObj.origin.replace("www.", "");
      await authService.deleteCookieFile(domain);
    }
  }),
  // 检查软件更新
  checkSoftwareLatestVersion: t.procedure.action(async () => {
    // [PATCH] software update check disabled
    return {
      success: true,
      version: {
        hasUpdate: false,
        currentVersion: electron.app.getVersion(),
        latestVersion: "",
        normalUpgradeVersion: "0.0.0",
        updateType: "optional",
        upgradeContent: "",
        downloadUrl: ""
      }
    };
  }),
  // 下载软件更新
  downloadSoftwareUpdate: t.procedure.input().action(async ({ input }) => {
    // [PATCH] software update download disabled
    return { success: true, result: { success: false, message: "update disabled" } };
  }),
  // 检查软件包是否存在
  checkSoftwarePackageExists: t.procedure.input().action(async ({ input }) => {
    // [PATCH] software update package check disabled
    return { success: false, filePath: void 0 };
  }),
  // 安装软件更新
  installSoftwareUpdate: t.procedure.input().action(async ({ input }) => {
    // [PATCH] software update install disabled
    return { success: false };
  }),
  // 获取ytdlp组件版本号
  getLocalYtDlpVersion: t.procedure.action(async () => {
    return {
      version: ytDlpStore.get("version"),
      status: ytDlpStore.get("status")
      // 'idle' | 'updating' | 'failed'
    };
  }),
  updateYtDlp: t.procedure.action(async () => {
    // [PATCH] yt-dlp update enabled (uses ytdlp-release.json)
    ytDlpStore.set("status", "updating");
    YtDlpService$1.updateYtDlp();
  }),
  // 关闭窗口
  closeWindow: t.procedure.action(async () => {
    try {
      await snapfileService.stop();
      console.log("Snapfile服务已停止");
    } catch (error) {
      console.error("停止Snapfile服务失败:", error);
    }
    const mainWindow2 = getMainWindow();
    mainWindow2?.destroy();
    electron.app.quit();
  }),
  // 代理连通性测试
  testProxyConnection: t.procedure.input().action(async ({ input }) => {
    try {
      if (input.type === "socks5") {
        return { success: await testSocks5ProxyConnection(input) };
      } else {
        return { success: await testHttpProxyConnection(input) };
      }
    } catch {
      return { success: false };
    }
  }),
  // 打开日志目录
  openLogDirectory: t.procedure.action(async () => {
    try {
      const logFilePath = log.transports.file.getFile().path;
      const logDirectory = path.dirname(logFilePath);
      electron.shell.showItemInFolder(logFilePath);
      return { success: true, path: logDirectory };
    } catch (error) {
      logError("打开日志目录失败", {
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : void 0
      });
      return { success: false, error: "openLogDirectoryFailed" };
    }
  })
};
const taskRoute = {
  // 开始下载任务
  startDownload: t.procedure.input().action(async ({ input }) => {
    logInfo("开始下载任务", {
      urls: input.urls,
      downloadPath: settingStore.path
    });
    const taskList = await taskService.saveTaskByUrls(input.urls);
    const setting = settingStore.store;
    // [PATCH] 使用 maxParsingTasks 和 batchSize 控制并发
    const maxParsingTasks = setting.maxParsingTasks || 3;
    const batchSize = setting.batchSize || 5;
    console.log("批量下载并发控制", { maxParsingTasks, batchSize, taskCount: taskList.length });

    // 获取 handlers 用于推送状态
    const handlers = main.getRendererHandlers(getMainWindowOrCreate().webContents);

    // 异步执行解析和下载，不阻塞返回
    (async () => {
      // 解析并发控制
      const parseQueue = [...taskList];
      const parseResults = new Map();
      const activeParses = new Set();

      const parseNext = async () => {
        if (parseQueue.length === 0) return;
        const task2 = parseQueue.shift();
        activeParses.add(task2.id);
        try {
          const ytdlpResp = await taskService.parseTask(task2);
          if (ytdlpResp) {
            const downloadItems = await taskService.getNeedDownloadItems(task2, ytdlpResp, setting);
            parseResults.set(task2.id, { task: task2, items: downloadItems });
          }
        } catch (error) {
          console.error("解析任务失败", { taskId: task2.id, error: error.message });
          // 推送失败状态给渲染进程
          handlers.onDownloadProgress.send({
            taskId: task2.id,
            taskStatus: "failed",
            errorMessage: error.message
          });
        } finally {
          activeParses.delete(task2.id);
          if (parseQueue.length > 0 && activeParses.size < maxParsingTasks) {
            parseNext();
          }
        }
      };

      const initialParses = Math.min(maxParsingTasks, taskList.length);
      for (let i = 0; i < initialParses; i++) {
        parseNext();
      }

      while (activeParses.size > 0 || parseQueue.length > 0) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }

      // 下载并发控制
      const downloadQueue = Array.from(parseResults.values());
      const activeDownloads = new Set();

      const downloadNext = async () => {
        if (downloadQueue.length === 0) return;
        const { task: task2, items: downloadItems } = downloadQueue.shift();
        activeDownloads.add(task2.id);
        try {
          await taskService.downloadWithSnapfile(task2.id, downloadItems, setting);
        } catch (error) {
          console.error("下载任务失败", { taskId: task2.id, error: error.message });
        } finally {
          activeDownloads.delete(task2.id);
          if (downloadQueue.length > 0 && activeDownloads.size < batchSize) {
            downloadNext();
          }
        }
      };

      const initialDownloads = Math.min(batchSize, downloadQueue.length);
      for (let i = 0; i < initialDownloads; i++) {
        downloadNext();
      }
    })();

    // 立即返回任务列表，UI 立刻更新
    return taskList;
  }),
  resumeDownload: t.procedure.input().action(async ({ input }) => {
    const { taskId } = input;
    const handlers = main.getRendererHandlers(getMainWindowOrCreate().webContents);
    try {
      const task2 = await taskService.getTaskById(taskId);
      handlers.onDownloadProgress.send({
        ...task2,
        taskStatus: task2.taskStatus,
        taskId: task2.id,
        eta: null,
        totalSize: task2.fileSize,
        downloadedSize: null,
        speed: null,
        errorAction: null,
        errorStatus: null,
        errorMessage: null,
        isLive: task2.isLive || false
      });
      const tempTask = JSON.parse(task2.tempTask);
      if (task2.taskStatus === taskStatus.extracting) {
        const asyncTask = async () => {
          const ytdlpResp = await taskService.parseTask(task2);
          const downloadItems = await taskService.getNeedDownloadItems(task2, ytdlpResp, tempTask.setting);
          taskService.downloadWithSnapfile(task2.id, downloadItems, tempTask.setting);
        };
        asyncTask();
      } else if (task2.taskStatus !== taskStatus.failed) {
        taskService.downloadWithSnapfile(task2.id, tempTask.items, tempTask.setting);
      }
    } catch (error) {
      console.warn("恢复任务下载失败", error);
    }
  }),
  // 获取任务列表
  getTaskList: t.procedure.action(async () => {
    const taskList = await taskService.getTaskList();
    return taskList;
  }),
  // 删除任务
  deleteTask: t.procedure.input().action(async ({ input }) => {
    try {
      const { taskId } = input;
      YtDlpService$1.cancelYtDlpProcess(taskId);
      const task2 = await taskService.getTaskById(taskId);
      if (task2) {
        await taskService.deleteTask(taskId);
        if (task2.taskStatus !== taskStatus.completed && task2.taskStatus !== taskStatus.failed) {
          snapfileService.cancelTask(taskId);
        }
        if (task2.tempTask) {
          try {
            const tempTask = JSON.parse(task2.tempTask);
            const filePath = path.join(tempTask.setting.downloadPath, `.${electron.app.getName()}`, taskId);
            const exist = await checkDirectoryExists(filePath);
            if (exist) {
              await forceRemoveWithExec(filePath);
            }
            tempTaskMap.delete(taskId);
          } catch (err) {
            logError("解析tempTask失败", {
              taskId,
              error: err instanceof Error ? err.message : String(err),
              stack: err instanceof Error ? err.stack : void 0
            });
          }
        }
      }
    } catch (err) {
      logError("删除任务失败", {
        taskId: input.taskId,
        error: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : void 0
      });
    }
  }),
  // 删除所有任务
  deleteTaskList: t.procedure.input().action(async ({ input }) => {
    try {
      const taskList = await taskService.deleteTaskList(input.isDeleteDownloading);
      for (const task2 of taskList) {
        try {
          YtDlpService$1.cancelYtDlpProcess(task2.id);
          if (task2.taskStatus !== taskStatus.completed) {
            snapfileService.cancelTask(task2.id);
          }
          if (input.isDeleteFile && task2.filePath) {
            if (await checkFileExists(task2.filePath)) {
              await forceRemoveWithExec(task2.filePath);
            }
          }
          if (task2.tempTask) {
            try {
              const tempTask = JSON.parse(task2.tempTask);
              const filePath = path.join(tempTask.setting.downloadPath, `.${electron.app.getName()}`, task2.id);
              const exist = await checkDirectoryExists(filePath);
              if (exist) {
                await forceRemoveWithExec(filePath);
              }
              tempTaskMap.delete(task2.id);
            } catch (err) {
              logError("解析tempTask失败", {
                taskId: task2.id,
                error: err instanceof Error ? err.message : String(err),
                stack: err instanceof Error ? err.stack : void 0
              });
            }
          }
        } catch (err) {
          logError("处理任务失败", {
            taskId: task2.id,
            error: err instanceof Error ? err.message : String(err),
            stack: err instanceof Error ? err.stack : void 0
          });
          continue;
        }
      }
    } catch (err) {
      logError("批量删除任务失败", {
        error: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : void 0
      });
    }
  }),
  // 中断任务
  interruptTasks: t.procedure.action(async () => {
    try {
      const taskList = await taskService.getInterruptTasks();
      for (const task2 of taskList) {
        try {
          YtDlpService$1.cancelYtDlpProcess(task2.id);
          snapfileService.cancelTask(task2.id);
          await taskService.updateTask(task2.id, {
            errorMessage: errorMessageEnum.cancel
          });
        } catch (err) {
          logError("中断任务失败", {
            taskId: task2.id,
            error: err instanceof Error ? err.message : String(err),
            stack: err instanceof Error ? err.stack : void 0
          });
          continue;
        }
      }
    } catch (err) {
      logError("批量中断任务失败", {
        error: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : void 0
      });
    }
  }),
  // 停止直播录制
  stopRecordingLive: t.procedure.input().action(async ({ input }) => {
    const { taskId } = input;
    try {
      const success = snapfileService.stopRecordingLive(taskId);
      if (!success) {
        logError("停止直播录制失败", {
          taskId,
          reason: "snapfile进程未运行"
        });
        return { success: false, message: "snapfile 进程未运行" };
      }
      logInfo("停止直播录制成功", { taskId });
      return { success: true };
    } catch (error) {
      logError("停止直播录制失败", {
        taskId,
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : void 0
      });
      return { success: false, message: "停止直播录制失败" };
    }
  })
};
var commonjsGlobal = typeof globalThis !== "undefined" ? globalThis : typeof window !== "undefined" ? window : typeof global !== "undefined" ? global : typeof self !== "undefined" ? self : {};
function getDefaultExportFromCjs(x) {
  return x && x.__esModule && Object.prototype.hasOwnProperty.call(x, "default") ? x["default"] : x;
}
var fs$1 = {};
var universalify = {};
var hasRequiredUniversalify;
function requireUniversalify() {
  if (hasRequiredUniversalify) return universalify;
  hasRequiredUniversalify = 1;
  universalify.fromCallback = function(fn) {
    return Object.defineProperty(function(...args) {
      if (typeof args[args.length - 1] === "function") fn.apply(this, args);
      else {
        return new Promise((resolve, reject) => {
          args.push((err, res) => err != null ? reject(err) : resolve(res));
          fn.apply(this, args);
        });
      }
    }, "name", { value: fn.name });
  };
  universalify.fromPromise = function(fn) {
    return Object.defineProperty(function(...args) {
      const cb = args[args.length - 1];
      if (typeof cb !== "function") return fn.apply(this, args);
      else {
        args.pop();
        fn.apply(this, args).then((r) => cb(null, r), cb);
      }
    }, "name", { value: fn.name });
  };
  return universalify;
}
var polyfills;
var hasRequiredPolyfills;
function requirePolyfills() {
  if (hasRequiredPolyfills) return polyfills;
  hasRequiredPolyfills = 1;
  var constants = require$$0;
  var origCwd = process.cwd;
  var cwd = null;
  var platform = process.env.GRACEFUL_FS_PLATFORM || process.platform;
  process.cwd = function() {
    if (!cwd)
      cwd = origCwd.call(process);
    return cwd;
  };
  try {
    process.cwd();
  } catch (er) {
  }
  if (typeof process.chdir === "function") {
    var chdir = process.chdir;
    process.chdir = function(d) {
      cwd = null;
      chdir.call(process, d);
    };
    if (Object.setPrototypeOf) Object.setPrototypeOf(process.chdir, chdir);
  }
  polyfills = patch;
  function patch(fs2) {
    if (constants.hasOwnProperty("O_SYMLINK") && process.version.match(/^v0\.6\.[0-2]|^v0\.5\./)) {
      patchLchmod(fs2);
    }
    if (!fs2.lutimes) {
      patchLutimes(fs2);
    }
    fs2.chown = chownFix(fs2.chown);
    fs2.fchown = chownFix(fs2.fchown);
    fs2.lchown = chownFix(fs2.lchown);
    fs2.chmod = chmodFix(fs2.chmod);
    fs2.fchmod = chmodFix(fs2.fchmod);
    fs2.lchmod = chmodFix(fs2.lchmod);
    fs2.chownSync = chownFixSync(fs2.chownSync);
    fs2.fchownSync = chownFixSync(fs2.fchownSync);
    fs2.lchownSync = chownFixSync(fs2.lchownSync);
    fs2.chmodSync = chmodFixSync(fs2.chmodSync);
    fs2.fchmodSync = chmodFixSync(fs2.fchmodSync);
    fs2.lchmodSync = chmodFixSync(fs2.lchmodSync);
    fs2.stat = statFix(fs2.stat);
    fs2.fstat = statFix(fs2.fstat);
    fs2.lstat = statFix(fs2.lstat);
    fs2.statSync = statFixSync(fs2.statSync);
    fs2.fstatSync = statFixSync(fs2.fstatSync);
    fs2.lstatSync = statFixSync(fs2.lstatSync);
    if (fs2.chmod && !fs2.lchmod) {
      fs2.lchmod = function(path2, mode, cb) {
        if (cb) process.nextTick(cb);
      };
      fs2.lchmodSync = function() {
      };
    }
    if (fs2.chown && !fs2.lchown) {
      fs2.lchown = function(path2, uid, gid, cb) {
        if (cb) process.nextTick(cb);
      };
      fs2.lchownSync = function() {
      };
    }
    if (platform === "win32") {
      fs2.rename = typeof fs2.rename !== "function" ? fs2.rename : function(fs$rename) {
        function rename(from, to, cb) {
          var start = Date.now();
          var backoff = 0;
          fs$rename(from, to, function CB(er) {
            if (er && (er.code === "EACCES" || er.code === "EPERM" || er.code === "EBUSY") && Date.now() - start < 6e4) {
              setTimeout(function() {
                fs2.stat(to, function(stater, st) {
                  if (stater && stater.code === "ENOENT")
                    fs$rename(from, to, CB);
                  else
                    cb(er);
                });
              }, backoff);
              if (backoff < 100)
                backoff += 10;
              return;
            }
            if (cb) cb(er);
          });
        }
        if (Object.setPrototypeOf) Object.setPrototypeOf(rename, fs$rename);
        return rename;
      }(fs2.rename);
    }
    fs2.read = typeof fs2.read !== "function" ? fs2.read : function(fs$read) {
      function read(fd, buffer, offset, length, position, callback_) {
        var callback;
        if (callback_ && typeof callback_ === "function") {
          var eagCounter = 0;
          callback = function(er, _, __) {
            if (er && er.code === "EAGAIN" && eagCounter < 10) {
              eagCounter++;
              return fs$read.call(fs2, fd, buffer, offset, length, position, callback);
            }
            callback_.apply(this, arguments);
          };
        }
        return fs$read.call(fs2, fd, buffer, offset, length, position, callback);
      }
      if (Object.setPrototypeOf) Object.setPrototypeOf(read, fs$read);
      return read;
    }(fs2.read);
    fs2.readSync = typeof fs2.readSync !== "function" ? fs2.readSync : /* @__PURE__ */ function(fs$readSync) {
      return function(fd, buffer, offset, length, position) {
        var eagCounter = 0;
        while (true) {
          try {
            return fs$readSync.call(fs2, fd, buffer, offset, length, position);
          } catch (er) {
            if (er.code === "EAGAIN" && eagCounter < 10) {
              eagCounter++;
              continue;
            }
            throw er;
          }
        }
      };
    }(fs2.readSync);
    function patchLchmod(fs22) {
      fs22.lchmod = function(path2, mode, callback) {
        fs22.open(
          path2,
          constants.O_WRONLY | constants.O_SYMLINK,
          mode,
          function(err, fd) {
            if (err) {
              if (callback) callback(err);
              return;
            }
            fs22.fchmod(fd, mode, function(err2) {
              fs22.close(fd, function(err22) {
                if (callback) callback(err2 || err22);
              });
            });
          }
        );
      };
      fs22.lchmodSync = function(path2, mode) {
        var fd = fs22.openSync(path2, constants.O_WRONLY | constants.O_SYMLINK, mode);
        var threw = true;
        var ret;
        try {
          ret = fs22.fchmodSync(fd, mode);
          threw = false;
        } finally {
          if (threw) {
            try {
              fs22.closeSync(fd);
            } catch (er) {
            }
          } else {
            fs22.closeSync(fd);
          }
        }
        return ret;
      };
    }
    function patchLutimes(fs22) {
      if (constants.hasOwnProperty("O_SYMLINK") && fs22.futimes) {
        fs22.lutimes = function(path2, at, mt, cb) {
          fs22.open(path2, constants.O_SYMLINK, function(er, fd) {
            if (er) {
              if (cb) cb(er);
              return;
            }
            fs22.futimes(fd, at, mt, function(er2) {
              fs22.close(fd, function(er22) {
                if (cb) cb(er2 || er22);
              });
            });
          });
        };
        fs22.lutimesSync = function(path2, at, mt) {
          var fd = fs22.openSync(path2, constants.O_SYMLINK);
          var ret;
          var threw = true;
          try {
            ret = fs22.futimesSync(fd, at, mt);
            threw = false;
          } finally {
            if (threw) {
              try {
                fs22.closeSync(fd);
              } catch (er) {
              }
            } else {
              fs22.closeSync(fd);
            }
          }
          return ret;
        };
      } else if (fs22.futimes) {
        fs22.lutimes = function(_a, _b, _c, cb) {
          if (cb) process.nextTick(cb);
        };
        fs22.lutimesSync = function() {
        };
      }
    }
    function chmodFix(orig) {
      if (!orig) return orig;
      return function(target, mode, cb) {
        return orig.call(fs2, target, mode, function(er) {
          if (chownErOk(er)) er = null;
          if (cb) cb.apply(this, arguments);
        });
      };
    }
    function chmodFixSync(orig) {
      if (!orig) return orig;
      return function(target, mode) {
        try {
          return orig.call(fs2, target, mode);
        } catch (er) {
          if (!chownErOk(er)) throw er;
        }
      };
    }
    function chownFix(orig) {
      if (!orig) return orig;
      return function(target, uid, gid, cb) {
        return orig.call(fs2, target, uid, gid, function(er) {
          if (chownErOk(er)) er = null;
          if (cb) cb.apply(this, arguments);
        });
      };
    }
    function chownFixSync(orig) {
      if (!orig) return orig;
      return function(target, uid, gid) {
        try {
          return orig.call(fs2, target, uid, gid);
        } catch (er) {
          if (!chownErOk(er)) throw er;
        }
      };
    }
    function statFix(orig) {
      if (!orig) return orig;
      return function(target, options, cb) {
        if (typeof options === "function") {
          cb = options;
          options = null;
        }
        function callback(er, stats) {
          if (stats) {
            if (stats.uid < 0) stats.uid += 4294967296;
            if (stats.gid < 0) stats.gid += 4294967296;
          }
          if (cb) cb.apply(this, arguments);
        }
        return options ? orig.call(fs2, target, options, callback) : orig.call(fs2, target, callback);
      };
    }
    function statFixSync(orig) {
      if (!orig) return orig;
      return function(target, options) {
        var stats = options ? orig.call(fs2, target, options) : orig.call(fs2, target);
        if (stats) {
          if (stats.uid < 0) stats.uid += 4294967296;
          if (stats.gid < 0) stats.gid += 4294967296;
        }
        return stats;
      };
    }
    function chownErOk(er) {
      if (!er)
        return true;
      if (er.code === "ENOSYS")
        return true;
      var nonroot = !process.getuid || process.getuid() !== 0;
      if (nonroot) {
        if (er.code === "EINVAL" || er.code === "EPERM")
          return true;
      }
      return false;
    }
  }
  return polyfills;
}
var legacyStreams;
var hasRequiredLegacyStreams;
function requireLegacyStreams() {
  if (hasRequiredLegacyStreams) return legacyStreams;
  hasRequiredLegacyStreams = 1;
  var Stream = require$$0$1.Stream;
  legacyStreams = legacy;
  function legacy(fs2) {
    return {
      ReadStream,
      WriteStream
    };
    function ReadStream(path2, options) {
      if (!(this instanceof ReadStream)) return new ReadStream(path2, options);
      Stream.call(this);
      var self2 = this;
      this.path = path2;
      this.fd = null;
      this.readable = true;
      this.paused = false;
      this.flags = "r";
      this.mode = 438;
      this.bufferSize = 64 * 1024;
      options = options || {};
      var keys = Object.keys(options);
      for (var index = 0, length = keys.length; index < length; index++) {
        var key = keys[index];
        this[key] = options[key];
      }
      if (this.encoding) this.setEncoding(this.encoding);
      if (this.start !== void 0) {
        if ("number" !== typeof this.start) {
          throw TypeError("start must be a Number");
        }
        if (this.end === void 0) {
          this.end = Infinity;
        } else if ("number" !== typeof this.end) {
          throw TypeError("end must be a Number");
        }
        if (this.start > this.end) {
          throw new Error("start must be <= end");
        }
        this.pos = this.start;
      }
      if (this.fd !== null) {
        process.nextTick(function() {
          self2._read();
        });
        return;
      }
      fs2.open(this.path, this.flags, this.mode, function(err, fd) {
        if (err) {
          self2.emit("error", err);
          self2.readable = false;
          return;
        }
        self2.fd = fd;
        self2.emit("open", fd);
        self2._read();
      });
    }
    function WriteStream(path2, options) {
      if (!(this instanceof WriteStream)) return new WriteStream(path2, options);
      Stream.call(this);
      this.path = path2;
      this.fd = null;
      this.writable = true;
      this.flags = "w";
      this.encoding = "binary";
      this.mode = 438;
      this.bytesWritten = 0;
      options = options || {};
      var keys = Object.keys(options);
      for (var index = 0, length = keys.length; index < length; index++) {
        var key = keys[index];
        this[key] = options[key];
      }
      if (this.start !== void 0) {
        if ("number" !== typeof this.start) {
          throw TypeError("start must be a Number");
        }
        if (this.start < 0) {
          throw new Error("start must be >= zero");
        }
        this.pos = this.start;
      }
      this.busy = false;
      this._queue = [];
      if (this.fd === null) {
        this._open = fs2.open;
        this._queue.push([this._open, this.path, this.flags, this.mode, void 0]);
        this.flush();
      }
    }
  }
  return legacyStreams;
}
var clone_1;
var hasRequiredClone;
function requireClone() {
  if (hasRequiredClone) return clone_1;
  hasRequiredClone = 1;
  clone_1 = clone;
  var getPrototypeOf = Object.getPrototypeOf || function(obj) {
    return obj.__proto__;
  };
  function clone(obj) {
    if (obj === null || typeof obj !== "object")
      return obj;
    if (obj instanceof Object)
      var copy2 = { __proto__: getPrototypeOf(obj) };
    else
      var copy2 = /* @__PURE__ */ Object.create(null);
    Object.getOwnPropertyNames(obj).forEach(function(key) {
      Object.defineProperty(copy2, key, Object.getOwnPropertyDescriptor(obj, key));
    });
    return copy2;
  }
  return clone_1;
}
var gracefulFs;
var hasRequiredGracefulFs;
function requireGracefulFs() {
  if (hasRequiredGracefulFs) return gracefulFs;
  hasRequiredGracefulFs = 1;
  var fs2 = require$$0$2;
  var polyfills2 = requirePolyfills();
  var legacy = requireLegacyStreams();
  var clone = requireClone();
  var util = require$$4;
  var gracefulQueue;
  var previousSymbol;
  if (typeof Symbol === "function" && typeof Symbol.for === "function") {
    gracefulQueue = Symbol.for("graceful-fs.queue");
    previousSymbol = Symbol.for("graceful-fs.previous");
  } else {
    gracefulQueue = "___graceful-fs.queue";
    previousSymbol = "___graceful-fs.previous";
  }
  function noop() {
  }
  function publishQueue(context, queue2) {
    Object.defineProperty(context, gracefulQueue, {
      get: function() {
        return queue2;
      }
    });
  }
  var debug = noop;
  if (util.debuglog)
    debug = util.debuglog("gfs4");
  else if (/\bgfs4\b/i.test(process.env.NODE_DEBUG || ""))
    debug = function() {
      var m = util.format.apply(util, arguments);
      m = "GFS4: " + m.split(/\n/).join("\nGFS4: ");
      console.error(m);
    };
  if (!fs2[gracefulQueue]) {
    var queue = commonjsGlobal[gracefulQueue] || [];
    publishQueue(fs2, queue);
    fs2.close = function(fs$close) {
      function close(fd, cb) {
        return fs$close.call(fs2, fd, function(err) {
          if (!err) {
            resetQueue();
          }
          if (typeof cb === "function")
            cb.apply(this, arguments);
        });
      }
      Object.defineProperty(close, previousSymbol, {
        value: fs$close
      });
      return close;
    }(fs2.close);
    fs2.closeSync = function(fs$closeSync) {
      function closeSync(fd) {
        fs$closeSync.apply(fs2, arguments);
        resetQueue();
      }
      Object.defineProperty(closeSync, previousSymbol, {
        value: fs$closeSync
      });
      return closeSync;
    }(fs2.closeSync);
    if (/\bgfs4\b/i.test(process.env.NODE_DEBUG || "")) {
      process.on("exit", function() {
        debug(fs2[gracefulQueue]);
        require$$5.equal(fs2[gracefulQueue].length, 0);
      });
    }
  }
  if (!commonjsGlobal[gracefulQueue]) {
    publishQueue(commonjsGlobal, fs2[gracefulQueue]);
  }
  gracefulFs = patch(clone(fs2));
  if (process.env.TEST_GRACEFUL_FS_GLOBAL_PATCH && !fs2.__patched) {
    gracefulFs = patch(fs2);
    fs2.__patched = true;
  }
  function patch(fs22) {
    polyfills2(fs22);
    fs22.gracefulify = patch;
    fs22.createReadStream = createReadStream;
    fs22.createWriteStream = createWriteStream;
    var fs$readFile = fs22.readFile;
    fs22.readFile = readFile;
    function readFile(path2, options, cb) {
      if (typeof options === "function")
        cb = options, options = null;
      return go$readFile(path2, options, cb);
      function go$readFile(path22, options2, cb2, startTime) {
        return fs$readFile(path22, options2, function(err) {
          if (err && (err.code === "EMFILE" || err.code === "ENFILE"))
            enqueue([go$readFile, [path22, options2, cb2], err, startTime || Date.now(), Date.now()]);
          else {
            if (typeof cb2 === "function")
              cb2.apply(this, arguments);
          }
        });
      }
    }
    var fs$writeFile = fs22.writeFile;
    fs22.writeFile = writeFile;
    function writeFile(path2, data, options, cb) {
      if (typeof options === "function")
        cb = options, options = null;
      return go$writeFile(path2, data, options, cb);
      function go$writeFile(path22, data2, options2, cb2, startTime) {
        return fs$writeFile(path22, data2, options2, function(err) {
          if (err && (err.code === "EMFILE" || err.code === "ENFILE"))
            enqueue([go$writeFile, [path22, data2, options2, cb2], err, startTime || Date.now(), Date.now()]);
          else {
            if (typeof cb2 === "function")
              cb2.apply(this, arguments);
          }
        });
      }
    }
    var fs$appendFile = fs22.appendFile;
    if (fs$appendFile)
      fs22.appendFile = appendFile;
    function appendFile(path2, data, options, cb) {
      if (typeof options === "function")
        cb = options, options = null;
      return go$appendFile(path2, data, options, cb);
      function go$appendFile(path22, data2, options2, cb2, startTime) {
        return fs$appendFile(path22, data2, options2, function(err) {
          if (err && (err.code === "EMFILE" || err.code === "ENFILE"))
            enqueue([go$appendFile, [path22, data2, options2, cb2], err, startTime || Date.now(), Date.now()]);
          else {
            if (typeof cb2 === "function")
              cb2.apply(this, arguments);
          }
        });
      }
    }
    var fs$copyFile = fs22.copyFile;
    if (fs$copyFile)
      fs22.copyFile = copyFile;
    function copyFile(src, dest, flags, cb) {
      if (typeof flags === "function") {
        cb = flags;
        flags = 0;
      }
      return go$copyFile(src, dest, flags, cb);
      function go$copyFile(src2, dest2, flags2, cb2, startTime) {
        return fs$copyFile(src2, dest2, flags2, function(err) {
          if (err && (err.code === "EMFILE" || err.code === "ENFILE"))
            enqueue([go$copyFile, [src2, dest2, flags2, cb2], err, startTime || Date.now(), Date.now()]);
          else {
            if (typeof cb2 === "function")
              cb2.apply(this, arguments);
          }
        });
      }
    }
    var fs$readdir = fs22.readdir;
    fs22.readdir = readdir;
    var noReaddirOptionVersions = /^v[0-5]\./;
    function readdir(path2, options, cb) {
      if (typeof options === "function")
        cb = options, options = null;
      var go$readdir = noReaddirOptionVersions.test(process.version) ? function go$readdir2(path22, options2, cb2, startTime) {
        return fs$readdir(path22, fs$readdirCallback(
          path22,
          options2,
          cb2,
          startTime
        ));
      } : function go$readdir2(path22, options2, cb2, startTime) {
        return fs$readdir(path22, options2, fs$readdirCallback(
          path22,
          options2,
          cb2,
          startTime
        ));
      };
      return go$readdir(path2, options, cb);
      function fs$readdirCallback(path22, options2, cb2, startTime) {
        return function(err, files) {
          if (err && (err.code === "EMFILE" || err.code === "ENFILE"))
            enqueue([
              go$readdir,
              [path22, options2, cb2],
              err,
              startTime || Date.now(),
              Date.now()
            ]);
          else {
            if (files && files.sort)
              files.sort();
            if (typeof cb2 === "function")
              cb2.call(this, err, files);
          }
        };
      }
    }
    if (process.version.substr(0, 4) === "v0.8") {
      var legStreams = legacy(fs22);
      ReadStream = legStreams.ReadStream;
      WriteStream = legStreams.WriteStream;
    }
    var fs$ReadStream = fs22.ReadStream;
    if (fs$ReadStream) {
      ReadStream.prototype = Object.create(fs$ReadStream.prototype);
      ReadStream.prototype.open = ReadStream$open;
    }
    var fs$WriteStream = fs22.WriteStream;
    if (fs$WriteStream) {
      WriteStream.prototype = Object.create(fs$WriteStream.prototype);
      WriteStream.prototype.open = WriteStream$open;
    }
    Object.defineProperty(fs22, "ReadStream", {
      get: function() {
        return ReadStream;
      },
      set: function(val) {
        ReadStream = val;
      },
      enumerable: true,
      configurable: true
    });
    Object.defineProperty(fs22, "WriteStream", {
      get: function() {
        return WriteStream;
      },
      set: function(val) {
        WriteStream = val;
      },
      enumerable: true,
      configurable: true
    });
    var FileReadStream = ReadStream;
    Object.defineProperty(fs22, "FileReadStream", {
      get: function() {
        return FileReadStream;
      },
      set: function(val) {
        FileReadStream = val;
      },
      enumerable: true,
      configurable: true
    });
    var FileWriteStream = WriteStream;
    Object.defineProperty(fs22, "FileWriteStream", {
      get: function() {
        return FileWriteStream;
      },
      set: function(val) {
        FileWriteStream = val;
      },
      enumerable: true,
      configurable: true
    });
    function ReadStream(path2, options) {
      if (this instanceof ReadStream)
        return fs$ReadStream.apply(this, arguments), this;
      else
        return ReadStream.apply(Object.create(ReadStream.prototype), arguments);
    }
    function ReadStream$open() {
      var that = this;
      open(that.path, that.flags, that.mode, function(err, fd) {
        if (err) {
          if (that.autoClose)
            that.destroy();
          that.emit("error", err);
        } else {
          that.fd = fd;
          that.emit("open", fd);
          that.read();
        }
      });
    }
    function WriteStream(path2, options) {
      if (this instanceof WriteStream)
        return fs$WriteStream.apply(this, arguments), this;
      else
        return WriteStream.apply(Object.create(WriteStream.prototype), arguments);
    }
    function WriteStream$open() {
      var that = this;
      open(that.path, that.flags, that.mode, function(err, fd) {
        if (err) {
          that.destroy();
          that.emit("error", err);
        } else {
          that.fd = fd;
          that.emit("open", fd);
        }
      });
    }
    function createReadStream(path2, options) {
      return new fs22.ReadStream(path2, options);
    }
    function createWriteStream(path2, options) {
      return new fs22.WriteStream(path2, options);
    }
    var fs$open = fs22.open;
    fs22.open = open;
    function open(path2, flags, mode, cb) {
      if (typeof mode === "function")
        cb = mode, mode = null;
      return go$open(path2, flags, mode, cb);
      function go$open(path22, flags2, mode2, cb2, startTime) {
        return fs$open(path22, flags2, mode2, function(err, fd) {
          if (err && (err.code === "EMFILE" || err.code === "ENFILE"))
            enqueue([go$open, [path22, flags2, mode2, cb2], err, startTime || Date.now(), Date.now()]);
          else {
            if (typeof cb2 === "function")
              cb2.apply(this, arguments);
          }
        });
      }
    }
    return fs22;
  }
  function enqueue(elem) {
    debug("ENQUEUE", elem[0].name, elem[1]);
    fs2[gracefulQueue].push(elem);
    retry();
  }
  var retryTimer;
  function resetQueue() {
    var now = Date.now();
    for (var i = 0; i < fs2[gracefulQueue].length; ++i) {
      if (fs2[gracefulQueue][i].length > 2) {
        fs2[gracefulQueue][i][3] = now;
        fs2[gracefulQueue][i][4] = now;
      }
    }
    retry();
  }
  function retry() {
    clearTimeout(retryTimer);
    retryTimer = void 0;
    if (fs2[gracefulQueue].length === 0)
      return;
    var elem = fs2[gracefulQueue].shift();
    var fn = elem[0];
    var args = elem[1];
    var err = elem[2];
    var startTime = elem[3];
    var lastTime = elem[4];
    if (startTime === void 0) {
      debug("RETRY", fn.name, args);
      fn.apply(null, args);
    } else if (Date.now() - startTime >= 6e4) {
      debug("TIMEOUT", fn.name, args);
      var cb = args.pop();
      if (typeof cb === "function")
        cb.call(null, err);
    } else {
      var sinceAttempt = Date.now() - lastTime;
      var sinceStart = Math.max(lastTime - startTime, 1);
      var desiredDelay = Math.min(sinceStart * 1.2, 100);
      if (sinceAttempt >= desiredDelay) {
        debug("RETRY", fn.name, args);
        fn.apply(null, args.concat([startTime]));
      } else {
        fs2[gracefulQueue].push(elem);
      }
    }
    if (retryTimer === void 0) {
      retryTimer = setTimeout(retry, 0);
    }
  }
  return gracefulFs;
}
var hasRequiredFs;
function requireFs() {
  if (hasRequiredFs) return fs$1;
  hasRequiredFs = 1;
  (function(exports) {
    const u = requireUniversalify().fromCallback;
    const fs2 = requireGracefulFs();
    const api = [
      "access",
      "appendFile",
      "chmod",
      "chown",
      "close",
      "copyFile",
      "cp",
      "fchmod",
      "fchown",
      "fdatasync",
      "fstat",
      "fsync",
      "ftruncate",
      "futimes",
      "glob",
      "lchmod",
      "lchown",
      "lutimes",
      "link",
      "lstat",
      "mkdir",
      "mkdtemp",
      "open",
      "opendir",
      "readdir",
      "readFile",
      "readlink",
      "realpath",
      "rename",
      "rm",
      "rmdir",
      "stat",
      "statfs",
      "symlink",
      "truncate",
      "unlink",
      "utimes",
      "writeFile"
    ].filter((key) => {
      return typeof fs2[key] === "function";
    });
    Object.assign(exports, fs2);
    api.forEach((method) => {
      exports[method] = u(fs2[method]);
    });
    exports.exists = function(filename, callback) {
      if (typeof callback === "function") {
        return fs2.exists(filename, callback);
      }
      return new Promise((resolve) => {
        return fs2.exists(filename, resolve);
      });
    };
    exports.read = function(fd, buffer, offset, length, position, callback) {
      if (typeof callback === "function") {
        return fs2.read(fd, buffer, offset, length, position, callback);
      }
      return new Promise((resolve, reject) => {
        fs2.read(fd, buffer, offset, length, position, (err, bytesRead, buffer2) => {
          if (err) return reject(err);
          resolve({ bytesRead, buffer: buffer2 });
        });
      });
    };
    exports.write = function(fd, buffer, ...args) {
      if (typeof args[args.length - 1] === "function") {
        return fs2.write(fd, buffer, ...args);
      }
      return new Promise((resolve, reject) => {
        fs2.write(fd, buffer, ...args, (err, bytesWritten, buffer2) => {
          if (err) return reject(err);
          resolve({ bytesWritten, buffer: buffer2 });
        });
      });
    };
    exports.readv = function(fd, buffers, ...args) {
      if (typeof args[args.length - 1] === "function") {
        return fs2.readv(fd, buffers, ...args);
      }
      return new Promise((resolve, reject) => {
        fs2.readv(fd, buffers, ...args, (err, bytesRead, buffers2) => {
          if (err) return reject(err);
          resolve({ bytesRead, buffers: buffers2 });
        });
      });
    };
    exports.writev = function(fd, buffers, ...args) {
      if (typeof args[args.length - 1] === "function") {
        return fs2.writev(fd, buffers, ...args);
      }
      return new Promise((resolve, reject) => {
        fs2.writev(fd, buffers, ...args, (err, bytesWritten, buffers2) => {
          if (err) return reject(err);
          resolve({ bytesWritten, buffers: buffers2 });
        });
      });
    };
    if (typeof fs2.realpath.native === "function") {
      exports.realpath.native = u(fs2.realpath.native);
    } else {
      process.emitWarning(
        "fs.realpath.native is not a function. Is fs being monkey-patched?",
        "Warning",
        "fs-extra-WARN0003"
      );
    }
  })(fs$1);
  return fs$1;
}
var makeDir = {};
var utils$1 = {};
var hasRequiredUtils$1;
function requireUtils$1() {
  if (hasRequiredUtils$1) return utils$1;
  hasRequiredUtils$1 = 1;
  const path2 = require$$1;
  utils$1.checkPath = function checkPath(pth) {
    if (process.platform === "win32") {
      const pathHasInvalidWinCharacters = /[<>:"|?*]/.test(pth.replace(path2.parse(pth).root, ""));
      if (pathHasInvalidWinCharacters) {
        const error = new Error(`Path contains invalid characters: ${pth}`);
        error.code = "EINVAL";
        throw error;
      }
    }
  };
  return utils$1;
}
var hasRequiredMakeDir;
function requireMakeDir() {
  if (hasRequiredMakeDir) return makeDir;
  hasRequiredMakeDir = 1;
  const fs2 = /* @__PURE__ */ requireFs();
  const { checkPath } = /* @__PURE__ */ requireUtils$1();
  const getMode = (options) => {
    const defaults = { mode: 511 };
    if (typeof options === "number") return options;
    return { ...defaults, ...options }.mode;
  };
  makeDir.makeDir = async (dir, options) => {
    checkPath(dir);
    return fs2.mkdir(dir, {
      mode: getMode(options),
      recursive: true
    });
  };
  makeDir.makeDirSync = (dir, options) => {
    checkPath(dir);
    return fs2.mkdirSync(dir, {
      mode: getMode(options),
      recursive: true
    });
  };
  return makeDir;
}
var mkdirs;
var hasRequiredMkdirs;
function requireMkdirs() {
  if (hasRequiredMkdirs) return mkdirs;
  hasRequiredMkdirs = 1;
  const u = requireUniversalify().fromPromise;
  const { makeDir: _makeDir, makeDirSync } = /* @__PURE__ */ requireMakeDir();
  const makeDir2 = u(_makeDir);
  mkdirs = {
    mkdirs: makeDir2,
    mkdirsSync: makeDirSync,
    // alias
    mkdirp: makeDir2,
    mkdirpSync: makeDirSync,
    ensureDir: makeDir2,
    ensureDirSync: makeDirSync
  };
  return mkdirs;
}
var pathExists_1;
var hasRequiredPathExists;
function requirePathExists() {
  if (hasRequiredPathExists) return pathExists_1;
  hasRequiredPathExists = 1;
  const u = requireUniversalify().fromPromise;
  const fs2 = /* @__PURE__ */ requireFs();
  function pathExists(path2) {
    return fs2.access(path2).then(() => true).catch(() => false);
  }
  pathExists_1 = {
    pathExists: u(pathExists),
    pathExistsSync: fs2.existsSync
  };
  return pathExists_1;
}
var utimes;
var hasRequiredUtimes;
function requireUtimes() {
  if (hasRequiredUtimes) return utimes;
  hasRequiredUtimes = 1;
  const fs2 = /* @__PURE__ */ requireFs();
  const u = requireUniversalify().fromPromise;
  async function utimesMillis(path2, atime, mtime) {
    const fd = await fs2.open(path2, "r+");
    let closeErr = null;
    try {
      await fs2.futimes(fd, atime, mtime);
    } finally {
      try {
        await fs2.close(fd);
      } catch (e) {
        closeErr = e;
      }
    }
    if (closeErr) {
      throw closeErr;
    }
  }
  function utimesMillisSync(path2, atime, mtime) {
    const fd = fs2.openSync(path2, "r+");
    fs2.futimesSync(fd, atime, mtime);
    return fs2.closeSync(fd);
  }
  utimes = {
    utimesMillis: u(utimesMillis),
    utimesMillisSync
  };
  return utimes;
}
var stat;
var hasRequiredStat;
function requireStat() {
  if (hasRequiredStat) return stat;
  hasRequiredStat = 1;
  const fs2 = /* @__PURE__ */ requireFs();
  const path2 = require$$1;
  const u = requireUniversalify().fromPromise;
  function getStats(src, dest, opts) {
    const statFunc = opts.dereference ? (file2) => fs2.stat(file2, { bigint: true }) : (file2) => fs2.lstat(file2, { bigint: true });
    return Promise.all([
      statFunc(src),
      statFunc(dest).catch((err) => {
        if (err.code === "ENOENT") return null;
        throw err;
      })
    ]).then(([srcStat, destStat]) => ({ srcStat, destStat }));
  }
  function getStatsSync(src, dest, opts) {
    let destStat;
    const statFunc = opts.dereference ? (file2) => fs2.statSync(file2, { bigint: true }) : (file2) => fs2.lstatSync(file2, { bigint: true });
    const srcStat = statFunc(src);
    try {
      destStat = statFunc(dest);
    } catch (err) {
      if (err.code === "ENOENT") return { srcStat, destStat: null };
      throw err;
    }
    return { srcStat, destStat };
  }
  async function checkPaths(src, dest, funcName, opts) {
    const { srcStat, destStat } = await getStats(src, dest, opts);
    if (destStat) {
      if (areIdentical(srcStat, destStat)) {
        const srcBaseName = path2.basename(src);
        const destBaseName = path2.basename(dest);
        if (funcName === "move" && srcBaseName !== destBaseName && srcBaseName.toLowerCase() === destBaseName.toLowerCase()) {
          return { srcStat, destStat, isChangingCase: true };
        }
        throw new Error("Source and destination must not be the same.");
      }
      if (srcStat.isDirectory() && !destStat.isDirectory()) {
        throw new Error(`Cannot overwrite non-directory '${dest}' with directory '${src}'.`);
      }
      if (!srcStat.isDirectory() && destStat.isDirectory()) {
        throw new Error(`Cannot overwrite directory '${dest}' with non-directory '${src}'.`);
      }
    }
    if (srcStat.isDirectory() && isSrcSubdir(src, dest)) {
      throw new Error(errMsg(src, dest, funcName));
    }
    return { srcStat, destStat };
  }
  function checkPathsSync(src, dest, funcName, opts) {
    const { srcStat, destStat } = getStatsSync(src, dest, opts);
    if (destStat) {
      if (areIdentical(srcStat, destStat)) {
        const srcBaseName = path2.basename(src);
        const destBaseName = path2.basename(dest);
        if (funcName === "move" && srcBaseName !== destBaseName && srcBaseName.toLowerCase() === destBaseName.toLowerCase()) {
          return { srcStat, destStat, isChangingCase: true };
        }
        throw new Error("Source and destination must not be the same.");
      }
      if (srcStat.isDirectory() && !destStat.isDirectory()) {
        throw new Error(`Cannot overwrite non-directory '${dest}' with directory '${src}'.`);
      }
      if (!srcStat.isDirectory() && destStat.isDirectory()) {
        throw new Error(`Cannot overwrite directory '${dest}' with non-directory '${src}'.`);
      }
    }
    if (srcStat.isDirectory() && isSrcSubdir(src, dest)) {
      throw new Error(errMsg(src, dest, funcName));
    }
    return { srcStat, destStat };
  }
  async function checkParentPaths(src, srcStat, dest, funcName) {
    const srcParent = path2.resolve(path2.dirname(src));
    const destParent = path2.resolve(path2.dirname(dest));
    if (destParent === srcParent || destParent === path2.parse(destParent).root) return;
    let destStat;
    try {
      destStat = await fs2.stat(destParent, { bigint: true });
    } catch (err) {
      if (err.code === "ENOENT") return;
      throw err;
    }
    if (areIdentical(srcStat, destStat)) {
      throw new Error(errMsg(src, dest, funcName));
    }
    return checkParentPaths(src, srcStat, destParent, funcName);
  }
  function checkParentPathsSync(src, srcStat, dest, funcName) {
    const srcParent = path2.resolve(path2.dirname(src));
    const destParent = path2.resolve(path2.dirname(dest));
    if (destParent === srcParent || destParent === path2.parse(destParent).root) return;
    let destStat;
    try {
      destStat = fs2.statSync(destParent, { bigint: true });
    } catch (err) {
      if (err.code === "ENOENT") return;
      throw err;
    }
    if (areIdentical(srcStat, destStat)) {
      throw new Error(errMsg(src, dest, funcName));
    }
    return checkParentPathsSync(src, srcStat, destParent, funcName);
  }
  function areIdentical(srcStat, destStat) {
    return destStat.ino && destStat.dev && destStat.ino === srcStat.ino && destStat.dev === srcStat.dev;
  }
  function isSrcSubdir(src, dest) {
    const srcArr = path2.resolve(src).split(path2.sep).filter((i) => i);
    const destArr = path2.resolve(dest).split(path2.sep).filter((i) => i);
    return srcArr.every((cur, i) => destArr[i] === cur);
  }
  function errMsg(src, dest, funcName) {
    return `Cannot ${funcName} '${src}' to a subdirectory of itself, '${dest}'.`;
  }
  stat = {
    // checkPaths
    checkPaths: u(checkPaths),
    checkPathsSync,
    // checkParent
    checkParentPaths: u(checkParentPaths),
    checkParentPathsSync,
    // Misc
    isSrcSubdir,
    areIdentical
  };
  return stat;
}
var copy_1;
var hasRequiredCopy$1;
function requireCopy$1() {
  if (hasRequiredCopy$1) return copy_1;
  hasRequiredCopy$1 = 1;
  const fs2 = /* @__PURE__ */ requireFs();
  const path2 = require$$1;
  const { mkdirs: mkdirs2 } = /* @__PURE__ */ requireMkdirs();
  const { pathExists } = /* @__PURE__ */ requirePathExists();
  const { utimesMillis } = /* @__PURE__ */ requireUtimes();
  const stat2 = /* @__PURE__ */ requireStat();
  async function copy2(src, dest, opts = {}) {
    if (typeof opts === "function") {
      opts = { filter: opts };
    }
    opts.clobber = "clobber" in opts ? !!opts.clobber : true;
    opts.overwrite = "overwrite" in opts ? !!opts.overwrite : opts.clobber;
    if (opts.preserveTimestamps && process.arch === "ia32") {
      process.emitWarning(
        "Using the preserveTimestamps option in 32-bit node is not recommended;\n\n	see https://github.com/jprichardson/node-fs-extra/issues/269",
        "Warning",
        "fs-extra-WARN0001"
      );
    }
    const { srcStat, destStat } = await stat2.checkPaths(src, dest, "copy", opts);
    await stat2.checkParentPaths(src, srcStat, dest, "copy");
    const include = await runFilter(src, dest, opts);
    if (!include) return;
    const destParent = path2.dirname(dest);
    const dirExists = await pathExists(destParent);
    if (!dirExists) {
      await mkdirs2(destParent);
    }
    await getStatsAndPerformCopy(destStat, src, dest, opts);
  }
  async function runFilter(src, dest, opts) {
    if (!opts.filter) return true;
    return opts.filter(src, dest);
  }
  async function getStatsAndPerformCopy(destStat, src, dest, opts) {
    const statFn = opts.dereference ? fs2.stat : fs2.lstat;
    const srcStat = await statFn(src);
    if (srcStat.isDirectory()) return onDir(srcStat, destStat, src, dest, opts);
    if (srcStat.isFile() || srcStat.isCharacterDevice() || srcStat.isBlockDevice()) return onFile(srcStat, destStat, src, dest, opts);
    if (srcStat.isSymbolicLink()) return onLink(destStat, src, dest, opts);
    if (srcStat.isSocket()) throw new Error(`Cannot copy a socket file: ${src}`);
    if (srcStat.isFIFO()) throw new Error(`Cannot copy a FIFO pipe: ${src}`);
    throw new Error(`Unknown file: ${src}`);
  }
  async function onFile(srcStat, destStat, src, dest, opts) {
    if (!destStat) return copyFile(srcStat, src, dest, opts);
    if (opts.overwrite) {
      await fs2.unlink(dest);
      return copyFile(srcStat, src, dest, opts);
    }
    if (opts.errorOnExist) {
      throw new Error(`'${dest}' already exists`);
    }
  }
  async function copyFile(srcStat, src, dest, opts) {
    await fs2.copyFile(src, dest);
    if (opts.preserveTimestamps) {
      if (fileIsNotWritable(srcStat.mode)) {
        await makeFileWritable(dest, srcStat.mode);
      }
      const updatedSrcStat = await fs2.stat(src);
      await utimesMillis(dest, updatedSrcStat.atime, updatedSrcStat.mtime);
    }
    return fs2.chmod(dest, srcStat.mode);
  }
  function fileIsNotWritable(srcMode) {
    return (srcMode & 128) === 0;
  }
  function makeFileWritable(dest, srcMode) {
    return fs2.chmod(dest, srcMode | 128);
  }
  async function onDir(srcStat, destStat, src, dest, opts) {
    if (!destStat) {
      await fs2.mkdir(dest);
    }
    const promises = [];
    for await (const item of await fs2.opendir(src)) {
      const srcItem = path2.join(src, item.name);
      const destItem = path2.join(dest, item.name);
      promises.push(
        runFilter(srcItem, destItem, opts).then((include) => {
          if (include) {
            return stat2.checkPaths(srcItem, destItem, "copy", opts).then(({ destStat: destStat2 }) => {
              return getStatsAndPerformCopy(destStat2, srcItem, destItem, opts);
            });
          }
        })
      );
    }
    await Promise.all(promises);
    if (!destStat) {
      await fs2.chmod(dest, srcStat.mode);
    }
  }
  async function onLink(destStat, src, dest, opts) {
    let resolvedSrc = await fs2.readlink(src);
    if (opts.dereference) {
      resolvedSrc = path2.resolve(process.cwd(), resolvedSrc);
    }
    if (!destStat) {
      return fs2.symlink(resolvedSrc, dest);
    }
    let resolvedDest = null;
    try {
      resolvedDest = await fs2.readlink(dest);
    } catch (e) {
      if (e.code === "EINVAL" || e.code === "UNKNOWN") return fs2.symlink(resolvedSrc, dest);
      throw e;
    }
    if (opts.dereference) {
      resolvedDest = path2.resolve(process.cwd(), resolvedDest);
    }
    if (stat2.isSrcSubdir(resolvedSrc, resolvedDest)) {
      throw new Error(`Cannot copy '${resolvedSrc}' to a subdirectory of itself, '${resolvedDest}'.`);
    }
    if (stat2.isSrcSubdir(resolvedDest, resolvedSrc)) {
      throw new Error(`Cannot overwrite '${resolvedDest}' with '${resolvedSrc}'.`);
    }
    await fs2.unlink(dest);
    return fs2.symlink(resolvedSrc, dest);
  }
  copy_1 = copy2;
  return copy_1;
}
var copySync_1;
var hasRequiredCopySync;
function requireCopySync() {
  if (hasRequiredCopySync) return copySync_1;
  hasRequiredCopySync = 1;
  const fs2 = requireGracefulFs();
  const path2 = require$$1;
  const mkdirsSync = requireMkdirs().mkdirsSync;
  const utimesMillisSync = requireUtimes().utimesMillisSync;
  const stat2 = /* @__PURE__ */ requireStat();
  function copySync(src, dest, opts) {
    if (typeof opts === "function") {
      opts = { filter: opts };
    }
    opts = opts || {};
    opts.clobber = "clobber" in opts ? !!opts.clobber : true;
    opts.overwrite = "overwrite" in opts ? !!opts.overwrite : opts.clobber;
    if (opts.preserveTimestamps && process.arch === "ia32") {
      process.emitWarning(
        "Using the preserveTimestamps option in 32-bit node is not recommended;\n\n	see https://github.com/jprichardson/node-fs-extra/issues/269",
        "Warning",
        "fs-extra-WARN0002"
      );
    }
    const { srcStat, destStat } = stat2.checkPathsSync(src, dest, "copy", opts);
    stat2.checkParentPathsSync(src, srcStat, dest, "copy");
    if (opts.filter && !opts.filter(src, dest)) return;
    const destParent = path2.dirname(dest);
    if (!fs2.existsSync(destParent)) mkdirsSync(destParent);
    return getStats(destStat, src, dest, opts);
  }
  function getStats(destStat, src, dest, opts) {
    const statSync = opts.dereference ? fs2.statSync : fs2.lstatSync;
    const srcStat = statSync(src);
    if (srcStat.isDirectory()) return onDir(srcStat, destStat, src, dest, opts);
    else if (srcStat.isFile() || srcStat.isCharacterDevice() || srcStat.isBlockDevice()) return onFile(srcStat, destStat, src, dest, opts);
    else if (srcStat.isSymbolicLink()) return onLink(destStat, src, dest, opts);
    else if (srcStat.isSocket()) throw new Error(`Cannot copy a socket file: ${src}`);
    else if (srcStat.isFIFO()) throw new Error(`Cannot copy a FIFO pipe: ${src}`);
    throw new Error(`Unknown file: ${src}`);
  }
  function onFile(srcStat, destStat, src, dest, opts) {
    if (!destStat) return copyFile(srcStat, src, dest, opts);
    return mayCopyFile(srcStat, src, dest, opts);
  }
  function mayCopyFile(srcStat, src, dest, opts) {
    if (opts.overwrite) {
      fs2.unlinkSync(dest);
      return copyFile(srcStat, src, dest, opts);
    } else if (opts.errorOnExist) {
      throw new Error(`'${dest}' already exists`);
    }
  }
  function copyFile(srcStat, src, dest, opts) {
    fs2.copyFileSync(src, dest);
    if (opts.preserveTimestamps) handleTimestamps(srcStat.mode, src, dest);
    return setDestMode(dest, srcStat.mode);
  }
  function handleTimestamps(srcMode, src, dest) {
    if (fileIsNotWritable(srcMode)) makeFileWritable(dest, srcMode);
    return setDestTimestamps(src, dest);
  }
  function fileIsNotWritable(srcMode) {
    return (srcMode & 128) === 0;
  }
  function makeFileWritable(dest, srcMode) {
    return setDestMode(dest, srcMode | 128);
  }
  function setDestMode(dest, srcMode) {
    return fs2.chmodSync(dest, srcMode);
  }
  function setDestTimestamps(src, dest) {
    const updatedSrcStat = fs2.statSync(src);
    return utimesMillisSync(dest, updatedSrcStat.atime, updatedSrcStat.mtime);
  }
  function onDir(srcStat, destStat, src, dest, opts) {
    if (!destStat) return mkDirAndCopy(srcStat.mode, src, dest, opts);
    return copyDir(src, dest, opts);
  }
  function mkDirAndCopy(srcMode, src, dest, opts) {
    fs2.mkdirSync(dest);
    copyDir(src, dest, opts);
    return setDestMode(dest, srcMode);
  }
  function copyDir(src, dest, opts) {
    const dir = fs2.opendirSync(src);
    try {
      let dirent;
      while ((dirent = dir.readSync()) !== null) {
        copyDirItem(dirent.name, src, dest, opts);
      }
    } finally {
      dir.closeSync();
    }
  }
  function copyDirItem(item, src, dest, opts) {
    const srcItem = path2.join(src, item);
    const destItem = path2.join(dest, item);
    if (opts.filter && !opts.filter(srcItem, destItem)) return;
    const { destStat } = stat2.checkPathsSync(srcItem, destItem, "copy", opts);
    return getStats(destStat, srcItem, destItem, opts);
  }
  function onLink(destStat, src, dest, opts) {
    let resolvedSrc = fs2.readlinkSync(src);
    if (opts.dereference) {
      resolvedSrc = path2.resolve(process.cwd(), resolvedSrc);
    }
    if (!destStat) {
      return fs2.symlinkSync(resolvedSrc, dest);
    } else {
      let resolvedDest;
      try {
        resolvedDest = fs2.readlinkSync(dest);
      } catch (err) {
        if (err.code === "EINVAL" || err.code === "UNKNOWN") return fs2.symlinkSync(resolvedSrc, dest);
        throw err;
      }
      if (opts.dereference) {
        resolvedDest = path2.resolve(process.cwd(), resolvedDest);
      }
      if (stat2.isSrcSubdir(resolvedSrc, resolvedDest)) {
        throw new Error(`Cannot copy '${resolvedSrc}' to a subdirectory of itself, '${resolvedDest}'.`);
      }
      if (stat2.isSrcSubdir(resolvedDest, resolvedSrc)) {
        throw new Error(`Cannot overwrite '${resolvedDest}' with '${resolvedSrc}'.`);
      }
      return copyLink(resolvedSrc, dest);
    }
  }
  function copyLink(resolvedSrc, dest) {
    fs2.unlinkSync(dest);
    return fs2.symlinkSync(resolvedSrc, dest);
  }
  copySync_1 = copySync;
  return copySync_1;
}
var copy;
var hasRequiredCopy;
function requireCopy() {
  if (hasRequiredCopy) return copy;
  hasRequiredCopy = 1;
  const u = requireUniversalify().fromPromise;
  copy = {
    copy: u(/* @__PURE__ */ requireCopy$1()),
    copySync: /* @__PURE__ */ requireCopySync()
  };
  return copy;
}
var remove_1;
var hasRequiredRemove;
function requireRemove() {
  if (hasRequiredRemove) return remove_1;
  hasRequiredRemove = 1;
  const fs2 = requireGracefulFs();
  const u = requireUniversalify().fromCallback;
  function remove(path2, callback) {
    fs2.rm(path2, { recursive: true, force: true }, callback);
  }
  function removeSync(path2) {
    fs2.rmSync(path2, { recursive: true, force: true });
  }
  remove_1 = {
    remove: u(remove),
    removeSync
  };
  return remove_1;
}
var empty;
var hasRequiredEmpty;
function requireEmpty() {
  if (hasRequiredEmpty) return empty;
  hasRequiredEmpty = 1;
  const u = requireUniversalify().fromPromise;
  const fs2 = /* @__PURE__ */ requireFs();
  const path2 = require$$1;
  const mkdir = /* @__PURE__ */ requireMkdirs();
  const remove = /* @__PURE__ */ requireRemove();
  const emptyDir = u(async function emptyDir2(dir) {
    let items;
    try {
      items = await fs2.readdir(dir);
    } catch {
      return mkdir.mkdirs(dir);
    }
    return Promise.all(items.map((item) => remove.remove(path2.join(dir, item))));
  });
  function emptyDirSync(dir) {
    let items;
    try {
      items = fs2.readdirSync(dir);
    } catch {
      return mkdir.mkdirsSync(dir);
    }
    items.forEach((item) => {
      item = path2.join(dir, item);
      remove.removeSync(item);
    });
  }
  empty = {
    emptyDirSync,
    emptydirSync: emptyDirSync,
    emptyDir,
    emptydir: emptyDir
  };
  return empty;
}
var file;
var hasRequiredFile;
function requireFile() {
  if (hasRequiredFile) return file;
  hasRequiredFile = 1;
  const u = requireUniversalify().fromPromise;
  const path2 = require$$1;
  const fs2 = /* @__PURE__ */ requireFs();
  const mkdir = /* @__PURE__ */ requireMkdirs();
  async function createFile(file2) {
    let stats;
    try {
      stats = await fs2.stat(file2);
    } catch {
    }
    if (stats && stats.isFile()) return;
    const dir = path2.dirname(file2);
    let dirStats = null;
    try {
      dirStats = await fs2.stat(dir);
    } catch (err) {
      if (err.code === "ENOENT") {
        await mkdir.mkdirs(dir);
        await fs2.writeFile(file2, "");
        return;
      } else {
        throw err;
      }
    }
    if (dirStats.isDirectory()) {
      await fs2.writeFile(file2, "");
    } else {
      await fs2.readdir(dir);
    }
  }
  function createFileSync(file2) {
    let stats;
    try {
      stats = fs2.statSync(file2);
    } catch {
    }
    if (stats && stats.isFile()) return;
    const dir = path2.dirname(file2);
    try {
      if (!fs2.statSync(dir).isDirectory()) {
        fs2.readdirSync(dir);
      }
    } catch (err) {
      if (err && err.code === "ENOENT") mkdir.mkdirsSync(dir);
      else throw err;
    }
    fs2.writeFileSync(file2, "");
  }
  file = {
    createFile: u(createFile),
    createFileSync
  };
  return file;
}
var link;
var hasRequiredLink;
function requireLink() {
  if (hasRequiredLink) return link;
  hasRequiredLink = 1;
  const u = requireUniversalify().fromPromise;
  const path2 = require$$1;
  const fs2 = /* @__PURE__ */ requireFs();
  const mkdir = /* @__PURE__ */ requireMkdirs();
  const { pathExists } = /* @__PURE__ */ requirePathExists();
  const { areIdentical } = /* @__PURE__ */ requireStat();
  async function createLink(srcpath, dstpath) {
    let dstStat;
    try {
      dstStat = await fs2.lstat(dstpath);
    } catch {
    }
    let srcStat;
    try {
      srcStat = await fs2.lstat(srcpath);
    } catch (err) {
      err.message = err.message.replace("lstat", "ensureLink");
      throw err;
    }
    if (dstStat && areIdentical(srcStat, dstStat)) return;
    const dir = path2.dirname(dstpath);
    const dirExists = await pathExists(dir);
    if (!dirExists) {
      await mkdir.mkdirs(dir);
    }
    await fs2.link(srcpath, dstpath);
  }
  function createLinkSync(srcpath, dstpath) {
    let dstStat;
    try {
      dstStat = fs2.lstatSync(dstpath);
    } catch {
    }
    try {
      const srcStat = fs2.lstatSync(srcpath);
      if (dstStat && areIdentical(srcStat, dstStat)) return;
    } catch (err) {
      err.message = err.message.replace("lstat", "ensureLink");
      throw err;
    }
    const dir = path2.dirname(dstpath);
    const dirExists = fs2.existsSync(dir);
    if (dirExists) return fs2.linkSync(srcpath, dstpath);
    mkdir.mkdirsSync(dir);
    return fs2.linkSync(srcpath, dstpath);
  }
  link = {
    createLink: u(createLink),
    createLinkSync
  };
  return link;
}
var symlinkPaths_1;
var hasRequiredSymlinkPaths;
function requireSymlinkPaths() {
  if (hasRequiredSymlinkPaths) return symlinkPaths_1;
  hasRequiredSymlinkPaths = 1;
  const path2 = require$$1;
  const fs2 = /* @__PURE__ */ requireFs();
  const { pathExists } = /* @__PURE__ */ requirePathExists();
  const u = requireUniversalify().fromPromise;
  async function symlinkPaths(srcpath, dstpath) {
    if (path2.isAbsolute(srcpath)) {
      try {
        await fs2.lstat(srcpath);
      } catch (err) {
        err.message = err.message.replace("lstat", "ensureSymlink");
        throw err;
      }
      return {
        toCwd: srcpath,
        toDst: srcpath
      };
    }
    const dstdir = path2.dirname(dstpath);
    const relativeToDst = path2.join(dstdir, srcpath);
    const exists = await pathExists(relativeToDst);
    if (exists) {
      return {
        toCwd: relativeToDst,
        toDst: srcpath
      };
    }
    try {
      await fs2.lstat(srcpath);
    } catch (err) {
      err.message = err.message.replace("lstat", "ensureSymlink");
      throw err;
    }
    return {
      toCwd: srcpath,
      toDst: path2.relative(dstdir, srcpath)
    };
  }
  function symlinkPathsSync(srcpath, dstpath) {
    if (path2.isAbsolute(srcpath)) {
      const exists2 = fs2.existsSync(srcpath);
      if (!exists2) throw new Error("absolute srcpath does not exist");
      return {
        toCwd: srcpath,
        toDst: srcpath
      };
    }
    const dstdir = path2.dirname(dstpath);
    const relativeToDst = path2.join(dstdir, srcpath);
    const exists = fs2.existsSync(relativeToDst);
    if (exists) {
      return {
        toCwd: relativeToDst,
        toDst: srcpath
      };
    }
    const srcExists = fs2.existsSync(srcpath);
    if (!srcExists) throw new Error("relative srcpath does not exist");
    return {
      toCwd: srcpath,
      toDst: path2.relative(dstdir, srcpath)
    };
  }
  symlinkPaths_1 = {
    symlinkPaths: u(symlinkPaths),
    symlinkPathsSync
  };
  return symlinkPaths_1;
}
var symlinkType_1;
var hasRequiredSymlinkType;
function requireSymlinkType() {
  if (hasRequiredSymlinkType) return symlinkType_1;
  hasRequiredSymlinkType = 1;
  const fs2 = /* @__PURE__ */ requireFs();
  const u = requireUniversalify().fromPromise;
  async function symlinkType(srcpath, type) {
    if (type) return type;
    let stats;
    try {
      stats = await fs2.lstat(srcpath);
    } catch {
      return "file";
    }
    return stats && stats.isDirectory() ? "dir" : "file";
  }
  function symlinkTypeSync(srcpath, type) {
    if (type) return type;
    let stats;
    try {
      stats = fs2.lstatSync(srcpath);
    } catch {
      return "file";
    }
    return stats && stats.isDirectory() ? "dir" : "file";
  }
  symlinkType_1 = {
    symlinkType: u(symlinkType),
    symlinkTypeSync
  };
  return symlinkType_1;
}
var symlink;
var hasRequiredSymlink;
function requireSymlink() {
  if (hasRequiredSymlink) return symlink;
  hasRequiredSymlink = 1;
  const u = requireUniversalify().fromPromise;
  const path2 = require$$1;
  const fs2 = /* @__PURE__ */ requireFs();
  const { mkdirs: mkdirs2, mkdirsSync } = /* @__PURE__ */ requireMkdirs();
  const { symlinkPaths, symlinkPathsSync } = /* @__PURE__ */ requireSymlinkPaths();
  const { symlinkType, symlinkTypeSync } = /* @__PURE__ */ requireSymlinkType();
  const { pathExists } = /* @__PURE__ */ requirePathExists();
  const { areIdentical } = /* @__PURE__ */ requireStat();
  async function createSymlink(srcpath, dstpath, type) {
    let stats;
    try {
      stats = await fs2.lstat(dstpath);
    } catch {
    }
    if (stats && stats.isSymbolicLink()) {
      const [srcStat, dstStat] = await Promise.all([
        fs2.stat(srcpath),
        fs2.stat(dstpath)
      ]);
      if (areIdentical(srcStat, dstStat)) return;
    }
    const relative = await symlinkPaths(srcpath, dstpath);
    srcpath = relative.toDst;
    const toType = await symlinkType(relative.toCwd, type);
    const dir = path2.dirname(dstpath);
    if (!await pathExists(dir)) {
      await mkdirs2(dir);
    }
    return fs2.symlink(srcpath, dstpath, toType);
  }
  function createSymlinkSync(srcpath, dstpath, type) {
    let stats;
    try {
      stats = fs2.lstatSync(dstpath);
    } catch {
    }
    if (stats && stats.isSymbolicLink()) {
      const srcStat = fs2.statSync(srcpath);
      const dstStat = fs2.statSync(dstpath);
      if (areIdentical(srcStat, dstStat)) return;
    }
    const relative = symlinkPathsSync(srcpath, dstpath);
    srcpath = relative.toDst;
    type = symlinkTypeSync(relative.toCwd, type);
    const dir = path2.dirname(dstpath);
    const exists = fs2.existsSync(dir);
    if (exists) return fs2.symlinkSync(srcpath, dstpath, type);
    mkdirsSync(dir);
    return fs2.symlinkSync(srcpath, dstpath, type);
  }
  symlink = {
    createSymlink: u(createSymlink),
    createSymlinkSync
  };
  return symlink;
}
var ensure;
var hasRequiredEnsure;
function requireEnsure() {
  if (hasRequiredEnsure) return ensure;
  hasRequiredEnsure = 1;
  const { createFile, createFileSync } = /* @__PURE__ */ requireFile();
  const { createLink, createLinkSync } = /* @__PURE__ */ requireLink();
  const { createSymlink, createSymlinkSync } = /* @__PURE__ */ requireSymlink();
  ensure = {
    // file
    createFile,
    createFileSync,
    ensureFile: createFile,
    ensureFileSync: createFileSync,
    // link
    createLink,
    createLinkSync,
    ensureLink: createLink,
    ensureLinkSync: createLinkSync,
    // symlink
    createSymlink,
    createSymlinkSync,
    ensureSymlink: createSymlink,
    ensureSymlinkSync: createSymlinkSync
  };
  return ensure;
}
var utils;
var hasRequiredUtils;
function requireUtils() {
  if (hasRequiredUtils) return utils;
  hasRequiredUtils = 1;
  function stringify(obj, { EOL = "\n", finalEOL = true, replacer = null, spaces } = {}) {
    const EOF = finalEOL ? EOL : "";
    const str = JSON.stringify(obj, replacer, spaces);
    return str.replace(/\n/g, EOL) + EOF;
  }
  function stripBom(content) {
    if (Buffer.isBuffer(content)) content = content.toString("utf8");
    return content.replace(/^\uFEFF/, "");
  }
  utils = { stringify, stripBom };
  return utils;
}
var jsonfile_1;
var hasRequiredJsonfile$1;
function requireJsonfile$1() {
  if (hasRequiredJsonfile$1) return jsonfile_1;
  hasRequiredJsonfile$1 = 1;
  let _fs;
  try {
    _fs = requireGracefulFs();
  } catch (_) {
    _fs = require$$0$2;
  }
  const universalify2 = requireUniversalify();
  const { stringify, stripBom } = requireUtils();
  async function _readFile(file2, options = {}) {
    if (typeof options === "string") {
      options = { encoding: options };
    }
    const fs2 = options.fs || _fs;
    const shouldThrow = "throws" in options ? options.throws : true;
    let data = await universalify2.fromCallback(fs2.readFile)(file2, options);
    data = stripBom(data);
    let obj;
    try {
      obj = JSON.parse(data, options ? options.reviver : null);
    } catch (err) {
      if (shouldThrow) {
        err.message = `${file2}: ${err.message}`;
        throw err;
      } else {
        return null;
      }
    }
    return obj;
  }
  const readFile = universalify2.fromPromise(_readFile);
  function readFileSync(file2, options = {}) {
    if (typeof options === "string") {
      options = { encoding: options };
    }
    const fs2 = options.fs || _fs;
    const shouldThrow = "throws" in options ? options.throws : true;
    try {
      let content = fs2.readFileSync(file2, options);
      content = stripBom(content);
      return JSON.parse(content, options.reviver);
    } catch (err) {
      if (shouldThrow) {
        err.message = `${file2}: ${err.message}`;
        throw err;
      } else {
        return null;
      }
    }
  }
  async function _writeFile(file2, obj, options = {}) {
    const fs2 = options.fs || _fs;
    const str = stringify(obj, options);
    await universalify2.fromCallback(fs2.writeFile)(file2, str, options);
  }
  const writeFile = universalify2.fromPromise(_writeFile);
  function writeFileSync(file2, obj, options = {}) {
    const fs2 = options.fs || _fs;
    const str = stringify(obj, options);
    return fs2.writeFileSync(file2, str, options);
  }
  const jsonfile2 = {
    readFile,
    readFileSync,
    writeFile,
    writeFileSync
  };
  jsonfile_1 = jsonfile2;
  return jsonfile_1;
}
var jsonfile;
var hasRequiredJsonfile;
function requireJsonfile() {
  if (hasRequiredJsonfile) return jsonfile;
  hasRequiredJsonfile = 1;
  const jsonFile = requireJsonfile$1();
  jsonfile = {
    // jsonfile exports
    readJson: jsonFile.readFile,
    readJsonSync: jsonFile.readFileSync,
    writeJson: jsonFile.writeFile,
    writeJsonSync: jsonFile.writeFileSync
  };
  return jsonfile;
}
var outputFile_1;
var hasRequiredOutputFile;
function requireOutputFile() {
  if (hasRequiredOutputFile) return outputFile_1;
  hasRequiredOutputFile = 1;
  const u = requireUniversalify().fromPromise;
  const fs2 = /* @__PURE__ */ requireFs();
  const path2 = require$$1;
  const mkdir = /* @__PURE__ */ requireMkdirs();
  const pathExists = requirePathExists().pathExists;
  async function outputFile(file2, data, encoding = "utf-8") {
    const dir = path2.dirname(file2);
    if (!await pathExists(dir)) {
      await mkdir.mkdirs(dir);
    }
    return fs2.writeFile(file2, data, encoding);
  }
  function outputFileSync(file2, ...args) {
    const dir = path2.dirname(file2);
    if (!fs2.existsSync(dir)) {
      mkdir.mkdirsSync(dir);
    }
    fs2.writeFileSync(file2, ...args);
  }
  outputFile_1 = {
    outputFile: u(outputFile),
    outputFileSync
  };
  return outputFile_1;
}
var outputJson_1;
var hasRequiredOutputJson;
function requireOutputJson() {
  if (hasRequiredOutputJson) return outputJson_1;
  hasRequiredOutputJson = 1;
  const { stringify } = requireUtils();
  const { outputFile } = /* @__PURE__ */ requireOutputFile();
  async function outputJson(file2, data, options = {}) {
    const str = stringify(data, options);
    await outputFile(file2, str, options);
  }
  outputJson_1 = outputJson;
  return outputJson_1;
}
var outputJsonSync_1;
var hasRequiredOutputJsonSync;
function requireOutputJsonSync() {
  if (hasRequiredOutputJsonSync) return outputJsonSync_1;
  hasRequiredOutputJsonSync = 1;
  const { stringify } = requireUtils();
  const { outputFileSync } = /* @__PURE__ */ requireOutputFile();
  function outputJsonSync(file2, data, options) {
    const str = stringify(data, options);
    outputFileSync(file2, str, options);
  }
  outputJsonSync_1 = outputJsonSync;
  return outputJsonSync_1;
}
var json;
var hasRequiredJson;
function requireJson() {
  if (hasRequiredJson) return json;
  hasRequiredJson = 1;
  const u = requireUniversalify().fromPromise;
  const jsonFile = /* @__PURE__ */ requireJsonfile();
  jsonFile.outputJson = u(/* @__PURE__ */ requireOutputJson());
  jsonFile.outputJsonSync = /* @__PURE__ */ requireOutputJsonSync();
  jsonFile.outputJSON = jsonFile.outputJson;
  jsonFile.outputJSONSync = jsonFile.outputJsonSync;
  jsonFile.writeJSON = jsonFile.writeJson;
  jsonFile.writeJSONSync = jsonFile.writeJsonSync;
  jsonFile.readJSON = jsonFile.readJson;
  jsonFile.readJSONSync = jsonFile.readJsonSync;
  json = jsonFile;
  return json;
}
var move_1;
var hasRequiredMove$1;
function requireMove$1() {
  if (hasRequiredMove$1) return move_1;
  hasRequiredMove$1 = 1;
  const fs2 = /* @__PURE__ */ requireFs();
  const path2 = require$$1;
  const { copy: copy2 } = /* @__PURE__ */ requireCopy();
  const { remove } = /* @__PURE__ */ requireRemove();
  const { mkdirp } = /* @__PURE__ */ requireMkdirs();
  const { pathExists } = /* @__PURE__ */ requirePathExists();
  const stat2 = /* @__PURE__ */ requireStat();
  async function move2(src, dest, opts = {}) {
    const overwrite = opts.overwrite || opts.clobber || false;
    const { srcStat, isChangingCase = false } = await stat2.checkPaths(src, dest, "move", opts);
    await stat2.checkParentPaths(src, srcStat, dest, "move");
    const destParent = path2.dirname(dest);
    const parsedParentPath = path2.parse(destParent);
    if (parsedParentPath.root !== destParent) {
      await mkdirp(destParent);
    }
    return doRename(src, dest, overwrite, isChangingCase);
  }
  async function doRename(src, dest, overwrite, isChangingCase) {
    if (!isChangingCase) {
      if (overwrite) {
        await remove(dest);
      } else if (await pathExists(dest)) {
        throw new Error("dest already exists.");
      }
    }
    try {
      await fs2.rename(src, dest);
    } catch (err) {
      if (err.code !== "EXDEV") {
        throw err;
      }
      await moveAcrossDevice(src, dest, overwrite);
    }
  }
  async function moveAcrossDevice(src, dest, overwrite) {
    const opts = {
      overwrite,
      errorOnExist: true,
      preserveTimestamps: true
    };
    await copy2(src, dest, opts);
    return remove(src);
  }
  move_1 = move2;
  return move_1;
}
var moveSync_1;
var hasRequiredMoveSync;
function requireMoveSync() {
  if (hasRequiredMoveSync) return moveSync_1;
  hasRequiredMoveSync = 1;
  const fs2 = requireGracefulFs();
  const path2 = require$$1;
  const copySync = requireCopy().copySync;
  const removeSync = requireRemove().removeSync;
  const mkdirpSync = requireMkdirs().mkdirpSync;
  const stat2 = /* @__PURE__ */ requireStat();
  function moveSync(src, dest, opts) {
    opts = opts || {};
    const overwrite = opts.overwrite || opts.clobber || false;
    const { srcStat, isChangingCase = false } = stat2.checkPathsSync(src, dest, "move", opts);
    stat2.checkParentPathsSync(src, srcStat, dest, "move");
    if (!isParentRoot(dest)) mkdirpSync(path2.dirname(dest));
    return doRename(src, dest, overwrite, isChangingCase);
  }
  function isParentRoot(dest) {
    const parent = path2.dirname(dest);
    const parsedPath = path2.parse(parent);
    return parsedPath.root === parent;
  }
  function doRename(src, dest, overwrite, isChangingCase) {
    if (isChangingCase) return rename(src, dest, overwrite);
    if (overwrite) {
      removeSync(dest);
      return rename(src, dest, overwrite);
    }
    if (fs2.existsSync(dest)) throw new Error("dest already exists.");
    return rename(src, dest, overwrite);
  }
  function rename(src, dest, overwrite) {
    try {
      fs2.renameSync(src, dest);
    } catch (err) {
      if (err.code !== "EXDEV") throw err;
      return moveAcrossDevice(src, dest, overwrite);
    }
  }
  function moveAcrossDevice(src, dest, overwrite) {
    const opts = {
      overwrite,
      errorOnExist: true,
      preserveTimestamps: true
    };
    copySync(src, dest, opts);
    return removeSync(src);
  }
  moveSync_1 = moveSync;
  return moveSync_1;
}
var move;
var hasRequiredMove;
function requireMove() {
  if (hasRequiredMove) return move;
  hasRequiredMove = 1;
  const u = requireUniversalify().fromPromise;
  move = {
    move: u(/* @__PURE__ */ requireMove$1()),
    moveSync: /* @__PURE__ */ requireMoveSync()
  };
  return move;
}
var lib;
var hasRequiredLib;
function requireLib() {
  if (hasRequiredLib) return lib;
  hasRequiredLib = 1;
  lib = {
    // Export promiseified graceful-fs:
    .../* @__PURE__ */ requireFs(),
    // Export extra methods:
    .../* @__PURE__ */ requireCopy(),
    .../* @__PURE__ */ requireEmpty(),
    .../* @__PURE__ */ requireEnsure(),
    .../* @__PURE__ */ requireJson(),
    .../* @__PURE__ */ requireMkdirs(),
    .../* @__PURE__ */ requireMove(),
    .../* @__PURE__ */ requireOutputFile(),
    .../* @__PURE__ */ requirePathExists(),
    .../* @__PURE__ */ requireRemove()
  };
  return lib;
}
var libExports = /* @__PURE__ */ requireLib();
const fs = /* @__PURE__ */ getDefaultExportFromCjs(libExports);
let currentFFmpegCommand$1 = null;
class VideoAudioConverService {
  taskQueue = [];
  // 任务队列
  isProcessing = false;
  // 是否正在处理任务
  constructor() {
  }
  /**
   * 获取媒体文件信息
   * @param filePaths 媒体文件路径列表
   * @returns 媒体文件信息列表
   */
  async getFilesMediaInfo(filePaths) {
    try {
      const fileInfoPromises = filePaths.map(async (filePath) => {
        try {
          const mediaInfo = await getFilePathMediaInfo(filePath);
          const isImage = await isImageFile(filePath);
          if ((isImage || mediaInfo.format.nb_frames === 1) && !filePath.endsWith(".mjpeg")) {
            return {
              duration: null,
              width: mediaInfo.streams.find((stream) => stream.width)?.width,
              height: mediaInfo.streams.find((stream) => stream.height)?.height,
              fileType: "image",
              filePath,
              name: path.basename(filePath, path.extname(filePath)),
              // 获取文件扩展名不包含点
              extname: path.extname(filePath).slice(1)
            };
          }
          const hasVideoStream = mediaInfo.streams.some((stream) => stream.codec_type === "video" && stream.disposition?.attached_pic !== 1);
          if (hasVideoStream) {
            return {
              // 如果转数字失败，则设置为null
              duration: Number.isNaN(Number(mediaInfo.format.duration)) ? null : Number(mediaInfo.format.duration),
              width: mediaInfo.streams.find((stream) => stream.width)?.width,
              height: mediaInfo.streams.find((stream) => stream.height)?.height,
              fileType: "video",
              filePath,
              name: path.basename(filePath, path.extname(filePath)),
              // 获取文件扩展名不包含点
              extname: path.extname(filePath).slice(1)
            };
          }
          const hasAudioStream = mediaInfo.streams.some((stream) => stream.codec_type === "audio");
          if (hasAudioStream) {
            return {
              // 如果转数字失败，则设置为null
              duration: Number.isNaN(Number(mediaInfo.format.duration)) ? null : Number(mediaInfo.format.duration),
              width: mediaInfo.streams.find((stream) => stream.width)?.width,
              height: mediaInfo.streams.find((stream) => stream.height)?.height,
              fileType: "audio",
              filePath,
              name: path.basename(filePath, path.extname(filePath)),
              // 获取文件扩展名不包含点
              extname: path.extname(filePath).slice(1)
            };
          }
          return null;
        } catch {
          return null;
        }
      });
      const fileInfos = await Promise.all(fileInfoPromises);
      const validFileInfos = fileInfos.filter((info) => info !== null);
      return validFileInfos;
    } catch (error) {
      console.error("获取媒体信息失败:", error);
      return [];
    }
  }
  /**
   * 转换文件
   * @param filePaths 文件路径列表
   * @param outputFormat 输出格式
   * @param outputDir 输出目录
   * @param extraParams 额外参数
   * @returns 转换结果
   */
  async convertMediaFiles(filePaths, outputFormat, outputDir, extraParams) {
    try {
      await this.stopCurrentConvertTask();
      await fs.ensureDir(outputDir);
      for (const filePath of filePaths) {
        this.addTaskToQueue({
          id: filePath,
          filePath,
          outputFormat,
          outputDir,
          extraParams,
          status: "waiting"
        });
      }
      this.processQueue();
      return filePaths;
    } catch (error) {
      console.error("添加转换任务失败:", error);
      return [];
    }
  }
  /**
   * 添加任务到队列
   * @param task 转换任务
   */
  addTaskToQueue(task2) {
    const existingTaskIndex = this.taskQueue.findIndex((t2) => t2.id === task2.id);
    if (existingTaskIndex !== -1) {
      if (this.taskQueue[existingTaskIndex].status !== "waiting") {
        return;
      }
      this.taskQueue[existingTaskIndex] = task2;
    } else {
      this.taskQueue.push(task2);
    }
    this.sendTaskStatusUpdate(task2.id, "waiting");
  }
  /**
   * 处理队列中的任务
   */
  async processQueue() {
    if (this.isProcessing) {
      return;
    }
    this.isProcessing = true;
    while (this.taskQueue.length > 0) {
      const taskIndex = this.taskQueue.findIndex((task22) => task22.status === "waiting");
      if (taskIndex === -1) {
        break;
      }
      const task2 = this.taskQueue[taskIndex];
      try {
        this.taskQueue[taskIndex].status = "converting";
        this.sendTaskStatusUpdate(task2.id, "converting");
        const fileName = path.basename(task2.filePath, path.extname(task2.filePath));
        const outputBasePath = path.join(task2.outputDir, fileName);
        const outputExt = `.${task2.outputFormat}`;
        const randomTempName = `${fileName}_${Date.now()}_${Math.floor(Math.random() * 1e4)}`;
        const tempDir = path.join(task2.outputDir, ".snapany", "conver_temp");
        await fs.ensureDir(tempDir);
        await this.cleanTempDir(tempDir);
        const outputTempPath = path.join(tempDir, `${randomTempName}${outputExt}`);
        const command = ffmpeg(task2.filePath);
        currentFFmpegCommand$1 = command;
        if (task2.extraParams) {
          command.outputOptions(task2.extraParams);
        }
        const inputExt = path.extname(task2.filePath).toLowerCase();
        const outputFormat = task2.outputFormat.toLowerCase();
        if (inputExt === ".gif" && outputFormat !== "webp") {
          console.log("检测到GIF转换为非Webp格式，将只保留第一帧");
          command.outputOptions(["-vframes", "1"]);
        }
        command.output(outputTempPath);
        const result = await this.executeFFmpegCommand(command, outputBasePath, outputTempPath, outputExt, task2.id);
        if (result.success && result.outputPath) {
          this.taskQueue[taskIndex].status = "completed";
          this.taskQueue[taskIndex].outputPath = result.outputPath;
          this.sendTaskStatusUpdate(task2.id, "completed", void 0, result.outputPath);
        } else {
          this.taskQueue[taskIndex].status = "failed";
          this.taskQueue[taskIndex].error = result.error;
          this.sendTaskStatusUpdate(task2.id, "failed", result.error);
        }
      } catch (error) {
        this.taskQueue[taskIndex].status = "failed";
        this.taskQueue[taskIndex].error = error.message;
        this.sendTaskStatusUpdate(task2.id, "failed", error.message);
        console.error(`转换文件 ${task2.filePath} 失败:`, error);
      }
    }
    this.isProcessing = false;
    currentFFmpegCommand$1 = null;
  }
  /**
   * 发送任务状态更新
   * @param taskId 任务ID
   * @param status 任务状态
   * @param error 错误信息
   * @param outputPath 输出路径
   */
  sendTaskStatusUpdate(taskId, status, error, outputPath) {
    const mainWindow2 = getMainWindow();
    const handlers = main.getRendererHandlers(mainWindow2?.webContents);
    if (handlers && handlers.onVideoAudioConverProgress && handlers.onVideoAudioConverProgress.send) {
      const updateData = {
        id: taskId,
        status
      };
      if (error) {
        updateData.error = error;
      }
      if (outputPath) {
        updateData.outputPath = outputPath;
        updateData.outputExt = path.extname(outputPath).slice(1);
      }
      handlers.onVideoAudioConverProgress.send(updateData);
    }
  }
  /**
   * 停止当前正在进行的转换任务和所有待转换任务
   * @returns 停止结果，包含成功状态和可能的错误信息
   */
  async stopCurrentConvertTask() {
    try {
      if (currentFFmpegCommand$1) {
        await new Promise((resolve) => {
          const command = currentFFmpegCommand$1;
          const originalErrorHandler = command.listeners("error")[0];
          command.removeAllListeners("error");
          command.on("error", (err) => {
            if (err.message && err.message.includes("SIGKILL")) {
              console.log("FFmpeg进程已成功终止");
              resolve();
            } else if (originalErrorHandler) {
              originalErrorHandler(err);
              resolve();
            } else {
              resolve();
            }
          });
          command.kill("SIGKILL");
        });
        currentFFmpegCommand$1 = null;
      }
      const tasksToCleanDir = this.taskQueue.map((task2) => task2.outputDir);
      this.taskQueue = [];
      this.isProcessing = false;
      await this.cleanAllTempDirs(tasksToCleanDir);
      console.log("已停止所有转换任务并清空队列");
      return {
        success: true
      };
    } catch (error) {
      console.error("停止转换任务时出错:", error);
      return {
        success: false,
        error: `停止任务失败: ${error.message}`
      };
    }
  }
  /**
   * 清理所有临时目录
   * @private
   */
  async cleanAllTempDirs(outputDirs) {
    try {
      for (const outputDir of outputDirs) {
        const tempDir = path.join(outputDir, ".snapany", "conver_temp");
        await this.cleanTempDir(tempDir);
      }
      console.log("所有临时目录已清理");
    } catch (error) {
      console.error("清理所有临时目录失败:", error);
    }
  }
  /**
   * 清理临时目录
   * @private
   * @param tempDir 临时目录路径
   */
  async cleanTempDir(tempDir) {
    try {
      await fs.ensureDir(tempDir);
      const files = await fs.readdir(tempDir);
      for (const file2 of files) {
        await fs.remove(path.join(tempDir, file2));
      }
      console.log("临时目录已清理:", tempDir);
    } catch (error) {
      console.error("清理临时目录失败:", error);
    }
  }
  /**
   * 执行FFmpeg命令
   * @private
   * @param command FFmpeg命令实例
   * @param outputBasePath 输出文件基本路径（不含扩展名）
   * @param outputTempPath 临时输出文件路径
   * @param outputExt 输出文件扩展名
   * @param taskId 任务ID
   * @returns 执行结果
   */
  async executeFFmpegCommand(command, outputBasePath, outputTempPath, outputExt, taskId) {
    return new Promise((resolve) => {
      command.on("start", (commandLine) => {
        console.log("转换开始:", commandLine);
      }).on("progress", (progress) => {
        console.log("转换进度:", progress.percent);
        const mainWindow2 = getMainWindow();
        const handlers = main.getRendererHandlers(mainWindow2?.webContents);
        if (handlers && handlers.onVideoAudioConverProgress && handlers.onVideoAudioConverProgress.send) {
          handlers.onVideoAudioConverProgress.send({
            id: taskId,
            status: "converting",
            progress: progress.percent
          });
        }
      }).on("error", async (err) => {
        console.error("FFmpeg错误:", err);
        currentFFmpegCommand$1 = null;
        const tempDir = path.dirname(outputTempPath);
        await this.cleanTempDir(tempDir);
        let errorMessage = err.message;
        if (typeof errorMessage === "string" && errorMessage.includes("ffmpeg exited with code")) {
          const lastColonIndex = errorMessage.lastIndexOf(":");
          if (lastColonIndex !== -1) {
            errorMessage = errorMessage.substring(lastColonIndex + 1).trim();
          }
        }
        resolve({
          success: false,
          error: errorMessage
        });
      }).on("end", async () => {
        console.log("FFmpeg处理完成");
        currentFFmpegCommand$1 = null;
        let finalOutputPath = `${outputBasePath}${outputExt}`;
        let counter = 1;
        while (await fs.pathExists(finalOutputPath)) {
          finalOutputPath = `${outputBasePath}(${counter})${outputExt}`;
          counter++;
        }
        try {
          await fs.move(outputTempPath, finalOutputPath, { overwrite: false });
          const tempDir = path.dirname(outputTempPath);
          await this.cleanTempDir(tempDir);
          resolve({
            success: true,
            outputPath: finalOutputPath
          });
        } catch (error) {
          console.error("移动文件失败:", error);
          const tempDir = path.dirname(outputTempPath);
          await this.cleanTempDir(tempDir);
          resolve({
            success: false,
            error: `移动文件失败: ${error.message}`
          });
        }
      }).run();
    });
  }
}
const VideoAudioConverService$1 = new VideoAudioConverService();
const videoAudioConverRoute = {
  /**
   * 获取需转换的文件信息
   * @param filePathArray 文件路径数组
   * @param format 转换类型
   * @returns
   */
  getMediaFormatConvertInfo: t.procedure.input().action(async ({ input }) => {
    const { filePaths, format } = input;
    if (!filePaths || filePaths.length === 0) {
      return {
        success: false,
        data: []
      };
    }
    const validFileInfos = await VideoAudioConverService$1.getFilesMediaInfo(filePaths);
    const targetMediaType = format || validFileInfos[0]?.fileType;
    if (!targetMediaType) {
      return {
        success: false,
        data: validFileInfos
      };
    }
    const filteredFiles = validFileInfos.filter((info) => info.fileType === targetMediaType);
    return {
      success: filteredFiles.length > 0,
      data: filteredFiles,
      targetMediaType
    };
  }),
  /**
   * 转换文件
   * @param filePaths 文件路径
   * @param outputFormat 输出格式
   * @returns
   */
  convertMediaFile: t.procedure.input().action(async ({ input }) => {
    const { filePaths, outputFormat, extraParams } = input;
    const setting = SettingService$1.getSetting();
    const outputDir = setting.downloadPath;
    VideoAudioConverService$1.convertMediaFiles(filePaths, outputFormat, outputDir, extraParams);
    return "开始转换";
  }),
  /**
   * 停止转换
   */
  stopConvert: t.procedure.action(async () => {
    VideoAudioConverService$1.stopCurrentConvertTask();
  })
};
let currentFFmpegCommand = null;
class VideoAudioMergeService {
  constructor() {
  }
  /**
   * 获取媒体文件信息
   * @param filePaths 媒体文件路径列表
   * @returns 媒体文件信息对象，键为文件路径，值为对应的媒体信息
   */
  async getFilesMediaInfo(filePaths) {
    try {
      const mediaInfoList = [];
      for (const filePath of filePaths) {
        const isImage = await isImageFile(filePath);
        if (isImage) {
          continue;
        }
        const mediaInfo = await getFilePathMediaInfo(filePath);
        mediaInfoList.push({
          name: path.basename(filePath, path.extname(filePath)),
          filePath,
          children: mediaInfo.streams.map((stream) => {
            if (stream.codec_type === "video") {
              if (stream.disposition.attached_pic !== 1) {
                return {
                  id: stream.index.toString(),
                  codec_type: stream.codec_type || "",
                  duration: Number(stream.duration) || Number(mediaInfo.format.duration) || "",
                  codec_name: stream.codec_name || ""
                };
              }
              return void 0;
            } else {
              return {
                id: stream.index.toString(),
                codec_type: stream.codec_type || "",
                duration: Number(stream.duration) || Number(mediaInfo.format.duration) || "",
                codec_name: stream.codec_name || ""
              };
            }
          }).filter((item) => item !== void 0)
          // 过滤掉undefined的项
        });
      }
      return mediaInfoList;
    } catch (error) {
      console.error("获取媒体信息失败:", error);
      return [];
    }
  }
  /**
   * 合并视频和音频流
   * @param streamSelection 选择的媒体流信息
   * @param outputDir 输出目录
   * @param outputFormat 输出格式
   * @returns 合并结果
   */
  async mergeMediaStreams(streamSelection, outputDir, outputFormat) {
    try {
      if (currentFFmpegCommand) {
        this.stopCurrentMergeTask();
      }
      const inputFiles = streamSelection.input.map((item) => item.filePath);
      if (inputFiles.length === 0) {
        return {
          success: false,
          error: "没有选择任何文件"
        };
      }
      const outputPath = await this.prepareOutputPath(outputDir, streamSelection.name, `.${outputFormat}`);
      const outputTempPath = await this.prepareOutputPath(`${outputDir}/.snapany`, `${streamSelection.name}_merge`, `.${outputFormat}`);
      const command = ffmpeg();
      currentFFmpegCommand = command;
      const mappings = this.createInputMappings(command, streamSelection.input);
      const outputOptions = await this.configureOutputOptions(mappings, `.${outputFormat}`, streamSelection.input, inputFiles);
      command.outputOptions(outputOptions);
      command.output(outputTempPath);
      return await this.executeFFmpegCommand(command, outputPath, outputTempPath);
    } catch (error) {
      console.error("合并媒体流错误:", error);
      currentFFmpegCommand = null;
      return {
        success: false,
        error: `合并过程中发生错误: ${error.message}`
      };
    }
  }
  /**
   * 停止当前正在进行的合并任务
   * @returns 停止结果，包含成功状态和可能的错误信息
   */
  stopCurrentMergeTask() {
    try {
      if (!currentFFmpegCommand) {
        return {
          success: false,
          error: "没有正在进行的合并任务"
        };
      }
      currentFFmpegCommand.kill("SIGKILL");
      console.log("已停止合并任务");
      currentFFmpegCommand = null;
      return {
        success: true
      };
    } catch (error) {
      console.error("停止合并任务时出错:", error);
      return {
        success: false,
        error: `停止任务失败: ${error.message}`
      };
    }
  }
  /**
   * 准备输出文件路径
   * @private
   * @param outputDir 输出目录
   * @param fileName 文件名
   * @param outputExt 输出文件扩展名
   * @returns 准备好的输出路径
   */
  async prepareOutputPath(outputDir, fileName, outputExt) {
    await fs.ensureDir(outputDir);
    let outputPath = path.join(outputDir, `${fileName}${outputExt}`);
    let counter = 1;
    const ext = outputExt;
    const nameWithoutExt = path.join(outputDir, fileName);
    while (await fs.pathExists(outputPath)) {
      outputPath = `${nameWithoutExt}_${counter}${ext}`;
      counter++;
    }
    return outputPath;
  }
  /**
   * 创建输入映射
   * @private
   * @param command FFmpeg命令实例
   * @param streamSelection 媒体流选择
   * @returns 创建的映射数组
   */
  createInputMappings(command, streamSelection) {
    const mappings = [];
    for (const item of streamSelection) {
      command.input(item.filePath);
      const inputIndex = streamSelection.indexOf(item);
      for (const streamIndex of item.ids) {
        mappings.push(`${inputIndex}:${streamIndex}`);
      }
    }
    return mappings;
  }
  /**
   * 配置输出选项
   * @private
   * @param mappings 流映射
   * @param outputExt 输出文件扩展名
   * @param streamSelection 媒体流选择
   * @param inputFiles 输入文件数组
   * @returns 配置好的输出选项数组
   */
  async configureOutputOptions(mappings, outputExt, streamSelection, inputFiles) {
    const outputOptions = [];
    mappings.forEach((mapping) => {
      outputOptions.push("-map", mapping);
    });
    const videoStreamInfo = await this.findVideoStreamInfo(inputFiles, streamSelection);
    if (videoStreamInfo && !Number.isNaN(videoStreamInfo.duration)) {
      console.log(`使用视频流时长作为输出文件时长: ${videoStreamInfo.duration}秒`);
      outputOptions.push("-t", videoStreamInfo.duration.toString());
    }
    if (outputExt === ".mkv") {
      outputOptions.push("-c:v", "copy");
      outputOptions.push("-c:a", "copy");
      outputOptions.push("-c:s", "srt");
    } else {
      outputOptions.push("-c:s", "mov_text");
      const { needVideoTranscode, needAudioTranscode } = await this.checkTranscodeNeeds(inputFiles, streamSelection);
      if (needVideoTranscode) {
        outputOptions.push("-c:v", "libx264");
      } else {
        outputOptions.push("-c:v", "copy");
      }
      if (needAudioTranscode) {
        outputOptions.push("-c:a", "aac");
      } else {
        outputOptions.push("-c:a", "copy");
      }
    }
    return outputOptions;
  }
  /**
   * 查找视频流并获取其时长信息
   * @private
   * @param inputFiles 输入文件数组
   * @param streamSelection 媒体流选择
   * @returns 视频流信息，包含时长
   */
  async findVideoStreamInfo(inputFiles, streamSelection) {
    const streamPromises = inputFiles.map((filePath) => getFilePathMediaInfo(filePath));
    const allFileStreams = await Promise.all(streamPromises);
    for (let i = 0; i < inputFiles.length; i++) {
      const filePath = inputFiles[i];
      const fileStreams = allFileStreams[i].streams || [];
      const selectedStreamIndices = streamSelection.find((item) => item.filePath === filePath)?.ids || [];
      for (const streamIndex of selectedStreamIndices) {
        const streamIdNumber = Number.parseInt(streamIndex, 10);
        if (!Number.isNaN(streamIdNumber) && streamIdNumber >= 0 && streamIdNumber < fileStreams.length) {
          const stream = fileStreams[streamIdNumber];
          if (stream.codec_type === "video" && stream.duration) {
            return { duration: Number(stream.duration) };
          }
        }
      }
    }
    return null;
  }
  /**
   * 检查是否需要进行视频或音频转码
   * @private
   * @param inputFiles 输入文件数组
   * @param streamSelection 媒体流选择
   * @returns 检查结果，包含是否需要视频转码和音频转码
   */
  async checkTranscodeNeeds(inputFiles, streamSelection) {
    let needVideoTranscode = false;
    let needAudioTranscode = false;
    const streamPromises = inputFiles.map((filePath) => getFilePathMediaInfo(filePath));
    const allFileStreams = await Promise.all(streamPromises);
    for (let i = 0; i < inputFiles.length; i++) {
      const filePath = inputFiles[i];
      const fileStreams = allFileStreams[i].streams || [];
      const selectedStreamIndices = streamSelection.find((item) => item.filePath === filePath)?.ids || [];
      for (const streamIndex of selectedStreamIndices) {
        const streamIdNumber = Number.parseInt(streamIndex, 10);
        if (!Number.isNaN(streamIdNumber) && streamIdNumber >= 0 && streamIdNumber < fileStreams.length) {
          const stream = fileStreams[streamIdNumber];
          if (stream.codec_type === "video") {
            if (!["h264", "hevc"].some((codec) => stream.codec_name?.includes(codec))) {
              needVideoTranscode = true;
            }
          } else if (stream.codec_type === "audio") {
            if (!["aac", "mp3"].some((codec) => stream.codec_name?.includes(codec))) {
              needAudioTranscode = true;
            }
          }
        }
      }
    }
    return { needVideoTranscode, needAudioTranscode };
  }
  /**
   * 执行FFmpeg命令
   * @private
   * @param command FFmpeg命令实例
   * @param outputPath 输出文件路径
   * @returns 执行结果
   */
  async executeFFmpegCommand(command, outputPath, outputTempPath) {
    const mainWindow2 = getMainWindow();
    const handlers = main.getRendererHandlers(mainWindow2?.webContents);
    return new Promise((resolve) => {
      command.on("start", (commandLine) => {
        console.log("合并开始:", commandLine);
      }).on("progress", (progress) => {
        console.log("合并进度:", progress.percent);
        handlers.onVideoAudioMergeProgress.send({
          status: "merging",
          progress: progress.percent
        });
      }).on("error", (err) => {
        console.error("FFmpeg错误:", err);
        currentFFmpegCommand = null;
        handlers.onVideoAudioMergeProgress.send({
          status: "error",
          error: err.message
        });
        resolve({
          success: false,
          error: err.message
        });
      }).on("end", async () => {
        console.log("FFmpeg处理完成");
        currentFFmpegCommand = null;
        let counter = 1;
        const outputExt = path.extname(outputPath);
        while (await fs.pathExists(outputPath)) {
          outputPath = `${outputPath.slice(0, -outputExt.length)}(${counter})${outputExt}`;
          counter++;
        }
        fs.move(outputTempPath, outputPath);
        handlers.onVideoAudioMergeProgress.send({
          status: "success",
          outputPath,
          outputName: path.basename(outputPath)
        });
        resolve({
          success: true,
          outputPath
        });
      }).run();
    });
  }
}
const VideoAudioMergeService$1 = new VideoAudioMergeService();
const videoAudioMergeRoute = {
  // 获取媒体文件信息
  getFilesMediaInfo: t.procedure.input().action(async ({ input }) => {
    const result = await VideoAudioMergeService$1.getFilesMediaInfo(input);
    return {
      success: result.length > 0,
      data: result
    };
  }),
  // 合并视频和音频
  mergeMedia: t.procedure.input().action(async ({ input }) => {
    if (!input || input.input.length === 0) {
      return {
        success: false,
        error: "没有选择任何媒体流"
      };
    }
    try {
      const setting = SettingService$1.getSetting();
      const outputDir = setting.downloadPath;
      const outputFormat = setting.videoConfig.format.format;
      const result = await VideoAudioMergeService$1.mergeMediaStreams(input, outputDir, outputFormat);
      return result;
    } catch (error) {
      console.error("合并媒体流失败:", error);
      return {
        success: false,
        error: `合并失败: ${error.message}`
      };
    }
  }),
  // 停止当前合并任务
  stopMergeTask: t.procedure.action(async () => {
    return VideoAudioMergeService$1.stopCurrentMergeTask();
  })
};
const router = {
  ...authRoute,
  ...settingRoute,
  ...taskRoute,
  ...systemRoute,
  ...snifferRoute,
  ...videoAudioMergeRoute,
  ...videoAudioConverRoute
};
function initTipc() {
  main.registerIpcMain(router);
  logInfo("TIPC路由已注册", {
    routeCount: Object.keys(router).length
  });
}
async function initializeLibs() {
  initLogger();
  if (!electron.app.isReady()) {
    await Promise.all([
      // [PATCH] telemetry disabled
      // initSentry(),
      // initAptabase(),
      initYtDlp(),
      initFFmpeg(),
      initDatabase(),
      initTipc(),
      // [PATCH] yt-dlp update check enabled (uses ytdlp-release.json)
      YtDlpService$1.checkYtDlpUpdate(),
      initSnapfile()
    ]);
  }
}
logInfo("应用启动，设备ID", { deviceId });
initializeLibs();
let mainWindow;
electron.app.whenReady().then(async () => {
  await ProxyService$1.setupProxy();
  createMainWindow();
});
electron.app.on("window-all-closed", async () => {
  if (!isMac) {
    try {
      await snapfileService.stop();
      logInfo("Snapfile服务已停止", { reason: "window-all-closed" });
    } catch (error) {
      logError("停止Snapfile服务失败", {
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : void 0,
        reason: "window-all-closed"
      });
    }
    destroyMainWindow();
    electron.app.quit();
  }
});
electron.app.on("activate", () => {
  mainWindow = getMainWindowOrCreate();
  mainWindow.show();
});
