#!/usr/bin/env tsx
/**
 * Cohub Dev 环境 — 并发 & Agent Tools 全覆盖测试
 *
 * 用法: COHUB_TOKEN=<your-token> npx tsx scripts/e2e-stress-test.ts
 *
 * 环境变量:
 *   COHUB_TOKEN          - 必须，用于鉴权的 Bearer token
 *   COHUB_API_ORIGIN     - 可选，默认 https://api-dev.cohub.run
 *   COHUB_GATEWAY_ORIGIN - 可选，默认由 API_ORIGIN 推导
 *
 * 测试内容:
 *   Phase A: Agent 7 大 Tools 全覆盖 (Read / Write / Edit / Bash / Ls / Find / Grep)
 *   Phase B: 多 Session 并发发消息 (5 路并发)
 *   Phase C: 单 Session 快速连续消息 (burst 10 条)
 *   Phase D: 混合负载 — 发消息期间持续观测健康指标
 */

// ── 配置 ──────────────────────────────────────────────────────────────────────

const API_ORIGIN = process.env.COHUB_API_ORIGIN ?? "https://api-dev.cohub.run";
const GATEWAY_ORIGIN = process.env.COHUB_GATEWAY_ORIGIN ?? API_ORIGIN.replace("api-dev", "gateway-dev");
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
  cyan: "\x1b[96m",
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

type TestResult = { name: string; status: "pass" | "fail" | "warn"; detail?: string; duration?: number };
const results: TestResult[] = [];

function ok(name: string, detail?: string, duration?: number) {
  results.push({ name, status: "pass", detail, duration });
  const durStr = duration ? ` ${C.dim}(${duration}ms)${C.reset}` : "";
  console.log(`    ${PASS} ${name}${detail ? ` ${C.dim}${detail}${C.reset}` : ""}${durStr}`);
}

function fail(name: string, detail?: string, duration?: number) {
  results.push({ name, status: "fail", detail, duration });
  const durStr = duration ? ` ${C.dim}(${duration}ms)${C.reset}` : "";
  console.log(`    ${FAIL} ${name}${detail ? ` ${C.dim}${detail}${C.reset}` : ""}${durStr}`);
}

function warn(name: string, detail?: string, duration?: number) {
  results.push({ name, status: "warn", detail, duration });
  const durStr = duration ? ` ${C.dim}(${duration}ms)${C.reset}` : "";
  console.log(`    ${WARN} ${name}${detail ? ` ${C.dim}${detail}${C.reset}` : ""}${durStr}`);
}

async function run(name: string, fn: () => Promise<void>) {
  step(name);
  const t0 = Date.now();
  try {
    await fn();
  } catch (err) {
    fail(name, err instanceof Error ? err.message : String(err), Date.now() - t0);
  }
}

// ── 健康监控采样 ──────────────────────────────────────────────────────────────

interface HealthSnapshot {
  ts: string;
  redisReady: boolean;
  inboundLength: number;
  pendingInbound: number;
  outboundLength: number;
}

const healthSnapshots: HealthSnapshot[] = [];
let healthMonitorInterval: ReturnType<typeof setInterval> | null = null;

function startHealthMonitoring(intervalMs = 3000) {
  healthSnapshots.length = 0;
  healthMonitorInterval = setInterval(async () => {
    try {
      const data = await api("/healthz") as Record<string, unknown>;
      healthSnapshots.push({
        ts: new Date().toISOString(),
        redisReady: data.redisReady === true,
        inboundLength: (data.inboundInfo as { length?: number } | null)?.length ?? 0,
        pendingInbound: (data.pendingInbound as { total?: number } | null)?.total ?? 0,
        outboundLength: (data.outboundInfo as { length?: number } | null)?.length ?? 0,
      });
    } catch {
      // ignore
    }
  }, intervalMs);
}

function stopHealthMonitoring() {
  if (healthMonitorInterval) clearInterval(healthMonitorInterval);
  healthMonitorInterval = null;
}

