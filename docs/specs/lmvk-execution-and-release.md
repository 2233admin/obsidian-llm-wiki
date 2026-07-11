# Spec: LMVK 执行 + Release 收口

- 状态：Active（2026-07-12）
- 来源：wayfinder 地图 [LMVK内容分发网络](https://git.xart.top:8418/Curry/obsidian-llm-wiki/issues/1)（已收图，17 票全决）+ release 前承诺审计
- 上游决议：拓扑 ADR `docs/adr/lmvk-0001-distribution-topology.md` + 地图 Decisions so far（15 条）

## 目标

1. **R 波（release 收口）**：main 转绿 → 补齐文档诚实度 → 发 `v2.6.0`（release.yml 自动编译发布）。
2. **L 波（LMVK 部署）**：把地图决议落成跑着的链路。R 波不被 L 波阻塞。

## R 波 — release 收口（阻塞发版，串行）

### R1 修 fleet 测试包同名影子
`tests/fleet/` 与顶层 `fleet/` 包同名，pytest rootdir sys.path 插入后影子覆盖，`ImportError: cannot import name 'FleetHub'`，main CI 连红 ≥5 次的主犯。改名 `tests/fleet_tests/`（或加 rootdir 隔离 conftest），root pytest 155 passed + 2 errors → 全绿。

### R2 修 lint-python
`ruff check compiler/` 现红。清违规（不放宽规则；确属误报才逐条 noqa 注明）。

### R3 诊断修复 CI test job（mcp-server）
本地 `node --test` 330 全过但 CI test job 红 —— 环境差异（node 版本/依赖装法/路径大小写）待诊断。以 CI 日志为准修到绿。

### R4 compiler pytest 接入 CI
662 个 compiler 测试 CI 从来没跑（形同虚设）。ci.yml 加 job：`pytest compiler/tests/`（8s 级，无成本借口）。release.yml quality 链同步加。

### R5 CHANGELOG 补账 + 版本号并轨
- CHANGELOG.md 从 v2.2.0 补到 HEAD：v2.3.0（graphify）/v2.4.0（second-brain）/v2.5.0（claude-obsidian port）/v2.5.1/v0.8.0（Context Core Phase 1-3）各自变更，从 git log + tag message 考古。
- **版本并轨决定：下一版 = `v2.6.0`**，功能轨为唯一对外轨；CHANGELOG 顶部注明 v0.x Phase 轨并入（v0.8.0 = v2.5.1 后的 Phase 里程碑，此后不再发 v0.x tag）。package.json/pyproject 内部版本号不强制对齐，仅注明。

### R6 文档诚实度
- `TASK14-DRAFT-multi-platform-compile.md` 标题 "BUILT" → "DESIGNED"（0 行代码，只过了设计评审）。
- HANDOFF.md Task12 矛盾（"未建" vs v0.8.0 tag "Phase 1-3 已做"）：核对后统一口径，一句话写清哪层做了哪层没做。
- v2.6.0 release notes 里如实列 Fleet Mode = code-complete/CI-red-fixed/Draft 文档状态。

### R7 发版
main 绿 → tag `v2.6.0` → release.yml 自动 quality→build→gh release（tar.gz×2 + auto notes）。验证 release 页真出现产物。

## L 波 — LMVK 部署（不阻塞 release，可并行/后置）

- **L1 connector 调度**：`scheduler.py` per-source interval yaml（对标 openwiki）；chubbyskills 中文包并入为首发源（HN 继续跑；Tavily/Gmail/X 后置，激活序按凭证轻重）。
- **L2 编译腿上机**：5090 schtasks cron 15min → pull vault → 无变更早退 → 增量 compile（haiku 档）→ push pages 分支；周度全量任务；$5/日护栏状态文件；产物页脚构建时间戳。5080 同脚本任务建好默认禁用。
- **L3 分发面**：caddy 容器 @gitea 同宿主（HITL：宿主机访问），拉 pages 分支，绑 NetBird 100.x 禁 0.0.0.0，basic_auth 每设备 bcrypt 账号（密码入各机 ~/.secrets）。
- **L4 PWA+SW**：html_export 产物加 service worker——stale-while-revalidate + 构建时 precache manifest 全站预缓存，>100MB 降级「索引+最近30天」；缓存版本随构建时间戳失效；与 basic_auth 同源兼容。
- **L5 vault 治理加固**：5080 装 rhizome pre-commit（--staged-files-from 模式）；obsidian-git auto-backup 驯化（pull-before-push/带机名/降频）；机器状态文件（.obsidian/graph.json、插件 main.js、.makemd/*.mdc、.space/*.mdb）入 .gitignore 并 git rm --cached。
- **L6 memory 入链**：schtasks 小时级把各机 CC memory 目录复制 → vault `02-Infrastructure/agent-memory/<机名>/`，复制脚本自动补最小 frontmatter 过门禁。
- **L7 Gitea Actions 增强**（HITL）：admin 启用 Actions + runner，publish-wiki.yml 跑通后编译腿可升级 push 触发（增强非依赖）。

## 依赖边

- R1→R2→R3→R4 串行（同 CI 面），R5/R6 可与 R1-R4 并行，R7 被 R1-R6 全部阻塞。
- L2 依赖 L1（scheduler 承载 compile 编排时）弱依赖，可先 schtasks 直拉 compile.py；L3 依赖 L2 产物（pages 分支存在）；L4 依赖 L3；L5/L6 独立随时可做；L7 独立 HITL。

## 验收

- R 波：gh run list main 最新 = 全绿；gh release view v2.6.0 有两个 tar.gz；CHANGELOG 覆盖到 v2.6.0。
- L 波：手机浏览器（NetBird 内）打开 caddy 站看到 wiki 且页脚时间戳 ≤30min；断网重进能读（PWA）；agent 机 git pull 即最新；memory 目录在 vault 出现且随 git 履历。
