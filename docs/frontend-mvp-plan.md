# 前端 MVP 改造计划

在 `apps/web` (SvelteKit) 中，重点突出面向开发者的工具属性，交互流变更为：**浏览 Workspaces、浏览 Agents，将它们组合后开启并进入一个会话 (Session) 进行联调调试。**

## 核心页面路由规划

| 路由 | 功能描述 | 细节 |
| :--- | :--- | :--- |
| `/` | 落地首页 | 极简风格的 Hero Section，展示“AI Workspace & Agent Orchestration Platform”理念。提供进入工作区的快捷入口。 |
| `/workspaces` | 工作区列表页 | 展示可用的 `Workspaces`（卡片列表），提供点击进入详情页的入口 |
| `/workspaces/[id]` | 工作区详情页 | 展示 Workspace 的 `description` 和配置元数据。提供 **“在工作区中部署 Agent (Start Session)”** 的操作按钮 |
| `/sessions/new?workspace_id=xxx` | 会话初始化页 | （过渡页或弹窗）让用户从自己的 Agent 列表中**选择一个 Agent** 部署到选定的 Workspace。点击“Start”请求后端创建 Session，然后跳转到调试台页。 |
| `/sessions/[id]` | 调试交互页 (Console) | 左侧侧边栏展示当前 Workspace 和 Agent 的组合信息，右侧为核心的对话输入与输出面板，用于调试验证。 |

## 交互流程串联

1. 用户访问 `/workspaces` 浏览工作区。
2. 点选一个工作区（如“客服知识库”），进入详情 `/workspaces/[id]`。
3. 点击“Start Session”。
4. 跳转至 `/sessions/new?workspace_id=[id]` 页面，弹出一个列表让用户挑选自己的 `Agent`（如“售后支持机器人”）。
5. 点击确认，前端向后端发送 `POST ${PUBLIC_API_ORIGIN}/api/sessions`（参数为 `workspace_id` + `agent_id`）。
6. 后端创建并返回 Session ID，前端使用 `goto('/sessions/' + session_id)` 跳转至调试台。
7. 用户在调试台中发送文本，与后端 `${PUBLIC_API_ORIGIN}/api/sessions/[id]/chat` 接口通信，验证 Agent 在当前 Workspace 下的回复表现。

## 阶段性 Mock 策略

在 API 尚未提供真实数据前，我们在 SvelteKit 的 `lib/mock.ts` 中写入测试用的 Workspace 和 Agent 对象：

- **Mock Workspaces**: 包含 2 个工作区（比如 "Customer Support", "Data Analysis"）。
- **Mock Agents**: 包含 2 个智能体（比如 "Support Bot", "SQL Assistant"）。
- **Mock Session & Chat**: 前端暂存对话列表数组，调用一个空函数模拟等待。
