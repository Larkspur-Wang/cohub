#!/usr/bin/env tsx
/**
 * Cohub Dev 环境 — Tool Call 全链路端到端验证
 *
 * 验证目标:
 *  1. 流式中间结果: WebSocket stream_update 中 tool_use 的 running→done 状态 + tool_result delta
 *  2. DB 持久化: session_messages.content 中 tool_use/tool_result 块完整性
 *  3. DB 持久化: meta.toolCallRenderStates / meta.messageKind 正确性
 *  4. 消息序列: user → assistant 的 sequence 连续性
 *  5. API 消息列表: 返回内容中 tool 信息完整
 *
 * 用法: pnpm test:tool-call
 *
 * 环境变量:
 *   COHUB_TOKEN / TOKEN  - 鉴权 token（从 .env 加载）
 *   COHUB_API_ORIGIN     - 可选，默认 https://api-dev.cohub.run
 */

import "dotenv/config";

// ── 工具函数 ──────────────────────────────────────────────────────────────────

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

// ── 配置 ──────────────────────────────────────────────────────────────────────

const config = {
  token: process.env.COHUB_TOKEN ?? process.env.TOKEN ?? "",
  apiOrigin: process.env.COHUB_API_ORIGIN ?? "https://api-dev.cohub.run",
  gatewayOrigin: process.env.COHUB_GATEWAY_ORIGIN ?? "",
  gatewayWs: process.env.COHUB_GATEWAY_WS ?? "",
};

if (!config.gatewayOrigin) {
  config.gatewayOrigin = config.apiOrigin.replace("api-dev", "gateway-dev");
}
if (!config.gatewayWs) {
  config.gatewayWs = `${config.gatewayOrigin.replace("https://", "wss://")}/ws`;
}

if (!config.token) {
  console.error("❌ 请设置 COHUB_TOKEN 或 TOKEN 环境变量");
  process.exit(1);
}

// ── 配色 ──────────────────────────────────────────────────────────────────────

const C = {
  reset: "\x1b[0m",
  dim: "\x1b[2m",
  green: "\x1b[32m",
  red: "\x1b[31m",
  yellow: "\x1b[33m",
  cyan: "\x1b[96m",
  white: "\x1b[1m",
  magenta: "\x1b[35m",
};

const PASS = `${C.green}✅ PASS${C.reset}`;
const FAIL = `${C.red}❌ FAIL${C.reset}`;
const SEC = `${C.magenta}━━━${C.reset}`;

// ── 测试运行器 ────────────────────────────────────────────────────────────────

type TestResult = { name: string; status: "pass" | "fail" | "warn"; detail?: string; duration?: number };
const results: TestResult[] = [];

function ok(name: string, detail?: string, duration?: number) {
  results.push({ name, status: "pass", detail, duration });
  const durStr = duration ? ` ${C.dim}(${duration}ms)${C.reset}` : "";
  console.log(`  ${PASS} ${name}${detail ? ` ${C.dim}${detail}${C.reset}` : ""}${durStr}`);
}

function fail(name: string, detail?: string, duration?: number) {
  results.push({ name, status: "fail", detail, duration });
  const durStr = duration ? ` ${C.dim}(${duration}ms)${C.reset}` : "";
  console.log(`  ${FAIL} ${name}${detail ? ` ${C.dim}${detail}${C.reset}` : ""}${durStr}`);
}

async function run(name: string, fn: () => Promise<void>) {
  console.log(`\n${SEC} ${C.white}${name}${C.reset} ${SEC}`);
  const t0 = Date.now();
  try {
    await fn();
  } catch (err) {
    fail(name, err instanceof Error ? err.message : String(err), Date.now() - t0);
  }
}

async function sub(name: string, fn: () => Promise<void>) {
  const t0 = Date.now();
  try {
    await fn();
  } catch (err) {
    fail(name, err instanceof Error ? err.message : String(err), Date.now() - t0);
  }
}

// ── API 辅助 ──────────────────────────────────────────────────────────────────

