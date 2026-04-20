#!/usr/bin/env tsx
/**
 * Cohub Dev — 真实并发验证 & K8s 资源实时监控
 *
 * 用法: pnpm test:concurrency
 *
 * 环境变量:
 *   COHUB_TOKEN / TOKEN  - 必须
 *   TEST_SPACE_ID        - 必须，ready sandbox 的 space id
 *   COHUB_API_ORIGIN     - 可选
 */

import {
  assertConfig, config, api, createSession, sendMessage, waitForAssistantReply,
  createK8sMonitor, findReadySpace, cleanupTestResources,
  C, SEC, TIMEOUTS,
} from "./test-utils.js";

assertConfig();

if (!config.testSpaceId) {
  console.error("❌ 请设置 TEST_SPACE_ID 环境变量 (ready sandbox 的 space id)");
  process.exit(1);
}

const TEST_SPACE_ID = config.testSpaceId;

// ── 辅助 ──────────────────────────────────────────────────────────────────────

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

const createdSessionIds: string[] = [];

async function trackSession(title: string): Promise<string> {
  const sid = await createSession(TEST_SPACE_ID, title);
  createdSessionIds.push(sid);
  return sid;
}

// ── 主测试 ────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`${C.white}Cohub Dev 真实并发验证 & K8s 资源监控${C.reset}`);
  console.log(`${C.dim}API: ${config.apiOrigin}${C.reset}`);
  console.log(`${C.dim}Space: ${TEST_SPACE_ID}${C.reset}`);
  console.log(`${C.dim}时间: ${new Date().toISOString()}${C.reset}`);

  // 如果没有指定 TEST_SPACE_ID，自动查找
  if (!TEST_SPACE_ID) {
    const found = await findReadySpace();
    if (!found) {
      console.error("❌ 未找到 ready sandbox，请先创建一个 space");
      process.exit(1);
    }
    console.log(`${C.dim}自动找到 ready sandbox: ${found}${C.reset}`);
  }

  // 启动 K8s 监控
  const k8s = createK8sMonitor(1500);
  k8s.start();

  // ── 实验 1: 时间戳并发验证 ─────────────────────────────────────────────────

  console.log(`\n${SEC} ${C.white}实验 1: 时间戳并发验证 (是否真正并行)${C.reset} ${SEC}`);

  console.log(`\n${C.dim}原理: 同时给 N 个独立 session 发消息，比较 agent 开始处理的时间戳。${C.reset}`);
  console.log(`${C.dim}如果真正并行，多个 session 的 assistant 第一条消息的 createdAt 应该非常接近 (≤2s)。${C.reset}`);
  console.log(`${C.dim}如果被串行，会呈现明显的阶梯状时间差。${C.reset}\n`);

  const parallelCount = 5;
  const parallelSessionIds = await Promise.all(
    Array.from({ length: parallelCount }, (_, i) => trackSession(`parallel-verify-${i}`)),
  );
  console.log(`${C.dim}创建了 ${parallelCount} 个 sessions${C.reset}`);

  // 同时发送消息
  const sendTimestamps = Date.now();
  await Promise.all(
    parallelSessionIds.map((sid, i) =>
      sendMessage(sid, `Parallel test #${i}. Reply with exactly: "PARALLEL-${i}"`),
    ),
  );
  const sendElapsed = Date.now() - sendTimestamps;
  console.log(`${C.dim}5 路消息发送完成 (耗时 ${sendElapsed}ms)${C.reset}`);

  // 等待回复
  const replyTimestamps: Array<{ sessionIndex: number; firstAssistantAt: string; firstAssistantId: string; totalMessages: number }> = [];

  const waitResults = await Promise.allSettled(
    parallelSessionIds.map(async (sid, i) => {
      const messages = await waitForAssistantReply(sid, { timeoutMs: TIMEOUTS.AGENT_REPLY_HEAVY });
      const assistantMsgs = messages.filter((m) => m.role === "assistant" && m.text?.trim());
      const first = assistantMsgs[0];
      return {
        sessionIndex: i,
        firstAssistantAt: first?.createdAt ? String(first.createdAt) : "unknown",
        firstAssistantId: first?.id ?? "unknown",
        totalMessages: messages.length,
      };
    }),
  );

  for (const r of waitResults) {
    if (r.status === "fulfilled") {
      replyTimestamps.push(r.value);
      console.log(`  Session ${r.value.sessionIndex}: first reply at ${r.value.firstAssistantAt} (${r.value.totalMessages} total messages)`);
    } else {
      console.log(`  Session ?: ❌ ${r.reason?.message ?? "unknown"}`);
    }
  }

  // 分析时间差
  if (replyTimestamps.length >= 2) {
    const timestamps = replyTimestamps.map((r) => ({ index: r.sessionIndex, ts: new Date(r.firstAssistantAt).getTime() }));
    timestamps.sort((a, b) => a.ts - b.ts);

    const minTs = timestamps[0]?.ts ?? 0;
    const maxTs = timestamps[timestamps.length - 1]?.ts ?? 0;
    const spreadMs = maxTs - minTs;

    console.log(`\n  ${C.cyan}并发分析:${C.reset}`);
    console.log(`    最早回复: ${new Date(minTs).toISOString()}`);
    console.log(`    最晚回复: ${new Date(maxTs).toISOString()}`);
    console.log(`    时间跨度: ${spreadMs}ms`);

    const gaps: number[] = [];
    for (let i = 1; i < timestamps.length; i++) {
      gaps.push((timestamps[i]?.ts ?? 0) - (timestamps[i - 1]?.ts ?? 0));
    }
    const avgGap = gaps.reduce((a, b) => a + b, 0) / gaps.length;
    const maxGap = Math.max(...gaps);

    console.log(`    相邻回复间隔: ${gaps.map((g) => `${g}ms`).join(", ")}`);
    console.log(`    平均间隔: ${avgGap.toFixed(0)}ms, 最大间隔: ${maxGap}ms`);

    if (spreadMs < 3000) {
      console.log(`    ${C.green}✅ PASS${C.reset} ${C.green}真正并行 — 所有回复在 ${spreadMs}ms 内完成${C.reset}`);
    } else if (spreadMs < 10000) {
      console.log(`    ${C.yellow}⚠️ WARN${C.reset} ${C.yellow}部分并行 — 时间跨度 ${spreadMs}ms，可能有排队${C.reset}`);
    } else {
      console.log(`    ${C.red}❌ FAIL${C.reset} ${C.red}疑似串行 — 时间跨度 ${spreadMs}ms，间隔明显${C.reset}`);
    }

    if (maxGap < 5000) {
      console.log(`    推断: Agent 使用 ${parallelCount === 1 ? "单线程" : "多线程/多实例"} 处理并发请求`);
    } else {
      console.log(`    推断: Agent 可能存在 ${maxGap > 10000 ? "串行队列" : "资源瓶颈"}`);
    }
  }

  // ── 实验 2: 高并发压力测试 ─────────────────────────────────────────────────

  console.log(`\n${SEC} ${C.white}实验 2: 高并发压力测试 (10 路并发)${C.reset} ${SEC}`);

  const stressCount = 10;
  const stressSessionIds = await Promise.all(
    Array.from({ length: stressCount }, (_, i) => trackSession(`stress-test-${i}`)),
  );

  const t0 = Date.now();
  await Promise.all(
    stressSessionIds.map((sid, i) =>
      sendMessage(sid, `Stress test #${i}. Count from 1 to 3 and say "STRESS-DONE-${i}".`),
    ),
  );
  console.log(`${C.dim}全部消息已发送，等待所有回复...${C.reset}`);

  const stressResults = await Promise.allSettled(
    stressSessionIds.map(async (sid, i) => {
      const start = Date.now();
      const messages = await waitForAssistantReply(sid, 240_000, 3000);
      const elapsed = Date.now() - start;
      const assistantCount = messages.filter((m) => m.role === "assistant").length;
      return { index: i, elapsed, assistantCount, totalMessages: messages.length };
    }),
  );

  const stressTotalElapsed = Date.now() - t0;
  const stressSucceeded = stressResults.filter((r) => r.status === "fulfilled") as PromiseFulfilledResult<{ index: number; elapsed: number; assistantCount: number; totalMessages: number }>[];
  const stressFailed = stressResults.filter((r) => r.status === "rejected");

  console.log(`\n  ${C.cyan}10 路并发结果:${C.reset}`);
  console.log(`    总耗时: ${stressTotalElapsed}ms`);
  console.log(`    成功: ${stressSucceeded.length}/${stressCount}, 失败: ${stressFailed.length}`);

  if (stressSucceeded.length > 0) {
    const elapseds = stressSucceeded.map((r) => r.value.elapsed);
    const minElapsed = Math.min(...elapseds);
    const maxElapsed = Math.max(...elapseds);
    const avgElapsed = elapseds.reduce((a, b) => a + b, 0) / elapseds.length;

    console.log(`    单 session 回复时间: 最快=${minElapsed}ms, 最慢=${maxElapsed}ms, 平均=${avgElapsed.toFixed(0)}ms`);

    const sumElapsed = elapseds.reduce((a, b) => a + b, 0);
    const parallelismRatio = sumElapsed / stressTotalElapsed;
    console.log(`    并行度估算: ${parallelismRatio.toFixed(1)}x (理论最大值=${stressCount}x)`);

    if (parallelismRatio > stressCount * 0.5) {
      console.log(`    ${C.green}✅ PASS${C.reset} 高并发并行度良好 (${parallelismRatio.toFixed(1)}x / ${stressCount}x)`);
    } else if (parallelismRatio > 2) {
      console.log(`    ${C.yellow}⚠️ WARN${C.reset} 存在一定并行度 (${parallelismRatio.toFixed(1)}x / ${stressCount}x)`);
    } else {
      console.log(`    ${C.red}❌ FAIL${C.reset} 并行度较低 (${parallelismRatio.toFixed(1)}x / ${stressCount}x)，可能接近串行`);
    }
  }

  // ── 实验 3: 单 Session 并发干扰 ────────────────────────────────────────────

  console.log(`\n${SEC} ${C.white}实验 3: 单 Session 并发干扰测试${C.reset} ${SEC}`);

  console.log(`${C.dim}原理: 对一个 session 快速连续发消息，观察 agent 是否支持 steer (中断当前流处理新消息)${C.reset}`);

  const interruptSessionId = await trackSession("interrupt-test");
  await sendMessage(interruptSessionId, "Start counting from 1 to 100 slowly, saying each number.");
  console.log(`${C.dim}发送了长任务消息，等待 3 秒后发送中断消息...${C.reset}`);
  await new Promise((r) => setTimeout(r, 3000));

  const interruptStart = Date.now();
  await sendMessage(interruptSessionId, "STOP! Reply immediately with 'INTERRUPTED'.");
  console.log(`${C.dim}中断消息已发送${C.reset}`);

  try {
    const interruptMessages = await waitForAssistantReply(interruptSessionId, { timeoutMs: 60_000, intervalMs: 1000 });
    const interruptElapsed = Date.now() - interruptStart;

    const allTexts = interruptMessages
      .filter((m) => m.role === "assistant")
      .map((m) => m.text ?? "");
    const hasInterrupt = allTexts.some((t) => t.includes("INTERRUPTED") || t.includes("interrupt"));

    console.log(`\n  ${C.cyan}中断测试结果:${C.reset}`);
    console.log(`    总消息数: ${interruptMessages.length}`);
    console.log(`    Assistant 消息数: ${allTexts.length}`);
    console.log(`    中断响应: ${hasInterrupt ? "✅ 检测到 INTERRUPTED" : "❌ 未检测到"} (${interruptElapsed}ms)`);

    if (hasInterrupt) {
      console.log(`    ${C.green}✅ PASS${C.reset} Agent 支持 steer/中断机制`);
    } else {
      console.log(`    ${C.yellow}⚠️ WARN${C.reset} Agent 可能不支持 steer，或消息未被及时处理`);
    }
  } catch (err) {
    console.log(`\n  ${C.cyan}中断测试结果:${C.reset}`);
    console.log(`    ${C.yellow}⚠️ WARN${C.reset} 等待中断回复超时: ${err instanceof Error ? err.message : String(err)}`);
  }

  // ── 停止监控 & 输出报告 ────────────────────────────────────────────────────

  k8s.stop();
  k8s.printReport();

  // ── 最终汇总 ────────────────────────────────────────────────────────────────

  console.log(`\n${SEC} ${C.white}汇总${C.reset} ${SEC}`);

  const testDuration = k8s.snapshots.length > 0
    ? (k8s.snapshots[k8s.snapshots.length - 1]?.ts ?? 0) - (k8s.snapshots[0]?.ts ?? 0)
    : 0;

  console.log(`  测试总时长: ${(testDuration / 1000).toFixed(0)}s`);
  console.log(`  K8s 采样次数: ${k8s.snapshots.length}`);
  console.log("  实验 1 (时间戳并发): 已完成");
  console.log("  实验 2 (10 路并发): 已完成");
  console.log("  实验 3 (中断测试): 已完成");
  console.log("");

  // 清理测试资源
  await cleanupTestResources(null, createdSessionIds);
}

main().catch((err) => {
  console.error("\n❌ 脚本执行失败:", err);
  process.exit(1);
});
