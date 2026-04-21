#!/usr/bin/env tsx
/**
 * Cohub Dev 端到端压力测试 — 极限探索
 *
 * 用法: pnpm test:load
 *
 * 策略: 逐步递增并发度 (5 → 10 → 20 → 30 → 50)，
 *       每轮记录成功率、延迟分布、K8s 资源峰值，找到系统极限。
 */

import {
  assertConfig, config, createSession, sendMessage, waitForAssistantReply,
  createK8sMonitor, cleanupTestResources, batchedAll,
  C, SEC,
} from "./test-utils.js";

assertConfig();

if (!config.testSpaceId) {
  console.error("❌ 请设置 TEST_SPACE_ID 环境变量");
  process.exit(1);
}

const TEST_SPACE_ID = config.testSpaceId;

// ── 辅助 ──────────────────────────────────────────────────────────────────────

const createdSessionIds: string[] = [];

async function trackSession(title: string): Promise<string> {
  const sid = await createSession(TEST_SPACE_ID, title);
  createdSessionIds.push(sid);
  return sid;
}

async function waitForReply(sessionId: string, timeoutMs = 180_000, intervalMs = 2000) {
  return waitForAssistantReply(sessionId, { timeoutMs, intervalMs });
}

// ── 压测核心 ──────────────────────────────────────────────────────────────────

interface RoundResult {
  concurrency: number;
  successCount: number;
  failCount: number;
  sendElapsedMs: number;
  totalWaitElapsedMs: number;
  perSessionElapsed: number[];
  errors: string[];
}

const roundResults: RoundResult[] = [];

async function runConcurrencyRound(concurrency: number, roundIndex: number): Promise<RoundResult> {
  console.log(`\n${SEC} ${C.white}压测轮次 ${roundIndex}: ${concurrency} 路并发${C.reset} ${SEC}`);

  const result: RoundResult = {
    concurrency,
    successCount: 0,
    failCount: 0,
    sendElapsedMs: 0,
    totalWaitElapsedMs: 0,
    perSessionElapsed: [],
    errors: [],
  };

  // 创建 sessions
  console.log(`  ${C.blue}▶${C.reset} 创建 ${concurrency} 个 sessions...`);
  const t0 = Date.now();
  const sessionIds = await Promise.all(
    Array.from({ length: concurrency }, (_, i) => trackSession(`load-round${roundIndex}-${i}`)),
  );
  const createElapsed = Date.now() - t0;
  console.log(`    Sessions 创建完成: ${createElapsed}ms`);

  // 发送消息 — 使用限流器避免瞬间打满
  console.log(`  ${C.blue}▶${C.reset} 同时发送 ${concurrency} 条消息...`);
  const sendT0 = Date.now();
  const sendResults = await Promise.allSettled(
    sessionIds.map((sid, i) =>
      sendMessage(sid, `Load test round ${roundIndex}, session ${i}. Count from 1 to 5 and reply "LOAD-R${roundIndex}-S${i}-DONE".`),
    ),
  );
  result.sendElapsedMs = Date.now() - sendT0;
  const sendOk = sendResults.filter((r) => r.status === "fulfilled").length;
  const sendFail = sendResults.filter((r) => r.status === "rejected").length;
  console.log(`    发送完成: ${sendOk} 成功, ${sendFail} 失败, 耗时 ${result.sendElapsedMs}ms`);

  if (sendFail > 0) {
    for (const r of sendResults) {
      if (r.status === "rejected") result.errors.push(`send: ${r.reason?.message ?? "unknown"}`);
    }
  }

  // 等待回复 — 分批限流
  console.log(`  ${C.blue}▶${C.reset} 等待 ${concurrency} 个回复...`);
  const waitT0 = Date.now();
  const waitResults = await batchedAll(
    sessionIds,
    async (sid) => {
      const t1 = Date.now();
      const messages = await waitForReply(sid, 240_000, 3000);
      return { elapsed: Date.now() - t1, messages };
    },
    Math.min(concurrency, 20), // 每批最多 20 个
  );
  result.totalWaitElapsedMs = Date.now() - waitT0;

  for (const r of waitResults) {
    if (r) {
      result.successCount++;
      result.perSessionElapsed.push(r.elapsed);
    } else {
      result.failCount++;
      result.errors.push("reply: unknown error");
    }
  }

  // 统计
  if (result.perSessionElapsed.length > 0) {
    const sorted = [...result.perSessionElapsed].sort((a, b) => a - b);
    const p50 = sorted[Math.floor(sorted.length * 0.5)] ?? 0;
    const p90 = sorted[Math.floor(sorted.length * 0.9)] ?? 0;
    const p99 = sorted[Math.floor(sorted.length * 0.99)] ?? 0;
    const avg = sorted.reduce((a, b) => a + b, 0) / sorted.length;

    console.log(`\n  ${C.cyan}结果摘要:${C.reset}`);
    console.log(`    成功率: ${result.successCount}/${concurrency} (${((result.successCount / concurrency) * 100).toFixed(1)}%)`);
    console.log(`    发送耗时: ${result.sendElapsedMs}ms`);
    console.log(`    总等待耗时: ${result.totalWaitElapsedMs}ms`);
    console.log(`    单 session 回复延迟: P50=${p50}ms, P90=${p90}ms, P99=${p99}ms, 平均=${avg.toFixed(0)}ms`);

    if (result.failCount > 0) {
      console.log(`    ${C.red}失败: ${result.failCount}${C.reset}`);
      for (const err of result.errors.slice(0, 3)) {
        console.log(`      - ${err}`);
      }
    }

    const parallelismRatio = sorted.length > 0
      ? sorted.reduce((a, b) => a + b, 0) / Math.max(result.totalWaitElapsedMs, 1)
      : 0;
    console.log(`    并行度: ${parallelismRatio.toFixed(1)}x / ${concurrency}x`);
  }

  roundResults.push(result);
  return result;
}

