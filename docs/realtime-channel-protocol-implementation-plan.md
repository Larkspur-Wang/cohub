# Realtime / Channel 事件协议重构实施方案（最小闭环版）

## 文档目标

这份文档用于指导当前项目对 realtime、websocket、channel adapter、session 输出链路进行一次**最小闭环**重构。

目标不是提前设计未来所有事件，而是：

- 保持系统名词统一：`space` / `session` / `message` / `turn` / `channel` / `provider`
- 保持 message-like 内容继续统一使用 `ContentBlock[]`
- 让 websocket 作为**帐号级全局连接**具备可扩展的协议外壳
- 让 outbound / inbound 都逐步走向“领域事件 + channel adapter”的结构
- **只覆盖当前已经存在的 session 相关事件**
- 输出一套可以直接照着施工的实施方案

---

# 1. 背景与当前问题

## 1.1 当前已有现实

当前系统中已经同时存在：

- Web 前端 websocket 直连写入 session
- Discord / Feishu 等 provider 的 inbound / outbound 消息链路
- session message 的 DB 持久化
- assistant progress / final / error 这些过程状态
- 浏览器 realtime 事件广播

这说明系统本质上已经不是“单纯消息通道”，而是：

- 有统一的 session 领域模型
- 有多个 channel/provider adapter
- 有一条全局 realtime 连接
- 有 message-like 事件，也有潜在非 message 事件

## 1.2 当前主要问题

### A. websocket 协议更像 transport 事件，不是领域事件
前端现在更多是靠：
- `eventType`
- `meta.messageKind`
- `sessionMessageId`
- `content`

来猜这个事件到底是：
- user persisted
- assistant progress
- assistant final
- assistant error
- request error

协议层语义不够清晰。

### B. outbound 当前更像“发给谁”驱动，而不是“表达什么”驱动
当前更容易按：
- websocket outbound
- discord outbound
- provider outbound

理解系统，而不是按：
- session.turn.progress
- session.turn.final
- session.message.persisted

理解系统。

### C. 顶层字段里存在提前泛化、但当前无明确价值的字段风险
例如：
- `resourceId`
- `delta`

这类字段在当前阶段容易造成：
- 语义重复
- 永远为真/无实际分支
- 让协议变得更难稳定

---

# 2. 本次重构的原则

## 2.1 名词统一
系统内部统一使用：

- `space`
- `session`
- `message`
- `turn`
- `channel`
- `provider`

不要把外部 provider 的 `conversation` / `chat` / `thread` 这些词提升为系统主概念。

外部 provider 的 conversation/chat/thread 只作为：
- provider 原始上下文
- 绑定 / 映射元数据

存在。

## 2.2 ContentBlock 继续作为消息内容模型
凡是 message-like 内容，统一使用：

```ts
content: ContentBlock[]
```

适用：
- user message
- assistant progress
- assistant final
- 某些可见 system note

不适用：
- session / space / task / fs 结构化事件

## 2.3 websocket 是帐号级全局连接
因此顶层 envelope 不能只为 chat 设计。

但当前阶段：
- 只正式支持已有 session 事件
- `space` 仅先在 domain 层预留位置
- 不提前设计完整未来事件矩阵

## 2.4 当前阶段只覆盖已有事件
本次只收敛当前已存在的 session 事件：

- request accepted / request error
- turn progress / turn final / turn error
- message persisted

不扩展：
- 完整的 `space.*`
- 完整的 provider 非消息事件
- 完整的 task / fs / membership 事件体系

---

# 3. 最小协议设计

## 3.1 顶层 Realtime Envelope

建议统一为：

```ts
type RealtimeEnvelope = {
  id: string;
  timestamp: number;

  domain: "system" | "session" | "space";
  type: string;

  requestId?: string | null;

  spaceId?: string | null;
  sessionId?: string | null;

  payload: Record<string, unknown>;
};
```

## 3.2 字段说明

### `id`
事件唯一 ID。
用途：
- 去重
- 调试
- 日志追踪

