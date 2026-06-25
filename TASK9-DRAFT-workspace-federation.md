# Task 9（草案）— Local-first Workspace Federation:本地优先的工作空间联邦

> 状态:**DRAFT,待审**。承接 Task 8(内部工作真值 + P0 协议)。与 Task 8 是**两件事**,不合并。
> 一句话:vault-mind 先认本地,再认远端——本地目录/本地 git 先存在,Gitea/GitHub/Linear 是**后附加的投影层**,不是项目能否被管理的前置条件。

## 核心判断(为什么单独开)

不能把 vault-mind 设计成「必须先有 Gitea/GitHub/Linear 项目才能工作」。否则你现状「多数项目只在本地、经常忘上传」会导致**大部分工作永远进不了 work-OS**。

> 当前最大的缺口不是更漂亮的远端看板,而是:**没有一张「电脑里到底有哪些项目、哪些没上传、哪些忘了」的本地总表。**
> 先建这张表,Gitea/GitHub/Linear 才是增强层。

```
本地目录 / 本地 git
      │ scan / register
      ▼
Local Project Registry  ──绑定 entity──▶  vault-mind 工作真值(Task 8)
      │
      ├──▶ Gitea  (代码托管 / 默认私有远端)
      ├──▶ GitHub (代码 + 看板 / 开源协作)
      └──▶ Linear (协作看板 / 人机入口)
```

## 三平面(职责分离)

| 平面 | 真值在哪 | vault-mind 记什么 |
|---|---|---|
| **代码** | 本地目录 / 本地 git / Gitea·GitHub 远端 | 不复制源码;只记 path、branch、HEAD、dirty?、有无 remote、未 push commit、最近活动、PR/commit/CI evidence |
| **工作** | vault-mind markdown(Task 8 的 `state/priority/assignee/...`) | capture=提案 · promote=提交 · reviewed snapshot=工作真值 |
| **展示/协作** | Gitea / GitHub Projects / Linear | 全是 work-OS 的**外部投影**,不是三个争真值的中心 |

外部修改反向进入:`远端改 → draft candidate → _triage → promote PR → reviewed current-truth → 再回写远端`(= 复用 Task 4/8 的 P0 协议,不另造同步真值系统)。

## §0 硬约束(在 Task 8 §0 之上新增,违反即回滚)

9. **逻辑身份 ≠ 机器路径**:项目 `entity`(逻辑)进共享 markdown;机器路径进 **gitignore 的 `.vault-mind/local-bindings.yaml`**,绝不写进共享 note(跨机/跨 OS 路径不污染真值;换机不换 entity)。
10. **单主看板**:每项目最多**一条**双向写路径(一个 code forge + 一个 primary-board),其余全是**只读镜像**。禁止 `vault↔GitHub`、`vault↔Linear`、`Linear↔GitHub` 同时双向→防同步环。
11. **远端变更不直接改 current-truth**:一律 `webhook → capture candidate(status:draft)→ _triage → promote PR → reviewed`。带 `origin.revision`(远端版本)+ `base-head`(本地基线)做冲突检测。
12. **代码活动只作 evidence**:commit≠in-progress,PR merged≠done。远端事件至多生成 `suggested-state`,**不绕 PR 闸**直接关工作项。
13. **沿用 Task 8 §0 #8**:不做 runtime / daemon。扫描挂在 compile 前 / capture 时 / 现有 scheduler / 手动 `vault project scan`,**不新增常驻进程**。

## §1 schema(新增,均派生为主、少量手写)

```yaml
# 工作真值 note(进共享 markdown)——只放逻辑身份
type: project
entity: project/opencli-admin
state: in-progress        # Task 8 工作流轴
status: reviewed          # 评审轴

# 集成声明(进共享 markdown;声明意图,不含机器路径)
integrations:
  forge:        { provider: gitea,  repo: 2233admin/opencli-admin }
  primary-board:{ provider: linear, project-id: xxx }     # 唯一双向写
  mirrors:
    - { provider: gitea-project, mode: read-only }        # 只读镜像

# 健康轴(由扫描器派生,不手写回源 note)
local-presence: present   # present | missing
repo-health:    unpushed  # no-git | local-only | clean | dirty | unpushed | diverged
board-health:   unbound   # unbound | synced | drift | conflict
```

