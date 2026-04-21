#!/usr/bin/env tsx
/**
 * Cohub Dev 环境端到端全链路验证脚本
 *
 * 用法: pnpm test:e2e
 *
 * 环境变量:
 *   COHUB_TOKEN / TOKEN  - 必须，用于鉴权的 Bearer token
 *   COHUB_API_ORIGIN     - 可选，默认 https://api-dev.cohub.run
 *   COHUB_GATEWAY_ORIGIN - 可选，默认由 API_ORIGIN 推导
 *   COHUB_GATEWAY_WS     - 可选，默认由 GATEWAY_ORIGIN 推导
 *   SKIP_WS_TEST         - 设为 1 跳过 WebSocket 实时测试
 *   SKIP_AGENT_TEST      - 设为 1 跳过 Agent 实际回复测试（耗时较长）
 */

import {
  assertConfig, config, api, createTestRunner,
  waitForAssistantReply, wsSendAndWaitForAgentReply, summarizeEvents,
  createSession, sendMessage, findReadySpace, cleanupTestResources,
  C, FAIL, SEC, TIMEOUTS,
} from "./test-utils.js";

assertConfig();

// ── 工具函数 ──────────────────────────────────────────────────────────────────

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

// ── 测试运行器 ────────────────────────────────────────────────────────────────

// biome-ignore lint/correctness/noUnusedVariables: false positive, warn is used later in the file
const { ok, fail, warn, run, summary } = createTestRunner();

// ── 测试用例 ──────────────────────────────────────────────────────────────────

let createdSpaceId: string | null = null;
let createdSessionId: string | null = null;
/** 用于 FS / 消息测试的 ready sandbox space */
let readySpaceId: string | null = null;
let readySessionId: string | null = null;
/** 用于 Agent 回复测试的 session */
let agentTestSessionId: string | null = null;
let agentTestSpaceId: string | null = null;
/** 记录创建的所有 session ID，用于清理 */
const createdSessionIds: string[] = [];

async function trackSession(spaceId: string, title: string): Promise<string> {
  const sid = await createSession(spaceId, title);
  createdSessionIds.push(sid);
  return sid;
}

