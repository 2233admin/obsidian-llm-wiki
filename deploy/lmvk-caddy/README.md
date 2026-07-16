# LMVK L3 — 浏览器腿部署包 (caddy @ gitea 同宿主)

- 状态：Ready for HITL（2026-07-16）
- Spec：`docs/specs/lmvk-execution-and-release.md` — **L3 分发面**
- 上游 ADR：`docs/legacy/adr/lmvk-0001-distribution-topology.md`（拓扑第 3 条腿：浏览器腿）
- 性质：**HITL 部署包**。本目录只是 copy-paste-ready 的物料；实际上线需要一位在 gitea 宿主机上有 shell 的人按下面的 runbook 操作。仓库不含任何自动上机逻辑。
- 收口意义：本包跑通即 **L3 完成**，同时给 **L4（PWA+SW）** 提供了它验收所需的分发面（HTTPS secure context + SW 友好缓存头都已就位）——L4 解锁。

## 拓扑回顾（来自 ADR）

```
[gitea: claudeQWQ/obsidian-knowledge]  ← 编辑设备经 Obsidian git 插件推入（真相源）
        │  cron 15min（5090 主 / 5080 备）
[compile + html_export] ──push──> [gitea: pages 分支]
                                        │  sync-pages.sh（宿主机 cron 5min）
                                  [本地 checkout] ──ro mount──> [caddy 容器]
                                                                    │
                                                     绑 NetBird 100.x + basic_auth
                                                                    │
                                                          [舰队内浏览器/手机]
```

## 文件清单

| 文件 | 作用 |
|---|---|
| `Caddyfile` | 站点定义：绑 NetBird 接口、`tls internal`、每设备 basic_auth、SW 协作缓存头 |
| `docker-compose.yml` | caddy 常驻容器（host 网络、只读挂载、restart、healthcheck） |
| `.env.example` | 环境占位（NETBIRD_ADDR / LMVK_PORT / PAGES_DIR），复制为 `.env` 填写 |
| `sync-pages.sh` | cron 脚本：pages 分支浅克隆/硬重置到 serve 目录，幂等 + 并发锁 |
| `add-device-account.sh` | 生成新设备 bcrypt 账号 + Caddyfile 片段 + `~/.secrets` 提醒 |
| `.gitattributes` | 强制 LF（Windows checkout 防 CRLF 污染 Linux 侧脚本） |

## 前置条件

1. gitea 宿主机 shell 访问（HITL 本体），docker + docker compose v2。
2. 宿主机已入 NetBird 舰队网：`netbird status` 能看到本机 100.x 地址（接口通常叫 `wt0`）。
3. **L2 已产出 pages 分支**（L3 的硬依赖，见 spec 依赖边）：
   ```sh
   git ls-remote https://git.xart.top:8418/claudeQWQ/obsidian-knowledge.git pages
   ```
   有输出才继续；没有先回去修 L2。
4. gitea 上发一个**只读** deploy token（scope: read repository），供 `sync-pages.sh` 拉取。

## 首次上线顺序（runbook）

```sh
# 0. 物料上机
scp -r deploy/lmvk-caddy/ <gitea-host>:/srv/lmvk/deploy/
ssh <gitea-host>
cd /srv/lmvk/deploy && chmod +x *.sh

# 1. 环境配置
cp .env.example .env
vi .env        # NETBIRD_ADDR=本机 100.x；LMVK_PORT=8443；PAGES_DIR=/srv/lmvk/pages

# 2. deploy token 落位（宿主机 ~/.secrets 惯例）
mkdir -p ~/.secrets && chmod 700 ~/.secrets
printf '%s\n' 'https://<TOKEN_USER>:<TOKEN>@git.xart.top:8418/claudeQWQ/obsidian-knowledge.git' \
  > ~/.secrets/lmvk-pages-repo-url
chmod 600 ~/.secrets/lmvk-pages-repo-url

# 3. 首拉产物（确认 PAGES_DIR 出现 index.html 再往下走）
LMVK_REPO_URL=$(cat ~/.secrets/lmvk-pages-repo-url) LMVK_PAGES_DIR=/srv/lmvk/pages ./sync-pages.sh
ls /srv/lmvk/pages/index.html

# 4. 第一台设备账号（Caddyfile 出厂占位 hash 是非法的，caddy 起不来 ——
#    这是故意的 fail-closed，防"没配账号先裸奔"。必须先做这步。）
./add-device-account.sh <first-device>
vi Caddyfile   # 贴入输出的行，删掉 REPLACE-device-example 占位行

# 5. 起容器
docker compose up -d
docker logs -f lmvk-caddy   # 看到 serving 无报错即可 Ctrl-C

# 6. 红线自检（必做，spec L3 "禁 0.0.0.0"）
ss -tlnp | grep 8443
#   期望: 只出现 100.x.y.z:8443
#   出现 0.0.0.0:8443 或 [::]:8443 = 违规，立刻 docker compose down 排查

# 7. cron 常驻同步（每 5 分钟）
crontab -e
# */5 * * * * LMVK_REPO_URL=$(cat /root/.secrets/lmvk-pages-repo-url) /srv/lmvk/deploy/sync-pages.sh >>/var/log/lmvk-sync.log 2>&1
```

### 设备信任内部 CA（每台消费设备一次）

NetBird 内网 IP 拿不到公网证书，站点用 Caddy 内部 CA 自签。**这不是可选项**：L4 的 service worker 只在 secure context（HTTPS 且证书受信）里能注册。

```sh
# 宿主机导出根证书（持久化在 caddy-data volume，换容器不变）
docker cp lmvk-caddy:/data/caddy/pki/authorities/local/root.crt ./lmvk-root.crt
```

