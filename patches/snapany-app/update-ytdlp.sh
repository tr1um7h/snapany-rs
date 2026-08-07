#!/bin/bash
set -euo pipefail

# ============================================================
# yt-dlp 更新脚本
# 只更新 yt-dlp 二进制文件并重新签名
# ============================================================

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
APP_PATH="/Applications/SnapAny.app"
YT_DLP_PATH="$APP_PATH/Contents/Resources/app.asar.unpacked/public/bin/yt-dlp"
YT_DLP_CONFIG="$APP_PATH/Contents/Resources/app/ytdlp-release.json"

echo "=========================================="
echo " yt-dlp Update"
echo "=========================================="

# 1. 检查 app 是否存在
if [ ! -d "$APP_PATH" ]; then
    echo "[ERROR] App not found: $APP_PATH"
    exit 1
fi

# 2. 停止 SnapAny
echo "[1/4] Stopping SnapAny..."
killall SnapAny 2>/dev/null || true
sleep 1

# 3. 备份当前 yt-dlp
echo "[2/4] Backing up current yt-dlp..."
cp "$YT_DLP_PATH" "$YT_DLP_PATH.bak" 2>/dev/null || true

# 4. 替换 yt-dlp
echo "[3/4] Replacing yt-dlp..."
cp "$SCRIPT_DIR/yt-dlp_macos" "$YT_DLP_PATH"
chmod +x "$YT_DLP_PATH"
xattr -cr "$YT_DLP_PATH" 2>/dev/null || true  # Remove quarantine for PyInstaller binary

# 5. 重新签名
echo "[4/4] Re-signing app (without --deep)..."
codesign --force --sign - "$APP_PATH"

echo ""
echo "=========================================="
echo " Done. yt-dlp updated and app re-signed."
echo " Backup saved as: $YT_DLP_PATH.bak"
echo "=========================================="
