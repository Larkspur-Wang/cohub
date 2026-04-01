# Dev 调试记录：Responses 会话历史被 intermediate assistant 污染

## 时间
- 2026-04-01

## 背景
在 dev 环境测试 Web chat 迁移到 Gateway Responses API 时，出现了这些现象：

- Gateway `/responses` 请求已经正常结束
- 前端有时能收到流式 event
- 但刷新/重新打开页面后，session 历史表现异常
- 用户主观感受为：
  - 回复像是丢了
  - 或最终展示不对
  - 或被后续状态覆盖

本次记录的目标是把**已确认的问题事实**先沉淀下来，后续再单独讨论最终优化方案。

---

## 结论摘要

当前问题的核心不是：

- Gateway SSE 不工作
- Web SSE parser 不工作
- Web 单纯的 UI 刷新问题

而是：

> agent 在一次用户请求过程中，会产生多条 `toolUse` 阶段的 intermediate assistant turn；这些 intermediate turn 被持久化到了 `session_messages`，从而污染了 session 历史真相。

其中大量 message 的特征是：

- `role = assistant`
- `stop_reason = toolUse`
- `message_kind = assistant_intermediate`
- `text = ''`
- `content = []`
- 但 `meta` 中包含 `thinkingSummary` / `toolCallRenderStates`

这类消息更像是：

- live status
- provider render
- 中间工具执行态

而不是用户应该在历史里看到的正式 assistant reply。

---

## 已确认正常的部分

### 1. Gateway Responses SSE 已恢复正常
通过 `curl -N` 验证，dev 环境现在已经能正常返回：

- `response.created`
- `response.output_text.delta`
- `response.completed`
- `[DONE]`

说明：

- Gateway `/responses` 主链路是通的
- 之前“请求一直挂住没 event”的问题已被修复

### 2. item_id 一致性问题已在本地代码修复
之前存在：

- `response.created.response.id`
- `response.output_text.delta.item_id`
- `response.completed.response.output[0].id`

三者不一致的问题。

本地代码已修正为：

- `itemId = ${responseId}_output_0`

但是否已部署到目标环境，需要以实际部署版本为准。

---

## 本次调试使用的环境信息

### Kubernetes
使用：

- `KUBECONFIG=~/.kube/config_us`

相关 namespace：

- `cohub-dev`
- `cohub-sessions-dev`

关键 pod：

- API: `cohub-api-dev-7c58b7778d-wwp2v`
- Gateway: `cohub-gateway-dev-0`
- Sandbox: `sandbox-99f1854c-f9dc-4139-938a-526ffd798e6c`

### DB
`apps/api/.env` 中 dev DB：

- `DATABASE_URL=postgres://cohub_dev:***@pgm-rj9shb8ezq45h5n8so.pg.rds-aliyun-america.rds.aliyuncs.com:5432/cohub_dev`

### 重点 session / runtime
- runtime: `99f1854c-f9dc-4139-938a-526ffd798e6c`
- session: `4e78c354-8c1a-4094-b143-b3d07507e3b2`

---

## 直接观测到的数据异常

### session_messages 中出现大量 assistant_intermediate
按 sequence 倒序查看该 session，可见如下模式：

- 用户消息后
- 跟着一条 `assistant_final`
- 然后又出现多条 `assistant_intermediate`
- 其中很多 `text_len = 0`
- `stop_reason = toolUse`

典型例子：

| sequence | id | kind | stop_reason | text_len |
|---|---|---|---|---:|
| 46 | `c701f313-e776-45eb-883a-879995c4bfc0` | `assistant_final` | `stop` | 736 |
| 47 | `a71a3bda-e091-4b68-97e7-004c6d921032` | `assistant_intermediate` | `toolUse` | 0 |
| 48 | `9028ca16-54a0-4fdb-827a-9c5a2f9a9c1b` | `assistant_intermediate` | `toolUse` | 0 |
| 49 | `51f2661e-0f6a-4014-8114-5129c10d549b` | `assistant_intermediate` | `toolUse` | 36 |
| 50 | `c525beee-aeb0-484a-bebb-c95c9cdf85b2` | `assistant_intermediate` | `toolUse` | 0 |
| 51 | `ec103939-7b93-4d95-bb55-fc31ed3e2439` | `assistant_intermediate` | `toolUse` | 0 |
| 52 | `6ee9f2be-9e5c-4c04-a7d8-de848dc8d14c` | `assistant_intermediate` | `toolUse` | 0 |
| 53 | `b54facb6-4661-4bf7-9890-452320e8c4b1` | `assistant_intermediate` | `toolUse` | 0 |
| 54 | `8c81d23e-948e-4671-a229-a4af2a352afe` | `assistant_intermediate` | `toolUse` | 0 |
| 55 | `66c87139-d839-4424-bb2f-168cb91c1d74` | `assistant_final` | `stop` | 1067 |