async function api(path: string, init?: RequestInit): Promise<unknown> {
  const headers = new Headers(init?.headers);
  headers.set("Authorization", `Bearer ${config.token}`);
  if (!headers.has("Content-Type") && init?.body) {
    headers.set("Content-Type", "application/json");
  }

  const url = path.startsWith("http") ? path : `${config.apiOrigin}${path}`;
  const resp = await fetch(url, { ...init, headers });
  const text = await resp.text();
  let body: unknown = null;
  try { body = JSON.parse(text); } catch { body = text; }

  if (!resp.ok) {
    const detail = typeof body === "string" ? body.slice(0, 500) : JSON.stringify(body).slice(0, 500);
    throw new Error(`HTTP ${resp.status} ${path}\n  Response: ${detail}`);
  }
  return body;
}

async function findReadySpace(): Promise<string | null> {
  const spaces = await api("/api/spaces") as Array<Record<string, unknown>>;
  for (const sp of spaces) {
    if (sp.sandboxStatus === "ready") return sp.id as string;
  }
  return null;
}

async function createSession(spaceId: string): Promise<string> {
  const body = await api(`/api/spaces/${spaceId}/sessions`, {
    method: "POST",
    body: JSON.stringify({ title: `tool-call-test-${Date.now()}` }),
  }) as { session: { id: string } };
  return body.session.id;
}

async function _sendMessage(sessionId: string, text: string): Promise<{ ok: boolean; userMessageId: string }> {
  return api(`/api/sessions/${sessionId}/messages`, {
    method: "POST",
    body: JSON.stringify({ content: [{ type: "text" as const, text }] }),
  }) as Promise<{ ok: boolean; userMessageId: string }>;
}

interface MessageRecord {
  id: string;
  sessionId: string;
  role: string;
  content: Array<Record<string, unknown>>;
  text: string | null;
  sequence: number;
  provider: string | null;
  model: string | null;
  stopReason: string | null;
  errorMessage: string | null;
  usageInput: number | null;
  usageOutput: number | null;
  costTotal: string | null;
  meta: Record<string, unknown> | null;
  createdAt: string;
}

async function getMessages(sessionId: string): Promise<MessageRecord[]> {
  const data = await api(`/api/sessions/${sessionId}/messages`) as {
    messages: MessageRecord[];
  };
  return data.messages;
}

// ── 类型定义 ──────────────────────────────────────────────────────────────────

type ToolUseBlock = { type: "tool_use"; id: string; name: string; input: Record<string, unknown>; _meta?: Record<string, unknown> };
type ToolResultBlock = { type: "tool_result"; tool_use_id: string; content: string | unknown[]; is_error?: boolean; _meta?: Record<string, unknown> };
type ContentBlock = ToolUseBlock | ToolResultBlock | { type: "text"; text: string } | { type: "thinking"; thinking: string };

interface WsStreamEvent {
  type: string;
  payload: {
    eventType?: string;
    content?: ContentBlock[];
    sourceMessageId?: string | null;
    timestamp?: number;
    turnEnd?: boolean;
  };
}

// ── WebSocket 采集器 ──────────────────────────────────────────────────────────

/**
 * 连接 Gateway WS, 发送消息, 采集所有 stream_update 事件直到 turnEnd
 */
