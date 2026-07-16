#!/bin/sh
# =============================================================================
# LMVK L3 — pages 分支同步脚本 (gitea 宿主机, cron 驱动)
#
# 把 vault 仓的 pages 分支 (L2 编译腿的 html_export 产物) 浅克隆/硬重置到
# 本地 serve 目录, caddy 只读挂载该目录。幂等, 并发安全, 可每几分钟跑一次。
#
# 用法:
#   ./sync-pages.sh                          # 用环境变量 / 下面的默认值
#   LMVK_REPO_URL=... LMVK_PAGES_DIR=... ./sync-pages.sh
#
# cron 示例 (每 5 分钟; 编译腿 15min 一轮 + 拉取 5min, SLA ≤30min 余量充足):
#   */5 * * * * /srv/lmvk/deploy/sync-pages.sh >>/var/log/lmvk-sync.log 2>&1
#
# 认证: 建议在 gitea 上发一个只读 deploy token (scope: read repository),
# 按 spec 惯例明文放宿主机 ~/.secrets/, cron 里从那读, 例如:
#   LMVK_REPO_URL=$(cat "$HOME/.secrets/lmvk-pages-repo-url") /srv/lmvk/deploy/sync-pages.sh
# ~/.secrets/lmvk-pages-repo-url 内容形如 (占位符, 换成真实 token):
#   https://<TOKEN_USER>:<TOKEN>@git.xart.top:8418/claudeQWQ/obsidian-knowledge.git
# =============================================================================
set -eu

# ---- 配置 (均可被环境变量覆盖; URL 为占位符, 见上方认证说明) ----
REPO_URL="${LMVK_REPO_URL:-https://<TOKEN_USER>:<TOKEN>@git.xart.top:8418/claudeQWQ/obsidian-knowledge.git}"
BRANCH="${LMVK_PAGES_BRANCH:-pages}"
DEST="${LMVK_PAGES_DIR:-/srv/lmvk/pages}"

log() { printf '%s [sync-pages] %s\n' "$(date '+%Y-%m-%dT%H:%M:%S%z')" "$*"; }

case "$REPO_URL" in
  *"<TOKEN"*) log "ERROR: LMVK_REPO_URL 仍是占位符, 先配置真实仓库 URL (见脚本头部注释)"; exit 1 ;;
esac

# ---- 并发锁 (mkdir 的原子性, 纯 POSIX; cron 重叠时后来者静默退出) ----
LOCKDIR="${DEST}.lock"
if ! mkdir "$LOCKDIR" 2>/dev/null; then
  log "another sync holds the lock ($LOCKDIR), exiting"
  exit 0
fi
trap 'rmdir "$LOCKDIR" 2>/dev/null || :' EXIT INT TERM

# ---- 首次: 浅克隆单分支 ----
if [ ! -d "$DEST/.git" ]; then
  log "initial shallow clone of '$BRANCH' -> $DEST"
  mkdir -p "$(dirname "$DEST")"
  git clone --quiet --depth 1 --single-branch --branch "$BRANCH" "$REPO_URL" "$DEST"
  log "clone done at $(git -C "$DEST" rev-parse --short HEAD)"
  exit 0
fi

# ---- 常规: 浅取 + 硬重置到远端 ----
# serve 目录是纯消费端: 本地永不产生状态, 每次无条件对齐 origin。
# (reset --hard + clean -fd 保证被上游删除的产物文件本地也消失。)
BEFORE=$(git -C "$DEST" rev-parse HEAD)
git -C "$DEST" fetch --quiet --depth 1 origin "$BRANCH"
git -C "$DEST" reset --hard --quiet FETCH_HEAD
git -C "$DEST" clean -fdq

AFTER=$(git -C "$DEST" rev-parse HEAD)
if [ "$BEFORE" = "$AFTER" ]; then
  log "no change ($(git -C "$DEST" rev-parse --short HEAD))"
else
  log "updated $(printf '%.8s' "$BEFORE") -> $(printf '%.8s' "$AFTER")"
fi
