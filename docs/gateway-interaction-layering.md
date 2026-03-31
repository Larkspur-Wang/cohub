# Gateway Interaction Layering

本文档补充说明 Gateway 当前统一交互建设的分层方式，重点回答：

- 哪些逻辑属于 provider-specific
- 哪些逻辑属于统一的 session interaction core
- Discord / Responses / Web 未来应该分别落在哪一层

---

## 1. 总原则

Gateway 中可以有多种 channel/provider：

- Discord
- Telegram
- Responses API
- 未来的 Web Chat

这些 provider 可以各自承担不同的接入协议和输出渲染方式；但它们不应该各自拥有一套独立的“如何与 API 执行一次 session chat”逻辑。

统一原则是：

> **provider-specific ingress/egress 保留差异；route 到既有 session 后的 chat execution 统一。**

---

## 2. 三层结构

## 2.1 Provider-specific ingress / egress

这一层保留 provider 差异。

### 典型职责
- 接入外部协议
- 提取原始输入
- 过滤平台噪音
- 处理平台特有上下文
- 输出平台特有渲染结果

### 例子
#### Discord
- MessageCreate / ThreadCreate 事件
- mention 规则
- thread / channel / DM 判断
- Discord reply/edit/render

#### Responses API
- HTTP request / SSE response
- Bearer token 读取
- Responses-style JSON / SSE 输出

这一层不追求完全统一。

---

## 2.2 Provider intent / session routing

这一层解决：

> 这条 provider 输入最终要进入哪个 runtime/session？

### 典型职责
- provider inbound 去重
- external conversation -> bindingKey
- bindingKey -> runtimeSessionId
- 必要时 create session / fork session
- conversation_create 等前置事件处理

### 当前落点
API 侧：
- `resolveSessionInteractionForInboundEvent(...)`

### 说明
这一层对 Discord 非常重要；对 Responses API 则几乎可跳过，因为 Responses URL 已经显式给定 `runtimeId + sessionId`。

---

## 2.3 Session interaction core

这一层解决：

> 在一个已经确定的 session 上，如何执行一次新的 chat interaction？

### 典型职责
- create user message
- 写入必要 metadata / interactionId
- enqueue prompt
- 记录必要的 inbound ref
- 返回本次 interaction 的 userMessageId / accepted result

### 当前落点
API 侧：
- `executeSessionInteraction(...)`

### 为什么这是统一核心
一旦 `runtimeId + sessionId + inputText` 已确定，不管输入来自：
- Discord
- Responses API
- 未来 Web Chat

后续这段逻辑都应一致。

---

## 3. 当前各 provider 的落点

## 3.1 Responses API

### 当前路径
```text
HTTP request
-> auth / scope check
-> publish session response request (Redis)
-> API consumer
-> executeSessionInteraction(...)
-> agent output stream
-> Responses SSE/JSON render
```

### 所处层级
- ingress/egress: provider-specific
- routing: 基本跳过（URL 已给定 session）
- interaction core: 已统一

---

## 3.2 Discord

### 当前路径
```text
Discord event
-> provider-specific normalize
-> publish inbound event (Redis)
-> API inbound consumer
-> resolveSessionInteractionForInboundEvent(...)
-> executeSessionInteraction(...)
-> outbound dispatch
-> Discord render
```

### 所处层级
- ingress/egress: provider-specific
- routing: 已开始统一
- interaction core: 已开始统一

### 说明
Discord 当前仍保留更多 provider-specific 前置逻辑，这是正确的；统一点应放在“route 到 session 之后”的 interaction core，而不是强行统一 Discord 的原始 ingress。

---

## 4. 为什么不把所有 provider 强行统一成同一种请求格式

因为不同 provider 处于不同层：

- Responses API 直接给定 session
- Discord 先要从 external conversation route 到 session

如果强行要求它们在 ingress 层完全一致，会把 provider-specific routing 信息抹掉，反而让结构变差。

正确做法是：

- ingress 层允许差异
- routing 层做必要统一
- session interaction core 做强统一

---

## 5. 哪些动作继续留在 API / control plane

以下动作不属于 session interaction core，继续保留为 API 资源操作：

- create session
- fork session
- list sessions
- query history messages
- query session graph
- runtime / workspace 管理

这些动作可能被 provider/routing 层在少数场景下触发，但它们本身不属于 chat execution。

---

## 6. 当前结论

当前统一交互建设已经形成如下稳定原则：

> **Gateway 负责多 provider 的接入与输出；Provider-specific routing 保留差异；Route 到既有 session 后的 chat execution 统一到 session interaction core；Gateway 与 API 的主交互链路以 Redis 为主，HTTP 仅保留在少量 auth/scope 校验环节。**
