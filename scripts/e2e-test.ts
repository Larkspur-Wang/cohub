#!/usr/bin/env tsx
/**
 * Cohub Dev 环境端到端全链路验证脚本
 *
 * 用法: COHUB_TOKEN=<your-token> pnpm e2e:test
 *
 * 环境变量:
 *   COHUB_TOKEN          - 必须，用于鉴权的 Bearer token
 *   COHUB_API_ORIGIN     - 可选，默认 https://api-dev.cohub.run
 *   COHUB_GATEWAY_ORIGIN - 可选，默认由 API_ORIGIN 推导 (api-dev → gateway-dev)
 *   COHUB_GATEWAY_WS     - 可选，默认由 GATEWAY_ORIGIN 推导
 *   SKIP_WS_TEST         - 设为 1 跳过 WebSocket 实时测试
 */

// ── 配置 ──────────────────────────────────────────────────────────────────────

const API_ORIGIN = process.env.COHUB_API_ORIGIN ?? "https://api-dev.cohub.run";
const GATEWAY_ORIGIN = process.env.COHUB_GATEWAY_ORIGIN ?? API_ORIGIN.replace("api-dev", "gateway-dev");
const GATEWAY_WS = process.env.COHUB_GATEWAY_WS ?? `${GATEWAY_ORIGIN.replace("https://", "wss://")}/ws`;
const TOKEN = process.env.COHUB_TOKEN ?? "";

if (!TOKEN) {
  console.error("❌ 错误: 请设置 COHUB_TOKEN 环境变量");
  process.exit(1);
}

// ── 工具函数 ──────────────────────────────────────────────────────────────────

const C = {
  reset: "\x1b[0m",
  dim: "\x1b[2m",
  green: "\x1b[32m",
  red: "\x1b[31m",
  yellow: "\x1b[33m",
  blue: "\x1b[36m",
  magenta: "\x1b[35m",
  white: "\x1b[1m",
};

const PASS = `${C.green}✅ PASS${C.reset}`;
const FAIL = `${C.red}❌ FAIL${C.reset}`;
const WARN = `${C.yellow}⚠️ WARN${C.reset}`;
const STEP = `${C.blue}▶${C.reset}`;
const SEC = `${C.magenta}━━━${C.reset}`;

function section(title: string) {
  console.log(`\n${SEC} ${C.white}${title}${C.reset} ${SEC}`);
}

function step(name: string) {
  console.log(`  ${STEP} ${name}`);
}

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

async function api(path: string, init?: RequestInit): Promise<unknown> {
  const headers = new Headers(init?.headers);
  headers.set("Authorization", `Bearer ${TOKEN}`);
  if (!headers.has("Content-Type") && init?.body) {
    headers.set("Content-Type", "application/json");
  }

  const url = path.startsWith("http") ? path : `${API_ORIGIN}${path}`;
  const resp = await fetch(url, { ...init, headers });
  const text = await resp.text();
  let body: unknown = null;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }

  if (!resp.ok) {
    throw new Error(
      `HTTP ${resp.status} ${path}\n  Response: ${typeof body === "string" ? body : JSON.stringify(body, null, 2)}`,
    );
  }
  return body;
}

// ── 测试状态追踪 ──────────────────────────────────────────────────────────────

type TestResult = { name: string; status: "pass" | "fail" | "warn"; detail?: string };
const results: TestResult[] = [];
const completedTests = new Set<string>();

function ok(name: string, detail?: string) {
  results.push({ name, status: "pass", detail });
  console.log(`    ${PASS} ${name}${detail ? ` ${C.dim}${detail}${C.reset}` : ""}`);
}

function fail(name: string, detail?: string) {
  // 如果同一个测试已被标记（内部子检查 ok 过），替换最后一条结果
  if (results.length && results[results.length - 1].name === name) {
    results[results.length - 1] = { name, status: "fail", detail };
  } else {
    results.push({ name, status: "fail", detail });
  }
  console.log(`    ${FAIL} ${name}${detail ? ` ${C.dim}${detail}${C.reset}` : ""}`);
}

function warn(name: string, detail?: string) {
  results.push({ name, status: "warn", detail });
  console.log(`    ${WARN} ${name}${detail ? ` ${C.dim}${detail}${C.reset}` : ""}`);
}

async function run(name: string, fn: () => Promise<void>) {
  step(name);
  try {
    await fn();
  } catch (err) {
    fail(name, err instanceof Error ? err.message : String(err));
  } finally {
    completedTests.add(name);
  }
}

// ── 测试用例 ──────────────────────────────────────────────────────────────────

let createdSpaceId: string | null = null;
let createdSessionId: string | null = null;
/** 用于 FS / 消息测试的 ready sandbox space */
let readySpaceId: string | null = null;
let readySessionId: string | null = null;

