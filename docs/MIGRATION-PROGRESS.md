# Space + Checkpoint 迁移进度与后续 TODO

## 1. 背景与目标

### 旧模型 (Old Model)
- **Workspace**: 偏向静态代码仓库，与动态运行时割裂。
- **Runtime**: 沙盒/运行时环境，包含状态 (starting/running/hibernated)，用户需手动操作 (wake/hibernate)。
- **Git 绑定**: 强绑定于 Workspace，操作重且复杂。

### 新模型 (New Model)
- **Space**: 统一的工作空间与沙盒。创建即运行，不再暴露底层 Runtime 概念。
- **Checkpoint**: 静态截面。替代 Commit，支持一键存档、分享、派生 (Fork)。
- **Proposal**: 共创提案。替代 PR/Merge Request，基于 Checkpoint 进行合并。
- **Sandbox**: 内部基础设施。负责状态流转 (pending -> ready -> error)，用户无感。

### 核心目标
- **去 Runtime 化**: 彻底移除 Runtime 作为一等公民的概念。
- **用户友好**: 用户只需关注 Space 和 Session，不再管理环境状态。
- **共创友好**: 建立基于 Checkpoint 的派生与提案流。

---

## 2. 迁移过程总结

### 2.1 协议与定义层 (Protocol)
- ✅ 核心类型重命名: `runtimeId` -> `spaceId`, `RuntimeStatus` -> `SpaceSandboxStatus`.
- ✅ 清理旧类型: 移除 `RuntimeFs*`, `RuntimeRecord`, `RuntimeStatus` 等。
- ✅ 新增空间类型: `SpaceSandboxStatus`, `SpaceFs*` 系列类型.
- ✅ 消息协议更新: `SessionPromptInput`, `RegisterSessionInput`, `GatewayOutboundCommand` 等全面切换.

### 2.2 数据库架构 (Database)
- ✅ **Schema V2 隔离**: 在 PostgreSQL 中创建 `v2` 命名空间，避免破坏旧 `public` 表.
- ✅ **新表定义**: 
  - `spaces`: 替代 workspaces + runtimes.
  - `space_sandboxes`: 承载运行状态，对业务透明.
  - `space_sessions`, `space_channels`, `space_session_bindings`: 会话与通道映射.
  - `checkpoints`, `proposals`: 为后续共创功能预留.
- ✅ **数据迁移**: 编写 `migrate-v2-data.ts`，支持将现有 `runtimes` 数据平滑迁移至 `v2` 空间.

### 2.3 后端服务 (API / Worker / Agent / Sandbox)
- ✅ **路由切换**:
  - 新增 `/api/spaces/*`, `/internal/spaces/*`.
  - 移除所有 `/api/runtimes/*` (410 Gone -> 404).
- ✅ **执行层重构**:
  - 删除 `runtime-sessions.ts`, `runtime-fs.ts`, `permissions.ts` (旧).
  - 新建 `space-sessions.ts`, `space-fs.ts`, `space-sandboxes.ts`.
  - `channels.ts` / `session-interactions.ts` 全面改用 `v2` 表查询.
- ✅ **运行架构收敛**:
  - Agent 固定为控制面服务，负责 `pi-coding-agent`、Redis、session 与 sandbox ws server.
  - Sandbox 固定为执行面服务，负责 workspace / fs / process primitive.
  - Agent 不再承担 workspace 初始化，本地 init 逻辑已删除.
  - sandbox 状态上报改为由 agent 在 `workspace.prepare` 成功后驱动.

### 2.4 清理与收尾
- ✅ 移除 `db/schema.ts`，项目全面依赖 `schema-v2.ts`.
- ✅ 清理残留的 runtime alias 与废弃路由提示.

---

## 3. 当前进度状态

| 模块 | 进度 | 状态说明 |
| :--- | :---: | :--- |
| **协议层 (Protocol)** | 🟢 100% | 已移除所有 Runtime 类型，全面切换 Space 语义。 |
| **数据库 (DB V2)** | 🟢 100% | V2 Schema 已上线 dev，迁移脚本已验证。 |
| **API 路由** | 🟢 100% | 旧路由已下线，新路由 `/api/spaces` 为主入口。 |
| **核心逻辑 (API)** | 🟢 100% | 空间创建、Session、权限、FS 均已切换至 V2 实现。 |
| **子进程 (Agent / Worker / Sandbox)** | 🟢 100% | Agent 已收敛为控制面服务，Sandbox 已独立为 Go 执行器，二者通过单一 WebSocket 协议协作。 |
| **前端 (Web UI)** | 🟡 85% | `/spaces` 主链路、旧 `/runtimes` 重定向、SSE 聊天、分页缓存、模型选择、图片附件与文件工作台均已恢复；剩余主要为全站细节 polish 与 Checkpoint/Proposal UI。 |

---

## 4. 后续 TODO

### 4.1 前端重构 (Priority: P0)
当前主链路已可用，并且 Space 工作台体验已基本对齐老版本。
- [x] **路由切换**: `/spaces`、`/spaces/new`、`/spaces/:id` 已成为主入口，旧 `/runtimes/*` 页面已改为重定向。
- [x] **创建流改造**: 已切为 `Create Space -> Auto Run`，移除 runtime/sandbox 用户操作入口。
- [x] **UI 概念替换**: Spaces、Sessions、文件操作已切换到 `/api/spaces` 接口。
- [x] **恢复聊天主体验**: `/spaces/:id` 已恢复 SSE 流式响应、乐观更新、历史消息分页、模型选择、图片附件、消息缓存与滚动恢复等核心能力。
- [x] **文件工作台恢复**: 右侧文件区已恢复为接近旧版的文件树 + 文件面板工作台，并支持桌面/移动端侧栏。
- [ ] **最终 polish**: 继续统一全站页面细节、loading/empty/error 态与少量微交互。

### 4.2 Checkpoint 与 Proposal 落地 (Priority: P1)
虽然数据库表已建立，但业务逻辑尚未实现。
- [ ] **Save Checkpoint**: 在 Space 工作台增加保存 Checkpoint 的交互，底层触发 Git Commit 并写入 `v2.checkpoints`。
- [ ] **Fork Space**: 实现基于 Checkpoint 的 Fork 接口 (`POST /api/checkpoints/:id/fork`)。
- [ ] **Proposal 流**: 实现创建提案、合并提案的接口，打通从 Checkpoint A 到 Space B 的代码合入。

### 4.3 基础设施完善 (Priority: P2)
- [ ] **旧迁移文档清理**: 继续移除历史 runtime / 单体 agent-sandbox 术语与旧配置名。
- [ ] **部署模板完善**: 补齐 agent Deployment / Service 的长期模板与文档约定。
- [ ] **公开访问链接**: 确认 `public.cohub.run/r/{id}` 的兼容策略，是维持重定向还是切换为 `/s/{id}`。

### 4.4 体验优化 (Priority: P3)
- [ ] **自动启动优化**: 优化 `provisionSpaceInBackground` 的冷启动速度，让用户创建后更快进入可聊天状态。
- [x] **流式聊天恢复**: Space 工作台已恢复 SSE、乐观更新、离线缓存、重连策略等核心聊天体验。
- [ ] **全站 polish**: 继续统一各页面视觉节奏、列表密度、空态与移动端细节。
- [ ] **Sandbox 容错**: 增强 Sandbox Error 状态下的自愈能力或友好的用户报错提示。
