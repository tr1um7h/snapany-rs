#!/bin/bash
set -euo pipefail

# ============================================================
# SnapAny 回滚脚本
# 恢复所有原始文件
# ============================================================

APP_PATH="/Applications/SnapAny.app"
MAIN_JS="$APP_PATH/Contents/Resources/app/out/main/main.js"
RENDERER_JS="$APP_PATH/Contents/Resources/app/out/renderer/assets/index-C602CO1A.js"
YT_DLP_PATH="$APP_PATH/Contents/Resources/app.asar.unpacked/public/bin/yt-dlp"
YT_DLP_CONFIG="$APP_PATH/Contents/Resources/app/ytdlp-release.json"

echo "=========================================="
echo " SnapAny App Revert"
echo "=========================================="

# 1. 停止 SnapAny
echo "[1/4] Stopping SnapAny..."
killall SnapAny 2>/dev/null || true
sleep 1

# 2. 恢复备份文件
echo "[2/4] Restoring backup files..."

if [ -f "$MAIN_JS.bak" ]; then
    mv "$MAIN_JS.bak" "$MAIN_JS"
    echo "  Restored main.js"
else
    echo "  [WARN] main.js.bak not found"
fi

if [ -f "$RENDERER_JS.bak" ]; then
    mv "$RENDERER_JS.bak" "$RENDERER_JS"
    echo "  Restored renderer JS"
else
    echo "  [WARN] renderer JS backup not found"
fi

if [ -f "$YT_DLP_PATH.bak" ]; then
    mv "$YT_DLP_PATH.bak" "$YT_DLP_PATH"
    echo "  Restored yt-dlp"
else
    echo "  [WARN] yt-dlp backup not found"
fi

if [ -f "$YT_DLP_CONFIG" ]; then
    rm -f "$YT_DLP_CONFIG"
    echo "  Removed ytdlp-release.json"
fi

# 3. 重新签名
echo "[3/4] Re-signing app (without --deep)..."
codesign --force --sign - "$APP_PATH"

# 4. 验证
echo "[4/4] Verifying..."
codesign --verify --strict "$APP_PATH" 2>&1 && echo "  Signature OK" || echo "  [WARN] Signature verify failed"

echo ""
echo "=========================================="
echo " Done. All files restored to original."
echo "=========================================="