### `timestamp`
事件产生时间。
用途：
- 排序
- 调试
- 时序诊断

### `domain`
领域名。
当前仅保留：
- `system`
- `session`
- `space`

### `type`
具体事件类型。
例如：
- `session.turn.progress`
- `session.request.accepted`

### `requestId`
仅用于 request lifecycle 相关事件。
不是所有事件都要带。

### `spaceId`
全局连接下保留。session 事件通常也应带上。

### `sessionId`
session 相关事件必须带。

### `payload`
具体事件数据。

---

# 4. 当前阶段正式支持的事件

## 4.1 system.ready

连接建立成功。

```ts
{
  domain: "system",
  type: "system.ready",
  payload: {
    connectionId: string;
  }
}
```

## 4.2 system.auth.ok

认证成功。

```ts
{
  domain: "system",
  type: "system.auth.ok",
  payload: {
    connectionId: string;
    user: Record<string, unknown>;
  }
}
```

## 4.3 system.request.error

系统级请求错误，例如：
- 未认证
- bad request
- internal error

```ts
{
  domain: "system",
  type: "system.request.error",
  requestId?: string | null,
  payload: {
    code: string;
    message: string;
  }
}
```

说明：
- 这是 transport / request 层错误
- 不是 turn 业务错误

---

## 4.4 session.request.accepted

表示：客户端发起的本次 session 写入请求已被系统接收。

```ts
{
  domain: "session",
  type: "session.request.accepted",
  requestId?: string | null,
  spaceId: string,
  sessionId: string,
  payload: {
    clientMessageId?: string | null;
  }
}
```

前端用途：
- pending 从 `sending` → `sent_unconfirmed`

---

## 4.5 session.request.error

表示：某次 session 请求失败。

```ts
{
  domain: "session",
  type: "session.request.error",
  requestId?: string | null,
  spaceId?: string | null,
  sessionId?: string | null,
  payload: {
    code: string;
    message: string;
    clientMessageId?: string | null;
  }
}
```

前端用途：
- pending → `failed`

---

## 4.6 session.turn.progress

表示：当前 assistant turn 的过程更新。

```ts
{
  domain: "session",
  type: "session.turn.progress",
  spaceId: string,
  sessionId: string,
  payload: {
    anchorUserMessageId: string | null;
    content: ContentBlock[];
  }
}
```

约定：
- `content` 默认就是 delta content
- 不再带 `delta: true`

前端用途：
- 只更新 streaming draft
- 不写 persisted cache

---

## 4.7 session.turn.final

表示：当前 assistant turn 已完成。

```ts
{
  domain: "session",
  type: "session.turn.final",
  spaceId: string,
  sessionId: string,
  payload: {
    sessionMessageId: string | null;
    anchorUserMessageId: string | null;
    content: ContentBlock[];
  }
}
```

前端用途：
- 结束 draft
- 允许视觉连续过渡
- 之后触发 authoritative reconcile

---

## 4.8 session.turn.error

表示：当前 assistant turn 出错 / 中断。

```ts
{
  domain: "session",
  type: "session.turn.error",
  spaceId: string,
  sessionId: string,
  payload: {
    anchorUserMessageId: string | null;
    error: string;
  }
}
```

前端用途：
- 清 draft
- 标记 turn 失败
- 是否展示由 UI 决定

---

## 4.9 session.message.persisted

表示：一条 DB authoritative 的 session message 已可见。

```ts
{
  domain: "session",
  type: "session.message.persisted",
  spaceId: string,
  sessionId: string,
  payload: {
    message: MessageRecord;
  }
}
```

前端用途：
- 更新 persisted state
- 清理 matching pending overlay
- 不再猜是不是 authoritative

---

# 5. 字段精简原则

## 5.1 当前建议删除 / 不引入

### 删除
- `resourceId`
- `delta`

### 当前不提前引入
- `resourceType`
- `version`
- `schema`
- `capability`
- `projectionMode`
- 泛化 `meta`（作为协议主语义容器）

