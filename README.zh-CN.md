# Cohub

*Host workspaces. Run agents.*

Cohub 是一个以 **Workspace 托管** 为核心、支持在云端部署和运行运行逻辑的开发平台。

它结合了三类能力：
- **类似 JupyterLab / Colab** 的浏览器内运行与调试体验
- **类似 Heroku / Fly.io** 的本地到云端部署流程
- **类似 GitHub / Hugging Face** 的 Workspace 托管、分享与复用模式

## 核心概念

### Workspace
**Workspace** 是 Cohub 中最核心的单元。

它是一个可版本化、可托管、可分享、可部署的工作单元，承载了运行逻辑所需的项目上下文、配置、代码与相关资源。

### Agent
**Agent** 是运行在 Workspace 中的可执行逻辑。

### Runtime
**Runtime** 是某个 Agent 基于特定 Workspace 启动后形成的运行实例。

Runtime 可以处于运行中、休眠中、可恢复或已停止等状态。它是执行、调试与持续交互的外层生命周期单元。

一个 Runtime 内可以包含一个或多个内部 Session。

### Session
**Session** 是 Runtime 内部的 LLM / 会话上下文单元。

每个 Session 维护自己的对话上下文，并可表现为带有分支与 fork 的 tree 结构。

### Channel
**Channel** 是 Runtime 对外通信的接入端点。

例如 Web、Discord、Telegram。用户通过 Channel 与 Runtime 交互，Runtime 也可以通过 Channel 回传结果。

## 仓库结构

```text
cohub/
├── apps/
│   ├── api/          # Hono API — 编排、Provisioning、Session 持久化
│   ├── agent/        # Runtime Pod 内的 Supervisor，封装 Pi coding agent
│   ├── gateway/      # 外部 Channel provider 网关（独立部署）
│   ├── web/          # SvelteKit 控制台
│   └── worker/       # 任务调度器 — 定时任务与异步处理
├── packages/
│   └── protocol/     # 跨 app 共享的类型与协议
├── deploy/           # K8s 部署配置（按环境）
├── docs/             # 架构与设计文档
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

详见 `docs/` 目录，推荐阅读顺序请查看 [`docs/README.md`](./docs/README.md)。