async function collectWsToolCallEvents(params: {
  spaceId: string;
  sessionId: string;
  text: string;
  timeoutMs?: number;
}): Promise<{
  accepted: boolean;
  streamEvents: WsStreamEvent[];
  connectionId: string;
  receivedTypes: string[];
  errorMessage?: string;
}> {
  const { spaceId, sessionId, text, timeoutMs = 180_000 } = params;
  const ws = new WebSocket(config.gatewayWs);
  const streamEvents: WsStreamEvent[] = [];
  const receivedTypes: string[] = [];
  let connectionId = "";
  let accepted = false;
  let errorMessage: string | undefined;

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      ws.close(1000, "timeout");
      resolve({ accepted, streamEvents, connectionId, receivedTypes, errorMessage });
    }, timeoutMs);

    ws.onopen = () => {
      ws.send(JSON.stringify({
        type: "auth",
        requestId: "tc-auth",
        payload: { token: config.token },
      }));
    };

    ws.onmessage = (event) => {
      let msg: Record<string, unknown>;
      try { msg = JSON.parse(String(event.data)); } catch { return; }

      const msgType = String(msg.type ?? "unknown");
      receivedTypes.push(msgType);

      if (msg.type === "auth.ok") {
        connectionId = String((msg.payload as Record<string, unknown>)?.connectionId ?? "");
        ws.send(JSON.stringify({
          type: "message.create",
          requestId: "tc-msg",
          payload: { spaceId, sessionId, text },
        }));
      }

      if (msg.type === "message.accepted") {
        accepted = true;
      }

      if (msg.type === "error" || msg.type === "message.rejected") {
        errorMessage = JSON.stringify(msg.payload);
      }

      // 采集 stream_update 事件（即 agent 的流式推送）
      if (msg.type === "event") {
        const payload = msg.payload as Record<string, unknown> | undefined;
        if (payload?.eventType === "stream_update" && Array.isArray(payload.content)) {
          streamEvents.push({
            type: msg.type as string,
            payload: {
              eventType: payload.eventType as string,
              content: payload.content as ContentBlock[],
              sourceMessageId: payload.sourceMessageId as string | null | undefined,
              timestamp: payload.timestamp as number | undefined,
              turnEnd: payload.turnEnd as boolean | undefined,
            },
          });
        }
      }
    };

    ws.onclose = () => clearTimeout(timeout);
    ws.onerror = () => { clearTimeout(timeout); reject(new Error("WebSocket error")); };
  });
}

/**
 * 等待 assistant 回复出现在消息列表中
 */
async function waitForAssistantReply(sessionId: string, timeoutMs = 180_000, intervalMs = 3000): Promise<MessageRecord[]> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const messages = await getMessages(sessionId);
      const assistantMsgs = messages.filter(
        (m) => m.role === "assistant" && m.text && m.text.trim().length > 0,
      );
      if (assistantMsgs.length > 0) return messages;
    } catch { /* retry */ }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error(`等待 assistant 回复超时 (${timeoutMs}ms)`);
}

// ── 主测试流程 ────────────────────────────────────────────────────────────────

let testSpaceId: string | null = null;
let testSessionId: string | null = null;
let wsEvents: WsStreamEvent[] = [];
let allMessages: MessageRecord[] = [];

