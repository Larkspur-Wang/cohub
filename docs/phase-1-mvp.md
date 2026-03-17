# Phase 1 MVP: 核心对话会话 (Core Chat Session)

## 1. 目标 (Objective)
验证 Netaverses 的核心业务循环：能够拉取一个 **World (世界)** 与一个 **Agent (角色)** 的设定资产，将它们结合并在云端启动一个 **Session (会话)**，最终通过 Web 界面（充当默认的 **Portal**）与 Agent 进行直接的 Chat 交互。

## 2. 核心价值验证 (Why this MVP?)
这个 MVP 抛弃了早期复杂的 Git 版本控制、多端接入和复杂的玩法规则，直击系统的心脏：
- 验证 World 和 Agent 设定分离（解耦）后，能否被 LLM 良好地理解并组合。
- 跑通 Session（运行实例）的生命周期管理与上下文（Context/Memory）维护。
- 为后续更复杂的 Playground（如跑团规则）和 Portal（如 Discord）奠定底层引擎基础。

## 3. 核心范围 (Scope)

在 MVP 阶段，5 大核心概念的落地形态如下：

- **🌍 World**: 最小化可行的数据结构（如一个包含 `description.md`, `lore.json` 的本地文件夹），提供世界观背景。
- **🧠 Agent**: 最小化可行的数据结构（如一个包含 `identity.md`, `persona.json` 的本地文件夹），提供角色性格与设定。
- **🎭 Playground**: 提供一个默认的、最基础的 **"Free Talk" (自由对话)** 玩法模组。没有复杂的数值和判定规则，仅做纯文本的 Roleplay (角色扮演)。
- **⚡️ Session**: 后端 (Hono) 维护的运行时状态。负责将 World 和 Agent 的设定拼装为 System Prompt，管理对话历史 (History)，并对接 LLM (如 OpenAI 兼容接口)。
- **🚪 Portal**: Netaverses 的 Web 工作台 (SvelteKit) 直接充当 Portal，提供一个类似 ChatGPT 的对话 UI，支持展示当前所处的世界和对话的角色。

## 4. 暂不包含 (Out of Scope for MVP)
为了保证第一阶段能够极速落地并看到效果，以下特性在 MVP 中**明确不包含**：
- ❌ 复杂的基于 Git 的资产托管、版本控制与 Fork（MVP 阶段可以直接在服务端放几个 Mock 的文件夹作为数据源）。
- ❌ 复杂的 RAG (检索增强生成) 与长期记忆（MVP 阶段暂只用简单的上下文拼接）。
- ❌ 外部 Portal 接入（如 Discord / QQ 机器人）。
- ❌ 复杂的 Playground 规则解析（如掷骰子、属性卡、抽卡机制）。
- ❌ 多 Agent 同在一个 Session 里的群聊。

## 5. 实施路径 (Implementation Steps)

1. **Schema 设计**: 确定 World 和 Agent 的文件目录结构和元数据格式（YAML / JSON / Markdown）。
2. **Mock 数据准备**: 手写 1 个测试用的 World（例如：赛博朋克夜之城）和 1 个 Agent（例如：义体医生）。
3. **API 层 (Hono) 开发**:
   - `GET /api/worlds` & `GET /api/agents` (读取本地 mock 数据返回)。
   - `POST /api/sessions` (选择 World + Agent，初始化会话，生成初始 System Prompt)。
   - `POST /api/sessions/:id/chat` (接收用户消息，调用 LLM，返回流式或普通响应)。
4. **Web 层 (SvelteKit) 开发**:
   - 简单的选择页：选择组合 World 与 Agent。
   - Session 界面：左右分栏结构（左侧显示世界/角色卡片元信息，右侧为主聊天区）。
5. **联调与体验验证**: 确认对话时 Agent 能否准确体现自己的 Persona 以及 World 的世界观限制。

## 6. 成功标准
当我们可以打开浏览器，选择“赛博朋克夜之城” + “义体医生”，并在网页里与他顺畅聊天，且他能根据设定的世界观回答问题时，MVP 即宣告成功。
