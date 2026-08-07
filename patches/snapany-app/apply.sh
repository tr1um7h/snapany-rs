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

# 1. 检查 app 是否存在
if [ ! -d "$APP_PATH" ]; then
    echo "[ERROR] App not found: $APP_PATH"
    exit 1
fi

# 2. 停止 SnapAny
echo "[1/5] Stopping SnapAny..."
killall SnapAny 2>/dev/null || true
sleep 1

# 3. 备份原文件
echo "[2/5] Backing up original files..."
cp "$MAIN_JS" "$MAIN_JS.bak" 2>/dev/null || true
cp "$RENDERER_JS" "$RENDERER_JS.bak" 2>/dev/null || true

# 4. 应用补丁
echo "[3/5] Applying patches..."
cp "$SCRIPT_DIR/out/main/main.js" "$MAIN_JS"
cp "$SCRIPT_DIR/out/renderer/assets/index-C602CO1A.js" "$RENDERER_JS"
cp "$SCRIPT_DIR/ytdlp-release.json" "$YT_DLP_CONFIG"

# 5. 重新签名
echo "[4/5] Re-signing app..."
codesign --force --deep --sign - "$APP_PATH"

# 6. 验证
echo "[5/5] Verifying..."
codesign --verify --deep --strict "$APP_PATH" 2>&1 && echo "  Signature OK" || echo "  [WARN] Signature verify failed"

echo ""
echo "=========================================="
echo " Done. Launch with: open $APP_PATH"
echo "=========================================="