说明：

- 一次用户请求并非只产生一条 assistant message
- tool 调用阶段的中间态也被当作正式历史消息持久化了

### session_tool_calls 与这些 intermediate message 一一对应
同一个 session 的 `session_tool_calls` 里可以看到：

- `functions.read:*`
- `functions.bash:*`
- `functions.edit:*`

这些 tool call 的 `message_id` 就对应上面那些 `assistant_intermediate` message。

说明：

> 这些空 assistant message 不是随机坏数据，而是工具执行阶段的中间 turn 被落库后的结果。

---

## Pod 日志中的证据

### sandbox pod
sandbox 日志显示，Responses 请求确实进入了 runtime：

例如：

- `core flow verification ping`
- `debug current dev data check`
- `item id consistency check`

说明：

- 用户输入确实入队
- agent 确实处理了这些 prompt

### API pod
API pod 日志显示：

- `enqueueRuntimePrompt` 正常执行
- 期间有大量 `Skip outbound ... missing externalChatId`

这不是本次核心问题，但说明当前 Responses session 没有关联外部 channel，是预期行为。

---

## 当前最可疑的代码路径

### 1. agent 侧：对每个 turn_end 都 persist
文件：

- `apps/agent/src/index.ts`

关键逻辑：

```ts
if (event.type === "turn_end" && handle.currentUserMessageId) {
  void persistAssistantMessage(...)
}
```

这意味着：

- 每遇到一次 `turn_end`
- 就调用 `persistAssistantMessage(...)`

如果 PI agent 在一次用户请求中会产生多个 `turn_end`（例如 toolUse 中间态），那么这些中间态都会被 persist。

### 2. agent API 层：persistAssistantMessage 缺少过滤
文件：

- `apps/agent/src/api.ts`

当前 `persistAssistantMessage(...)` 会把 assistant message 转成：

- `content`
- `text`
- `toolCalls`
- `stopReason`
- `meta`

然后直接调用 API internal route 落库。

现在缺少的重要保护是：

- 对 `stopReason = toolUse` 的 intermediate turn
- 当 `content` 为空且 `text` 为空时
- 不应继续写入 `session_messages`

### 3. API 侧：persistMessageNode 也没有兜底阻断
文件：

- `apps/api/src/runtime-sessions.ts`

`persistMessageNode(...)` 目前会接收上游 assistant payload 并照常落库。

也就是说：

- 一旦 agent 侧把空 intermediate 传进来
- API 侧不会拦住

因此 session history 很容易被污染。

---

## 为什么这会导致前端看起来“reply 没了”

前端目前的策略是：

- 流式阶段显示 Gateway SSE 的 delta
- 完成后再从 API 拉取 session 历史作为最终真相

所以当 API 历史里已经包含大量空的 `assistant_intermediate` 时：

- 前端流式阶段看到的内容可能是正常的
- 但最终 sync 回来的历史是异常的
- 用户看到的最终状态就可能像：
  - 回复被稀释
  - 回复位置错乱
  - 回复像消失
  - 聊天历史突然出现很多空 assistant item

---

## 当前不在本记录中定案的部分

以下内容已经有方向，但本记录**不直接给出最终定案方案**，等待后续再讨论：

- 是否只持久化 final assistant
- 是否允许部分带正文的 intermediate assistant 保留在历史中
- toolUse intermediate 是否应只存在于 provider render / live stream
- API 是否应强制拒绝空 assistant message 落库
- Web 是否需要对 assistant_intermediate 做特殊展示或过滤

---

## 建议后续讨论的问题

后续单独讨论时，至少需要明确这些策略问题：

1. Session 历史的真相边界是什么？
   - final only？
   - 还是允许部分 intermediate？

2. toolUse 阶段的数据应该进哪里？
   - `session_messages`
   - `session_tool_calls`
   - `provider_render`
   - `runtime stream`

3. 需要几层保护？
   - agent 侧过滤
   - API 侧兜底
   - Web 展示层容错

4. 对已有脏数据是否需要清理/修复脚本？
   - 当前 dev session 已经有很多空 `assistant_intermediate`

---

## 当前状态

本次调试已经确认：

- Gateway Responses SSE 主链路已基本恢复可用
- 当前体验问题的主要来源是 session history 被 intermediate assistant 污染
- 根因更靠近 agent turn_end 持久化策略，而非前端展示本身

后续优化方案待进一步讨论。
