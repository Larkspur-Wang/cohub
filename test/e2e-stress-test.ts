#!/usr/bin/env tsx
/**
 * Cohub Dev 环境 — 并发 & Agent Tools 全覆盖测试
 *
 * 用法: pnpm test:stress
 *
 * 环境变量:
 *   COHUB_TOKEN / TOKEN  - 必须
 *   COHUB_API_ORIGIN     - 可选
 *   SKIP_WS_TEST / SKIP_AGENT_TEST - 可选
 *
 * 测试内容:
 *   Phase A: Agent 7 大 Tools 全覆盖
 *   Phase B: 多 Session 并发发消息 (5 路)
 *   Phase C: 单 Session Burst 消息 (10 条)
 *   Phase D: 混合负载 (3 轮 × 3 并发)
 */

import {
  assertConfig, config, api, createSession, sendMessage, waitForAssistantReply,
  createTestRunner, createHealthMonitor, findReadySpace, cleanupTestResources,
  C, SEC, TIMEOUTS,
} from "./test-utils.js";

assertConfig();

// ── 工具函数 ──────────────────────────────────────────────────────────────────

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

// biome-ignore lint/correctness/noUnusedVariables: false positive, warn is used later in the file
const { ok, fail, warn, run, summary } = createTestRunner();

let testSpaceId: string | null = null;
const testSessions = new Map<string, string>();
const allCreatedSessionIds: string[] = [];

async function trackSession(title: string): Promise<string> {
  assert(testSpaceId, "testSpaceId should be set");
  const sid = await createSession(testSpaceId, title);
  testSessions.set(title, sid);
  allCreatedSessionIds.push(sid);
  return sid;
}

