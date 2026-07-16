#!/bin/sh
# =============================================================================
# LMVK L3 — 新设备账号生成器 (gitea 宿主机, HITL)
#
# 为一台新设备生成 basic_auth 账号: bcrypt hash + 可直接粘进 Caddyfile 的行。
# spec L3: 每设备一账号 (可单独吊销), 密码明文只进 *该设备* 的 ~/.secrets。
#
# 用法:
#   ./add-device-account.sh <device-name>
#   e.g. ./add-device-account.sh pixel8
#        ./add-device-account.sh thinkpad-5080
#
# hash 生成优先级: 运行中的 lmvk-caddy 容器 -> 宿主机 caddy 二进制
#                  -> 一次性 docker run caddy 镜像
# =============================================================================
set -eu

DEVICE="${1:?usage: $0 <device-name>   (e.g. pixel8, thinkpad-5080)}"
CONTAINER="${LMVK_CADDY_CONTAINER:-lmvk-caddy}"
CADDY_IMAGE="${LMVK_CADDY_IMAGE:-caddy:2.10-alpine}"

# ---- 读密码 (不回显); 直接回车 = 自动生成 24 位随机密码 ----
printf 'Password for device "%s" (回车 = 自动生成): ' "$DEVICE"
stty -echo 2>/dev/null || :
read -r PASSWORD || PASSWORD=""
stty echo 2>/dev/null || :
printf '\n'

GENERATED=no
if [ -z "$PASSWORD" ]; then
  PASSWORD=$(head -c 64 /dev/urandom | LC_ALL=C tr -dc 'A-Za-z0-9' | head -c 24)
  GENERATED=yes
fi

# ---- 生成 bcrypt hash (密码走 stdin 管道, 不进 argv / 进程列表) ----
HASH=""
if command -v docker >/dev/null 2>&1 \
   && docker ps --format '{{.Names}}' 2>/dev/null | grep -qx "$CONTAINER"; then
  HASH=$(printf '%s' "$PASSWORD" | docker exec -i "$CONTAINER" caddy hash-password 2>/dev/null) || HASH=""
fi
if [ -z "$HASH" ] && command -v caddy >/dev/null 2>&1; then
  HASH=$(printf '%s' "$PASSWORD" | caddy hash-password 2>/dev/null) || HASH=""
fi
if [ -z "$HASH" ] && command -v docker >/dev/null 2>&1; then
  HASH=$(printf '%s' "$PASSWORD" | docker run --rm -i "$CADDY_IMAGE" caddy hash-password 2>/dev/null) || HASH=""
fi

if [ -z "$HASH" ]; then
  echo "ERROR: 找不到能跑 'caddy hash-password' 的途径" >&2
  echo "  试过: docker exec $CONTAINER / 本机 caddy / docker run $CADDY_IMAGE" >&2
  exit 1
fi

# ---- 输出 ----
cat <<EOF

==== Caddyfile 片段 (粘进 basic_auth { ... } 块内) ====

	$DEVICE $HASH

==== HITL checklist ====
1. 编辑 Caddyfile, 把上面一行加进 basic_auth 块
   (首次部署: 同时删掉 REPLACE-device-example 占位行)
2. 热重载:  docker exec $CONTAINER caddy reload --config /etc/caddy/Caddyfile
3. [spec L3] 密码明文写入 *$DEVICE 这台设备* 的 ~/.secrets (不是宿主机!):
     mkdir -p ~/.secrets && chmod 700 ~/.secrets
     printf '%s\n' '<密码>' > ~/.secrets/lmvk-wiki-basic-auth
     chmod 600 ~/.secrets/lmvk-wiki-basic-auth
   (手机等无 shell 设备: 存系统密码管理器, 语义等同)
4. 吊销该设备 = 从 Caddyfile 删掉这一行 + 重复第 2 步, 不影响其他设备
EOF

if [ "$GENERATED" = "yes" ]; then
  cat <<EOF
==== 自动生成的密码 (仅显示这一次, 本脚本不落盘任何明文) ====

	$PASSWORD

EOF
else
  echo "(密码为手动输入, 不回显; 本脚本不落盘任何明文)"
fi