```yaml
# .vault-mind/local-bindings.yaml —— gitignore,机器私有,绝不提交
project/opencli-admin: { path: D:/projects/opencli-admin }
project/vault-mind:    { path: D:/projects/vault-mind }
```

```yaml
# 项目存在状态 ≠ 工作流 state。工作流仍只有 backlog/todo/in-progress/done/canceled。
# 本地 git 状况走独立的 repo-health 轴,不塞进 state。
```

## §2 派生视图:`_workspace-status.md`(本任务的「拳头功能」)

```markdown
# Workspace Status
## Local Only        (无 remote → 候选一键私有发布)
## Unpushed          (N commits ahead / 分支无 upstream)
## Dirty / Forgotten (dirty 多日 / 末次 commit 很久前)
## Missing Local Path(registry 里有、磁盘上没了)
## Board Unbound     (active 但无外部看板)
## Remote Drift      (Linear says done, vault says in-progress)
```

这才是真正解决「开发了但忘了上传」。

## §3 任务(顺序即优先级)

### 9A — Local Project Registry(先做,Python)
- config `workspace-roots:`(多根目录);`vault project scan` 走根目录,按标记识别项目:`.git/`、`package.json`、`pyproject.toml`、`Cargo.toml`、`go.mod`、`pom.xml`、`*.sln`、`CMakeLists.txt`。
- **无 git / 无 remote / 无看板** 的项目**也**注册进 registry。
- `vault project adopt <path> --entity project/<slug>`;path 写进 `.vault-mind/local-bindings.yaml`(gitignore),entity 写进共享 note。
- 验收:扫一个含 3 类项目(纯本地无 git / 本地 git 无 remote / 有 remote)的 fixture 根目录,三者都进 registry,路径只落 local-bindings、不进共享 markdown。

### 9B — Workspace Health(Python)
- 扫描器对每个 registered + bound 项目派生 `local-presence / repo-health / board-health`;编译 `_workspace-status.md`(上面六段)。
- 验收:fixture 覆盖 local-only / unpushed / dirty / missing-path / unbound 各一,六段分类正确;派生/可重建/未提交/未回改源。

### 9C — Gitea Adapter(Node/TS)
- 发现 `local-only` → 提供「创建私有 Gitea 仓库并上传」,**默认 dry-run**:查 .gitignore / 大文件 / 疑似 secret → 展示将上传文件 → 建 private repo → 加 remote → 首次 push(apply 才执行)。
- 收 push/issue/PR webhook(Gitea REST + 仓库/组织级 webhook);scoped labels(`state/in-progress`、`priority/urgent`)承载通用字段。
- 验收:dry-run 出完整计划且不动远端;apply 路径在 mock/本地 gitea 上建 repo+push;webhook payload → capture candidate。

### 9D — GitHub Adapter(Node/TS)
- commit/PR/review/CI → evidence 进 vault;reviewed issue snapshot → 投影成 GitHub Issue / Projects item(GraphQL Projects V2 + Issues API:依赖/sub-issue/issue fields → 映射 `blocked-by`/层级/properties)。
- **不**负责发现本地未上传项目(那是 9A 的职责)。
- 验收:PR merged 事件 → `suggested-state: done` candidate(不自动关);reviewed issue → 投影 item 字段正确。

### 9E — Linear Adapter(Node/TS)
- initiative/project/cycle/triage 投影;GraphQL query+mutation 建/改 issue;webhook 覆盖 Issues/Projects/Initiatives/Cycles。
- **不**负责发现本地目录;未上传项目可先只在 vault 存在,进入活跃/多人协作才建 Linear Project。
- 验收:Linear 改 issue=done → candidate(vault 仍 in-progress,落 _triage);promote 后 current-truth=done 且回写 Linear;不触发回环。

