# Netaverses

Netaverses 是一个以 **Workspace 托管** 为核心、支持在云端部署和运行 Agent 的平台。

它结合了三类能力：
- **类似 JupyterLab / Colab** 的浏览器内运行与调试体验
- **类似 Heroku / Fly.io** 的本地到云端部署流程
- **类似 GitHub / Hugging Face** 的 Workspace 托管、分享与复用模式

## 核心概念

### Workspace
**Workspace** 是 Netaverses 中最核心的单元。

它是一个可版本化、可托管、可分享、可部署的工作单元，承载了运行 Agent 所需的项目上下文、配置、代码与相关资源。

Workspace 同时也是：
- 在云端托管的基本单元
- 从本地推送到远端的基本单元
- 分享给其他人的基本单元
- 用来部署 Agent 的基本单元
- 可被其他开发者复用或 Fork 的基本单元

### Agent
**Agent** 是运行在 Workspace 中的可执行逻辑。

如果说 Workspace 是项目单元，那么 Agent 就是在其中运行的行为逻辑。

### Session
**Session** 是某个 Agent 基于特定 Workspace 启动后形成的一次运行实例。

它代表一个真实存在的运行时上下文，可用于调试、执行或持续交互。

### Channel
**Channel** 是 Session 对外通信的接入端点。

例如 Web、Discord、Telegram。用户通过 Channel 与 Agent 交互，Agent 也可以通过 Channel 回传结果。

## 项目定位

Netaverses 的核心前提是：**Workspace 是主要的云端资产**。

这个平台主要用于：
- **托管** 可复用 Workspace
- **运行** 基于 Workspace 的 Agent
- **部署** 基于 Workspace 的 Agent 负载
- **分发** 可复用 Workspace 给其他开发者

> Netaverses 是一个托管可复用 Workspace、并基于其部署 Agent 的云平台。

## 典型使用场景

### 1. 浏览器内运行
直接在浏览器里基于某个 Workspace 拉起 Agent，用于云端调试和执行。

### 2. 本地到云端部署
把本地 Workspace 推送到云端，并从中部署一个 Agent。

### 3. 多 Channel 持续交互
让云端长任务通过 Discord、Telegram 等 Channel 把结果推送给用户，并从用户回复继续后续执行。

### 4. Workspace 托管与复用
像在 GitHub 上托管代码、在 Hugging Face 上托管模型一样，托管成熟 Workspace，让其他开发者可以发现、复用并继续构建。

## 术语说明

- **Workspace**：可运行、可托管、可分享的项目单元
- **Agent**：运行在 Workspace 中的可执行行为
- **Session**：活跃的运行时实例
- **Channel**：对外通信接口

## 技术栈

- **语言**: TypeScript
- **前端**: SvelteKit
- **后端**: Hono
- **数据库**: PostgreSQL + Drizzle ORM
- **基础设施**: Kubernetes (ACK)
- **包管理**: pnpm monorepo

## 仓库结构

```text
netaverses/
├── apps/
│   ├── api/          # 编排与运行服务
│   └── web/          # Web 控制台
├── deploy/           # 部署配置
├── docs/             # 架构与设计文档
├── packages/         # 共享包
└── README.md
```

## 本地开发

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

- `docs/terminology.md`
- `docs/use-cases.md`
- `docs/phase-1-mvp.md`
- `docs/frontend-mvp-plan.md`
- `docs/db-schema.md`

## 路线图

- **Phase 1**：打通 Workspace + Agent + Session + Web Channel 的基础链路
- **Phase 2**：增强云端运行、调试与任务生命周期管理
- **Phase 3**：支持本地 Workspace 推送上云部署，以及更多 Channel 集成
- **Phase 4**：建立 Workspace 的分享、复用与分发机制