## 5.2 当前必须保留的锚点字段

### 顶层
- `id`
- `timestamp`
- `domain`
- `type`
- `requestId?`
- `spaceId?`
- `sessionId?`

### payload 内
按事件类型保留：
- `clientMessageId`
- `anchorUserMessageId`
- `sessionMessageId`
- `message`

---

# 6. 当前代码映射与职责调整

这部分用于指导具体施工。

---

## 6.1 packages/protocol

### 目标
把现有 websocket / realtime 相关协议定义，逐步收敛到：
- 顶层 envelope
- 当前阶段 session / system 事件

### 涉及文件
- `packages/protocol/src/websocket.ts`
- 可能补充 `packages/protocol/src/realtime.ts`（如果想单独拆文件）

### 建议动作
1. 定义新的 envelope schema / type
2. 定义当前阶段 session / system 事件 payload type
3. 逐步减少对自由 `meta` 的依赖
4. 保持 `ContentBlock[]`、`MessageRecord` 等复用现有定义

---

## 6.2 apps/gateway

### 目标
把 websocket server 从“发送泛化 event”改成“发送 typed realtime envelope”。

### 涉及文件
- `apps/gateway/src/index.ts`

### 当前问题
当前 gateway websocket server 里：
- `ready`
- `auth.ok`
- `message.accepted`
- `event`
- `error`

这些类型混合了：
- 连接事件
- 请求生命周期事件
- session 输出事件

### 建议动作
1. 保留连接建立 / 认证的系统事件语义
2. 把 `message.accepted` 收敛为 `session.request.accepted`
3. 把 transport 级错误收敛为 `system.request.error` 或 `session.request.error`
4. 把当前 websocket special outbound 分支产出的 payload，改成新的 envelope 结构
5. 不改变 websocket 作为帐号级全局连接的事实

---

## 6.3 apps/api

### 目标
把当前 session 输出逻辑，从“直接广播某种 event/meta”改成先产出明确的 session 输出语义。

### 涉及文件
- `apps/api/src/index.ts`
- `apps/api/src/space-sessions.ts`
- `apps/api/src/channels.ts`

### 建议动作

#### A. `apps/api/src/index.ts`
当前 agent stream bridge 负责把：
- `stream_update`
- `error`

桥接成 websocket broadcast payload。

建议：
- 直接桥接成 `session.turn.progress`
- 直接桥接成 `session.turn.error`
- 不再主要依赖 `messageKind + meta` 暗示语义

#### B. `apps/api/src/space-sessions.ts`
当前 `persistMessageNode(...)` 在落库后直接：
- dispatchOutboundMessage
- dispatchRealtimeEventToUsers

建议：
1. 先抽出一个明确的输出编排函数，例如：
   - `emitPersistedSessionOutputs(...)`
2. 在这里决定要产出哪些 session 领域事件：
   - user persisted → `session.message.persisted`
   - assistant final persisted → `session.message.persisted`
   - assistant error → `session.turn.error`（如果需要）
3. provider / websocket 都只消费这些明确语义，而不是继续猜 `meta.messageKind`

#### C. `apps/api/src/channels.ts`
- 保持 inbound resolver / executor 结构
- `dispatchRealtimeEventToUsers(...)` 后续应逐步从“泛化 event meta”转向“typed realtime envelope”

---

## 6.4 apps/web

### 目标
前端不再主要依赖：
- `eventType`
- `meta.messageKind`
- `meta.delta`

来猜事件，而是按：
- `domain`
- `type`

做状态更新。

### 涉及文件
- `apps/web/src/lib/realtime.ts`
- `apps/web/src/routes/spaces/[id]/+page.svelte`
- 以及后续可能新拆的 realtime store / event handler 文件

### 建议动作

#### A. `apps/web/src/lib/realtime.ts`
1. 更新 websocket server envelope schema
2. 把 `event` 这种泛化类型收敛成 typed envelope
3. 让 client 暴露更明确的 realtime event 类型

