#!/bin/bash
set -euo pipefail

# ============================================================
# init-from-asar.sh — 一次性把 app.asar 布局转换为 app/ 目录布局
#
# 背景：当前 /Applications/SnapAny.app 是原始 asar 布局。
# 补丁流程（apply.sh）需要 Resources/app/ 目录布局。
# 本脚本做一次性转换：
#   1. 解包 app.asar -> Resources/app/
#   2. 合入 app.asar.unpacked（原生模块、ffmpeg 等二进制）
#   3. 应用 JS 补丁 + ytdlp-release.json
#   4. 禁用 app.asar（改名 .disabled，保留以便回滚）
#   5. 重签名
#
# 回滚：rm -rf Resources/app && mv Resources/app.asar.disabled Resources/app.asar
#       然后 codesign --force --sign - /Applications/SnapAny.app
# ============================================================

APP_PATH="/Applications/SnapAny.app"
RES="$APP_PATH/Contents/Resources"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ASAR_CACHE="${ASAR_CACHE:-$SCRIPT_DIR/../../.tmpwork/asarcache}"

echo "=========================================="
echo " SnapAny asar -> app/ layout init"
echo "=========================================="

if [ ! -d "$APP_PATH" ]; then
    echo "[ERROR] App not found: $APP_PATH"
    exit 1
fi

echo "[1/6] Stopping SnapAny..."
killall SnapAny 2>/dev/null || true
sleep 1

if [ ! -d "$RES/app" ]; then
    echo "[2/6] Extracting app.asar -> Resources/app/ ..."
    mkdir -p "$ASAR_CACHE"
    npm_config_cache="$ASAR_CACHE" npx --yes @electron/asar extract "$RES/app.asar" "$RES/app"
else
    echo "[2/6] Resources/app/ already exists, skip extract"
fi

echo "[3/6] Merging app.asar.unpacked into app/ ..."
cp -R "$RES/app.asar.unpacked/." "$RES/app/"

echo "[4/6] Applying JS patches..."
cp "$SCRIPT_DIR/out/main/main.js" "$RES/app/out/main/main.js"
cp "$SCRIPT_DIR/out/renderer/assets/index-C602CO1A.js" "$RES/app/out/renderer/assets/index-C602CO1A.js"
cp "$SCRIPT_DIR/ytdlp-release.json" "$RES/app/ytdlp-release.json"

echo "[5/6] Disabling app.asar..."
if [ -f "$RES/app.asar" ]; then
    mv "$RES/app.asar" "$RES/app.asar.disabled"
fi

echo "[6/6] Re-signing app..."
codesign --force --deep --sign - "$APP_PATH"

echo ""
echo "=========================================="
echo " Done. Launch with: open $APP_PATH"
echo "=========================================="
