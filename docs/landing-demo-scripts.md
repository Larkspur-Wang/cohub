# Landing Page 演示录屏脚本

Landing 页面上有 6 个 16:10 的占位视频位（hero + 5 个 idea）。本文档给出每个视频的录制脚本，全部基于产品真实 UI（已对照 `apps/web/src` 核实）。

## 通用录制要求

- 分辨率 2560×1600（16:10），最低 1920×1200。导出 H.264 MP4，每个约 10–18 秒，无音频（或仅保留 UI 操作音）。
- 主题用暗色模式（默认），保留 brand 橙色点缀。
- 准备一个真实 demo 账号，预置几个 Space，保证侧栏不为空。
- 鼠标移动放慢、有意图，每个关键元素停留约 0.5 秒后再操作。
- 尽量裁掉加载态，但保留一拍流式输出（体现「活的 Space」）。

---

## 1. demo · hero（首屏主视觉）

**目标：** 用约 15 秒的流畅蒙太奇传达「create, play, and build with people and agents」。

**前置：** 一个活跃 Space，聊天会话进行中，时间线里已有一张生成图。

**镜头**
1. Landing 首屏文案短暂可见（0.5 秒）→ 切入产品。
2. Space 工作区：左侧轨道可见（Labels / Chats / Saves / Works / Scheduled / Tasks flyout），一个聊天会话打开，agent 回复正在流式输出。
3. 输入框：输入「make a cover image」→ 回车。Agent 流式输出 thinking block，随后 SessionTaskTray 出现生成任务行（Running 1），时间线渲染出 image block。
4. 快速切换（每拍 0.4 秒）：点 **Saves** flyout → 一个 checkpoint；点 **Works** flyout → 一个已发布 Work；切到 **Port 预览** 标签展示一个运行中的 app。
5. 收尾停在聊天时间线：生成图 + agent 回复稳定下来。

---

## 2. demo · fun to start（有趣能玩）

**理念：** Open a Space and play with ideas, prompts, files, and agents.

**镜头**
1. Spaces 列表 / 首页：点 **Start a Space**（橙色 CTA）。
2. `/spaces/new` 表单：输入名称（如「sketch lab」），slug 自动填充，bootstrap 选 **blank**，点 Create。
3. 进入新 Space——空的聊天会话。展示左侧轨道是全新的（尚无 saves/works）。
4. 输入框输入一个随意的 prompt：「draw a tiny robot watering a plant」。发送。
5. Agent 流式回复 + 触发一个图像生成任务；图出现在时间线。
6. 拖入文件：把一张图拖到输入框（出现 attachment chip），输入「remix this style」，发送 → agent 参考它生成新图。
7. 收尾停在时间线：2–3 张生成图叠在一起——「玩」的感觉。

**节奏：** 这一条要快，从「空白」到「做出东西」约 10 秒。

---

## 3. demo · build together（协作共创）

**理念：** People and agents in one context. Co-create, save, and share.

**前置：** 一个 Space 有 2 个成员 + 1 个 agent，会话里有来回对话。

**镜头**
1. Space 头部：展示成员头像（人 + 一个「AI」agent chip）——hover 体现在场感。
2. 聊天会话：一个人发「let's add a settings page」。Agent 回复一张 **tool call** 卡片（如编辑文件），展示 tool result，再给一段总结消息。
3. 第二个人的消息实时进来（realtime）——如「make it dark mode」——agent 立刻再发一个 tool call 响应。
4. 点 **New save**（头部的 Save 图标）→ checkpoint 创建表单 → 输入「settings page + dark mode」→ 保存。Saves 出现条目；展示 task run 完成。
5. 点 **Share**（SessionShareDialog）：切到 public，复制链接。
6. 收尾停在会话时间线：人 → agent（tool call）→ 人 → agent（tool call）→ save 标记。

**关键节拍：** 多个角色在场、tool call 实时发生、从对话中生成一个 save。

---

## 4. demo · open everywhere（随时随地）

**理念：** Web, mobile, CLI, Discord, WeChat. The Space follows you.

**镜头（多屏切换）**
1. **Web（桌面）：** Space 里一个会话，agent 正在回复。
2. **移动端：** 在手机上打开同一个 Space（MobileSidebarDrawer + 移动端输入框）。展示同一会话在继续，从手机发一条消息。
3. **CLI：** 终端——`cohub -s <space-id> prompt "summarize where we left off"` → 终端流式输出文本。接着 `cohub -s <space-id> spaces files ls` 展示 Space 的文件。
4. **Discord：** 绑定到该 Space 的 Discord 频道；在那里发一条消息 → 它作为一条 session turn 出现在 web 端（channel provider 色为 Discord）。Agent 回复流回 Discord。
5. **WeChat：**（如可用）一个 WeChat 频道消息 → 同样的往返。若 WeChat 未配置，用 Feishu 替代。
6. 收尾回到 web：时间线上现在能看到来自 mobile / CLI / Discord 的 turn，各自可按来源辨识。

