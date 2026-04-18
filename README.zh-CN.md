# Cohub

*在 Space 中创作，保存 Checkpoint，与 Agent 共创。*

Cohub 是一个面向 **Space 驱动的 Agent 创作、运行与协作** 的云平台。

它结合了三类能力：
- **类似 JupyterLab / Colab** 的浏览器内创作与调试体验
- **类似 Heroku / Fly.io** 的本地到云端部署流程
- **类似 GitHub / Hugging Face** 的分享、复用与社区共创模式

## 核心概念

### Space
**Space** 是 Cohub 中最核心的单元。

Space 是一个实时、隔离的创作环境，用户和 Agent 会在其中共同对话、改文件、做实验，并不断推进尚未固化的想法。

Space 同时也是：
- 主要的创作场所
- 在浏览器中打开和工作的单元
- 运行 Agent 的上下文容器
- 后续可保存、可派生、可继续演化的基础单元

### Checkpoint
**Checkpoint** 是从 Space 中保存出来的不可变快照。

它代表某个有价值的阶段性成果，是后续分享、回滚、派生与复用的稳定基准。

Checkpoint 同时也是：
- 某个 Space 状态的静态截面
- 对外分享与发现的基础资产
- 后续 Fork 的来源
- 共创过程中重要的安全锚点

### Proposal
**Proposal** 是把某个 Checkpoint 的成果贡献回另一个 Space 的共创流程。

它承载评审、讨论与合入，是 Cohub 中对应协作与合并的核心机制。

### Agent
**Agent** 是运行在 Space 中的可执行智能体逻辑。

如果说 Space 是创作环境，那么 Agent 就是在其中持续协作的主动执行者。

### Session
**Session** 是 Space 内部的 LLM 会话上下文单元。

每个 Session 都维护自己的交互历史，用户可以在不同 Session 中探索不同方向。

### Channel
**Channel** 是连接到 Space 的外部通信入口。

例如 Web、Discord、Telegram、飞书。用户通过 Channel 与 Agent 交互，Agent 也可以通过 Channel 回传结果。

### Sandbox
**Sandbox** 是 Space 背后的内部执行基础设施。

系统内部仍然维护 sandbox 状态，但它属于基础设施层概念，而不再是主要的用户心智模型。

## 产品定位

Cohub 的核心思路是：**Space 是主要的创作界面，Checkpoint 是沉淀下来的可复用资产。**

这个平台适合：
- 在实时 Space 中与 Agent 一起创作
- 将阶段性成果保存为 Checkpoint
- 从 Checkpoint 派生出新的 Space 继续探索
- 通过 Proposal 将成果贡献回其他 Space
- 基于 Space 上下文部署 Agent 工作负载

> Cohub 是一个让用户在 Space 中创作、将成果保存为 Checkpoint，并与 Agent 持续共创的云平台。

## 共创工作流

### 1. 在 Space 中创作
创建一个 Space，在浏览器中与 Agent 对话、修改文件、持续迭代。

### 2. 保存 Checkpoint
当 Space 达到一个有价值的阶段时，将其保存为 Checkpoint。

### 3. Fork 并继续探索
基于已有 Checkpoint Fork 出一个新的隔离 Space，继续实验和演化。

### 4. 发起 Proposal
把你的成果整理成 Proposal，贡献回另一个 Space。

## 技术栈

- **语言**：TypeScript + Go
- **前端**：SvelteKit
- **后端**：Hono
- **Agent Runtime**：pi-coding-agent（WS 客户端，主动连接 sandbox）
- **Sandbox Runtime**：Go + WebSocket server
- **数据库**：PostgreSQL + Drizzle ORM
- **基础设施**：Kubernetes (ACK)
- **包管理**：pnpm monorepo

## 仓库结构

```text
cohub/
├── apps/
│   ├── api/          # Hono API — 编排、Provisioning、Session 持久化
│   ├── agent/        # Agent 控制服务 — 运行 Pi coding agent，作为 WS 客户端连接 sandbox
│   ├── sandbox/      # Sandbox 执行器 — Go WS server，负责 workspace / fs / process primitive
│   ├── gateway/      # 外部 channel provider 网关（独立部署）
│   ├── web/          # SvelteKit Web 控制台
│   └── worker/       # 任务调度器 — 定时任务与异步任务处理
├── deploy/           # 部署配置（按环境组织的 K8s manifests）
├── docs/             # 架构、迁移与产品模型文档
├── packages/
│   ├── protocol/            # 跨 apps 共享的类型与协议
│   └── agent-sandbox-protocol/  # Agent-Sandbox WebSocket RPC 协议
├── scripts/          # 工具脚本
└── README.zh-CN.md
```

## 开发

```bash
pnpm install
pnpm dev
```

### 质量检查

```bash
pnpm lint
pnpm typecheck
pnpm build
```

## 文档

推荐优先阅读：
- `docs/agent-sandbox-runtime.md`
- `docs/prod-deploy-checklist.md`
- `docs/CO-CREATION-MODEL.md`
- `docs/MIGRATION-PROGRESS.md`
- `docs/SCHEMA-MIGRATION-PLAN.md`
