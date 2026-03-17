# Netaverses

Netaverses 是一个面向 AI 驱动的新一代 **World Studio**（世界构建与运行平台）。
你可以将它理解为**“叙事与计算资源的 GitHub/HuggingFace”**。在这里，创作者可以构建世界观、塑造角色灵魂，并让它们在云端运行，通过各种媒介与现实世界连接。

## 核心概念 (Terminology)

平台的运作基于以下五个高度解耦且可复用的核心实体：

- 🌍 **World (世界)**
  世界的背景设定、规则库、知识库。它是一个托管在云端的文件夹（Repository），具备类似 Git 的版本控制特性。可以通过书籍导入、从零构建或 Fork 他人的开源世界来创建。
- 🧠 **Agent (智能体/角色)**
  实体的内在精神内核，包含其身份标识 (Identity)、记忆、性格与话风。Agent 同样作为一个独立的文件系统存在。一个 Agent 可以穿梭、放置于不同的 World 中。
- 🎭 **Playground (游乐场/玩法)**
  基于特定 World 开发的“消费体验”或玩法模组 (Module/Scenario)。基于同一个 World，不同的创作者可以开发出跑团 (TRPG) Playground、抽卡养成 Playground 或文字 AVG Playground 等等。
- ⚡️ **Session (运行会话)**
  当一个 World、一个或多个 Agent，搭配上特定的 Playground 开始在云端节点上运行时，即开启了一个独立的 Session（实例）。它是处于“活跃”和“推演”状态的动态宇宙。
- 🚪 **Portal (传送门/渠道)**
  运行中的 Session 与现实世界用户交互的物理/数字媒介。你可以为 Agent 绑定 Discord、QQ、微信或 Web 端作为 Portal，让它通过这些真实的渠道与玩家进行互动。

## 架构概览

- **统一数据层 (基于 Git)**：World 和 Agent 的底层数据结构均以文件夹形式存在，通过 Git/类 Git 的底层机制进行版本控制、协作、Fork 与托管。
- **云端运行引擎**：负责调度和维持 Session 的生命周期，将 World 的世界观规则与 Agent 的思维逻辑相融合。
- **API 服务层 (Hono)**：处理核心业务逻辑、实体 CRUD、权限管控及触发 Session 的流转。
- **Web 工作台 (SvelteKit)**：面向创作者的 World Studio 界面，支持可视化浏览、创作、配置和组合各个实体。

### 技术栈偏好

- **语言**: 全栈 TypeScript
- **包管理**: pnpm (Monorepo)
- **代码规范**: Biome
- **前端框架**: Svelte / SvelteKit
- **后端框架**: Hono (Node.js / Bun 兼容)
- **基础设施**: Alibaba Cloud ACK (Kubernetes)

## 目录结构

```text
netaverses/
├── apps/
│   ├── api/                  # Netaverses API 服务 (Hono)
│   └── web/                  # Netaverses Studio 前端 (SvelteKit)
├── deploy/                   # 基础设施与云端部署配置
├── docs/                     # 详细设计文档与架构方案
├── packages/                 # Monorepo 共享包 (如 types, 公共组件, 脚本等)
├── biome.json                # Biome 配置文件
└── package.json
```

## 本地开发

### 前置要求

- Node.js 22+
- pnpm 9.12.1+

### 安装依赖

```bash
pnpm install
```

### 开发模式

```bash
# 启动所有应用（api + web）
pnpm dev

# 或单独启动
cd apps/api && pnpm dev
cd apps/web && pnpm dev
```

### 代码检查与构建

```bash
# 格式化与 Lint (Biome)
pnpm lint

# 遇到 lint 问题尽量解决，而不是 ignore
pnpm lint:fix 

# 类型检查
pnpm typecheck

# 生产环境构建
pnpm build
```

## 演进路线

- **Phase 1: 基础设施与数据基座**
  - [ ] 确立 World 和 Agent 的标准目录 Schema (元信息、知识库、记忆等)。
  - [ ] 跑通基于底层存储库的资产托管与版本控制机制。
  - [ ] 开发 Web Studio，实现 World 与 Agent 资产的浏览、上传、展示。
- **Phase 2: 玩法机制与运行时**
  - [ ] 设计并实现 Playground 机制，提供标准化的场景钩子与规则系统。
  - [ ] 构建 Session 调度引擎，支持在云端计算节点上拉起并维持世界实例。
- **Phase 3: 跨界连接**
  - [ ] 开发标准化 Portal 适配层。
  - [ ] 接入 Discord、QQ 等主流社交 Portal，实现从“世界”到“现实”的消息流转与事件反馈。