**提示：** 若录制真实 Discord/WeChat 成本高，可只录 web + mobile + CLI（这三个容易），最后用 2 秒 Discord/WeChat 截图平移收尾。「同一个 Space，多个入口」的点照样成立。

---

## 5. demo · powerful for real work（专业自由）

**理念：** Games, apps, media, automations — from playful to production.

**镜头**
1. 一个 Space 里 agent 已搭好一个小 web app：打开 **Files** 视图，展示文件树里的 `index.html` / `app.js`。
2. 切到 **Port 预览**（PortPreviewPanel）——运行中的 app 在工作区内实时渲染（如一个小游戏或交互 demo）。
3. 输入框：「add a start screen」→ agent 编辑文件（tool call 卡片）→ port 预览热重载出新界面。
4. **发布 Work：** 在 port（或文件）上点发布 → WorkPublishDialog：target type = **port**，选端口，设 slug → Publish。展示公开 URL `/{user}/{space}/w/{slug}`。
5. 新标签打开该公开 Work URL——WorkSurface 无需登录即可渲染 app。
6. 快切到 **Scheduled**（cron）flyout 条目 → 一个按计划运行 prompt 的 cronjob（「自动化」节拍）。

**关键节拍：** 真实代码 → 实时预览 → 发布到公开 URL → 自动化。这是「production」的证明。

---

## 6. demo · never start blank（不从空白开始）

**理念：** Fork a checkpoint into a new Space, or reference any Space with `@space` as context.

**两条路径，先后展示：**

**路径 A — Fork（重量级）：**
1. 从 **Explore**（wall 视图）打开一个公开 Space。浏览它的 Saves flyout → 打开一个 checkpoint。
2. CheckpointView：展示 commit hash、fork 数、文件列表。
3. 点 **Fork** → 跳转 `/spaces/new?checkpointId=...` → Create。
4. 新 Space 打开，预装了该 checkpoint 的文件/状态。发一个基于它的 prompt 继续。

**路径 B — @space 引用（轻量级）：**
5. 在另一个 Space 的会话输入框输入 `@` → SpaceMentionMenu 弹出，搜索并选中另一个 Space → 插入为 `@spacename` chip（mono/brand）。
6. 继续写 prompt：「...based on @spacename, build a variant」→ 发送。
7. Agent 回复时已把被引用的 Space 作为上下文拉入——展示该 Space 已成为这一 turn 的一部分。

**收尾：** 一秒回顾——fork（新 Space）对比 `@space`（会话内上下文）。两种从不空白开始的方式。

---

## 录制前准备清单

依据代码库需要预置的内容：

- **Demo 账号**，含 3–4 个 Space：一个「sketch lab」（fun）、一个协作型（build together）、一个含已发布 port Work（powerful）、一个公开带 checkpoint 的 Space（never start blank）。
- **绑定 Channel：**「open everywhere」的 Space 上至少绑 Discord + WeChat/Feishu 之一，加上 web channel。
- **开启生成模型**（至少图像；如有视频/音频更好），确保时间线能渲染 image block。
- **一个已发布 Work**，target type 为 `port`（跑一个小 app），以及一个 target 为 `file`（如 HTML 文件），用于「powerful」和「never start blank」。
- **CLI 已登录**（`cohub auth login`），用于「open everywhere」的终端镜头。
- **移动端**用同一账号登录，用于移动端镜头。

## 需要避免的

- 不要展示 pricing / billing 界面。
- 不要展示空态或错误 toast；预置好数据，让每个 flyout 和视图都有内容。
- 不要在 loading spinner 上停留——流式拖沓处裁掉，但保留一拍「live」流式以传达活的 Space 感。

## 关键功能依据（代码出处）

- **`@space` 触发：** `SessionComposer.svelte` 检测 `@` → `SpaceMentionMenu` → `applySpaceMention` 插入 `@[name](cohub://spaces/<id>)`。
- **Fork：** `CheckpointView.svelte` 的 `handleForkCheckpoint` → `goto('/spaces/new?checkpointId=...')`。
- **Works 发布目标：** file / directory / port（`WorkView.svelte` 的 select 选项），公开路由 `[username]/[spaceSlug]/w/[workSlug]`。
- **生成内容块类型：** text / image / video / audio（`GenerationContentBlock`），任务在 `SessionTaskTray` 显示 running/completed。
- **CLI 常用命令：** 取自 `packages/cli/src/index.ts` 的 help 文本。
- **Space 左侧轨道：** Labels / Chats / Saves / Works / Scheduled / Tasks flyout，加 Space settings 和 New save 按钮（`Sidebar.svelte`）。
- **Space 视图：** session / file / checkpoint / cronjob / work / task（`SpaceWorkspacePage.svelte`）。