// ── 主流程 ────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`${C.white}Cohub Dev 端到端压力测试 — 极限探索${C.reset}`);
  console.log(`${C.dim}API: ${config.apiOrigin}${C.reset}`);
  console.log(`${C.dim}Space: ${TEST_SPACE_ID}${C.reset}`);
  console.log(`${C.dim}时间: ${new Date().toISOString()}${C.reset}`);

  // 启动 K8s 监控 (动态 Pod 发现)
  const k8s = createK8sMonitor(1500);
  k8s.start();

  // ── Warmup: 1 个请求预热连接 ───────────────────────────────────────────────

  console.log(`\n${C.dim}🔥 Warmup: 发送 1 个预热请求...${C.reset}`);
  const warmupSid = await trackSession("warmup");
  await sendMessage(warmupSid, "warmup");
  try {
    await waitForReply(warmupSid, 60_000, 2000);
    console.log(`${C.dim}  Warmup 完成${C.reset}`);
  } catch {
    console.log(`${C.dim}  Warmup 未收到回复 (不影响后续测试)${C.reset}`);
  }

  // ── 渐进式压测 ──────────────────────────────────────────────────────────────

  const concurrencyLevels = [5, 10, 20, 30, 50];
  let stopEarly = false;

  for (let i = 0; i < concurrencyLevels.length; i++) {
    if (stopEarly) break;

    const concurrency = concurrencyLevels[i];
    const result = await runConcurrencyRound(concurrency, i + 1);

    // 失败率 > 30% 停止
    if (result.failCount > concurrency * 0.3) {
      console.log(`\n${C.red}失败率超过 30%，停止递增并发度${C.reset}`);
      stopEarly = true;
    }

    // 间隔 10s 让系统恢复
    if (i < concurrencyLevels.length - 1 && !stopEarly) {
      console.log(`\n${C.dim}等待 10s 让系统恢复...${C.reset}`);
      await new Promise((r) => setTimeout(r, 10000));
    }
  }

  // ── 持续负载测试 ────────────────────────────────────────────────────────────

  console.log(`\n${SEC} ${C.white}持续负载测试: 20 并发持续 60s${C.reset} ${SEC}`);

  const sustainedConcurrency = 20;
  const sustainedDuration = 60_000;
  const sustainedStart = Date.now();
  let sustainedTotal = 0;
  let sustainedSuccess = 0;
  let sustainedFail = 0;
  let sustainedBatches = 0;

  while (Date.now() - sustainedStart < sustainedDuration) {
    const batchStart = Date.now();
    const sessionIds = await Promise.all(
      Array.from({ length: sustainedConcurrency }, (_, i) =>
        trackSession(`sustained-${sustainedBatches}-${i}`),
      ),
    );

    await Promise.all(
      sessionIds.map((sid, i) =>
        sendMessage(sid, `Sustained load test batch ${sustainedBatches}, session ${i}. Reply "SUSTAINED-${sustainedBatches}-${i}"`),
      ),
    );

    const batchResults = await Promise.allSettled(
      sessionIds.map((sid) => waitForReply(sid, 120_000, 2000)),
    );

    sustainedTotal += sustainedConcurrency;
    sustainedSuccess += batchResults.filter((r) => r.status === "fulfilled").length;
    sustainedFail += batchResults.filter((r) => r.status === "rejected").length;
    sustainedBatches++;

    const batchElapsed = Date.now() - batchStart;
    console.log(`    Batch ${sustainedBatches}: ${batchResults.filter((r) => r.status === "fulfilled").length}/${sustainedConcurrency} 成功, 耗时 ${batchElapsed}ms`);

    await new Promise((r) => setTimeout(r, 1000));
  }

  console.log(`\n  ${C.cyan}持续负载结果:${C.reset}`);
  console.log(`    总批次: ${sustainedBatches}`);
  console.log(`    总消息: ${sustainedTotal}`);
  console.log(`    成功率: ${sustainedSuccess}/${sustainedTotal} (${((sustainedSuccess / sustainedTotal) * 100).toFixed(1)}%)`);
  console.log(`    失败: ${sustainedFail}`);
  console.log(`    吞吐率: ${((sustainedSuccess / sustainedDuration) * 1000).toFixed(2)} 条/s`);

  // ── 停止监控 & 输出报告 ────────────────────────────────────────────────────

  k8s.stop();
  k8s.printReport();

  // ── 汇总报告 ────────────────────────────────────────────────────────────────

  console.log(`\n${SEC} ${C.white}📈 压测汇总报告${C.reset} ${SEC}`);

  console.log(`\n  ${C.cyan}渐进式并发测试结果:${C.reset}`);
  console.log("  ┌────────────┬──────────┬──────────┬──────────┬────────────┬────────────┐");
  console.log("  │ 并发度     │ 成功     │ 失败     │ 发送耗时 │ 总等待耗时 │ P90 延迟   │");
  console.log("  ├────────────┼──────────┼──────────┼──────────┼────────────┼────────────┤");
  for (const r of roundResults) {
    const sorted = [...r.perSessionElapsed].sort((a, b) => a - b);
    const p90 = sorted[Math.floor(sorted.length * 0.9)] ?? 0;
    console.log(`  │ ${String(r.concurrency).padStart(10)} │ ${String(r.successCount).padStart(8)} │ ${String(r.failCount).padStart(8)} │ ${String(r.sendElapsedMs).padStart(8)}ms │ ${String(r.totalWaitElapsedMs).padStart(10)}ms │ ${String(p90).padStart(10)}ms │`);
  }
  console.log("  └────────────┴──────────┴──────────┴──────────┴────────────┴────────────┘");

  const lastRound = roundResults[roundResults.length - 1];
  if (lastRound) {
    console.log(`\n  ${C.cyan}极限评估:${C.reset}`);
    const successRate = lastRound.successCount / lastRound.concurrency;
    if (successRate >= 0.9) {
      console.log(`    ${C.green}系统在 ${lastRound.concurrency} 路并发下运行稳定，极限可能在更高并发度${C.reset}`);
    } else if (successRate >= 0.7) {
      console.log(`    ${C.yellow}系统在 ${lastRound.concurrency} 路并发下开始出现不稳定${C.reset}`);
    } else {
      console.log(`    ${C.red}系统在 ${lastRound.concurrency} 路并发下已接近极限${C.reset}`);
    }

    const totalSuccess = roundResults.reduce((a, r) => a + r.successCount, 0);
    const totalWaitTime = roundResults.reduce((a, r) => a + r.totalWaitElapsedMs, 0);
    const overallThroughput = totalWaitTime > 0 ? (totalSuccess / (totalWaitTime / 1000)).toFixed(2) : "N/A";
    console.log(`    整体吞吐率: ${overallThroughput} 条/s`);
  }

  console.log("");

  // 清理测试资源
  await cleanupTestResources(null, createdSessionIds);
}

main().catch((err) => {
  console.error("\n❌ 脚本执行失败:", err);
  process.exit(1);
});