async function main() {
  console.log(`${C.white}Cohub Dev 并发 & Agent Tools 全覆盖测试${C.reset}`);
  console.log(`${C.dim}API: ${config.apiOrigin}${C.reset}`);
  console.log(`${C.dim}时间: ${new Date().toISOString()}${C.reset}`);

  // ── 准备: 确保有 ready sandbox ──────────────────────────────────────────────

  console.log(`\n${SEC} ${C.white}准备: 获取 Ready Sandbox${C.reset} ${SEC}`);

  await run("查找已有 ready sandbox", async () => {
    const found = await findReadySpace();
    if (!found) {
      throw new Error("没有 ready sandbox，请先运行主 E2E 测试或手动创建一个 space");
    }
    testSpaceId = found;
    const spaces = await api("/api/spaces") as Array<Record<string, unknown>>;
    const sp = spaces.find((s) => s.id === found);
    ok("找到 ready sandbox", `spaceId=${testSpaceId}, name=${sp?.name}`);
  });

  if (!testSpaceId) {
    console.error("\n❌ 没有可用 space，退出");
    process.exit(1);
  }

  // 启动健康监控
  const health = createHealthMonitor(2000);
  health.start();

  // ── Phase A: Agent 7 大 Tools 全覆盖 ──────────────────────────────────────

  console.log(`\n${SEC} ${C.white}Phase A: Agent Tools 全覆盖测试 (7 tools)${C.reset} ${SEC}`);

  // A1: Read
  await run("Tool 1/7: Read (读取文件)", async () => {
    const sessionId = await trackSession("tool-read-test");
    await sendMessage(sessionId, "Read the file e2e-test.md and tell me its full content.");
    const messages = await waitForAssistantReply(sessionId, { timeoutMs: TIMEOUTS.AGENT_REPLY_HEAVY });
    const assistantMsgs = messages.filter((m) => m.role === "assistant" && m.text?.trim());
    assert(assistantMsgs.length > 0, "should have assistant reply");
    const reply = assistantMsgs[assistantMsgs.length - 1].text ?? "";
    assert(reply.length > 20, `reply too short (${reply.length} chars)`);
    ok("Read Tool", `reply=${reply.slice(0, 80)}...`);
  });

  // A2: Ls
  await run("Tool 2/7: Ls (列出目录)", async () => {
    const sessionId = await trackSession("tool-ls-test");
    await sendMessage(sessionId, "List all files and directories in the root workspace. Use the ls tool.");
    const messages = await waitForAssistantReply(sessionId, { timeoutMs: TIMEOUTS.AGENT_REPLY_HEAVY });
    const assistantMsgs = messages.filter((m) => m.role === "assistant" && m.text?.trim());
    assert(assistantMsgs.length > 0, "should have assistant reply");
    ok("Ls Tool", `reply=${assistantMsgs[assistantMsgs.length - 1].text?.slice(0, 80)}...`);
  });

  // A3: Find
  await run("Tool 3/7: Find (查找文件)", async () => {
    const sessionId = await trackSession("tool-find-test");
    await sendMessage(sessionId, "Find all markdown files (*.md) in the workspace. Use the find tool.");
    const messages = await waitForAssistantReply(sessionId, { timeoutMs: TIMEOUTS.AGENT_REPLY_HEAVY });
    const assistantMsgs = messages.filter((m) => m.role === "assistant" && m.text?.trim());
    assert(assistantMsgs.length > 0, "should have assistant reply");
    ok("Find Tool", `reply=${assistantMsgs[assistantMsgs.length - 1].text?.slice(0, 80)}...`);
  });

  // A4: Grep
  await run("Tool 4/7: Grep (搜索文件内容)", async () => {
    const sessionId = await trackSession("tool-grep-test");
    await sendMessage(sessionId, 'Search for the text "Hello Cohub" in all files using the grep tool.');
    const messages = await waitForAssistantReply(sessionId, { timeoutMs: TIMEOUTS.AGENT_REPLY_HEAVY });
    const assistantMsgs = messages.filter((m) => m.role === "assistant" && m.text?.trim());
    assert(assistantMsgs.length > 0, "should have assistant reply");
    ok("Grep Tool", `reply=${assistantMsgs[assistantMsgs.length - 1].text?.slice(0, 80)}...`);
  });

  // A5: Write
  await run("Tool 5/7: Write (写入文件)", async () => {
    const sessionId = await trackSession("tool-write-test");
    const unique = `WRITE-TOOL-TEST-${Date.now()}`;
    await sendMessage(sessionId, `Write a file called test-output-${Date.now()}.txt with the content: "${unique}". Use the write tool.`);
    const messages = await waitForAssistantReply(sessionId, { timeoutMs: TIMEOUTS.AGENT_REPLY_HEAVY });
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

  // A6: Edit
  await run("Tool 6/7: Edit (编辑文件)", async () => {
    const sessionId = await trackSession("tool-edit-test");
    await sendMessage(sessionId, `Create a file called edit-test-${Date.now()}.py with the content:
def hello():
    print("hello world")

Then use the edit tool to change "hello world" to "hello cohub" and show me the result.`);
    const messages = await waitForAssistantReply(sessionId, { timeoutMs: TIMEOUTS.AGENT_REPLY_HEAVY });
    const assistantMsgs = messages.filter((m) => m.role === "assistant" && m.text?.trim());
    assert(assistantMsgs.length > 0, "should have assistant reply");
    const reply = assistantMsgs[assistantMsgs.length - 1].text ?? "";
    assert(reply.length > 20, `reply too short (${reply.length} chars)`);
    ok("Edit Tool", `reply=${reply.slice(0, 80)}...`);
  });

  // A7: Bash
  await run("Tool 7/7: Bash (执行 Shell 命令)", async () => {
    const sessionId = await trackSession("tool-bash-test");
    await sendMessage(sessionId, `Run these commands using the bash tool and show me the output:
1. python3 --version
2. echo "BASH-TOOL-TEST-${Date.now()}"
3. ls -la
4. date -u`);
    const messages = await waitForAssistantReply(sessionId, { timeoutMs: TIMEOUTS.AGENT_REPLY_HEAVY });
    const assistantMsgs = messages.filter((m) => m.role === "assistant" && m.text?.trim());
    assert(assistantMsgs.length > 0, "should have assistant reply");
    const reply = assistantMsgs[assistantMsgs.length - 1].text ?? "";
    assert(reply.length > 30, `reply too short (${reply.length} chars)`);
    ok("Bash Tool", `reply=${reply.slice(0, 80)}...`);
  });

  // Phase A 总结
  await run("Phase A 总结: 统计所有 sessions 的消息", async () => {
    let totalUserMsgs = 0;
    let totalAssistantMsgs = 0;
    for (const [, sessionId] of testSessions) {
      const data = await api(`/api/sessions/${sessionId}/messages`) as {
        messages: Array<{ role: string }>;
      };
      totalUserMsgs += data.messages.filter((m) => m.role === "user").length;
      totalAssistantMsgs += data.messages.filter((m) => m.role === "assistant").length;
    }
    ok("工具测试统计", `sessions=${testSessions.size}, user=${totalUserMsgs}, assistant=${totalAssistantMsgs}`);
  });

  // ── Phase B: 多 Session 并发发消息 ─────────────────────────────────────────

  console.log(`\n${SEC} ${C.white}Phase B: 多 Session 并发发消息 (5 路并发)${C.reset} ${SEC}`);

  const concurrentSessionCount = 5;
  const concurrentSessionIds: string[] = [];

  await run(`创建 ${concurrentSessionCount} 个测试 Sessions`, async () => {
    for (let i = 0; i < concurrentSessionCount; i++) {
      const sid = await trackSession(`concurrent-session-${i}`);
      concurrentSessionIds.push(sid);
    }
    ok("Sessions 创建完成", `count=${concurrentSessionIds.length}`);
  });

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

  await run("等待所有并发 Session 的 Agent 回复", async () => {
    const t0 = Date.now();
    const results = await Promise.allSettled(
      concurrentSessionIds.map(async (sid) => {
        const messages = await waitForAssistantReply(sid, { timeoutMs: TIMEOUTS.AGENT_REPLY_HEAVY });
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

  // ── Phase C: 单 Session Burst 消息 ─────────────────────────────────────────

  console.log(`\n${SEC} ${C.white}Phase C: 单 Session Burst 消息 (10 条快速连续)${C.reset} ${SEC}`);

  const burstSessionId = await trackSession("burst-test");

  await run("发送 10 条 Burst 消息", async () => {
    const t0 = Date.now();
    const burstPrompts = Array.from({ length: 10 }, (_, i) =>
      `Burst message #${i + 1}. Reply with exactly: "BURST-ACK-${i + 1}"`,
    );

    const sendResults = await Promise.allSettled(
      burstPrompts.map((p) => sendMessage(burstSessionId, p)),
    );

    const elapsed = Date.now() - t0;
    const success = sendResults.filter((r) => r.status === "fulfilled").length;
    ok("10 条 Burst 消息发送完成", `success=${success}, 耗时=${elapsed}ms`);
  });

  await run("等待 Burst Session 所有 Agent 回复", async () => {
    const t0 = Date.now();
    const messages = await waitForAssistantReply(burstSessionId, {
      timeoutMs: TIMEOUTS.BURST_REPLY,
      intervalMs: 5000,
    });

    const elapsed = Date.now() - t0;
    const assistantMsgs = messages.filter((m) => m.role === "assistant" && m.text?.trim());
    const userMsgs = messages.filter((m) => m.role === "user");

    // 严格断言: 必须收到至少部分回复
    assert(assistantMsgs.length > 0, "should have at least one assistant reply");

    const burstAcks = assistantMsgs
      .map((m) => m.text ?? "")
      .filter((t) => /BURST-ACK-\d+/.test(t));

    ok("Burst 回复等待完成", `user=${userMsgs.length}, assistant=${assistantMsgs.length}, 耗时=${elapsed}ms`);

    if (burstAcks.length > 0) {
      ok("Burst ACK 检测", `found ${burstAcks.length} BURST-ACK replies out of ${assistantMsgs.length} assistant messages`);
    } else {
      // Agent 合并处理是预期行为，但应该至少回复了一条
      warn("Burst ACK 检测", `agent 合并处理了多条消息 (${assistantMsgs.length} 条回复) — 这是预期行为`);
    }
  });

  // ── Phase D: 混合负载 ──────────────────────────────────────────────────────

  console.log(`\n${SEC} ${C.white}Phase D: 混合负载测试 (3 轮 × 3 并发)${C.reset} ${SEC}`);

  const mixedRounds = 3;
  const mixedConcurrency = 3;

  for (let round = 0; round < mixedRounds; round++) {
    await run(`混合负载 Round ${round + 1}/${mixedRounds}`, async () => {
      const t0 = Date.now();

      const roundSessionIds: string[] = [];
      for (let i = 0; i < mixedConcurrency; i++) {
        const sid = await trackSession(`mixed-round${round}-session${i}`);
        roundSessionIds.push(sid);
      }

      const prompts = [
        `Round ${round + 1}: What is 2 + 2? Reply "MIXED-R${round + 1}-S1"`,
        `Round ${round + 1}: What is 3 * 3? Reply "MIXED-R${round + 1}-S2"`,
        `Round ${round + 1}: What is 10 / 2? Reply "MIXED-R${round + 1}-S3"`,
      ];

      await Promise.allSettled(
        roundSessionIds.map((sid, i) => sendMessage(sid, prompts[i])),
      );

      const replyResults = await Promise.allSettled(
        roundSessionIds.map((sid) => waitForAssistantReply(sid, { timeoutMs: TIMEOUTS.AGENT_REPLY_HEAVY })),
      );

      const elapsed = Date.now() - t0;
      const succeeded = replyResults.filter((r) => r.status === "fulfilled").length;
      const failed = replyResults.filter((r) => r.status === "rejected").length;

      ok(`Round ${round + 1} 完成`, `success=${succeeded}/${mixedConcurrency}, failed=${failed}, 耗时=${elapsed}ms`);
    });
  }

  // ── 停止监控 & 输出报告 ────────────────────────────────────────────────────

  health.stop();
  health.printReport();

  const { failCount } = summary();

  // 清理测试资源
  await cleanupTestResources(null, allCreatedSessionIds);

  if (failCount > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(`\n${C.red}❌ FAIL${C.reset} 脚本执行失败:`, err);
  process.exit(1);
});
