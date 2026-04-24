# Cohub 迭代总结 (2026-04-23)

> 171 files changed, +13,744 / -4,153

一天连打 5 个 tag（v0.7.5 → v0.9.0），这不是发版，这是给代码做心肺复苏。

---

## 一、新增大模块

### Agent Runtime 全面重构（全新运行时系统）
- **CohubAgentSession**：全新的 agent 会话抽象，封装 prompt / steer / setModel / reload / abort 生命周期
- **SessionManager**：基于 JSONL 文件落盘的会话管理，支持分支会话（branched session）、消息/思考等级/模型切换/压缩等各类 entry 类型
- **CohubModelRegistry**：从 `models.json` 动态加载模型注册表，支持多 provider、API key 注入、header 注入
- **SystemPromptBuilder**：自动加载 AGENTS.md / CLAUDE.md 上下文文件和 .agents/skills 目录，动态组装系统提示词
- **Agent Tools 体系**：read / write / edit / bash / ls / find / grep 七大工具完整重建，带截断控制（truncate）和类型安全
- **好处**：彻底摆脱 pi coding agent 依赖，Cohub 拥有自主可控的 agent 运行时，模型切换、技能加载、上下文管理全部内化

### SDK 正式发布（@neta-art/cohub @ npm 1.0.0）
- 完整的 Space / Session / File / Member / Access / Checkpoint / Channel / CronJob / Task 客户端 API
- HTTP + WebSocket 双通道，支持 `space.subscribe()` / `session.subscribe()` 实时事件订阅
- 业务语义事件：`turn.progress` / `turn.final` / `turn.error` / `message.persisted`
- HTTP-only 和 WebSocket-only 两种独立入口
- **好处**：前端从手写 828 行 `api.ts` 迁移到 SDK 统一调用，第三方集成也有了标准客户端

### Token 用量统计（token_usage_stats_hourly）
- 新表按小时聚合 token 输入/输出/缓存读/缓存写、请求成功/失败数、成本估算
- 多维索引覆盖 user / space / session / provider+model 维度
- session_messages 新增 `usage` jsonb 字段
- **好处**：终于能回答"这个 space 花了多少钱"这个灵魂拷问了

### Gateway Contract 包（@cohub/gateway-contract）
- 定义 Discord / Feishu 的 delivery plan 结构，将出站命令转译为各平台的发送策略
- **好处**：网关输出规划与协议层解耦，新渠道接入只需新增 adapter

---

## 二、用户体验优化

### 消息元数据栏（Meta Bar）
- 每条消息底部新增一行展示：复制按钮 | 模型名称 | token 用量 | 时间
- 支持移动端响应式，模型名过长自动截断保证时间可见
- 仅 assistant 消息显示，hover 高亮，带复制成功反馈动画
- **好处**：不用点开详情就能快速判断这条回复是哪个模型、花了多少 token

### 图片查看增强
- 图片点击可缩放，缩放后支持拖拽平移（drag to pan）
- 文件大小格式化显示（B / KB / MB）
- **好处**：查看 agent 生成的截图 / 设计稿不再瞎凑合

### 内联文件面板（Inline File Panel）
- 右侧文件面板可直接在 workspace 页面内展开，支持拖拽调整大小
- 工具栏新增复制图标 + segmented toggle 切换视图
- **好处**：边聊天边看代码文件，不用跳来跳去

### 匿名会话访问
- session access 路由支持 `anonymous_user` 策略配置
- 匿名用户可通过 minimal space info 优雅访问，不再直接 403
- **好处**：分享 session 链接给非登录用户终于能看了

---

## 三、技术上大的重构

### 权限系统：从 flat permission 迁移到 RBAC
- 废弃 `resourcePermissions` 表，新建 `spaceMembers` 表 + `accessPolicies` 表
- 角色模型：`host` / `maker` / `guest`，每个角色映射一套精细权限（space.view、session.prompt.fullaccess、file.edit 等 17 种权限）
- 新增 `isLastHost` 守卫（防止 host 把自己踢出去导致 space 无人认领）
- API 路由全面适配：collaborators → members，permissions → access policies
- **好处**：多人协作空间终于有了清晰的权限边界，不再是"要么全有要么全无"

### 前端数据层：web app 全面迁移到 SDK
- 删除 `apps/web/src/lib/api.ts`（828 行 → 0 行）
- 新建 `apps/web/src/lib/sdk.ts`，通过 `createCohubClient` 统一初始化
- 所有 stores（auth / session-list / session-pending / session-state）改为通过 SDK 调用
- WebSocket 实时事件集成到前端 stores
- **好处**：前端不再维护一套重复的 API client，类型安全和错误处理全部交给 SDK

### Protocol 分层重构
- 协议包从扁平结构拆分为子路径：`@neta-art/cohub-protocol/core` / `/gateway` / `/realtime` / `/fs` / `/task`
- `session-ingestion.ts` → `model/session.ts`，`gateway.ts` → `gateway/index.ts`，`tasks.ts` → `task/index.ts`
- `websocket.ts` 移入 `realtime/` 子目录
- 移除 `permissions.ts` / `responses.ts` / `space-sandbox.ts`（职责下沉到具体应用层）
- 新增 `realtime/stream.ts` 类型定义
- **好处**：协议边界清晰，消费方按需引入子模块，减少 bundle 体积

### Session 数据访问：web → SDK 迁移
- 新增 `session-list-cache.ts` 按 space 缓存 session 列表
- `session-tree.ts` 重构适配 SDK 数据结构
- `message-cache.ts` 从 346 行大幅精简
- Vite 构建配置重构，解决 protocol subpath alias 匹配问题
- **好处**：session 列表缓存减少重复请求，message 渲染更流畅

---

## 四、Bug Fix

- SDK WebSocket 自动重连：`4001 expired` 错误在 connecting 状态也能触发重连
- WebSocket 订阅前置检查：确保连接建立后再 subscribe，避免丢失事件
- `activeSessionState.session` 为 undefined 时防止前端崩溃
- Vite 动态 env import 回退到静态，修复 API 404
- Drizzle v2 migration journal / snapshot / SQL 文件一致性修复
- 已有 v2 表时跳过 drizzle migrate（防止重复建表报错）
- Worker save-checkpoint task 在 commit 前正确设置 git user identity
- Gateway Dockerfile 补上 gateway-contract 构建步骤
- CI pnpm filter 包名修正为 `@neta-art/cohub-protocol`
- Inline panel 左边框始终可见，右侧 sidebar resize 样式统一
- 复制反馈 + segmented toggle 可见性 + inline panel resize 联动修复
- Agent tsconfig typecheck 补上 protocol subpath entries
- SDK 包名从 `@neta-art/cohub` 修正为 `@cohub/sdk`

---

## 五、基础设施 & 发布

- **SDK 发布到 npm**：`@neta-art/cohub@1.0.0` 公开包，含 build / typecheck 发布检查清单
- **Protocol 1.0.0**：同步发版，README 重写为 co-creation 定位
- **Sandbox 资源调优**：CPU limit 从 1 提升到 2，restartPolicy 改为 `OnFailure`
- **包名统一**：GitHub repo URL 全部修正为 `talesofai/cohub`
- **E2E 测试**：新增 tool call 全链路验证脚本（WS 事件 + DB 持久化双校验）
- **文档**：SDK README 132 行完整文档，Protocol README 重写
