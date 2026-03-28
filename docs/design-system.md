# Cohub 前端视觉风格与设计系统

本文档定义 Cohub Web 控制台当前统一使用的视觉风格、UI 结构规则、术语映射和可复用样式约束。

目标有两个：

1. **保证后续页面持续统一**，避免每个页面“各写各的”。
2. **沉淀为长期可复用的设计资产**，让新页面和新组件可以快速复用。

---

## 1. 当前最终风格定位

Cohub 当前前端的统一风格为：

> **Playful Neo-Brutalism for Product Dashboard**
> 
> 即：**俏皮新粗野主义**，但收敛到可用于 SaaS / Agent 控制台的程度。

它不是纯 marketing 落地页风格，也不是传统后台的极简灰白风格，而是一种：

- 更有记忆点
- 有明确品牌个性
- 带物理按压感
- 同时仍然适合中后台信息展示

的产品界面语言。

---

## 2. 风格关键词

后续所有页面设计，统一围绕以下关键词：

- **Bold**：标题、按钮、模块层级清晰，视觉存在感强
- **Playful**：适度使用亮色、旋转、小贴纸感、漫画感
- **Structured**：布局必须整齐，不可杂乱
- **Compact**：比传统 marketing 页面更紧凑，避免太松散
- **Physical**：按钮、卡片要有“实体感”和“按压感”
- **Readable**：虽然风格鲜明，但信息可读性优先

一句话：

> **像贴纸和漫画一样有趣，但作为控制台仍然要克制、清晰、可维护。**

---

## 3. 视觉基础规则

## 3.1 页面底色

全局页面底色统一使用暖米色：

- `#FFF9F0`

这能让黑色边框和高饱和色块更有冲击力，同时比纯白更柔和。

适用场景：
- 控制台页面主背景
- 大多数空白区域
- 默认容器外层背景

---

## 3.2 主色与辅助色

当前主色板：

- Brand Red: `#FF5A5F`
- Neo Blue: `#4D96FF`
- Neo Green: `#28B463`
- Neo Yellow: `#FFD93D`
- Neo Pink: `#FF85B3`
- Neo Purple: `#9D4EDD`
- Paper: `#FFF9F0`
- Black: `#000000`
- White: `#FFFFFF`

使用原则：

### 推荐分工
- **红色**：主 CTA、重点强调、危险提醒
- **蓝色**：信息、导航高亮、功能模块标题条
- **绿色**：成功、运行中、可用状态
- **黄色**：提醒、入口强调、次 CTA
- **紫色**：辅助模块、步骤区、装饰性大面板
- **粉色**：保留给次级趣味点缀，不宜滥用

### 控制规则
- 一个页面主视觉色建议控制在 **2~4 种**。
- 不要每个卡片都用不同颜色，避免游乐场化。
- 若页面信息复杂，优先用：**米色 + 白色 + 黑色 + 1~2 个强调色**。

---

## 3.3 边框

边框是整个风格的灵魂之一。

统一原则：

- 核心 UI 元素必须有明显黑边框
- 优先使用：`border-[3px] border-black`
- 更强强调场景可用：`border-[4px] border-black`
- 小型图标盒或小徽章可用：`border-2 border-black`

适用对象：
- 按钮
- 卡片
- 输入框
- Badge
- 面板头部
- 头像框
- 弹窗
- 标签

避免：
- 透明边框
- 灰色细边框
- 模糊、弱化、几乎看不见的边线

---

## 3.4 阴影

统一使用 **硬阴影（Hard Shadow）**，绝对不使用模糊阴影。

标准阴影等级：

- 小：`2px 2px 0 #000`
- 中：`4px 4px 0 #000`
- 大：`6px 6px 0 #000` 或 `8px 8px 0 #000`

使用建议：

- 默认按钮 / 小卡片：中阴影
- 大卡片 / Hero 高亮块：大阴影
- 小图标框 / 小 badge：小阴影

禁止：
- `shadow-lg` 这类模糊 Tailwind 阴影直接乱用
- 黑色透明渐变阴影
- 毛玻璃阴影体系

一句话：

> **影子是“偏移出来的实体层”，不是发光。**

---

## 3.5 圆角

虽然风格粗野，但容器不是尖锐的。

推荐圆角：