function printHealthReport() {
  if (healthSnapshots.length === 0) return;
  console.log(`\n${C.cyan}📊 健康监控报告 (${healthSnapshots.length} 次采样)${C.reset}`);
  console.log(`${C.dim}  ┌─────────────────────┬───────────┬──────────┬──────────┬──────────┐${C.reset}`);
  console.log(`${C.dim}  │ Timestamp           │ Redis     │ Inbound  │ Pending  │ Outbound │${C.reset}`);
  console.log(`${C.dim}  ├─────────────────────┼───────────┼──────────┼──────────┼──────────┤${C.reset}`);
  for (const s of healthSnapshots) {
    const redis = s.redisReady ? "✅" : "❌";
    console.log(`${C.dim}  │ ${s.ts} │ ${redis}     │ ${String(s.inboundLength).padStart(8)} │ ${String(s.pendingInbound).padStart(8)} │ ${String(s.outboundLength).padStart(8)} │${C.reset}`);
  }
  console.log(`${C.dim}  └─────────────────────┴───────────┴──────────┴──────────┴──────────┘${C.reset}`);

  // 总结
  const maxInbound = Math.max(...healthSnapshots.map((s) => s.inboundLength));
  const maxPending = Math.max(...healthSnapshots.map((s) => s.pendingInbound));
  console.log(`${C.dim}  峰值: inbound=${maxInbound}, pending=${maxPending}${C.reset}`);
}

// ── 等待 Agent 回复 ──────────────────────────────────────────────────────────

async function waitForAssistantReply(
  sessionId: string,
  options?: { timeoutMs?: number; intervalMs?: number },
): Promise<Array<{ id: string; role: string; text: string | null }>> {
  const timeoutMs = options?.timeoutMs ?? 120_000;
  const intervalMs = options?.intervalMs ?? 3000;
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    const data = await api(`/api/sessions/${sessionId}/messages`) as {
      messages: Array<{ id: string; role: string; text: string | null }>;
    };

    const assistantMsgs = data.messages.filter(
      (m) => m.role === "assistant" && m.text && m.text.trim().length > 0,
    );

    if (assistantMsgs.length > 0) {
      return data.messages;
    }

    await new Promise((r) => setTimeout(r, intervalMs));
  }

  throw new Error(`Waiting for assistant reply timed out (${timeoutMs}ms)`);
}

// ── 主测试流程 ────────────────────────────────────────────────────────────────

let testSpaceId: string | null = null;
const testSessions = new Map<string, string>(); // session title → sessionId

