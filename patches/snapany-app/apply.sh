#!/bin/bash
set -euo pipefail

# ============================================================
# SnapAny Electron App 补丁应用脚本
# 将修改后的 main.js 和 renderer JS 应用到 /Applications/SnapAny.app
# ============================================================

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
APP_PATH="/Applications/SnapAny.app"
MAIN_JS="$APP_PATH/Contents/Resources/app/out/main/main.js"
RENDERER_JS="$APP_PATH/Contents/Resources/app/out/renderer/assets/index-C602CO1A.js"
YT_DLP_CONFIG="$APP_PATH/Contents/Resources/app/ytdlp-release.json"

echo "=========================================="
echo " SnapAny App Patch Apply"
echo "=========================================="

if [ ! -d "$APP_PATH" ]; then
    echo "[ERROR] App not found: $APP_PATH"
    exit 1
fi

echo "[1/3] Stopping SnapAny..."
killall SnapAny 2>/dev/null || true
sleep 1

echo "[2/3] Applying patches..."
cp "$SCRIPT_DIR/out/main/main.js" "$MAIN_JS"
cp "$SCRIPT_DIR/out/renderer/assets/index-C602CO1A.js" "$RENDERER_JS"
cp "$SCRIPT_DIR/ytdlp-release.json" "$YT_DLP_CONFIG"

echo "[3/3] Re-signing app..."
codesign --force --sign - "$APP_PATH"

echo ""
echo "=========================================="
echo " Done. Launch with: open $APP_PATH"
echo "=========================================="
