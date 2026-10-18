#!/usr/bin/env bash
#
# 从 DMG 起一个**完全隔离、完全静音、不抢焦点**的沙盒实例，用于实测打包产物。
#
# 为什么需要这个脚本 —— 三个坑都是实测踩出来的：
#
#   1) 数据隔离
#      用 --user-data-dir 指定沙盒目录。已实测：App 的 app.getPath('userData')
#      会跟随该开关（getAppInfo().dataDir 返回沙盒路径），不会碰用户真实数据。
#      不要只依赖 HOME 覆盖，Electron 读的是 Chromium 的 user-data-dir。
#
#   2) 静音
#      必须加 --mute-audio。只在应用内把 exam.autoAdvance 关掉是**不可靠**的：
#      渲染进程的设置 store 不会自动刷新，自动播放仍会触发；而没有云端 key 时
#      题目语音会回退到系统 say，照样出声。--mute-audio 是从进程层兜底。
#
#   3) 隐藏窗口 + 渲染进程存活
#      open -j 能隐藏启动、不抢焦点，但隐藏窗口会被 Chromium 判定为「遮挡后台」
#      并回收渲染进程（实测：导入 164 页 PDF 后约 73 秒渲染进程直接消失，
#      内存爬到 ~393MB 后归零）。必须配合下面三个开关：
#        --disable-renderer-backgrounding
#        --disable-backgrounding-occluded-windows
#        --disable-background-timer-throttling
#
# 用法：
#   scripts/sandbox-dmg-test.sh           # 起沙盒，等 CDP 就绪后打印连接方式
#   scripts/sandbox-dmg-test.sh --stop    # 停止沙盒进程
#   scripts/sandbox-dmg-test.sh --clean   # 停止并删除整个沙盒目录
#
set -euo pipefail

SB="${TOEFL_SANDBOX_DIR:-/tmp/toefl-sandbox}"
PORT="${TOEFL_SANDBOX_PORT:-9224}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DMG="${TOEFL_SANDBOX_DMG:-$ROOT/release/TOEFL-Speaking-Sim-1.0.0-arm64.dmg}"
APP_NAME="TOEFL 口语模考"

stop() { pkill -f "toefl-sandbox" 2>/dev/null || true; sleep 2; }

case "${1:-}" in
  --stop) stop; echo "沙盒已停止"; exit 0 ;;
  --clean)
    stop
    case "$SB" in
      /tmp/toefl-sandbox*|/var/folders/*) rm -rf "$SB" ;;
      *) echo "拒绝删除非沙盒路径：$SB" >&2; exit 1 ;;
    esac
    echo "沙盒已清空：$SB"; exit 0 ;;
esac

[ -f "$DMG" ] || { echo "找不到 DMG：$DMG" >&2; exit 1; }
stop
rm -rf "$SB"; mkdir -p "$SB/mnt" "$SB/app"

echo "==> 挂载 DMG（-nobrowse，不弹 Finder）"
hdiutil attach "$DMG" -nobrowse -readonly -mountpoint "$SB/mnt" >/dev/null
trap 'hdiutil detach "$SB/mnt" >/dev/null 2>&1 || true' EXIT

echo "==> 拷贝 App 到沙盒"
cp -R "$SB/mnt/$APP_NAME.app" "$SB/app/"
hdiutil detach "$SB/mnt" >/dev/null 2>&1 || true
trap - EXIT

mkdir -p "$SB/ud"

echo "==> 隐藏启动（不抢焦点 / 不发声 / 独立数据目录）"
open -j -n -a "$SB/app/$APP_NAME.app" --args \
  --user-data-dir="$SB/ud" \
  --remote-debugging-port="$PORT" \
  --mute-audio \
  --disable-renderer-backgrounding \
  --disable-backgrounding-occluded-windows \
  --disable-background-timer-throttling

for _ in $(seq 1 30); do
  if curl -s --max-time 2 "http://127.0.0.1:$PORT/json/list" | grep -q webSocketDebuggerUrl; then
    echo "==> CDP 就绪: http://127.0.0.1:$PORT"
    echo "    驱动示例: CDP_PORT=$PORT node scripts/cdp.mjs text"
    echo "    停止:     $0 --stop"
    exit 0
  fi
  sleep 1
done

echo "CDP 未就绪，请检查沙盒 App 是否启动" >&2
exit 1