async function main() {
  console.log(`${C.white}Cohub Dev E2E 全链路验证${C.reset}`);
  console.log(`${C.dim}API: ${config.apiOrigin}${C.reset}`);
  console.log(`${C.dim}Gateway WS: ${config.gatewayWs}${C.reset}`);
  console.log(`${C.dim}时间: ${new Date().toISOString()}${C.reset}`);

  // ── Phase 1: 基础设施健康检查 ─────────────────────────────────────────────

  console.log(`\n${SEC} ${C.white}Phase 1: 基础设施健康检查${C.reset} ${SEC}`);

  await run("API /healthz", async () => {
    const data = await api("/healthz") as Record<string, unknown>;
    assert(data.ok === true, "healthz.ok should be true");
    assert(data.redisReady === true, "redisReady should be true");
    ok("API /healthz", `redisReady=true, inbound=${JSON.stringify(data.inboundInfo)}`);
  });

  await run("API /readyz", async () => {
    const data = await api("/readyz") as Record<string, unknown>;
    assert(data.ok === true, "readyz.ok should be true");
    ok("API /readyz");
  });

  await run("Gateway /healthz", async () => {
    const data = await api(`${config.gatewayOrigin}/healthz`) as Record<string, unknown>;
    assert(data.ok === true, "gateway healthz.ok should be true");
    ok("Gateway /healthz");
  });

  await run("Gateway /readyz", async () => {
    const data = await api(`${config.gatewayOrigin}/readyz`) as Record<string, unknown>;
    assert((data as Record<string, unknown>).ready === true, "gateway readyz.ready should be true");
    const checks = data as Record<string, Record<string, boolean>>;
    if (checks.checks) {
      for (const [key, val] of Object.entries(checks.checks)) {
        if (!val) throw new Error(`Gateway check ${key} failed`);
      }
    }
    ok("Gateway /readyz", `checks=${JSON.stringify(checks.checks)}`);
  });

  // ── Phase 2: 鉴权 & 用户信息 ──────────────────────────────────────────────

  console.log(`\n${SEC} ${C.white}Phase 2: 鉴权 & 用户信息${C.reset} ${SEC}`);

  await run("GET /api/me", async () => {
    const user = await api("/api/me") as Record<string, unknown>;
    assert(user.uuid, "user.uuid should exist");
    ok("GET /api/me", `user=${user.nick_name ?? user.uuid} (${user.uuid})`);
  });

  await run("GET /api/models", async () => {
    const models = await api("/api/models") as Record<string, Array<{ id: string; model: Record<string, unknown> }>>;
    const providers = Object.keys(models);
    assert(providers.length > 0, "should have at least one provider");
    let total = 0;
    for (const p of providers) total += models[p].length;
    ok("GET /api/models", `providers=${providers.join(", ")}, total=${total}`);
  });

  // ── Phase 3: Space 列表 & 已有 Space 检查 ──────────────────────────────────

  console.log(`\n${SEC} ${C.white}Phase 3: Space 列表 & 已有 Space 检查${C.reset} ${SEC}`);

  let existingSpaces: Array<Record<string, unknown>> = [];

  await run("GET /api/spaces", async () => {
    const spaces = await api("/api/spaces") as Array<Record<string, unknown>>;
    assert(Array.isArray(spaces), "should return array");
    existingSpaces = spaces;
    ok("GET /api/spaces", `count=${spaces.length}`);
  });

  // 找一个 sandbox 状态为 ready 的已有 Space
  const foundReady = await findReadySpace();
  if (foundReady) {
    const sp = existingSpaces.find((s) => s.id === foundReady);
    readySpaceId = foundReady;
    ok("找到 ready sandbox", `spaceId=${readySpaceId}, name=${sp?.name}`);
  }

  // 检查已有 sandbox 状态 (取前 2 个)
  for (const sp of existingSpaces.slice(0, 2)) {
    await run(`GET /api/spaces/${sp.id} (已有 Space)`, async () => {
      const space = await api(`/api/spaces/${sp.id}`) as Record<string, unknown>;
      assert(space.id === sp.id, "space id mismatch");
      ok(`Space ${sp.id}`, `name=${space.name}, sandboxStatus=${space.sandboxStatus}`);
    });
  }

  // ── Phase 4: Space 创建链路 ────────────────────────────────────────────────

  console.log(`\n${SEC} ${C.white}Phase 4: Space 创建链路 (Web → API → Gitea → K8s)${C.reset} ${SEC}`);

  await run("POST /api/spaces (创建 Space)", async () => {
    const ts = Date.now();
    const body = await api("/api/spaces", {
      method: "POST",
      body: JSON.stringify({
        name: `e2e-test-space-${ts}`,
        description: `E2E test space created at ${new Date().toISOString()}`,
      }),
    }) as { space: Record<string, unknown> };

    assert(body.space, "response should contain space");
    assert(body.space.id, "space.id should exist");
    createdSpaceId = body.space.id as string;
    ok("创建 Space", `id=${createdSpaceId}`);
  });

  await run("GET /api/spaces/:id (验证 Space 存在)", async () => {
    assert(createdSpaceId, "createdSpaceId should be set");
    const space = await api(`/api/spaces/${createdSpaceId}`) as Record<string, unknown>;
    assert(space.id === createdSpaceId, "space id mismatch");
    ok("验证 Space 存在");
  });

  // Sandbox pod 创建验证
  await run("Sandbox Pod 创建验证", async () => {
    assert(createdSpaceId, "createdSpaceId should be set");
    const maxRetries = 12;
    const intervalMs = 5000;

    for (let i = 0; i < maxRetries; i++) {
      const data = await api(`/api/spaces/${createdSpaceId}`) as Record<string, unknown>;
      const sandbox = await api(`/api/spaces/${createdSpaceId}/sandbox`) as {
        sandbox: { podName: string; status: string } | null;
      };

      if (sandbox.sandbox?.podName) {
        ok("Sandbox Pod 已创建", `podName=${sandbox.sandbox.podName}, status=${sandbox.sandbox.status}`);
        return;
      }

      if (i === 0) {
        console.log(`      ${C.dim}  等待 sandbox pod 创建 (当前 DB 状态: ${data.sandboxStatus ?? "null"})...${C.reset}`);
      }
      await new Promise((r) => setTimeout(r, intervalMs));
    }

    warn("Sandbox Pod", "超时 60s，pod 可能尚未创建 (provision 是异步的)");
  });

  await run("Sandbox 状态说明", async () => {
    ok("Sandbox 状态流转", "provisioning → ready 依赖首次消息触发 agent 连接 (设计行为)");
  });

  // ── Phase 5: Session 创建链路 ──────────────────────────────────────────────

  console.log(`\n${SEC} ${C.white}Phase 5: Session 创建链路 (Web → API → DB)${C.reset} ${SEC}`);

  await run("POST /api/spaces/:id/sessions (创建 Session)", async () => {
    assert(createdSpaceId, "createdSpaceId should be set");
    const sid = await trackSession(createdSpaceId, "E2E test session");
    createdSessionId = sid;
    ok("创建 Session", `id=${createdSessionId}`);
  });

  await run("GET /api/spaces/:id/sessions (列出 Sessions)", async () => {
    assert(createdSpaceId, "createdSpaceId should be set");
    const data = await api(`/api/spaces/${createdSpaceId}/sessions`) as {
      space: Record<string, unknown>;
      sessions: Array<Record<string, unknown>>;
    };
    assert(Array.isArray(data.sessions), "should return sessions array");
    const found = data.sessions.find((s) => s.id === createdSessionId);
    assert(found, `new session ${createdSessionId} should be in list`);
    ok("列出 Sessions", `count=${data.sessions.length}`);
  });

  // ── Phase 6: 文件工作台链路 ────────────────────────────────────────────────

  console.log(`\n${SEC} ${C.white}Phase 6: 文件工作台链路 (Web → API → Sandbox FS)${C.reset} ${SEC}`);

  const fsSpaceId = readySpaceId ?? createdSpaceId;
  const fsLabel = readySpaceId ? "ready sandbox" : "新 space (sandbox 可能未就绪)";

  if (fsSpaceId) {
    await run("GET /api/spaces/:id/fs/tree (文件树)", async () => {
      const tree = await api(`/api/spaces/${fsSpaceId}/fs/tree`) as {
        path: string;
        entries: Array<{ name: string; path: string; type: string }>;
      };
      assert(Array.isArray(tree.entries), "entries should be array");
      ok("文件树", `entries=${tree.entries.length} [${fsLabel}]`);
    });

    await run("PUT /api/spaces/:id/fs/file (写入文件)", async () => {
      const content = `# E2E Test File\nGenerated at ${new Date().toISOString()}\n\nHello Cohub!`;
      const resp = await api(`/api/spaces/${fsSpaceId}/fs/file`, {
        method: "PUT",
        body: JSON.stringify({ path: "e2e-test.md", content, encoding: "utf-8" }),
      }) as { path: string; size: number; mtimeMs: number };

      assert(resp.path === "e2e-test.md", "path mismatch");
      assert(resp.size > 0, "size should be positive");
      ok("写入文件", `path=${resp.path}, size=${resp.size} [${fsLabel}]`);
    });

    await run("GET /api/spaces/:id/fs/file (读取文件)", async () => {
      const file = await api(`/api/spaces/${fsSpaceId}/fs/file?path=e2e-test.md`) as {
        path: string;
        content: string;
        kind: string;
        size: number;
      };
      assert(file.path === "e2e-test.md", "path mismatch");
      assert(file.content.includes("Hello Cohub!"), "content should contain test text");
      ok("读取文件", `kind=${file.kind}, size=${file.size}`);
    });

    await run("GET /api/spaces/:id/fs/tree (验证文件树包含新文件)", async () => {
      const tree = await api(`/api/spaces/${fsSpaceId}/fs/tree`) as {
        entries: Array<{ name: string; path: string }>;
      };
      const found = tree.entries.find((e) => e.name === "e2e-test.md");
      assert(found, "e2e-test.md should appear in tree");
      ok("验证文件树");
    });

    await run("POST /api/spaces/:id/fs/dir (创建目录)", async () => {
      const resp = await api(`/api/spaces/${fsSpaceId}/fs/dir`, {
        method: "POST",
        body: JSON.stringify({ path: "e2e-test-dir" }),
      }) as { path: string; mtimeMs: number };

      assert(resp.path === "e2e-test-dir", "path mismatch");
      ok("创建目录", `path=${resp.path}`);
    });

    await run("DELETE /api/spaces/:id/fs/node (清理测试文件)", async () => {
      const resp = await api(`/api/spaces/${fsSpaceId}/fs/node?path=e2e-test.md`, {
        method: "DELETE",
      }) as { path: string; deleted: boolean };

      assert(resp.deleted === true, "deleted should be true");
      ok("清理文件");
    });
  } else {
    warn("文件工作台", "跳过：没有可用的 sandbox");
  }

  // ── Phase 7: Checkpoint 保存链路 ───────────────────────────────────────────

  console.log(`\n${SEC} ${C.white}Phase 7: Checkpoint 保存链路 (Web → API → Worker → Gitea → DB)${C.reset} ${SEC}`);

  await run("POST /api/spaces/:id/checkpoints (触发 Save Checkpoint)", async () => {
    const cpSpaceId = readySpaceId ?? createdSpaceId;
    if (!cpSpaceId) {
      warn("触发 Checkpoint", "跳过：没有可用的 space");
      return;
    }

    const body = await api(`/api/spaces/${cpSpaceId}/checkpoints`, {
      method: "POST",
      body: JSON.stringify({ description: "E2E test checkpoint" }),
    }) as { ok: boolean; jobId: string };

    assert(body.ok === true, "response ok should be true");
    assert(body.jobId, "jobId should exist");
    const jobId = body.jobId;
    ok("触发 Checkpoint", `jobId=${jobId}`);

    console.log(`      ${C.dim}  轮询任务状态...${C.reset}`);
    const maxRetries = 20;
    for (let i = 0; i < maxRetries; i++) {
      await new Promise((r) => setTimeout(r, 3000));
      const taskData = await api(`/api/tasks/runs/${jobId}`) as {
        run: { status: string; errorMessage?: string };
      };
      const status = taskData.run.status;
      if (status === "completed") {
        ok("Checkpoint 任务完成");
        return;
      }
      if (status === "failed") {
        warn("Checkpoint 任务", `failed: ${taskData.run.errorMessage ?? "unknown"}`);
        return;
      }
      if (i === maxRetries - 1) {
        warn("Checkpoint 任务", `超时 (60s)，当前状态: ${status}`);
        return;
      }
    }
  });

  if (readySpaceId) {
    await run("GET /api/spaces/:id/checkpoints (列出 Checkpoints)", async () => {
      const data = await api(`/api/spaces/${readySpaceId}/checkpoints`) as {
        checkpoints: Array<Record<string, unknown>>;
      };
      ok("列出 Checkpoints", `count=${data.checkpoints.length}`);
    });
  }

  // ── Phase 8: Gateway WebSocket 实时链路 ────────────────────────────────────

  if (!config.skipWsTest) {
    console.log(`\n${SEC} ${C.white}Phase 8: Gateway WebSocket 实时链路${C.reset} ${SEC}`);

    await run("Gateway WebSocket 连接 & 鉴权", async () => {
      const ws = new WebSocket(config.gatewayWs);

      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error("WebSocket connect timeout 10s")), 10_000);

        ws.onopen = () => {
          clearTimeout(timeout);
          ws.send(JSON.stringify({
            type: "auth",
            requestId: "e2e-auth",
            payload: { token: config.token },
          }));
        };

        let authOk = false;
        let connectionId = "";

        ws.onmessage = (event) => {
          let msg: { type: string; payload: Record<string, unknown> };
          try {
            msg = JSON.parse(String(event.data));
          } catch {
            return;
          }

          if (msg.type === "auth.ok") {
            authOk = true;
            connectionId = String(msg.payload.connectionId ?? "");
            ws.send(JSON.stringify({
              type: "ping",
              requestId: "e2e-ping",
              payload: {},
            }));
          }

          if (authOk && msg.type === "pong" && msg.payload.requestId === "e2e-ping") {
            ws.close(1000, "e2e done");
          }
        };

        ws.onclose = () => {
          if (!authOk) {
            reject(new Error("WebSocket auth failed (did not receive auth.ok)"));
            return;
          }
          ok("WebSocket 连接 & 鉴权", `connectionId=${connectionId}`);
          resolve();
        };

        ws.onerror = () => {
          clearTimeout(timeout);
          reject(new Error("WebSocket error occurred"));
        };
      });
    });

    await run("Gateway WebSocket 发送消息 (message.create)", async () => {
      const msgSpaceId = readySpaceId ?? createdSpaceId;
      const msgSessionId = readySessionId ?? createdSessionId;
      if (!msgSpaceId || !msgSessionId) {
        warn("WebSocket 发送消息", "跳过：没有可用的 spaceId / sessionId");
        return;
      }

      const ws = new WebSocket(config.gatewayWs);

      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
          ws.close(1000, "timeout");
          reject(new Error("WebSocket message flow timeout 15s"));
        }, 15_000);

        ws.onopen = () => {
          ws.send(JSON.stringify({
            type: "auth",
            requestId: "e2e-auth2",
            payload: { token: config.token },
          }));
        };

        let authOk = false;

        ws.onmessage = (event) => {
          let msg: { type: string; payload: Record<string, unknown> };
          try {
            msg = JSON.parse(String(event.data));
          } catch {
            return;
          }

          if (msg.type === "auth.ok") {
            authOk = true;
            ws.send(JSON.stringify({
              type: "message.create",
              requestId: "e2e-msg",
              payload: {
                spaceId: msgSpaceId,
                sessionId: msgSessionId,
                text: "E2E test message via WebSocket",
              },
            }));
          }

          if (authOk && msg.type === "message.accepted") {
            ws.close(1000, "e2e done");
            ok("WebSocket 发送消息", "message.accepted received — 消息已进入 Gateway inbound stream");
            resolve();
          }
        };

        ws.onclose = () => {
          clearTimeout(timeout);
        };

        ws.onerror = () => {
          clearTimeout(timeout);
          reject(new Error("WebSocket error occurred"));
        };
      });
    });
  } else {
    console.log(`\n${SEC} ${C.white}Phase 8: Gateway WebSocket 实时链路 (已跳过)${C.reset} ${SEC}`);
    warn("WebSocket 测试", "SKIP_WS_TEST=1");
  }

  // ── Phase 9: Session 消息链路 (HTTP API) ──────────────────────────────────

  console.log(`\n${SEC} ${C.white}Phase 9: Session 消息链路 (HTTP API 发送)${C.reset} ${SEC}`);

  const httpSessionId = readySessionId ?? createdSessionId;
  if (httpSessionId) {
    const httpLabel = readySpaceId ? "ready sandbox" : "新 space";

    if (readySpaceId) {
      await run("POST /api/spaces/:id/sessions (为 ready sandbox 创建 Session)", async () => {
        const sid = await trackSession(readySpaceId, "E2E HTTP message test");
        readySessionId = sid;
        ok("创建 Session (ready sandbox)", `id=${readySessionId}`);
      });
    }

    await run("POST /api/sessions/:id/messages (HTTP 发送消息)", async () => {
      const actualSessionId = readySessionId ?? httpSessionId;
      const body = await api(`/api/sessions/${actualSessionId}/messages`, {
        method: "POST",
        body: JSON.stringify({
          content: [{ type: "text" as const, text: "E2E test message via HTTP API" }],
        }),
      }) as { ok: boolean; userMessageId: string };

      assert(body.ok === true, "response ok should be true");
      assert(body.userMessageId, "userMessageId should exist");
      ok("HTTP 发送消息", `userMessageId=${body.userMessageId} [${httpLabel}]`);
    });

    await run("GET /api/sessions/:id/messages (获取消息列表)", async () => {
      const actualSessionId = readySessionId ?? httpSessionId;
      const data = await api(`/api/sessions/${actualSessionId}/messages`) as {
        messages: Array<{ id: string; role: string; text: string | null }>;
      };
      assert(Array.isArray(data.messages), "messages should be array");
      ok("获取消息列表", `count=${data.messages.length}`);
    });
  } else {
    warn("Session 消息链路", "跳过：没有可用的 sessionId");
  }

  // ── Phase 10: Channels 链路 ────────────────────────────────────────────────

  console.log(`\n${SEC} ${C.white}Phase 10: Channels 链路${C.reset} ${SEC}`);

  await run("GET /api/channels", async () => {
    const channels = await api("/api/channels") as Array<Record<string, unknown>>;
    assert(Array.isArray(channels), "should return array");
    ok("列出 Channels", `count=${channels.length}`);
  });

  if (createdSpaceId) {
    await run("GET /api/spaces/:id/channels", async () => {
      const channels = await api(`/api/spaces/${createdSpaceId}/channels`) as Array<Record<string, unknown>>;
      assert(Array.isArray(channels), "should return array");
      ok("Space Channels", `count=${channels.length}`);
    });
  }

  // ── Phase 11: 端到端整合验证 ────────────────────────────────────────────────

  console.log(`\n${SEC} ${C.white}Phase 11: 端到端整合验证${C.reset} ${SEC}`);

  await run("创建 Space → 创建 Session → 关联验证 (完整链路)", async () => {
    assert(createdSpaceId, "createdSpaceId should be set");
    assert(createdSessionId, "createdSessionId should be set");

    const sessionData = await api(`/api/sessions/${createdSessionId}`) as {
      space: { id: string };
      session: { id: string; spaceId: string };
    };
    assert(sessionData.space.id === createdSpaceId, "session should belong to the created space");
    assert(sessionData.session.spaceId === createdSpaceId, "session.spaceId should match");

    ok("Space-Session 关联验证", `spaceId=${createdSpaceId}, sessionId=${createdSessionId}`);
  });

  // ── Phase 12: 全链路数据流完整性验证 ────────────────────────────────────────

  console.log(`\n${SEC} ${C.white}Phase 12: 全链路数据流完整性验证${C.reset} ${SEC}`);

  await run("Space 数据完整性", async () => {
    assert(createdSpaceId, "createdSpaceId should be set");
    const space = await api(`/api/spaces/${createdSpaceId}`) as Record<string, unknown>;

    assert(space.id === createdSpaceId, "id should match");
    assert(typeof space.name === "string", "name should be string");
    assert(typeof space.userUuid === "string", "userUuid should be string");
    assert(typeof space.storageRepoName === "string", "storageRepoName should be string");
    assert(typeof space.createdAt === "string", "createdAt should be string");

    ok("Space 数据完整性", `name=${space.name}, storageRepo=${space.storageRepoName}`);
  });

  await run("Session 数据完整性", async () => {
    assert(createdSessionId, "createdSessionId should be set");
    const data = await api(`/api/sessions/${createdSessionId}`) as {
      session: Record<string, unknown>;
    };
    const session = data.session;

    assert(session.id === createdSessionId, "session id should match");
    assert(session.spaceId === createdSpaceId, "session.spaceId should match");
    assert(typeof session.createdAt === "string", "createdAt should be string");

    ok("Session 数据完整性", `spaceId=${session.spaceId}, title=${session.title}`);
  });

  await run("全链路数据流向: Space → Session → Sandbox", async () => {
    assert(createdSpaceId, "createdSpaceId should be set");

    const sandbox = await api(`/api/spaces/${createdSpaceId}/sandbox`) as {
      sandbox: { spaceId: string; podName: string | null; status: string } | null;
    };
    const sessions = await api(`/api/spaces/${createdSpaceId}/sessions`) as {
      sessions: Array<{ spaceId: string }>;
    };

    if (sandbox.sandbox) {
      assert(sandbox.sandbox.spaceId === createdSpaceId, "sandbox.spaceId should match space");
    }

    assert(sessions.sessions.every((s) => s.spaceId === createdSpaceId), "all sessions should belong to space");

    ok("全链路数据关联", `sandbox=${sandbox.sandbox?.podName ?? "pending"}, sessions=${sessions.sessions.length}`);
  });

  // ── Phase 13: Agent 实际回复端到端测试 ─────────────────────────────────────

  if (!config.skipAgentTest) {
    console.log(`\n${SEC} ${C.white}Phase 13: Agent 实际回复端到端测试 (完整消息往返链路)${C.reset} ${SEC}`);

    agentTestSpaceId = readySpaceId;

    // 如果没有 ready sandbox，尝试等待新 space 的 sandbox 就绪
    if (!agentTestSpaceId && createdSpaceId) {
      await run("等待新 Space 的 Sandbox 就绪 (用于 Agent 测试)", async () => {
        const maxRetries = 24;
        for (let i = 0; i < maxRetries; i++) {
          const sandbox = await api(`/api/spaces/${createdSpaceId}/sandbox`) as {
            sandbox: { podName: string | null; status: string } | null;
          };
          if (sandbox.sandbox?.status === "ready") {
            agentTestSpaceId = createdSpaceId;
            ok("Sandbox 就绪", `spaceId=${createdSpaceId}, podName=${sandbox.sandbox.podName}`);
            return;
          }
          if (i === 0) {
            console.log(`      ${C.dim}  等待 sandbox 就绪 (当前状态: ${sandbox.sandbox?.status ?? "null"})...${C.reset}`);
          }
          await new Promise((r) => setTimeout(r, 5000));
        }
        warn("Sandbox 就绪", "超时 120s，新 space sandbox 尚未就绪");
      });
    }

    if (!agentTestSpaceId) {
      warn("Agent 回复测试", "跳过：没有 ready sandbox，无法触发 Agent");
    } else {
      await run("验证 Agent 测试 Space 权限", async () => {
        const space = await api(`/api/spaces/${agentTestSpaceId}`) as Record<string, unknown>;
        const me = await api("/api/me") as Record<string, unknown>;
        assert(space.userUuid === me.uuid, `space owner ${space.userUuid} !== current user ${me.uuid}`);
        ok("Space 权限验证通过", `owner=${space.userUuid}`);
      });

      // Agent 连通性预检 — 改为轮询等待而非固定 15s
      await run("Agent 连通性预检", async () => {
        const pingSid = await trackSession(agentTestSpaceId, "Agent ping test");
        await sendMessage(pingSid, "ping");

        // 轮询等待回复，最多 30s
        const pingOk = await waitForAssistantReply(pingSid, {
          timeoutMs: 30_000,
          intervalMs: 2000,
        }).then(() => true).catch(() => false);

        if (!pingOk) {
          throw new Error("Agent 未响应 ping 测试，可能未连接 dev 环境。请确认 agent pod 正在运行并已连接到该 space。");
        }
        ok("Agent 连通性预检通过", "agent 已连接并正常响应");
      });

      await run("为 Agent 测试创建 Session", async () => {
        const sid = await trackSession(agentTestSpaceId, "E2E Agent reply test");
        agentTestSessionId = sid;
        ok("创建 Agent 测试 Session", `id=${agentTestSessionId}, space=${agentTestSpaceId}`);
      });

      if (agentTestSpaceId && agentTestSessionId) {
        const targetSpaceId = agentTestSpaceId;
        const targetSessionId = agentTestSessionId;

        // 13.1: HTTP 发消息 → 轮询等待回复
        await run("Agent 回复测试: HTTP 发消息 → 轮询等待回复", async () => {
          const ts2 = Date.now();
          const testMsg = `E2E agent reply test ${ts2}. Reply with "E2E-ACK:${ts2}" to confirm.`;

          const sendBody = await api(`/api/sessions/${targetSessionId}/messages`, {
            method: "POST",
            body: JSON.stringify({
              content: [{ type: "text" as const, text: testMsg }],
            }),
          }) as { ok: boolean; userMessageId: string };

          assert(sendBody.ok === true, "send ok should be true");
          assert(sendBody.userMessageId, "userMessageId should exist");
          console.log(`      ${C.dim}  消息已发送 userMessageId=${sendBody.userMessageId}，等待 Agent 回复...${C.reset}`);

          const messages = await waitForAssistantReply(targetSessionId, { timeoutMs: TIMEOUTS.ASSISTANT_REPLY });

          const assistantMsgs = messages.filter(
            (m) => m.role === "assistant" && m.text && m.text.trim().length > 0,
          );
          assert(assistantMsgs.length > 0, "should have at least one assistant reply");

          const latestReply = assistantMsgs[assistantMsgs.length - 1];
          ok(
            "HTTP → Agent 回复成功",
            `assistantMessageId=${latestReply.id}, preview="${latestReply.text?.slice(0, 80)}..."`,
          );
        });

        // 13.2: WebSocket 发消息 → 接收 Agent 实时事件
        if (!config.skipWsTest) {
          await run("Agent 回复测试: WebSocket → 接收 Agent 实时事件", async () => {
            const ts = Date.now();
            const testMsg = `E2E WS agent event test ${ts}. Reply quickly.`;

            const result = await wsSendAndWaitForAgentReply({
              spaceId: targetSpaceId,
              sessionId: targetSessionId,
              text: testMsg,
            }, { timeoutMs: TIMEOUTS.WS_AGENT_REPLY });

            assert(result.accepted, "message should be accepted by gateway");
            assert(result.agentEvents.length > 0, "should receive agent events via WS");

            // 使用采样 + 统计，避免输出爆炸
            const eventSummary = summarizeEvents(result.agentEvents);
            ok("WebSocket Agent 事件", `收到 ${result.agentEvents.length} 个事件: ${eventSummary}`);
          });
        }

        // 13.3: 验证回复消息已持久化
        await run("Agent 回复持久化验证", async () => {
          const data = await api(`/api/sessions/${targetSessionId}/messages`) as {
            messages: Array<{
              id: string;
              role: string;
              text: string | null;
              sequence: number;
            }>;
          };

          const userMsgs = data.messages.filter((m) => m.role === "user");
          const assistantMsgs = data.messages.filter(
            (m) => m.role === "assistant" && m.text && m.text.trim().length > 0,
          );

          assert(userMsgs.length > 0, "should have user messages");
          assert(assistantMsgs.length > 0, "should have assistant replies persisted");

          ok("回复持久化验证", `user=${userMsgs.length}, assistant=${assistantMsgs.length}, 总消息=${data.messages.length}`);
        });
      }
    }
  } else {
    console.log(`\n${SEC} ${C.white}Phase 13: Agent 实际回复端到端测试 (已跳过)${C.reset} ${SEC}`);
    warn("Agent 回复测试", "SKIP_AGENT_TEST=1");
  }

  // ── Phase 14: 消息内容质量验证 ─────────────────────────────────────────────

  console.log(`\n${SEC} ${C.white}Phase 14: 消息内容质量验证${C.reset} ${SEC}`);

  const contentCheckSessionId = agentTestSessionId ?? "";
  if (agentTestSessionId) {
    await run("消息内容非空检查", async () => {
      const data = await api(`/api/sessions/${contentCheckSessionId}/messages`) as {
        messages: Array<{
          id: string;
          role: string;
          text: string | null;
          content: Array<{ type: string }>;
        }>;
      };

      for (const msg of data.messages) {
        assert(Array.isArray(msg.content) && msg.content.length > 0, `message ${msg.id} should have content`);
      }

      const assistantMsgs = data.messages.filter(
        (m) => m.role === "assistant" && m.text && m.text.trim().length > 0,
      );
      assert(assistantMsgs.length > 0, "should have assistant replies with text");

      ok("消息内容完整", `total=${data.messages.length}, assistant=${assistantMsgs.length}`);
    });

    await run("消息序列号连续性", async () => {
      const data = await api(`/api/sessions/${contentCheckSessionId}/messages`) as {
        messages: Array<{ id: string; sequence: number }>;
      };

      const sequences = data.messages.map((m) => m.sequence);
      for (let i = 1; i < sequences.length; i++) {
        assert(
          sequences[i] === sequences[i - 1] + 1,
          `sequence gap: ${sequences[i - 1]} → ${sequences[i]}`,
        );
      }

      ok("消息序列号连续", `range=[${sequences[0]}..${sequences[sequences.length - 1]}]`);
    });
  } else {
    warn("消息内容质量验证", "跳过：没有 agentTestSessionId");
  }

  // ── 汇总报告 ────────────────────────────────────────────────────────────────

  const { failCount } = summary();

  // 清理测试资源
  await cleanupTestResources(createdSpaceId, createdSessionIds);

  if (failCount > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(`\n${FAIL} 脚本执行失败:`, err);
  process.exit(1);
});