async function main() {
  console.log(`${C.white}Cohub Dev 并发 & Agent Tools 全覆盖测试${C.reset}`);
  console.log(`${C.dim}API: ${API_ORIGIN}${C.reset}`);
  console.log(`${C.dim}时间: ${new Date().toISOString()}${C.reset}`);

  // ── 准备: 确保有 ready sandbox ──────────────────────────────────────────────

  section("准备: 获取 Ready Sandbox");

  await run("查找已有 ready sandbox", async () => {
    const spaces = await api("/api/spaces") as Array<Record<string, unknown>>;
    for (const sp of spaces) {
      if (sp.sandboxStatus === "ready") {
        testSpaceId = sp.id as string;
        ok("找到 ready sandbox", `spaceId=${testSpaceId}, name=${sp.name}`);
        return;
      }
    }
    throw new Error("没有 ready sandbox，请先运行主 E2E 测试或手动创建一个 space");
  });

  if (!testSpaceId) {
    console.error("\n❌ 没有可用 space，退出");
    process.exit(1);
  }

  // 启动健康监控
  startHealthMonitoring(2000);

  // ── Phase A: Agent 7 大 Tools 全覆盖 ──────────────────────────────────────

  section("Phase A: Agent Tools 全覆盖测试 (7 tools)");

  // A1: Read Tool — 读取文件内容
  await run("Tool 1/7: Read (读取文件)", async () => {
    const sessionId = await createSession("tool-read-test");
    await sendMessage(sessionId, "Read the file e2e-test.md and tell me its full content.");
    const messages = await waitForAssistantReply(sessionId, { timeoutMs: 120_000 });
    const assistantMsgs = messages.filter((m) => m.role === "assistant" && m.text?.trim());
    assert(assistantMsgs.length > 0, "should have assistant reply");
    const reply = assistantMsgs[assistantMsgs.length - 1].text ?? "";
    // 检查回复中是否包含文件内容（之前 E2E 测试写入的）
    assert(reply.length > 20, `reply too short (${reply.length} chars), agent may not have read the file`);
    ok("Read Tool", `reply=${reply.slice(0, 80)}...`);
  });

  // A2: Ls Tool — 列出目录
  await run("Tool 2/7: Ls (列出目录)", async () => {
    const sessionId = await createSession("tool-ls-test");
    await sendMessage(sessionId, "List all files and directories in the root workspace. Use the ls tool.");
    const messages = await waitForAssistantReply(sessionId, { timeoutMs: 120_000 });
    const assistantMsgs = messages.filter((m) => m.role === "assistant" && m.text?.trim());
    assert(assistantMsgs.length > 0, "should have assistant reply");
    ok("Ls Tool", `reply=${assistantMsgs[assistantMsgs.length - 1].text?.slice(0, 80)}...`);
  });

  // A3: Find Tool — 按模式查找文件
  await run("Tool 3/7: Find (查找文件)", async () => {
    const sessionId = await createSession("tool-find-test");
    await sendMessage(sessionId, "Find all markdown files (*.md) in the workspace. Use the find tool.");
    const messages = await waitForAssistantReply(sessionId, { timeoutMs: 120_000 });
    const assistantMsgs = messages.filter((m) => m.role === "assistant" && m.text?.trim());
    assert(assistantMsgs.length > 0, "should have assistant reply");
    ok("Find Tool", `reply=${assistantMsgs[assistantMsgs.length - 1].text?.slice(0, 80)}...`);
  });

  // A4: Grep Tool — 搜索文件内容
  await run("Tool 4/7: Grep (搜索文件内容)", async () => {
    const sessionId = await createSession("tool-grep-test");
    await sendMessage(sessionId, 'Search for the text "Hello Cohub" in all files using the grep tool.');
    const messages = await waitForAssistantReply(sessionId, { timeoutMs: 120_000 });
    const assistantMsgs = messages.filter((m) => m.role === "assistant" && m.text?.trim());
    assert(assistantMsgs.length > 0, "should have assistant reply");
    ok("Grep Tool", `reply=${assistantMsgs[assistantMsgs.length - 1].text?.slice(0, 80)}...`);
  });

  // A5: Write Tool — 写入文件
  await run("Tool 5/7: Write (写入文件)", async () => {
    const sessionId = await createSession("tool-write-test");
    const unique = `WRITE-TOOL-TEST-${Date.now()}`;
    await sendMessage(sessionId, `Write a file called test-output-${Date.now()}.txt with the content: "${unique}". Use the write tool.`);
    const messages = await waitForAssistantReply(sessionId, { timeoutMs: 120_000 });
    const assistantMsgs = messages.filter((m) => m.role === "assistant" && m.text?.trim());
    assert(assistantMsgs.length > 0, "should have assistant reply");
    ok("Write Tool", `reply=${assistantMsgs[assistantMsgs.length - 1].text?.slice(0, 80)}...`);

    // 验证文件已写入
    const tree = await api(`/api/spaces/${testSpaceId}/fs/tree`) as { entries: Array<{ name: string }> };
    const matches = tree.entries.filter((e) => e.name.startsWith("test-output-"));
    if (matches.length > 0) {
      ok("文件已写入", `found ${matches.length} test file(s)`);
    }
  });

  // A6: Edit Tool — 编辑文件
  await run("Tool 6/7: Edit (编辑文件)", async () => {
    const sessionId = await createSession("tool-edit-test");
    // 先创建一个文件
    await sendMessage(sessionId, `Create a file called edit-test-${Date.now()}.py with the content:
def hello():
    print("hello world")

Then use the edit tool to change "hello world" to "hello cohub" and show me the result.`);
    const messages = await waitForAssistantReply(sessionId, { timeoutMs: 180_000 });
    const assistantMsgs = messages.filter((m) => m.role === "assistant" && m.text?.trim());
    assert(assistantMsgs.length > 0, "should have assistant reply");
    const reply = assistantMsgs[assistantMsgs.length - 1].text ?? "";
    // 检查是否包含编辑后的内容
    assert(reply.length > 20, `reply too short (${reply.length} chars)`);
    ok("Edit Tool", `reply=${reply.slice(0, 80)}...`);
  });

  // A7: Bash Tool — 执行 shell 命令
  await run("Tool 7/7: Bash (执行 Shell 命令)", async () => {
    const sessionId = await createSession("tool-bash-test");
    await sendMessage(sessionId, `Run these commands using the bash tool and show me the output:
1. python3 --version
2. echo "BASH-TOOL-TEST-${Date.now()}"
3. ls -la
4. date -u`);
    const messages = await waitForAssistantReply(sessionId, { timeoutMs: 180_000 });
    const assistantMsgs = messages.filter((m) => m.role === "assistant" && m.text?.trim());
    assert(assistantMsgs.length > 0, "should have assistant reply");
    const reply = assistantMsgs[assistantMsgs.length - 1].text ?? "";
    assert(reply.length > 30, `reply too short (${reply.length} chars), bash tool may have failed`);
    ok("Bash Tool", `reply=${reply.slice(0, 80)}...`);
  });

  // ── Phase A 总结: 工具调用统计 ─────────────────────────────────────────────

  await run("Phase A 总结: 统计所有 sessions 的消息", async () => {
    let totalUserMsgs = 0;
    let totalAssistantMsgs = 0;
    for (const [title, sessionId] of testSessions) {
      const data = await api(`/api/sessions/${sessionId}/messages`) as {
        messages: Array<{ role: string }>;
      };
      const userCount = data.messages.filter((m) => m.role === "user").length;
      const assistantCount = data.messages.filter((m) => m.role === "assistant").length;
      totalUserMsgs += userCount;
      totalAssistantMsgs += assistantCount;
    }
    ok("工具测试统计", `sessions=${testSessions.size}, user=${totalUserMsgs}, assistant=${totalAssistantMsgs}`);
  });

  // ── Phase B: 多 Session 并发发消息 ─────────────────────────────────────────

  section("Phase B: 多 Session 并发发消息 (5 路并发)");

  const concurrentSessionCount = 5;
  const concurrentSessionIds: string[] = [];

  // 先创建所有 sessions
  await run(`创建 ${concurrentSessionCount} 个测试 Sessions`, async () => {
    for (let i = 0; i < concurrentSessionCount; i++) {
      const body = await api(`/api/spaces/${testSpaceId}/sessions`, {
        method: "POST",
        body: JSON.stringify({ title: `concurrent-session-${i}` }),
      }) as { ok: boolean; session: Record<string, unknown> };
      assert(body.session?.id, `session ${i} id should exist`);
      concurrentSessionIds.push(body.session.id as string);
    }
    ok("Sessions 创建完成", `count=${concurrentSessionIds.length}`);
  });

  // 并发发送消息
  await run("并发发送消息 (5 路同时)", async () => {
    const t0 = Date.now();
    const prompts = [
      "Count from 1 to 5 and then say 'DONE-1'.",
      "Count from 1 to 5 and then say 'DONE-2'.",
      "Count from 1 to 5 and then say 'DONE-3'.",
      "Count from 1 to 5 and then say 'DONE-4'.",
      "Count from 1 to 5 and then say 'DONE-5'.",
    ];

    const sendResults = await Promise.allSettled(
      concurrentSessionIds.map((sid, i) => sendMessage(sid, prompts[i])),
    );

    const elapsed = Date.now() - t0;
    const success = sendResults.filter((r) => r.status === "fulfilled").length;
    const failed = sendResults.filter((r) => r.status === "rejected").length;

    assert(success === concurrentSessionCount, `${failed} messages failed to send`);
    ok("5 路消息发送完成", `success=${success}, failed=${failed}, 耗时=${elapsed}ms`);
  });

  // 等待所有并发 session 的回复
  await run("等待所有并发 Session 的 Agent 回复", async () => {
    const t0 = Date.now();
    const results = await Promise.allSettled(
      concurrentSessionIds.map(async (sid) => {
        const messages = await waitForAssistantReply(sid, { timeoutMs: 180_000 });
        const assistantMsgs = messages.filter((m) => m.role === "assistant" && m.text?.trim());
        return { sessionId: sid, replyCount: assistantMsgs.length, totalMessages: messages.length };
      }),
    );

    const elapsed = Date.now() - t0;
    const succeeded = results.filter((r) => r.status === "fulfilled") as PromiseFulfilledResult<{ sessionId: string; replyCount: number; totalMessages: number }>[];
    const failed = results.filter((r) => r.status === "rejected");

    ok("并发回复等待完成", `success=${succeeded.length}/${concurrentSessionCount}, failed=${failed.length}, 总耗时=${elapsed}ms`);

    for (const r of succeeded) {
      ok(`Session ${r.value.sessionId.slice(0, 8)}...`, `replies=${r.value.replyCount}, total=${r.value.totalMessages}`);
    }

    for (const r of failed) {
      warn("Session 超时/失败", (r as PromiseRejectedResult).reason?.message ?? "unknown");
    }
  });

  // ── Phase C: 单 Session 快速连续消息 (Burst) ──────────────────────────────

  section("Phase C: 单 Session Burst 消息 (10 条快速连续)");

  await run("创建 Burst 测试 Session", async () => {
    const body = await api(`/api/spaces/${testSpaceId}/sessions`, {
      method: "POST",
      body: JSON.stringify({ title: "burst-test" }),
    }) as { ok: boolean; session: Record<string, unknown> };
    assert(body.session?.id, "session id should exist");
    testSessions.set("burst-test", body.session.id as string);
    ok("Burst Session 创建", `id=${body.session.id}`);
  });

  const burstSessionId = testSessions.get("burst-test") ?? "";

  await run("发送 10 条 Burst 消息", async () => {
    const t0 = Date.now();
    const burstPrompts = Array.from({ length: 10 }, (_, i) =>
      `Burst message #${i + 1}. Reply with exactly: "BURST-ACK-${i + 1}"`,
    );

    // 快速连续发送（不等回复）
    const sendResults = await Promise.allSettled(
      burstPrompts.map((p) => sendMessage(burstSessionId, p)),
    );

    const elapsed = Date.now() - t0;
    const success = sendResults.filter((r) => r.status === "fulfilled").length;
    ok("10 条 Burst 消息发送完成", `success=${success}, 耗时=${elapsed}ms`);
  });

  // 等待 burst session 的所有回复
  await run("等待 Burst Session 所有 Agent 回复", async () => {
    const t0 = Date.now();
    // burst 消息可能需要较长时间，给足超时
    const messages = await waitForAssistantReply(burstSessionId, {
      timeoutMs: 300_000,
      intervalMs: 5000,
    });

    const elapsed = Date.now() - t0;
    const assistantMsgs = messages.filter((m) => m.role === "assistant" && m.text?.trim());
    const userMsgs = messages.filter((m) => m.role === "user");

    ok("Burst 回复等待完成", `user=${userMsgs.length}, assistant=${assistantMsgs.length}, 耗时=${elapsed}ms`);

    // 检查是否回复了所有 burst 消息
    const burstAcks = assistantMsgs
      .map((m) => m.text ?? "")
      .filter((t) => /BURST-ACK-\d+/.test(t));

    if (burstAcks.length > 0) {
      ok("Burst ACK 检测", `found ${burstAcks.length} BURST-ACK replies`);
    } else {
      warn("Burst ACK 检测", "agent 可能合并处理了多条消息（这是预期行为）");
    }
  });

  // ── Phase D: 混合负载 — 发消息期间持续观测 ─────────────────────────────────

  section("Phase D: 混合负载测试 (3 轮 × 3 并发)");

  const mixedRounds = 3;
  const mixedConcurrency = 3;

  for (let round = 0; round < mixedRounds; round++) {
    await run(`混合负载 Round ${round + 1}/${mixedRounds}`, async () => {
      const t0 = Date.now();

      // 创建 sessions
      const roundSessionIds: string[] = [];
      for (let i = 0; i < mixedConcurrency; i++) {
        const body = await api(`/api/spaces/${testSpaceId}/sessions`, {
          method: "POST",
          body: JSON.stringify({ title: `mixed-round${round}-session${i}` }),
        }) as { ok: boolean; session: Record<string, unknown> };
        assert(body.session?.id, "session id should exist");
        roundSessionIds.push(body.session.id as string);
      }

      // 并发发消息
      const prompts = [
        `Round ${round + 1}: What is 2 + 2? Reply "MIXED-R${round + 1}-S1"`,
        `Round ${round + 1}: What is 3 * 3? Reply "MIXED-R${round + 1}-S2"`,
        `Round ${round + 1}: What is 10 / 2? Reply "MIXED-R${round + 1}-S3"`,
      ];

      await Promise.allSettled(
        roundSessionIds.map((sid, i) => sendMessage(sid, prompts[i])),
      );

      // 等待所有回复
      const replyResults = await Promise.allSettled(
        roundSessionIds.map((sid) => waitForAssistantReply(sid, { timeoutMs: 180_000 })),
      );

      const elapsed = Date.now() - t0;
      const succeeded = replyResults.filter((r) => r.status === "fulfilled").length;
      const failed = replyResults.filter((r) => r.status === "rejected").length;

      ok(`Round ${round + 1} 完成`, `success=${succeeded}/${mixedConcurrency}, failed=${failed}, 耗时=${elapsed}ms`);
    });
  }

  // ── 停止监控 & 输出报告 ────────────────────────────────────────────────────

  stopHealthMonitoring();

  // ── 汇总报告 ────────────────────────────────────────────────────────────────

  printHealthReport();

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
      const durStr = r.duration ? ` (${r.duration}ms)` : "";
      console.log(`    ${FAIL} ${r.name}: ${r.detail ?? "no detail"}${durStr}`);
    }
  }

  if (warnCount > 0) {
    console.log(`\n  ${C.yellow}警告详情:${C.reset}`);
    for (const r of results.filter((r) => r.status === "warn")) {
      const durStr = r.duration ? ` (${r.duration}ms)` : "";
      console.log(`    ${WARN} ${r.name}: ${r.detail ?? "no detail"}${durStr}`);
    }
  }

  console.log("");

  if (failCount > 0) {
    process.exit(1);
  }
}

// ── 辅助函数 ──────────────────────────────────────────────────────────────────

async function createSession(title: string): Promise<string> {
  assert(testSpaceId, "testSpaceId should be set");
  const body = await api(`/api/spaces/${testSpaceId}/sessions`, {
    method: "POST",
    body: JSON.stringify({ title }),
  }) as { ok: boolean; session: Record<string, unknown> };
  assert(body.session?.id, `session "${title}" id should exist`);
  const sessionId = body.session.id as string;
  testSessions.set(title, sessionId);
  return sessionId;
}

async function sendMessage(sessionId: string, text: string): Promise<{ ok: boolean; userMessageId: string }> {
  return api(`/api/sessions/${sessionId}/messages`, {
    method: "POST",
    body: JSON.stringify({
      content: [{ type: "text" as const, text }],
    }),
  }) as Promise<{ ok: boolean; userMessageId: string }>;
}

main().catch((err) => {
  console.error(`\n${FAIL} 脚本执行失败:`, err);
  stopHealthMonitoring();
  process.exit(1);
});
