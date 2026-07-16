# Landing Page 演示录屏脚本

Landing 页面上有 6 个 16:10 的视觉位（hero + 5 个 idea）。当前实现用 **CSS/SVG micro-demo** 填洞；真视频到位后可替换。本文档给出每个位的录制脚本与叙事对齐。

**Hero 主句（体验起点）：**

> Your own space to create, play, and build with people and agents.

**差异化能力（非起点，页面中后段讲清）：**

1. **Cross-space `@space`**：Session 内 `@` 引用另一个 Space（≠ Fork）。
2. **Publish Live Work**：Cohub-hosted 活表面（scopes + viewer auth → 回写 Space）。
3. **CLI local sandbox**：`cohub sandbox up <dir>` 把本机目录连成 Space sandbox。

## 通用录制要求

- 分辨率 2560×1600（16:10），最低 1920×1200。导出 H.264 MP4，每个约 10–18 秒，无音频（或仅保留 UI 操作音）。
- 主题用暗色模式（默认），保留 brand 橙色点缀。
- 准备一个真实 demo 账号，预置几个 Space，保证侧栏不为空。
- 鼠标移动放慢、有意图，每个关键元素停留约 0.5 秒后再操作。
- 尽量裁掉加载态，但保留一拍流式输出（体现「活的 Space」）。

---

## 1. demo · hero（首屏主视觉）

**目标：** 约 12–15 秒传达「人在 Space 里和 agent 一起做事」——真实协作，而不是 `@space` 作为起点。

**Hero 主句保持：** *Your own space to create, play, and build with people and agents.*

**前置：** 一个活跃 Space，会话中有协作；可编辑的小 web app + port 预览。

**镜头**
1. Landing 首屏旧主句短暂可见 → 切入产品 Space。
2. 队友消息：「can we darken the start screen?」
3. 你在 composer 用**自然语言**发：「update the start screen to dark mode」（不要写 `@agent make one, ~30s loop` 这类怪 prompt）。
4. Agent tool call `edit index.html` → Port 预览更新。
5. 浮层/收尾暗示：checkpoint saved；可选一闪 CLI `cohub sandbox up`（local ↔ Space）。

**`@space` / Live Work 不放 hero 主节拍**——放在页面下方 differentials / idea 04–05。

**当前占位：** `LandingSpaceDemo.svelte`（peer → plain prompt → edit + port preview；chips: checkpoint / CLI local）。

---

## 2. demo · fun to start（有趣能玩）

**理念：** Open a Space and play with ideas, prompts, files, and agents.

**镜头**
1. 点 **Start a Space** → `/spaces/new` → blank → Create。
2. 空会话输入随意 prompt → 生成图出现。
3. 拖入文件 → remix → 时间线 2–3 张图。

**节奏：** 从空白到做出东西约 10 秒。

**当前占位：** `LandingIdeaArt` kind=`spark`。

---

## 3. demo · build together（协作共创）

**理念：** People and agents in one live context. Co-create, save, keep the thread.

**镜头**
1. 成员头像（人 + agent）。
2. 人 → agent tool call → 第二人 realtime 消息 → 再 tool call。
3. New save → checkpoint。
4. （可选）Share public session link。

**当前占位：** `LandingIdeaArt` kind=`build`。

---

## 4. demo · open everywhere（随时随地）

**理念：** Web / CLI（含 **local sandbox**）/ API / Scheduled 是主力；Discord/WeChat 等 channel 是可选边缘。

**镜头**
1. **Web：** Space 会话中 agent 回复。
2. **CLI local：** `cohub sandbox up ./my-project` → 本机目录成为 Space sandbox → 打开 web Space。
3. **CLI prompt：** `cohub -s <id> spaces prompt "..."`。
4. **API / Scheduled：** 简短示意即可。
5. （可选）channel 不占主叙事。

**当前占位：** `LandingIdeaArt` kind=`open`（Web / CLI / API / Scheduled + `sandbox up` 命令行）。

---

## 5. demo · publish live works（专业 / 活表面）

**理念：** Live Work = Cohub-hosted surface，非静态页。scopes + viewer auth + 回写 Space。

**镜头**
1. Files / Port 预览中的真实 app。
2. Publish Work → target port/file → 设 `workScopes` + `allowedViewerScopes` → public URL。
3. 访客打开 Work → authorize → `createCohubClient()` 动作 → Space 内出现 prompt/generation side effect。
4. （可选）Scheduled 一条自动化收尾。

**当前占位：** `LandingIdeaArt` kind=`work`（browser + viewer authorized + live work badge）。

---

## 6. demo · never start blank（不从空白开始）

**理念：** `@space`（轻）vs Fork（重）对照。

**路径 A — `@space`（轻量）：**
1. Composer 输入 `@` → 选 Space → chip → prompt → agent 使用外部上下文。

**路径 B — Fork（重量）：**
2. Explore / CheckpointView → Fork → 新 Space 预装状态 → 继续 build。

**收尾：** 一秒对照字幕：`@space` = attach to this turn · Fork = new writable Space。

**当前占位：** `LandingIdeaArt` kind=`fork`（split: @space chip vs fork graph）。

---

## 页面结构对照（代码）

| Section | 组件 / 文件 | 叙事角色 |
| --- | --- | --- |
| Hero | `+page.svelte` + `LandingSpaceDemo` | 主句 + 旗舰节拍 |
| How it works | `LandingHowItWorks` | `@space` → Build & Save → Live Work |
| Differentials | `LandingDifferentials` | Live Work scopes/auth · `@space` vs Fork |
| 5 ideas | `LandingIdeaArt` | 保留骨架，04/05 服务两卖点；03 Open everywhere 重写 |
| Concepts | `LandingConcepts` | Space / Checkpoint / @space / Fork / Live Work / Agent |
| Footer | `+page.svelte` | Pricing, Changelog, Trending, X/Twitter, email |

## 录制前准备清单

- Demo 账号 + 3–4 Spaces：sketch、协作、含 Live Work、可 `@` 的公开 Space。
- 至少一个已发布 **port/file Work**，`workScopes` + 至少一个 `allowedViewerScopes`。
- CLI 已登录；Scheduled 至少一条 cron。
- （可选）Channel 绑定仅作 edge 镜头。

## 需要避免的

- 不要把 Work 拍成「能打开的静态页」而不展示 scopes / auth / 回写。
- 不要把 `@space` 挤成附赠；Fork 与 `@space` 必须对照。
- 不要主打 Discord/WeChat；不要把 Proposal 当主卖点。
- 不要展示 pricing/billing、空态、错误 toast。

## 关键功能依据（代码出处）

- **`@space` 触发：** `SessionComposer.svelte` → `SpaceMentionMenu` → `applySpaceMention` 插入 `@[name](cohub://spaces/<id>)`。
- **Fork：** `CheckpointView.svelte` → `/spaces/new?checkpointId=...`。
- **Works：** file / directory / port；`workScopes` / `allowedViewerScopes`；公开路由 `[username]/[spaceSlug]/w/[workSlug]`。
- **Work SDK：** `createCohubClient()` + `auth.request()`（见 `docs/works-guide.md`、`docs/work-capability-lab/`）。
- **CLI / Scheduled：** `packages/cli`；Space 左侧 Scheduled flyout。
