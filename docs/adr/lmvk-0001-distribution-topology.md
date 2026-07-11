# ADR lmvk-0001: LMVK 内容分发拓扑定稿

- 状态：Accepted（2026-07-11）
- 来源：wayfinder 地图 [LMVK内容分发网络](https://git.xart.top:8418/Curry/obsidian-llm-wiki/issues/1) ticket [分发拓扑定稿 — ADR](https://git.xart.top:8418/Curry/obsidian-llm-wiki/issues/15)
- 输入决议：#2 新鲜度SLA、#3 认证与网络边界、#4 分发宿主选型、#5 编译与发布触发、#14 AI agent消费端形态

## Context

真相源 vault（`D:\knowledge`）需要让三类消费端在目标 SLA 内看到最新 wiki：浏览器可达设备、AI agent、离线/弱网场景。安全线已锁全私有：分发面只在自建基建（git.xart.top / NetBird 舰队网 100.x）+ 认证后可达，公网匿名不可达。

关键事实修正（#5 发现）：vault 本身是 git 仓，经 Obsidian git 插件推 gitea `claudeQWQ/obsidian-knowledge` —— gitea 是全拓扑的汇聚点与单一分发源。

## Decision — 拓扑五条腿

```
[编辑设备] --Obsidian git插件/Synology--> [gitea: claudeQWQ/obsidian-knowledge]  (真相源汇聚)
                                              │
                       cron 15min pull（5090主/5080备，不双跑；HEAD无变更早退）
                                              │
                                   [compile + html_export]
                                              │ push
                                   [gitea: 产物 pages 分支]
                                    │                    │
                     caddy容器拉产物 │                    │ agent直接 git pull（token）
                                    ▼                    ▼
                  [浏览器腿: caddy@gitea同宿主]      [agent腿: 舰队各机]
                   绑100.x + basic_auth              （后续: remote MCP 增强）
                                    │
                                    ▼
                  [离线腿: 每日离线包 ≤24h]（方案待 #16）
```

1. **编辑腿**：Obsidian 编辑设备 → git 插件推 `claudeQWQ/obsidian-knowledge`；设备间文件同步现状 Synology Drive（验收中，#18）。编辑与只读分发是两条腿，互不阻塞。
2. **编译腿**：cron 15min（schtasks/scheduler.py），5090 主、5080 备（备侧任务默认禁用，不双跑）。机器无关：输入一律 `git pull` gitea vault 仓，不直读本地盘。HEAD 无变更即早退，零 LLM 消耗。产物（html_export 静态站）push 回 gitea pages 分支。
3. **浏览器腿**：caddy 容器常驻 **gitea 同宿主**（分发面可用性=gitea 可用性，本就是链路硬依赖；与两台开发机开关机解耦），从 pages 分支拉产物。绑 NetBird 接口 100.x（禁 0.0.0.0），`basic_auth` 每设备一账号（bcrypt，可单独吊销）。SLA：入库起 ≤30min。
4. **agent 腿**：舰队各机 agent 直接 `git pull`（gitea token，复用现有认证），读 vault 原文，不经 compile 链路；SLA=pull 频率（按需）。增强路线：现有 mcp-server（stdio）经 SDK 自带 HTTP 传输远程化 + bearer header，验证后铺开（#14）。
5. **离线腿**：每日构建离线包，SLA ≤24h；打包形态与承载方案待 [离线/弱网消费方案](https://git.xart.top:8418/Curry/obsidian-llm-wiki/issues/16)（本 ADR 预留挂载点：产物同样落 gitea，由离线方案自取）。

## 失败感知（承袭 #2/#5）

编译日志 + 状态文件 + 产物页脚构建时间戳；staleness 按需检查脚本，不建常驻告警服务。

## Consequences

- gitea 成为单点：接受 —— 全私有姿态下 gitea 本就是不可绕的硬依赖，容灾=gitea 自身备份策略，不在本 effort 范围。
- 5090 关机时编译停、分发面照常（旧快照）；恢复后 cron 自动追平。
- Gitea Actions（#6）跑通后可将编译腿升级为 push 事件驱动，属增强非依赖，不改本拓扑。
- 浏览器分发路线至此全清；剩余待决：#16 离线方案、#18 编辑端同步验收、#6/#7/#17 执行位任务。