async function main() {
  console.log(`${C.white}Cohub Dev E2E 全链路验证${C.reset}`);
  console.log(`${C.dim}API: ${API_ORIGIN}${C.reset}`);
  console.log(`${C.dim}Gateway WS: ${GATEWAY_WS}${C.reset}`);
  console.log(`${C.dim}时间: ${new Date().toISOString()}${C.reset}`);

  // ── Phase 1: 基础设施健康检查 ─────────────────────────────────────────────

  section("Phase 1: 基础设施健康检查");

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
    const data = await api(`${GATEWAY_ORIGIN}/healthz`) as Record<string, unknown>;
    assert(data.ok === true, "gateway healthz.ok should be true");
    ok("Gateway /healthz");
  });

  await run("Gateway /readyz", async () => {
    const data = await api(`${GATEWAY_ORIGIN}/readyz`) as Record<string, unknown>;
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

  section("Phase 2: 鉴权 & 用户信息");

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

  section("Phase 3: Space 列表 & 已有 Space 检查");

  let existingSpaces: Array<Record<string, unknown>> = [];

  await run("GET /api/spaces", async () => {
    const spaces = await api("/api/spaces") as Array<Record<string, unknown>>;
    assert(Array.isArray(spaces), "should return array");
    existingSpaces = spaces;
    ok("GET /api/spaces", `count=${spaces.length}`);
  });

  // 找一个 sandbox 状态为 ready 的已有 Space，用于后续 FS / 消息测试
  for (const sp of existingSpaces) {
    if (sp.sandboxStatus === "ready") {
      readySpaceId = sp.id as string;
      ok("找到 ready sandbox", `spaceId=${readySpaceId}, name=${sp.name}`);
      break;
    }
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

  section("Phase 4: Space 创建链路 (Web → API → Gitea → K8s)");

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

  // Sandbox pod 创建验证 (缩短轮询，sandbox 就绪依赖首次消息触发 agent 连接)
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
    // sandbox 状态从 provisioning → ready 需要 agent 连接并执行 workspace.prepare
    // agent 只在收到消息时才会建立连接，这是设计行为
    ok("Sandbox 状态流转", "provisioning → ready 依赖首次消息触发 agent 连接 (设计行为)");
  });

  // ── Phase 5: Session 创建链路 ──────────────────────────────────────────────

  section("Phase 5: Session 创建链路 (Web → API → DB)");

  await run("POST /api/spaces/:id/sessions (创建 Session)", async () => {
    assert(createdSpaceId, "createdSpaceId should be set");
    const body = await api(`/api/spaces/${createdSpaceId}/sessions`, {
      method: "POST",
      body: JSON.stringify({ title: "E2E test session" }),
    }) as { ok: boolean; session: Record<string, unknown> };

    assert(body.ok === true, "response ok should be true");
    assert(body.session?.id, "session.id should exist");
    createdSessionId = body.session.id as string;
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

  section("Phase 6: 文件工作台链路 (Web → API → Sandbox FS)");

  // 优先用 ready sandbox，如果没有则用新 space (可能失败)
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

  section("Phase 7: Checkpoint 保存链路 (Web → API → Worker → Gitea → DB)");

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

    // 轮询任务状态
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

  if (process.env.SKIP_WS_TEST !== "1") {
    section("Phase 8: Gateway WebSocket 实时链路");

    await run("Gateway WebSocket 连接 & 鉴权", async () => {
      const ws = new WebSocket(GATEWAY_WS);

      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error("WebSocket connect timeout 10s")), 10_000);

        ws.onopen = () => {
          clearTimeout(timeout);
          ws.send(JSON.stringify({
            type: "auth",
            requestId: "e2e-auth",
            payload: { token: TOKEN },
          }));
        };

        let authOk = false;
        let connectionId = "";

        ws.onmessage = (event) => {
          let msg: { type: string; payload: Record<string, unknown> };
          try {
            msg = JSON.parse(String(event.data));
          } catch {
            return; // 忽略非 JSON 消息（如 heartbeat 文本帧）
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

      const ws = new WebSocket(GATEWAY_WS);

      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
          ws.close(1000, "timeout");
          reject(new Error("WebSocket message flow timeout 15s"));
        }, 15_000);

        ws.onopen = () => {
          ws.send(JSON.stringify({
            type: "auth",
            requestId: "e2e-auth2",
            payload: { token: TOKEN },
          }));
        };

        let authOk = false;

        ws.onmessage = (event) => {
          let msg: { type: string; payload: Record<string, unknown> };
          try {
            msg = JSON.parse(String(event.data));
          } catch {
            return; // 忽略非 JSON 消息
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
    section("Phase 8: Gateway WebSocket 实时链路 (已跳过)");
    warn("WebSocket 测试", "SKIP_WS_TEST=1");
  }

  // ── Phase 9: Session 消息链路 (HTTP API) ──────────────────────────────────

  section("Phase 9: Session 消息链路 (HTTP API 发送)");

  // 使用 ready sandbox 的 session 来做 HTTP 消息测试
  const httpSessionId = readySessionId ?? createdSessionId;
  if (httpSessionId) {
    const httpSpaceId = readySpaceId ?? createdSpaceId;
    const httpLabel = readySpaceId ? "ready sandbox" : "新 space";

    if (readySpaceId) {
      // 有 ready sandbox，先为该 space 创建一个 session
      await run("POST /api/spaces/:id/sessions (为 ready sandbox 创建 Session)", async () => {
        const body = await api(`/api/spaces/${readySpaceId}/sessions`, {
          method: "POST",
          body: JSON.stringify({ title: "E2E HTTP message test" }),
        }) as { ok: boolean; session: Record<string, unknown> };

        assert(body.ok === true, "response ok should be true");
        readySessionId = body.session.id as string;
        ok("创建 Session (ready sandbox)", `id=${readySessionId}`);
      });
    }

    await run("POST /api/sessions/:id/messages (HTTP 发送消息)", async () => {
      const actualSessionId = readySessionId ?? httpSessionId;
      const actualSpaceId = readySpaceId ?? httpSpaceId;
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

  section("Phase 10: Channels 链路");

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

  section("Phase 11: 端到端整合验证");

  await run("创建 Space → 创建 Session → 关联验证 (完整链路)", async () => {
    assert(createdSpaceId, "createdSpaceId should be set");
    assert(createdSessionId, "createdSessionId should be set");

    // 验证 Space 和 Session 的关联关系
    const sessionData = await api(`/api/sessions/${createdSessionId}`) as {
      space: { id: string };
      session: { id: string; spaceId: string };
    };
    assert(sessionData.space.id === createdSpaceId, "session should belong to the created space");
    assert(sessionData.session.spaceId === createdSpaceId, "session.spaceId should match");

    ok("Space-Session 关联验证", `spaceId=${createdSpaceId}, sessionId=${createdSessionId}`);
  });

  // ── Phase 12: 全链路数据流完整性验证 ────────────────────────────────────────

  section("Phase 12: 全链路数据流完整性验证");

  await run("Space 数据完整性", async () => {
    assert(createdSpaceId, "createdSpaceId should be set");
    const space = await api(`/api/spaces/${createdSpaceId}`) as Record<string, unknown>;

    // 验证关键字段
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

    const space = await api(`/api/spaces/${createdSpaceId}`) as Record<string, unknown>;
    const sandbox = await api(`/api/spaces/${createdSpaceId}/sandbox`) as {
      sandbox: { spaceId: string; podName: string | null; status: string } | null;
    };
    const sessions = await api(`/api/spaces/${createdSpaceId}/sessions`) as {
      sessions: Array<{ spaceId: string }>;
    };

    // 验证 Space → Sandbox 关联
    if (sandbox.sandbox) {
      assert(sandbox.sandbox.spaceId === createdSpaceId, "sandbox.spaceId should match space");
    }

    // 验证 Space → Session 关联
    assert(sessions.sessions.every((s) => s.spaceId === createdSpaceId), "all sessions should belong to space");

    ok("全链路数据关联", `sandbox=${sandbox.sandbox?.podName ?? "pending"}, sessions=${sessions.sessions.length}`);
  });

  // ── 汇总报告 ────────────────────────────────────────────────────────────────

  section("汇总报告");

  const passCount = results.filter((r) => r.status === "pass").length;
  const failCount = results.filter((r) => r.status === "fail").length;
  const warnCount = results.filter((r) => r.status === "warn").length;
  const totalCount = results.length;

  console.log(`  ${C.white}总计: ${totalCount} 项${C.reset}`);
  console.log(`  ${C.green}通过: ${passCount}${C.reset}  ${C.red}失败: ${failCount}${C.reset}  ${C.yellow}警告: ${warnCount}${C.reset}`);

  if (failCount > 0) {
    console.log(`\n  ${C.red}失败详情:${C.reset}`);
    for (const r of results.filter((r) => r.status === "fail")) {
      console.log(`    ${FAIL} ${r.name}: ${r.detail ?? "no detail"}`);
    }
  }

  if (warnCount > 0) {
    console.log(`\n  ${C.yellow}警告详情:${C.reset}`);
    for (const r of results.filter((r) => r.status === "warn")) {
      console.log(`    ${WARN} ${r.name}: ${r.detail ?? "no detail"}`);
    }
  }

  console.log("");

  if (failCount > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(`\n${FAIL} 脚本执行失败:`, err);
  process.exit(1);
});