- 大卡片：`rounded-[1.75rem]` / `rounded-[2rem]`
- 普通卡片：`rounded-2xl`
- 小按钮：`rounded-xl` / `rounded-2xl`
- Badge：`rounded-full`

规则：
- 组件越大，圆角可以越大
- 同一页面避免出现过多不一致的圆角体系

---

## 4. 排版规范

## 4.1 标题

Cohub 当前标题风格必须具备以下特征：

- 极粗：`font-black`
- 紧字距：`tracking-tight` 或 `tracking-tighter`
- 强层级：字号大，且层级差异明显
- 允许局部彩色强调词

推荐层级：

- Page Hero：`text-5xl` ~ `text-6xl`
- Section Title：`text-2xl` ~ `text-3xl`
- Card Title：`text-base` ~ `text-xl`
- Meta Label：`text-xs + uppercase + tracking-widest`

### 标题使用原则
- 大标题一屏内不要超过 2 行
- 强调词可以上色，但不要每个词都上色
- 若页面信息密集，优先缩小字号，不要堆大标题

---

## 4.2 正文

正文需要压住风格感，承担“可读性稳定器”的角色。

推荐：
- `font-medium` 或 `font-bold`
- 颜色用 `text-black/70`、`text-black/60`
- 行高适当放松，但不要太松

不要：
- 过细字体
- 太浅灰
- 长段大段视觉说明

---

## 4.3 标签和元信息

推荐用于状态、分组、小标题：

- `text-[10px]` / `text-xs`
- `font-black` 或 `font-bold`
- `uppercase`
- `tracking-widest`

这类样式适合：
- 小节标题
- 卡片顶部 meta label
- 状态标签
- 辅助信息

---

## 5. 布局规范

## 5.1 总体布局

控制台布局以：

- 固定侧边栏
- 右侧主内容区
- 内容最大宽度约束
- 紧凑型模块间距

为主。

当前推荐：
- Sidebar 宽度：`w-64`
- 主内容最大宽度：`max-w-6xl` 或 `max-w-7xl`
- 页面外边距：`p-5 md:p-8`

---

## 5.2 模块间距

为了避免杂乱，当前页面应更紧凑。

推荐间距：

- 页面主区块之间：`space-y-10` / `space-y-12`
- 小模块之间：`gap-4` / `gap-5`
- 卡片内部 padding：`p-4` / `p-5`
- 大卡片内部 padding：`p-5` / `p-6`

不要轻易使用：
- `p-8` 以上的大面积 padding
- `gap-8` 以上的大间距，除非是首页 Hero

---

## 5.3 Bento Grid 使用规则

Cohub 可以使用 Bento Grid，但必须克制。

适合场景：
- Dashboard 首页
- Overview 面板
- Explore 入口页

不适合场景：
- 表格页
- 长列表管理页
- 配置页
- 详情页

规则：
- 便当盒最多 2~3 个主视觉块即可
- 不要每一屏都像营销页一样堆大小不一的彩色块
- 数据型页面以规整列表优先

---

## 6. 交互规范

## 6.1 按钮按压感

所有主要按钮都应具备物理按压感：

- 默认有黑色硬阴影
- hover 时轻微上浮 / 左上位移
- active 时向右下位移并消除阴影

这是 Cohub 最重要的交互识别之一。

标准行为：
- `hover:-translate-x-1 hover:-translate-y-1`
- `active:translate-x-1 active:translate-y-1 active:shadow-none`

---

## 6.2 卡片 hover

卡片 hover 可以做，但不能过头。

推荐：
- 轻微位移
- 阴影增大一档
- 背景色轻微变化

不推荐：
- 大幅缩放
- 旋转角度变化太明显
- 连续闪烁或复杂动画

---

## 6.3 旋转与趣味元素

Playful 风格允许少量旋转，但必须节制。

推荐使用场景：
- Hero 强调词块
- Quick Start 卡片
- 小贴纸式提示

不建议使用场景：
- 导航
- 表格行
- 表单输入区
- 核心功能操作按钮

原则：

> **趣味元素只负责“点题”，不负责“占满页面”。**

---

## 7. 组件层级建议

为了长期统一，建议将组件分成三层：

