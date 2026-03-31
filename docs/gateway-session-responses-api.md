# Gateway Session Responses API

## 相关文档

- `docs/gateway-interaction-layering.md`

## 背景

当前系统中：

- API 负责 Workspace / Runtime / Session 的资源管理、持久化和编排
- Gateway 负责外部 channel provider 的接入与实时交互
- Web chat 当前仍主要通过 API 与 agent 交互

本次目标是在 Gateway 中新增一类 first-party API Channel，用于在指定 Session 上持续与 agent 对话。

该 API Channel 采用 **Responses-style** 交互模型，而非 Chat Completions 模型。

同时在 Gateway 内部明确区分两层：

- provider/channel adapter
- unified session interaction core

Responses API 被视为一种 first-party provider，与 Discord 等 provider 在架构上并列；不同 provider 负责各自的协议接入与出站渲染，但内部统一通过 session interaction core 对接 API。

---

## 本期目标

本期新增：

```text
POST /v1/runtimes/{runtimeId}/sessions/{sessionId}/responses
```

能力包括：

- 在一个已存在的 session 上追加本次输入
- Gateway 将 session response request 写入 Redis
- API 通过 consumer group 消费该 request 并创建 user message / enqueue prompt
- Gateway 监听本次 interaction 的接受结果与 runtime output stream
- 支持非流式返回
- 支持 SSE 流式返回
- 尽量兼容 OpenAI SDK 的 Responses 调用方式

---

## 非目标

本期不包含：

- Web chat 迁移
- `chat/completions` API
- message edit
- session 自动创建
- session binding 自动路由增强
- create/fork session 迁移到 Gateway
- `/v1/models` 等额外 OpenAI 兼容面
- 域名统一与入口合并

---

## 职责边界

### Gateway 负责

- 对外暴露 Session-scoped Responses API
- Bearer token 接入与基础校验
- 作为一种 first-party provider 承接 Responses-style 请求
- 解析请求体
- 将 session response request 写入 Redis
- 监听 interaction 接受结果与 runtime output stream
- 流式输出 SSE
- 通过统一的 session interaction core 与 API 协作
- 将内部结果适配为 Responses-style 输出

### API 负责

- Session / Message 的领域真相
- 查询历史消息
- 创建 Session
- Fork Session
- Runtime / Session 的持久化和编排
- 真正的 user message 创建与 prompt 入队
- Assistant 输出的最终持久化

---

## 接口设计

### 主接口

```http
POST /v1/runtimes/{runtimeId}/sessions/{sessionId}/responses
Authorization: Bearer <token>
Content-Type: application/json
```

### 语义

在指定 `runtimeId + sessionId` 上发起一轮新的 response。

- 上下文以服务端已有 Session 历史为准
- 请求体只表达本次新增输入
- 不支持通过该接口重写整个对话历史

### 第一版请求体

```json
{
  "model": "cohub-agent",
  "input": "帮我分析这个错误",
  "stream": true
}
```

### 第一版返回

- `stream: false`：返回完整 response JSON
- `stream: true`：返回 SSE event stream

---

## 领域边界说明

Responses API 仅处理：

- Session continuation

不处理：

- create session
- fork session
- message edit
- history query
- graph query

这些继续由 API 提供独立接口。

---

## 数据流

### Provider / Interaction 分层

```text
provider ingress (discord / responses)
  -> request normalization
  -> unified session interaction core
  -> API domain capabilities
  -> unified interaction result/events
  -> provider-specific egress
```

### 非流式

```text
Client -> Gateway /responses
       -> Gateway 鉴权并校验 session scope
       -> Gateway 写入 Redis session response request
       -> API consumer 消费 request
       -> API 创建 user message 并 enqueue prompt
       -> API 写入 interaction accepted result
       -> Agent 执行并输出事件
       -> Gateway 等待本次 turn 结束
       -> Gateway 聚合结果并返回
```

### 流式

```text
Client -> Gateway /responses?stream=true
       -> Gateway 建立 SSE
       -> Gateway 鉴权并校验 session scope
       -> Gateway 写入 Redis session response request
       -> API consumer 消费 request
       -> API 创建 user message 并 enqueue prompt
       -> API 写入 interaction accepted result
       -> Agent 输出 runtime stream
       -> Gateway 监听 interaction result + runtime output stream
       -> Gateway 转成 Responses-style SSE
       -> Client
```

---

## 为什么采用 Responses-style 而不是 Chat Completions

原因：

- Chat Completions 偏向客户端 whole messages replay
- 不适合服务端持久化 Session 为真相的模型
- 不适合未来的 fork / session graph / 独立历史管理
- Responses-style 更接近“在已有上下文上继续一轮”的能力语义

---

## 后续演进

### 下期计划

- Web chat 改接 Gateway Responses API
- 保持历史查询、create/fork 继续走 API

### 后续可能增强

- 更丰富的 Responses event
- stop/cancel
- tool call 兼容输出
- OpenAI facade 完善
- 单域名统一入口