#### B. `apps/web/src/routes/spaces/[id]/+page.svelte`
当前 session 页面需要按新事件语义处理：

- `session.request.accepted` → pending 变 `sent_unconfirmed`
- `session.request.error` → pending 变 `failed`
- `session.turn.progress` → 更新 draft
- `session.turn.final` → 清 draft，做视觉连续，触发 reconcile
- `session.turn.error` → 清 draft，标错
- `session.message.persisted` → 更新 persisted，清理 matching pending

#### C. persisted cache 规则保持不变
- 只存 DB 对齐后的 authoritative 数据
- progress / draft / pending 不入 cache

---

# 7. 施工顺序（推荐）

## Phase 1：协议定义落地
1. 在 `packages/protocol` 中定义新的 envelope 和当前阶段事件类型
2. 保留旧结构过渡，但新增新类型定义

## Phase 2：gateway websocket server 改造
1. `ready` / `auth.ok` 映射为 `system.*`
2. `message.accepted` 改为 `session.request.accepted`
3. request error 改为 `system.request.error` / `session.request.error`
4. 广播 payload 改为新 envelope

## Phase 3：API 侧 session 输出语义显式化
1. 抽出 `emitPersistedSessionOutputs(...)`
2. stream bridge 输出 `session.turn.progress` / `session.turn.error`
3. persisted message 输出 `session.message.persisted`

## Phase 4：前端事件消费切换
1. `RealtimeClient` 改成消费 typed envelope
2. session 页面按 `domain + type` 更新状态
3. 逐步减少对 `meta.messageKind` 的依赖

## Phase 5：清理旧字段与旧路径
1. 删除 `delta`
2. 删除无意义泛化字段（如 `resourceId`）
3. 清理仅用于旧协议兼容的 event mapping

---

# 8. 验证清单

## 8.1 基础连接
- websocket 连接成功能收到 `system.ready`
- auth 成功能收到 `system.auth.ok`
- 未认证请求能收到 `system.request.error`

## 8.2 发送消息
- 发送后收到 `session.request.accepted`
- pending 状态正确从 `sending` → `sent_unconfirmed`
- 请求失败时收到 `session.request.error`
- pending 状态变 `failed`

## 8.3 assistant 过程
- progress 事件只更新 draft
- progress 的 `content` 按 delta 处理
- 不会写入 persisted cache

## 8.4 assistant final
- final 事件能结束 draft
- final 后仍做 authoritative reconcile
- persisted cache 最终仍只存 DB authoritative 数据

## 8.5 persisted message
- user persisted / assistant persisted 正确发出 `session.message.persisted`
- pending 能正确被清理
- 不会出现重复 user message

## 8.6 页面刷新 / 切换 session
- persisted cache 仍能秒开
- pending overlay 不丢
- draft 行为符合当前设计（若中途恢复不完整，仍可保留展示层 `…` 方案）

---

# 9. 非目标

本次重构明确不包括：

- 设计完整 `space.*` / `fs.*` / `task.*` 事件全集
- 接入所有 provider 的非消息事件（如 Discord member joined 等）
- 做完整 capability matrix
- 一次性重写所有 provider outbound / inbound 逻辑
- 改变 `ContentBlock[]` 作为消息内容模型的地位

---

# 10. 最终总结

当前阶段的最小闭环方案是：

- 顶层统一为 `domain + type + payload` 的 realtime envelope
- message-like 内容继续统一使用 `ContentBlock[]`
- 当前只正式支持已有的 session 事件：
  - `session.request.accepted`
  - `session.request.error`
  - `session.turn.progress`
  - `session.turn.final`
  - `session.turn.error`
  - `session.message.persisted`
- 删除 `resourceId`、`delta` 等当前无效泛化字段
- 让 websocket、discord、feishu 等后续都能作为 channel adapter 持续演进，但当前施工只先落地已有 session 路径