### L1：基础原子样式
可直接通过 CSS 类复用，例如：
- `neo-card`
- `neo-btn`
- `neo-badge`
- `neo-input`
- `neo-icon-box`

### L2：语义化业务组件
基于原子样式封装 Svelte 组件，例如：
- `SidebarNavItem.svelte`
- `StatCard.svelte`
- `WorkspaceCard.svelte`
- `SectionHeader.svelte`
- `StatusBadge.svelte`

### L3：页面级组合
例如：
- Dashboard Hero
- Workspace List Panel
- Runtime Overview Panel

建议后续尽量减少页面里直接手写一大段 Tailwind 类，逐步往 L2 组件抽离。

---

## 8. 术语统一要求

前端展示文案必须与产品术语保持一致。

当前统一采用：

- **Workspace**：项目托管单元
- **Runtime**：运行实例
- **Session**：运行中的独立会话上下文
- **Channel**：外部通信入口
- **Explore**：探索页
- **Overview**：概览页

约束：
- 不要把 Workspace 写成 Project
- 不要把 Runtime 写成 Instance，除非是技术解释场景
- 不要混用 Chat / Conversation / Session，默认用 Session

如果术语存在疑问，统一以 [`terminology.md`](./terminology.md) 为准。

---

## 9. 当前可复用 CSS 规范

在 `apps/web/src/app.css` 中，已经开始沉淀 Cohub 的长期复用样式。

后续新增页面时，优先复用这些类，而不是每次重新写一套。

### 页面骨架
- `neo-page-shell`
- `neo-page-header`

### 通用状态
- `neo-loading`
- `neo-error`
- `neo-empty`

### 容器与列表
- `neo-card`
- `neo-card-sm`
- `neo-panel`
- `neo-list-card`
- `neo-panel-fill-*`
- `neo-btn`
- `neo-btn-primary`
- `neo-btn-secondary`
- `neo-badge`
- `neo-badge-*`
- `neo-icon-box`
- `neo-input`
- `neo-page-title`
- `neo-page-desc`
- `neo-section-title`
- `neo-meta`

这些类的目标不是替代所有 Tailwind，而是提供一套稳定的“基础骨架”。

推荐方式：
- **结构布局**：继续使用 Tailwind utility
- **风格骨架**：优先使用 `neo-*` 类

例如：

```html
<div class="neo-card p-5 flex items-center gap-4">
  <div class="neo-icon-box neo-fill-blue">
    ...
  </div>
  <div>
    <p class="neo-meta">Workspaces</p>
    <p class="text-5xl font-black tracking-tighter">12</p>
  </div>
</div>
```

---

## 10. 页面设计建议

## 10.1 Dashboard / Overview

应当：
- 更强视觉张力
- 允许少量趣味元素
- 使用 2~3 个主色块
- 使用 Bento 布局

## 10.2 List 页面（Workspaces / Runtimes / Channels）

应当：
- 更规整
- 更少颜色
- 更少旋转
- 卡片尽量等高、等结构

建议：
- 用白底卡片 + 黑边 + 中阴影
- hover 时轻微抬起
- 状态用 badge 解决

## 10.3 Detail 页面

应当：
- 信息清晰第一
- 装饰第二
- 面板头、属性区、日志区明确分块

不建议：
- 大量彩色背景块
- 复杂 Hero
- 过多贴纸感元素

## 10.4 Form 页面

应当：
- 重点强化输入框、分组标题、主 CTA
- 背景保持安静

建议：
- 表单主体用白色卡片
- 输入框统一 `neo-input`
- 主按钮统一 `neo-btn-primary`

---

## 11. 后续演进建议

建议后续分三步沉淀：

### 第一步：先统一样式类
把 `neo-*` 基础类补全，所有新页面优先复用。

### 第二步：再抽 Svelte 基础组件
例如：
- Button
- Badge
- Card
- SectionHeader
- EmptyState
- StatCard

### 第三步：建立页面模板
例如：
- 管理列表页模板
- 详情页模板
- 创建页模板
- 仪表盘模板

这样后续新增页面时，开发者只需要在统一骨架上填业务内容。

---

## 12. 一句话设计原则

如果后续写页面拿不准风格，统一按这句话判断：

> **用黑边框、硬阴影、粗标题和少量高饱和色，做出有实体感、有趣但不混乱的 Agent 控制台。**
