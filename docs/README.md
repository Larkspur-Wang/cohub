# Cohub 技术文档

本文档目录面向 Cohub 技术团队，描述当前项目在 **产品模型、系统架构、运行链路、数据库设计、Session/Channel 关系、Pi 集成方式** 等方面的统一设计。

## 推荐阅读顺序

如果你要快速建立完整认知，建议按下面顺序阅读：

1. [`terminology.md`](./terminology.md)
   - 项目统一术语
   - Runtime / Session / Channel 的边界

2. [`runtime-session-model.md`](./runtime-session-model.md)
   - 当前最重要的运行时模型
   - 线性 Session + Session Fork 设计

3. [`technical-architecture.md`](./technical-architecture.md)
   - 整体系统架构
   - Web / API / Agent / Gateway / Redis / K8s / Gitea / Pi 的关系
   - 关键时序链路

4. [`db-schema.md`](./db-schema.md)
   - 当前数据库模型
   - Runtime / Session / Message / Channel Binding 的表结构说明

5. [`agent-infra-design.md`](./agent-infra-design.md)
   - Agent 运行基础设施
   - 容器、K8s、运行时、消息转发设计

6. [`cli-vision.md`](./cli-vision.md)
   - 统一 CLI 的长期设想
   - 开发 / 运维 / 用户工作流入口设计

7. [`use-cases.md`](./use-cases.md)
   - 产品侧典型场景

## 当前设计总原则

当前项目围绕下面这条主线组织：

> **Workspace 托管 + 云端 Runtime 运行**

在这条主线之下，当前运行时模型是：

- **Runtime 是 Workspace 启动出来的外层运行实例**
- **Session 是 Runtime 内部的独立上下文容器**
- **Session 内消息是线性的**
- **Fork 会生成新的 Session**
- **Session graph 的边由某条 message 触发 fork 而形成**
- **Channel 永远绑定 Session，不绑定 Message**

一句话概括：

> **平台托管 Workspace，并从 Workspace 启动云端 Runtime；Runtime 下有多个线性 Session，Session 可以从另一 Session 的某条 Message fork 出来。**

## 文档用途

这套文档主要用于：

- 团队内部技术分享
- 新成员 onboarding
- API / Web / Agent / Gateway 协作时的统一模型对齐
- 后续功能设计时的架构依据

## 文档和代码的对应关系

### 核心代码目录

```text
apps/
  api/      # Runtime orchestration / session persistence / channel routing / provisioning
  agent/    # Runtime 内部 Agent Supervisor，封装 Pi session
  gateway/  # 外部 Channel provider 接入层（独立部署）
  web/      # 控制台 / Runtime UI / Session UI / Graph UI

packages/
  protocol/ # API / Gateway / Agent 之间的共享协议
```

### 当前重点文件

```text
apps/api/src/index.ts               # HTTP API 入口
apps/api/src/runtime-sessions.ts    # Runtime / Session / Message 核心逻辑
apps/api/src/channels.ts            # Channel binding 与入站/出站路由
apps/api/src/db/schema.ts           # 当前数据库 schema

apps/agent/src/index.ts             # Agent Supervisor 入口
apps/agent/src/api.ts               # Agent -> API 持久化/注册逻辑
apps/agent/src/redis.ts             # Runtime 输入输出队列协议

apps/web/src/routes/runtimes/[id]/+page.svelte         # Runtime 主界面
apps/web/src/routes/runtimes/[id]/graph/+page.svelte   # Session Graph 页面
```
