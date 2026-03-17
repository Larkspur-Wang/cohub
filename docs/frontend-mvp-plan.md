# Phase 1: Web 前端 MVP 设计方案

## 1. 目标
在 `apps/web` (SvelteKit) 中删减不必要的页面（原有的 Git/Workspace 仓库浏览逻辑），替换为符合 Phase 1 MVP 目标的交互流：**能够浏览 Worlds、浏览 Agents，将它们组合后开启并进入一个会话 (Session) 进行 Chat。**

## 2. 目录结构与页面改造

**原有的无用页面（建议删除/覆盖）：**
- ❌ `src/routes/workspaces/[owner]/[repo]/` (原代码库浏览逻辑)

**新增的核心页面流（MVP 阶段）：**

| 路由路径 | 页面描述 | 核心功能 |
| :--- | :--- | :--- |
| `/` | 首页 | 展示欢迎语，引导用户进入“探索世界”或“我的角色” |
| `/worlds` | 世界列表页 | 展示可用的 `Worlds`（卡片列表），提供点击进入详情页的入口 |
| `/worlds/[id]` | 世界详情页 | 展示 World 的 `description` 和背景设定。提供 **“带上 Agent 探索此世界 (Start Session)”** 按钮 |
| `/agents` | 角色列表页 | 展示可用的 `Agents`。提供点击进入详情页或“新建 Agent”的入口 |
| `/agents/[id]` | 角色详情页 | 展示 Agent 的设定（如名称、描述）。 |
| `/sessions/new?world_id=xxx` | 会话初始化页 | （过渡页或弹窗）让用户从自己的 Agent 列表中**选择一个 Agent** 丢入选定的 World。点击“Start”请求后端创建 Session，然后跳转到 Chat 页。 |
| `/sessions/[id]` | 对话交互页 (Chat) | 左侧侧边栏展示当前 World 和 Agent 信息，右侧为核心的类似 ChatGPT 的对话气泡列表与输入框。 |

## 3. 页面交互流程 (User Flow)
1. 用户访问 `/worlds` 浏览世界。
2. 点选一个世界（如“赛博朋克夜之城”），进入详情 `/worlds/[id]`。
3. 点击 **“开启探索 (Start Session)”** 按钮。
4. 跳转至 `/sessions/new?world_id=[id]` 页面，弹出一个列表让用户挑选自己的 `Agent`（如“黑客义体医生”）。
5. 点击确认，前端向后端发送 `POST /api/sessions` (参数为 `world_id` + `agent_id`)。
6. 后端返回 `session_id`，前端跳转到 `/sessions/[session_id]`。
7. 进入主 Chat 界面，向后端发起首条系统欢迎消息请求，随后用户可以发消息聊天。

## 4. UI 库与样式栈
- 当前 `apps/web` 中包含了一个基础的 `app.css`，看依赖中没有 Tailwind/DaisyUI 等。
- **建议**：为了第一阶段的快速和美观，我们使用原生的极简 CSS + CSS Variables 或者是如果你偏好，我们可以不引入重量级 UI 库，手写一些极简大气的 Flex 布局和卡片样式（类似 Vercel / Huggingface 的性冷淡极简风）。

## 5. Mock 数据规划（第一阶段联调前）
在 API 尚未提供真实数据前，我们在 SvelteKit 的 `lib/mock.ts` 中写死几个 World 和 Agent 对象：
- **Mock Worlds**: 包含 2 个世界（比如 Sci-Fi, Fantasy）。
- **Mock Agents**: 包含 2 个角色（比如 雇佣兵, 魔法学徒）。
- 组件中使用这些 mock 数据占位，保证流程连贯跑通。

---
**确认点：**
1. 这个路由结构 (`/worlds`, `/agents`, `/sessions`) 是否符合你的预期？
2. 新建 Session 的交互：是在世界详情页点击后**先跳选择 Agent 页**，还是直接用一个 Svelte 模态框 (Modal) 选完直接进 Chat？（推荐弹窗或下拉框选 Agent，体验更连贯）
3. 样式风格上，要不要我现在顺手给你配置一下 TailwindCSS 还是就手写轻量 CSS？