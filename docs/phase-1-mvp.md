# Phase 1 MVP 定义

## 核心目标

验证 Netaverses 的核心技术链路：能够拉取一个 **Workspace (工作区)** 与一个 **Agent (智能体)** 的配置资产，将它们结合并在云端启动一个 **Session (会话)**，最终通过 Web 界面（充当默认的 **Channel**）与 Agent 进行直接的交互联调。

## 关键验证点

- 验证 Workspace 和 Agent 配置分离（解耦）后，能否被良好地组合及理解。
- 为后续更复杂的工具调用（Function Calling）和第三方 Channel 接入奠定底层引擎基础。
- 前后端基于 Hono + SvelteKit 的基本联调跑通，数据库 Schema 设计无误。

## 最小可用范围 (Scope)

### 包含内容 (In Scope)

- **🌍 Workspace**: 最小化可行的数据结构，提供上下文环境与静态提示词配置。
- **🧠 Agent**: 定义智能体的模型偏好、人设与核心指令。
- **⚡️ Session**: 后端 (Hono) 维护的运行时状态。负责将 Workspace 和 Agent 的设定拼装为 System Prompt，管理对话历史 (History)，并对接 LLM (如 OpenAI 兼容接口)。
- **🚪 Channel**: Netaverses 的 Web 工作台 (SvelteKit) 直接充当 Channel，提供一个对话调试 UI，支持展示当前所处的工作区和调试的智能体。

### 不包含内容 (Out of Scope)

- ❌ Git 底层存储库真实对接（Phase 1 可先写死本地文件夹或 Mock 模拟托管流程）。
- ❌ 复杂权限控制（Auth）。
- ❌ 第三方 Channel 接入（如 Webhook / Slack 机器人）。

## 开发路径规划

1. **Schema 设计**: 确定 Workspace 和 Agent 的元数据格式与基本表结构。
2. **Mock 数据准备**: 构建 1 个测试用的 Workspace 和 1 个 Agent。
3. **后端 API (Hono)**:
   - `GET /api/workspaces` & `GET /api/agents` (返回 mock 列表)。
   - `POST /api/sessions` (选择 Workspace + Agent，初始化会话，生成初始 System Prompt)。
   - `POST /api/sessions/:id/chat` (向特定会话发送消息并获取 LLM 回复)。
4. **前端工作台 (SvelteKit)**:
   - 列表页：浏览 Workspaces 与 Agents。
   - 会话启动页：选择组合 Workspace 与 Agent。
   - 调试面板：类似 ChatGPT 的聊天 UI。
5. **联调与体验验证**: 确认对话时 Agent 能否准确结合 Workspace 的上下文。