- **Android**：root.crt 传到手机 → 设置 → 安全 → 加密与凭据 → 安装 CA 证书。
- **iOS**：AirDrop/发送 root.crt → 安装描述文件 → 设置→通用→关于本机→证书信任设置里启用完全信任。
- **桌面**：系统钥匙串/证书库导入并信任。

## 验证（= spec L 波验收第一条）

用一台 NetBird 已连接的**手机**：

1. 浏览器打开 `https://<NETBIRD_ADDR>:8443/`。
2. 弹 basic_auth → 输入该设备账号（明文在该设备 `~/.secrets` / 密码管理器）。
3. 看到 wiki 首页，且**页脚构建时间戳距当前 ≤30min** —— 这就是验收线（编译腿 15min + 同步 5min，余量充足）。

宿主机侧快速自检：

```sh
# 探活（无认证端点）
curl -sk https://$NETBIRD_ADDR:8443/healthz            # -> ok
# 认证 + 缓存头抽查
curl -sk -u '<device>:<password>' -I https://$NETBIRD_ADDR:8443/
#   期望 HTML: Cache-Control: no-cache（绝不该看到 immutable / 大 max-age）
curl -sk -u '<device>:<password>' -I https://$NETBIRD_ADDR:8443/sw.js
#   期望: Cache-Control: no-cache + Service-Worker-Allowed: /（产物含 sw.js 后）
```

## 日常运维

| 操作 | 命令 |
|---|---|
| 加设备 | `./add-device-account.sh <name>` → 贴 Caddyfile → `docker exec lmvk-caddy caddy reload --config /etc/caddy/Caddyfile` |
| 吊销设备 | Caddyfile 删该设备行 → 同上 reload（其他设备不受影响） |
| 产物新鲜度 | 自动（cron）；手动 `tail /var/log/lmvk-sync.log` 或直接跑一次 `sync-pages.sh` |
| 改配置 | 编辑 Caddyfile → reload（不用重启容器） |

## 回滚

- **分发面整体下线**：`docker compose down`。只影响浏览器腿；gitea、真相源、编译腿、agent 腿全部照常（ADR：腿间互不阻塞）。
- **产物回滚**（pages 上了坏构建）：
  ```sh
  crontab -e            # 先注释掉 sync 行，防止又被拉回最新
  cd /srv/lmvk/pages
  git fetch --depth 50 origin pages     # 补深度拿到历史
  git reset --hard <known-good-sha>
  ```
  正解仍是修上游（编译腿重推 pages），本地回滚只是止血；恢复后取消注释 cron。
- **caddy 版本回滚**：compose 里镜像 tag 是钉死的，改回旧 tag → `docker compose up -d`。

## 安全红线备忘

1. **0.0.0.0 禁止**（spec L3）。双保险：Caddyfile `bind {$NETBIRD_ADDR}` + compose 用 host 网络、零端口映射（docker `ports:` 发布默认绑 0.0.0.0，所以根本不用它）。每次改动网络相关配置后重跑 `ss -tlnp` 自检。
2. **密码明文只进各设备 `~/.secrets`**（或手机密码管理器）；宿主机上只存在 bcrypt hash 与只读 deploy token。
3. 内部 CA 私钥在 `caddy-data` volume 里，不要拷出宿主机；外发的只有 `root.crt`（公钥证书）。
4. serve 目录对容器**只读**挂载：分发面无法反向污染产物（呼应"编译单向"全局不变量）。

## 与 L4（PWA+SW）的关系

本包已为 L4 铺好路，L4 落地时**分发面零改动**：

| 已就位 | 说明 |
|---|---|
| HTTPS secure context | `tls internal`；SW 注册的硬前提，裸 HTTP 100.x 会被浏览器拒绝 |
| `sw.js` → `no-cache` | SW 本体更新不被 HTTP 缓存卡住，缓存版本才能随构建时间戳失效 |
| `Service-Worker-Allowed: /` | 产物即使把 sw.js 放子目录，scope 也能覆盖全站 |
| HTML `no-cache`（协商缓存） | stale-while-revalidate 的"陈旧可用"由 SW 层负责，HTTP 层不锁死时间戳页脚 |
| basic_auth 同源 | SW 与页面同源同凭据，fetch 事件天然带 Authorization，无跨域问题 |

## 占位符清单（部署时必须替换）

| 占位符 | 位置 | 换成 |
|---|---|---|
| `NETBIRD_ADDR` / `100.x.y.z` | `.env` | 宿主机 NetBird 地址（`netbird status`） |
| `LMVK_PORT`（默认 8443） | `.env` | 宿主机空闲端口（避开 gitea 8418） |
| `PAGES_DIR`（默认 `/srv/lmvk/pages`） | `.env` / cron | serve 目录绝对路径 |
| `<TOKEN_USER>:<TOKEN>` | `~/.secrets/lmvk-pages-repo-url` | gitea 只读 deploy token |
| `claudeQWQ/obsidian-knowledge.git` | repo URL | 若 pages 分支实际在别的仓，换之（ADR 口径：产物 push 回同一 vault 仓） |
| `REPLACE-device-example …` | `Caddyfile` | `add-device-account.sh` 生成的真实账号行 |

## 已知边界：SW 缓存与共享设备

Service worker 会把经 basic_auth 认证后拉到的页面存进浏览器 Cache Storage（stale-while-revalidate 的本意，也是离线阅读的前提）。同一浏览器 profile 的其他使用者无需重新认证即可读到这些缓存页。NetBird 内网 + 每设备独立账号的部署形态下这是可接受的；**不要**在共享电脑的公用浏览器 profile 上登录本站，或用后清站点数据。