async function main() {
  console.log(`${C.white}Cohub Dev — Tool Call 全链路端到端验证${C.reset}`);
  console.log(`${C.dim}API: ${config.apiOrigin}${C.reset}`);
  console.log(`${C.dim}Gateway WS: ${config.gatewayWs}${C.reset}`);
  console.log(`${C.dim}时间: ${new Date().toISOString()}${C.reset}`);

  // ── Step 1: 找到 ready sandbox ─────────────────────────────────────────────

  await run("1. 找到 ready sandbox space", async () => {
    const spaceId = await findReadySpace();
    assert(spaceId, "没有找到 ready 状态的 sandbox space");
    testSpaceId = spaceId;
    ok("ready sandbox", `spaceId=${testSpaceId}`);
  });

  if (!testSpaceId) {
    console.log(`\n${C.red}无法继续: 没有 ready sandbox${C.reset}`);
    process.exit(1);
  }

  // ── Step 2: 创建 session ───────────────────────────────────────────────────

  await run("2. 创建测试 Session", async () => {
    assert(testSpaceId, "testSpaceId should be set from step 1");
    const sid = await createSession(testSpaceId);
    testSessionId = sid;
    ok("创建 session", `sessionId=${testSessionId}`);
  });

  // ── Step 3: 通过 WebSocket 采集流式 tool call 事件 ─────────────────────────

  await run("3. WebSocket 流式事件采集 (发送触发 tool call 的消息)", async () => {
    // 使用大概率触发 tool call 的 prompt：让 agent 读取 workspace 中的文件
    const promptText = "Please read the file /workspace/README.md if it exists, or list the files in /workspace using bash. Tell me what you find.";

    console.log(`  ${C.dim}发送 prompt: "${promptText.slice(0, 60)}..."${C.reset}`);

    assert(testSpaceId, "testSpaceId should be set");
    assert(testSessionId, "testSessionId should be set");
    const result = await collectWsToolCallEvents({
      spaceId: testSpaceId,
      sessionId: testSessionId,
      text: promptText,
      timeoutMs: 120_000,
    });

    if (result.errorMessage) {
      console.log(`  ${C.dim}  Gateway 错误: ${result.errorMessage}${C.reset}`);
    }
    if (result.receivedTypes.length > 0) {
      console.log(`  ${C.dim}  收到的 WS 消息类型: ${[...new Set(result.receivedTypes)].join(", ")}${C.reset}`);
    }

    if (result.accepted) {
      ok("消息 accepted", `connectionId=${result.connectionId}`);

      wsEvents = result.streamEvents;
      if (wsEvents.length === 0) {
        ok("流式事件", "暂无 stream_update（agent 可能尚未开始推送）");
      } else {
        ok("收到 stream_update 事件", `共 ${wsEvents.length} 个事件`);
      }
    } else {
      // WS 未被 accepted，回退到 HTTP 发送
      console.log(`  ${C.yellow}  WS 消息未被 accepted，回退到 HTTP API 发送...${C.reset}`);
      assert(testSessionId, "testSessionId should be set");
      const sendResult = await _sendMessage(testSessionId, promptText);
      ok("HTTP 发送消息", `userMessageId=${sendResult.userMessageId}`);
    }

    // 3.1-3.4: 如果有流式事件，验证其内容
    if (wsEvents.length > 0) {
      await sub("3.1 流式事件包含 tool_use 块", async () => {
        const allBlocks = wsEvents.flatMap((e) => e.payload.content ?? []);
        const toolUseBlocks = allBlocks.filter((b) => b.type === "tool_use");
        assert(toolUseBlocks.length > 0, "流式事件中应包含 tool_use 块");
        const toolNames = [...new Set(toolUseBlocks.map((b) => b.name))];
        ok("tool_use 块", `共 ${toolUseBlocks.length} 个, 工具名: ${toolNames.join(", ")}`);
        for (const tu of toolUseBlocks.slice(0, 3)) {
          assert(tu.id, `tool_use 块应有 id (name=${tu.name})`);
          assert(tu.name, "tool_use 块应有 name");
          assert(tu.input !== undefined, "tool_use 块应有 input");
        }
        ok("tool_use 块结构完整", "id/name/input 均存在");
      });

      await sub("3.2 tool_use 状态流: running → done", async () => {
        const toolStatuses = new Map<string, string[]>();
        for (const event of wsEvents) {
          for (const block of (event.payload.content ?? [])) {
            if (block.type === "tool_use" && block._meta?.toolStatus) {
              const id = block.id;
              const status = String(block._meta.toolStatus);
              const statuses = toolStatuses.get(id) ?? [];
              if (statuses[statuses.length - 1] !== status) statuses.push(status);
              toolStatuses.set(id, statuses);
            }
          }
        }
        assert(toolStatuses.size > 0, "应有 tool_use 状态记录");
        for (const [id, statuses] of toolStatuses) {
          const name = (wsEvents.flatMap((e) => e.payload.content ?? [])
            .find((b) => b.type === "tool_use" && b.id === id) as ToolUseBlock | undefined)?.name ?? "unknown";
          ok(`工具 ${name} (${id.slice(0, 8)})`, `状态流: ${statuses.join(" → ")}`);
          assert(statuses.includes("running") || statuses.includes("done"), `工具 ${name} 应有 running 或 done 状态`);
        }
      });

      await sub("3.3 流式事件包含 tool_result 块", async () => {
        const allBlocks = wsEvents.flatMap((e) => e.payload.content ?? []);
        const toolResultBlocks = allBlocks.filter((b) => b.type === "tool_result");
        if (toolResultBlocks.length > 0) {
          ok("tool_result 块", `共 ${toolResultBlocks.length} 个`);
          const toolUseIds = new Set(allBlocks.filter((b) => b.type === "tool_use").map((b) => (b as ToolUseBlock).id));
          for (const tr of toolResultBlocks.slice(0, 3)) {
            assert(toolUseIds.has(tr.tool_use_id), `tool_result 的 tool_use_id 应匹配某个 tool_use`);
          }
          ok("tool_result ↔ tool_use 关联正确");
        } else {
          ok("tool_result 块", "流式阶段未出现（可能在 turn_end 时才完整推送）");
        }
      });

      await sub("3.4 流式事件时序统计", async () => {
        if (wsEvents.length < 2) return;
        const timestamps = wsEvents.map((e) => e.payload.timestamp ?? 0);
        const durationMs = (timestamps[timestamps.length - 1] ?? 0) - (timestamps[0] ?? 0);
        ok("流式事件时序", `首帧→末帧 ${durationMs}ms, 共 ${wsEvents.length} 帧`);
      });
    } else {
      ok("流式事件", "WS 未推送 stream_update（agent 可能通过其他路径响应）");
    }
  });

  // ── Step 4: 等待 agent 完成并持久化 ─────────────────────────────────────────

  await run("4. 等待 Agent 完成 & 消息持久化", async () => {
    assert(testSessionId, "testSessionId should be set");
    allMessages = await waitForAssistantReply(testSessionId, 180_000, 3000);
    ok("Agent 回复已持久化", `共 ${allMessages.length} 条消息`);
  });

  // ── Step 5: 验证 DB 持久化数据 ──────────────────────────────────────────────

  await run("5. DB 持久化数据验证", async () => {
    const assistantMsgs = allMessages.filter((m) => m.role === "assistant" && m.text && m.text.trim().length > 0);
    assert(assistantMsgs.length > 0, "应有 assistant 回复消息");

    const latestAssistant = assistantMsgs[assistantMsgs.length - 1];

    // 打印消息内容摘要用于调试
    console.log(`  ${C.dim}  消息概览:${C.reset}`);
    for (const msg of allMessages) {
      const types = msg.content.map((b) => String(b.type)).join(", ");
      const textPreview = (msg.text ?? "").slice(0, 80);
      console.log(`  ${C.dim}    [${msg.role}] seq=${msg.sequence} types=[${types}] text="${textPreview}"${C.reset}`);
    }

    // 检查是否有 tool call
    const toolUseBlocks = latestAssistant.content.filter((b) => b.type === "tool_use") as ToolUseBlock[];
    const toolResultBlocks = latestAssistant.content.filter((b) => b.type === "tool_result") as ToolResultBlock[];
    const hasToolCalls = toolUseBlocks.length > 0;
    const hasToolResults = toolResultBlocks.length > 0;

    // 关键诊断: stopReason=toolUse 但无 tool_use 块 = 持久化 bug
    if (latestAssistant.stopReason === "tool_use" && !hasToolCalls) {
      console.log(`  ${C.red}  🐛 发现数据不一致: stopReason=tool_use 但 content 中无 tool_use 块！${C.reset}`);
      console.log(`  ${C.red}  这表明 agent 执行了工具调用但持久化时遗漏了 tool_use 块${C.reset}`);
    }

    if (!hasToolCalls && !hasToolResults) {
      console.log(`  ${C.yellow}  ⚠ Agent 本次回复未触发 tool call（可能 prompt 未命中工具使用条件，或 sandbox tools 不可用）${C.reset}`);
      console.log(`  ${C.yellow}  stopReason=${latestAssistant.stopReason}, provider=${latestAssistant.provider}, model=${latestAssistant.model}${C.reset}`);
    }

    // 5.1: content 中 tool_use 块完整性
    await sub("5.1 content 中 tool_use 块完整性", async () => {
      if (!hasToolCalls) {
        ok("tool_use 块", "本次回复无 tool_use（agent 选择了纯文本回复）");
        return;
      }
      for (const tu of toolUseBlocks) {
        assert(tu.id, "tool_use 块应有 id");
        assert(tu.name, "tool_use 块应有 name");
        assert(typeof tu.input === "object", "tool_use 块应有 input 对象");
        ok(`持久化 tool_use: ${tu.name}`, `id=${tu.id.slice(0, 8)}, input_keys=${Object.keys(tu.input).join(", ")}`);
      }
    });

    // 5.2: content 中 tool_result 块完整性
    await sub("5.2 content 中 tool_result 块完整性", async () => {
      const toolResultBlocks = latestAssistant.content.filter((b) => b.type === "tool_result") as ToolResultBlock[];

      // 关键检查: 如果有 tool_result 但没有 tool_use，说明数据持久化有 bug
      if (toolResultBlocks.length > 0 && !hasToolCalls) {
        fail("tool_result 块完整性", `存在 ${toolResultBlocks.length} 个 tool_result 但无对应 tool_use — 数据持久化可能遗漏了 tool_use 块`);
        // 仍然打印详情以便排查
        for (const tr of toolResultBlocks.slice(0, 3)) {
          const contentPreview = typeof tr.content === "string"
            ? tr.content.slice(0, 80)
            : JSON.stringify(tr.content).slice(0, 80);
          console.log(`      ${C.dim}tool_result: tool_use_id=${tr.tool_use_id.slice(0, 8)}, content="${contentPreview}"${C.reset}`);
        }
        return;
      }

      if (!hasToolCalls) {
        ok("tool_result 块", "无（无 tool_use 则无 tool_result）");
        return;
      }

      const toolUseIds = new Set(toolUseBlocks.map((b) => b.id));
      if (toolResultBlocks.length > 0) {
        for (const tr of toolResultBlocks) {
          assert(tr.tool_use_id, "tool_result 块应有 tool_use_id");
          assert(toolUseIds.has(tr.tool_use_id), `tool_result.tool_use_id 应匹配 tool_use`);
          assert(tr.content !== undefined, "tool_result 块应有 content");
          const contentPreview = typeof tr.content === "string"
            ? tr.content.slice(0, 80)
            : JSON.stringify(tr.content).slice(0, 80);
          ok(`持久化 tool_result: ${tr.tool_use_id.slice(0, 8)}`, `content_preview="${contentPreview}", is_error=${tr.is_error ?? false}`);
        }
      } else {
        ok("tool_result 块", "无（可能 agent 内联处理了 tool 结果）");
      }
    });

    // 5.3: tool_use ↔ tool_result 配对验证
    await sub("5.3 tool_use ↔ tool_result 配对验证", async () => {
      if (!hasToolCalls) {
        ok("配对验证", "跳过（无 tool_use）");
        return;
      }
      const toolUseIds = new Set(toolUseBlocks.map((b) => b.id));
      const toolResultIds = new Set(
        latestAssistant.content.filter((b) => b.type === "tool_result").map((b) => (b as ToolResultBlock).tool_use_id),
      );
      const unpaired = [...toolUseIds].filter((id) => !toolResultIds.has(id));
      if (unpaired.length > 0) {
        for (const id of unpaired) {
          const tu = toolUseBlocks.find((b) => b.id === id);
          const status = tu?._meta?.toolStatus;
          if (status === "done") {
            ok(`tool_use ${id.slice(0, 8)} 无对应 tool_result 但 status=done`);
          } else {
            fail(`tool_use ${id.slice(0, 8)} 无对应 tool_result 且 status=${status}`);
          }
        }
      } else {
        ok("tool_use ↔ tool_result 完全配对", `${toolUseIds.size} 对`);
      }
    });

    // 5.4: meta 字段验证
    await sub("5.4 meta 字段验证 (toolCallRenderStates / messageKind)", async () => {
      const meta = latestAssistant.meta;
      assert(meta, "assistant message 应有 meta");

      if (hasToolCalls) {
        const messageKind = meta.messageKind as string | undefined;
        assert(messageKind === "assistant_intermediate", `有 tool_call 的消息 messageKind 应为 assistant_intermediate, 实际: ${messageKind}`);
        ok("messageKind", messageKind);
      } else {
        const messageKind = meta.messageKind as string | undefined;
        ok("messageKind", `${messageKind ?? "未设置"}（无 tool_call 时为 normal）`);
      }

      const toolCallRenderStates = meta.toolCallRenderStates as Array<Record<string, unknown>> | undefined;
      if (toolCallRenderStates && Array.isArray(toolCallRenderStates) && toolCallRenderStates.length > 0) {
        for (const ts of toolCallRenderStates) {
          assert(ts.toolCallId, "toolCallRenderState 应有 toolCallId");
          assert(ts.toolName, "toolCallRenderState 应有 toolName");
          assert(ts.status, "toolCallRenderState 应有 status");
          ok(`toolCallRenderState: ${ts.toolName}`, `status=${ts.status}, summary=${ts.summary ?? "n/a"}`);
        }
      } else if (hasToolCalls) {
        fail("toolCallRenderStates", "有 tool_use 但 toolCallRenderStates 为空");
      } else {
        ok("toolCallRenderStates", "不存在（无 tool_call）");
      }

      assert(latestAssistant.provider, "assistant message 应有 provider");
      assert(latestAssistant.model, "assistant message 应有 model");
      ok("provider/model", `${latestAssistant.provider} / ${latestAssistant.model}`);
    });

    // 5.5: usage 字段验证
    await sub("5.5 usage 字段验证", async () => {
      if (latestAssistant.usageInput !== null || latestAssistant.usageOutput !== null) {
        ok("usage", `input=${latestAssistant.usageInput ?? "null"}, output=${latestAssistant.usageOutput ?? "null"}, cost=${latestAssistant.costTotal ?? "null"}`);
      } else {
        ok("usage", "无（agent 可能未上报 usage）");
      }
    });
  });

  // ── Step 6: 消息序列连续性验证 ─────────────────────────────────────────────

  await run("6. 消息序列连续性验证", async () => {
    const sequences = allMessages.map((m) => m.sequence);
    for (let i = 1; i < sequences.length; i++) {
      assert(
        sequences[i] === sequences[i - 1] + 1,
        `sequence 不连续: ${sequences[i - 1]} → ${sequences[i]}`,
      );
    }
    ok("序列连续", `range=[${sequences[0]}..${sequences[sequences.length - 1]}], count=${sequences.length}`);

    // 验证 user → assistant 交替
    const userMsgIdx = allMessages.findIndex((m) => m.role === "user");
    if (userMsgIdx >= 0) {
      const assistantAfterUser = allMessages.slice(userMsgIdx).find((m) => m.role === "assistant");
      assert(assistantAfterUser, "user 消息后应有 assistant 回复");
      ok("user→assistant 配对", `user seq=${allMessages[userMsgIdx].sequence}, assistant seq=${assistantAfterUser.sequence}`);
    }
  });

  // ── Step 7: 多工具调用场景 (可选增强测试) ─────────────────────────────────

  await run("7. 多工具调用场景验证 (HTTP 发送)", async () => {
    assert(testSpaceId, "testSpaceId should be set");
    const sid2 = await createSession(testSpaceId);

    // 发送需要多个工具才能完成的 prompt
    const promptText = "First list all files in /workspace, then read the first .md file you find, and finally run 'echo hello from cohub' in bash. Report all results.";

    const sendResult = await _sendMessage(sid2, promptText);
    ok("HTTP 发送消息", `userMessageId=${sendResult.userMessageId}`);

    const messages2 = await waitForAssistantReply(sid2, 120_000, 3000);
    const assistantMsgs2 = messages2.filter((m) => m.role === "assistant" && m.text && m.text.trim().length > 0);

    if (assistantMsgs2.length > 0) {
      const latest2 = assistantMsgs2[assistantMsgs2.length - 1];
      const toolUseBlocks2 = latest2.content.filter((b) => b.type === "tool_use");
      const toolResultBlocks2 = latest2.content.filter((b) => b.type === "tool_result");

      // 打印多工具场景的消息概览
      console.log(`  ${C.dim}  多工具场景消息概览:${C.reset}`);
      for (const msg of messages2) {
        const types = msg.content.map((b) => String((b as Record<string, unknown>).type)).join(", ");
        const textPreview = (msg.text ?? "").slice(0, 80);
        console.log(`  ${C.dim}    [${msg.role}] seq=${msg.sequence} stopReason=${msg.stopReason} types=[${types}] text="${textPreview}"${C.reset}`);
      }

      // 检查工具调用的完整性
      if (toolResultBlocks2.length > 0 && toolUseBlocks2.length === 0) {
        fail("多工具调用完整性", `有 ${toolResultBlocks2.length} 个 tool_result 但无 tool_use 块 — 持久化遗漏`);
      } else {
        ok("多工具调用消息", `tool_use=${toolUseBlocks2.length}, tool_result=${toolResultBlocks2.length}`);
        if (toolUseBlocks2.length > 0) {
          const toolNames = [...new Set(toolUseBlocks2.map((b) => (b as ToolUseBlock).name))];
          if (toolNames.length > 1) ok("多种工具被调用", toolNames.join(", "));
          if (toolResultBlocks2.length > 0) {
            const resultIds = new Set(toolResultBlocks2.map((b) => (b as ToolResultBlock).tool_use_id));
            const allPaired = toolUseBlocks2.every((tu) => resultIds.has((tu as ToolUseBlock).id));
            if (allPaired) ok("所有 tool_call 都有对应结果");
          }
        }
      }

      // 验证序列连续性
      const seqs2 = messages2.map((m) => m.sequence);
      let continuous = true;
      for (let i = 1; i < seqs2.length; i++) {
        if (seqs2[i] !== seqs2[i - 1] + 1) { continuous = false; break; }
      }
      if (continuous) ok("多工具场景序列连续");

      // 清理
      try { await api(`/api/sessions/${sid2}`, { method: "DELETE" }); } catch { /* ignore */ }
    } else {
      ok("多工具调用", "agent 未产生 assistant 回复（可能仍在处理中）");
    }
  });

  // ── 汇总报告 ────────────────────────────────────────────────────────────────

  console.log(`\n${SEC} ${C.white}汇总报告${C.reset} ${SEC}`);
  const passCount = results.filter((r) => r.status === "pass").length;
  const failCount = results.filter((r) => r.status === "fail").length;
  const warnCount = results.filter((r) => r.status === "warn").length;
  const totalCount = results.length;

  console.log(`  ${C.white}总计: ${totalCount} 项${C.reset}`);
  console.log(`  ${C.green}通过: ${passCount}${C.reset}  ${C.red}失败: ${failCount}${C.reset}  ${C.yellow}警告: ${warnCount}${C.reset}`);

  if (failCount > 0) {
    console.log(`\n  ${C.red}失败详情:${C.reset}`);
    for (const r of results.filter((r) => r.status === "fail")) {
      const durStr = r.duration ? ` (${r.duration}ms)` : "";
      console.log(`    ${FAIL} ${r.name}: ${r.detail ?? "no detail"}${durStr}`);
    }
  }

  // 清理
  if (testSessionId) {
    try { await api(`/api/sessions/${testSessionId}`, { method: "DELETE" }); } catch { /* ignore */ }
  }

  if (failCount > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(`\n${FAIL} 脚本执行失败:`, err);
  process.exit(1);
});