### 9F — Reconciliation(Python+Node)
- `vault sync pull --all`(全进 candidate)/ `vault sync plan`(预演写哪些远端)/ `vault sync apply`(只把 reviewed current-truth 推外部)。
- 防循环(§0#10 单主看板)、remote `revision` 比对、`base-head` 乐观锁冲突检测。
- 验收:制造一条 vault 与 Linear 并发改 → 检出 conflict 进 _triage 而非静默覆盖;单主看板约束下不产生写回环。

## §4 命令形态(草案)

```bash
vault project scan                         # 扫本地所有项目
vault project adopt <path> --entity ...    # 纳管一个本地项目
vault workspace status                     # 忘上传/未push/长期dirty 总表
vault project bind <entity> --forge gitea --repo ...        # 绑已有远端
vault project publish <entity> --to gitea --private --dry-run  # 一键私有发布(默认只给计划)
vault project bind-board <entity> --provider linear --project-id ...
vault sync pull --all | sync plan | sync apply
```

## §5 落地顺序(强建议)

1. **9A Local Project Registry** — 解决「项目忘上传」根因,优先级最高
2. **9B `_workspace-status.md`** — 拳头视图
3. **9C Gitea 一键私有发布** — 把 local-only 项目接住
4. **9D GitHub evidence / Projects** — 开源协作
5. **9E Linear project projection** — 跨项目人机看板
6. **9F Reconciliation** — 串起双向 + 防环

## §6 边界(明确不做)
不做 runtime / daemon;不替远端执行交易级动作;不让多条双向写路径共存;不把机器路径写进共享 markdown;不让代码活动绕过 PR 闸自动关工作项。

## §7 Adapter 设计(9C–9F 锁定决策)

> 锁定:9C 起的 adapter 全按这套。9C 同时铺**共享脚手架**(transport / provider 接口 / pull→candidate / plan-apply / 防环),9D/9E 复用。

1. **pull-only,不做 webhook**(守 §0 #11):adapter = 一次性 API 客户端,由 `sync pull`(拉远端→生成 candidate)/`sync plan`(预演)/`sync apply`(把 reviewed current-truth 推远端)驱动。**不实现 webhook 接收端**(那要常驻监听=runtime,违反 #11)。若日后要事件驱动,改为「定时 pull」挂现有 scheduler,仍不引入 daemon。
2. **zero-dep transport**:HTTP 走 stdlib `urllib.request`。定义 `Transport` 接口(`request(method,url,headers,body)->resp`),**可注入**——测试用 mock/录制 JSON,**绝不打真 API**。
3. **凭证与端点**:token 从环境变量(`GITEA_TOKEN`/`GITHUB_TOKEN`/`LINEAR_TOKEN`);端点+repo/project 绑定从 gitignored `<vault>/.vault-mind/forge.json`(机器本地、永不提交;secrets 留环境/`~/`,不进库)。缺 token → adapter 优雅报「未配置」,不崩。
4. **provider 接口**:每 adapter 实现 `pull()->[remote item]` 与 `push(snapshot)->payload`。远端变更 → **draft candidate**(`status:draft` + 盖 Task 8 预留的 `origin:{provider,object-id,revision,actor}` + `base-head`)→ `_triage` → promote(走 PR 闸,§0 #4)→ reviewed → 再 push。**代码活动只作 evidence**(§0 #12),PR merged 至多建议 `state:done`,不绕闸自动关。
5. **单主看板防环(§0 #10)**:每项目 `integrations:` 声明一个 forge + 一个 primary-board(双向)+ 只读 mirrors;reconciliation **拒绝**第二条双向写路径。冲突检测靠 `origin.revision`(远端版本)+ `base-head`(本地基线)。
6. **build 序**:9C = Gitea adapter + 脚手架(Transport/provider iface/pull→candidate/plan-apply/防环)→ 9D GitHub(Issues+Projects V2 GraphQL,evidence)→ 9E Linear(GraphQL issues/projects)→ 9F reconciliation(conflict 检测+冲突进 `_triage/Conflicts`)。
7. **测试**:mock transport + 录制 fixtures;断言**双向映射**(remote→candidate、reviewed→payload)+ 防环 + dry-run 默认 + 缺凭证优雅降级。绝不打真 API、不在测试里建真远端 repo。
