#!/usr/bin/env tsx
/**
 * Cohub Dev 端到端压力测试 — 极限探索
 *
 * 用法: COHUB_TOKEN=<token> TEST_SPACE_ID=<space> npx tsx scripts/e2e-load-test.ts
 *
 * 策略: 逐步递增并发度 (5 → 10 → 20 → 30 → 50)，
 *       每轮记录成功率、延迟分布、K8s 资源峰值，找到系统极限。
 */

const API_ORIGIN = process.env.COHUB_API_ORIGIN ?? "https://api-dev.cohub.run";
const TOKEN = process.env.COHUB_TOKEN ?? "";
const TEST_SPACE_ID = process.env.TEST_SPACE_ID ?? "";

if (!TOKEN || !TEST_SPACE_ID) {
  console.error("❌ 请设置 COHUB_TOKEN 和 TEST_SPACE_ID");
  process.exit(1);
}

import { exec } from "node:child_process";
import { promisify } from "node:util";

const execAsync = promisify(exec);

// ── 配色 ──────────────────────────────────────────────────────────────────────

const C = {
  reset: "\x1b[0m", dim: "\x1b[2m", green: "\x1b[32m", red: "\x1b[31m",
  yellow: "\x1b[33m", blue: "\x1b[36m", magenta: "\x1b[35m", white: "\x1b[1m",
  cyan: "\x1b[96m",
};
const SEC = `${C.magenta}━━━${C.reset}`;
function section(t: string) { console.log(`\n${SEC} ${C.white}${t}${C.reset} ${SEC}`); }
function step(t: string) { console.log(`  ${C.blue}▶${C.reset} ${t}`); }

// ── K8s 资源监控 ──────────────────────────────────────────────────────────────

interface PodMetrics {
  name: string;
  cpu: number; // m
  mem: number; // Mi
}

interface MetricsSnapshot {
  ts: number;
  tsStr: string;
  pods: PodMetrics[];
}

const allSnapshots: MetricsSnapshot[] = [];
let monitorInterval: ReturnType<typeof setInterval> | null = null;

async function collectPodMetrics(): Promise<PodMetrics[]> {
  const pods: PodMetrics[] = [];

  // Agent pod
  try {
    const { stdout } = await execAsync(
      "KUBECONFIG=/Users/tzwm/.kube/config_us kubectl top pod cohub-agent-dev-574f98c8b9-qqkts -n cohub-dev --no-headers 2>/dev/null",
    );
    const parts = stdout.trim().split(/\s+/);
    pods.push({ name: "agent", cpu: Number.parseInt(parts[1] ?? "0"), mem: Math.round(Number.parseFloat(parts[2] ?? "0")) });
  } catch { /* skip */ }

  // API pod
  try {
    const { stdout } = await execAsync(
      "KUBECONFIG=/Users/tzwm/.kube/config_us kubectl top pod cohub-api-dev-68ff4cf5c-bpb29 -n cohub-dev --no-headers 2>/dev/null",
    );
    const parts = stdout.trim().split(/\s+/);
    pods.push({ name: "api", cpu: Number.parseInt(parts[1] ?? "0"), mem: Math.round(Number.parseFloat(parts[2] ?? "0")) });
  } catch { /* skip */ }

  // Gateway pod
  try {
    const { stdout } = await execAsync(
      "KUBECONFIG=/Users/tzwm/.kube/config_us kubectl top pod cohub-gateway-dev-0 -n cohub-dev --no-headers 2>/dev/null",
    );
    const parts = stdout.trim().split(/\s+/);
    pods.push({ name: "gateway", cpu: Number.parseInt(parts[1] ?? "0"), mem: Math.round(Number.parseFloat(parts[2] ?? "0")) });
  } catch { /* skip */ }

  // Worker pod
  try {
    const { stdout } = await execAsync(
      "KUBECONFIG=/Users/tzwm/.kube/config_us kubectl top pod cohub-worker-dev-84b48ff57b-hz688 -n cohub-dev --no-headers 2>/dev/null",
    );
    const parts = stdout.trim().split(/\s+/);
    pods.push({ name: "worker", cpu: Number.parseInt(parts[1] ?? "0"), mem: Math.round(Number.parseFloat(parts[2] ?? "0")) });
  } catch { /* skip */ }

  // Sandbox pod (测试用)
  try {
    const { stdout } = await execAsync(
      `KUBECONFIG=/Users/tzwm/.kube/config_us kubectl top pod sandbox-${TEST_SPACE_ID} -n cohub-sessions-dev --no-headers 2>/dev/null`,
    );
    const parts = stdout.trim().split(/\s+/);
    pods.push({ name: "sandbox", cpu: Number.parseInt(parts[1] ?? "0"), mem: Math.round(Number.parseFloat(parts[2] ?? "0")) });
  } catch { /* skip */ }

  return pods;
}

function startMonitoring(intervalMs = 1500) {
  console.log(`${C.dim}📊 K8s 监控已启动 (每 ${intervalMs}ms 采样)...${C.reset}`);
  const collect = async () => {
    const pods = await collectPodMetrics();
    allSnapshots.push({ ts: Date.now(), tsStr: new Date().toISOString(), pods });
  };
  void collect();
  monitorInterval = setInterval(collect, intervalMs);
}

function stopMonitoring() {
  if (monitorInterval) clearInterval(monitorInterval);
  monitorInterval = null;
}

function printMetricsReport() {
  if (allSnapshots.length < 2) return;

  section("📊 K8s 资源监控报告");

  const podNames = ["agent", "api", "gateway", "worker", "sandbox"];
  for (const podName of podNames) {
    const samples = allSnapshots.flatMap((s) => s.pods.filter((p) => p.name === podName));
    if (samples.length === 0) continue;

    const cpuVals = samples.map((s) => s.cpu);
    const memVals = samples.map((s) => s.mem);
    const avgCpu = cpuVals.reduce((a, b) => a + b, 0) / cpuVals.length;
    const maxCpu = Math.max(...cpuVals);
    const avgMem = memVals.reduce((a, b) => a + b, 0) / memVals.length;
    const maxMem = Math.max(...memVals);

    const limits: Record<string, { cpu: number; mem: number }> = {
      agent: { cpu: 1000, mem: 1024 },
      api: { cpu: 500, mem: 512 },
      gateway: { cpu: 500, mem: 512 },
      worker: { cpu: 500, mem: 512 },
      sandbox: { cpu: 1000, mem: 2048 },
    };
    const lim = limits[podName] ?? { cpu: 1000, mem: 1024 };
    const cpuUtil = ((maxCpu / lim.cpu) * 100).toFixed(1);
    const memUtil = ((maxMem / lim.mem) * 100).toFixed(1);

    console.log(`\n  ${C.cyan}${podName.toUpperCase()} Pod${C.reset} (Limit: CPU=${lim.cpu}m, MEM=${lim.mem}Mi)`);
    console.log(`    CPU  平均: ${avgCpu.toFixed(1)}m  峰值: ${maxCpu}m  利用率: ${cpuUtil}%`);
    console.log(`    MEM  平均: ${avgMem.toFixed(0)}Mi  峰值: ${maxMem}Mi  利用率: ${memUtil}%`);
  }

  // 时间线
  console.log(`\n  ${C.dim}资源时间线 (${allSnapshots.length} 个采样点):${C.reset}`);
  const barWidth = 40;
  const maxCpu = Math.max(...allSnapshots.flatMap((s) => s.pods.map((p) => p.cpu)), 1);

  for (const s of allSnapshots) {
    const ts = new Date(s.ts).toISOString().slice(11, 19);
    const parts: string[] = [];
    for (const podName of podNames) {
      const pod = s.pods.find((p) => p.name === podName);
      if (!pod || pod.cpu === 0) continue;
      const bar = "█".repeat(Math.round((pod.cpu / maxCpu) * barWidth)) || "░";
      parts.push(`${podName} ${bar} ${pod.cpu}m/${pod.mem}Mi`);
    }
    if (parts.length > 0) {
      console.log(`    ${ts} │ ${parts.join(" │ ")}`);
    }
  }
}

// ── API 辅助 ──────────────────────────────────────────────────────────────────

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
  try { body = JSON.parse(text); } catch { body = text; }
  if (!resp.ok) throw new Error(`HTTP ${resp.status} ${path}\n  ${typeof body === "string" ? body.slice(0, 200) : JSON.stringify(body).slice(0, 200)}`);
  return body;
}

async function createSession(title: string): Promise<string> {
  const body = await api(`/api/spaces/${TEST_SPACE_ID}/sessions`, {
    method: "POST",
    body: JSON.stringify({ title }),
  }) as { session: { id: string } };
  return body.session.id;
}

async function sendMessage(sessionId: string, text: string): Promise<{ userMessageId: string }> {
  return api(`/api/sessions/${sessionId}/messages`, {
    method: "POST",
    body: JSON.stringify({ content: [{ type: "text" as const, text }] }),
  }) as Promise<{ userMessageId: string }>;
}

async function waitForReply(sessionId: string, timeoutMs = 180_000, intervalMs = 2000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const data = await api(`/api/sessions/${sessionId}/messages`) as {
      messages: Array<{ id: string; role: string; text: string | null }>;
    };
    const assistantMsgs = data.messages.filter((m) => m.role === "assistant" && m.text?.trim());
    if (assistantMsgs.length > 0) return data.messages;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error(`Timeout waiting for reply on ${sessionId}`);
}

// ── 压力测试核心 ──────────────────────────────────────────────────────────────

interface RoundResult {
  concurrency: number;
  totalSessions: number;
  successCount: number;
  failCount: number;
  sendElapsedMs: number;
  totalWaitElapsedMs: number;
  perSessionElapsed: number[];
  errors: string[];
  peakAgentCpu: number;
  peakAgentMem: number;
  peakApiCpu: number;
  peakApiMem: number;
}

const roundResults: RoundResult[] = [];

async function runConcurrencyRound(concurrency: number, roundIndex: number): Promise<RoundResult> {
  section(`压测轮次 ${roundIndex}: ${concurrency} 路并发`);

  const result: RoundResult = {
    concurrency,
    totalSessions: concurrency,
    successCount: 0,
    failCount: 0,
    sendElapsedMs: 0,
    totalWaitElapsedMs: 0,
    perSessionElapsed: [],
    errors: [],
    peakAgentCpu: 0,
    peakAgentMem: 0,
    peakApiCpu: 0,
    peakApiMem: 0,
  };

  // 创建 sessions
  step(`创建 ${concurrency} 个 sessions...`);
  const t0 = Date.now();
  const sessionIds = await Promise.all(
    Array.from({ length: concurrency }, (_, i) => createSession(`load-round${roundIndex}-${i}`)),
  );
  const createElapsed = Date.now() - t0;
  console.log(`    Sessions 创建完成: ${createElapsed}ms`);

  // 发送消息
  step(`同时发送 ${concurrency} 条消息...`);
  const sendT0 = Date.now();
  const sendResults = await Promise.allSettled(
    sessionIds.map((sid, i) => sendMessage(sid, `Load test round ${roundIndex}, session ${i}. Count from 1 to 5 and reply "LOAD-R${roundIndex}-S${i}-DONE".`)),
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

  // 等待回复
  step(`等待 ${concurrency} 个回复...`);
  const waitT0 = Date.now();
  const waitResults = await Promise.allSettled(
    sessionIds.map(async (sid, i) => {
      const t1 = Date.now();
      const messages = await waitForReply(sid, 240_000, 3000);
      return { elapsed: Date.now() - t1, messages };
    }),
  );
  result.totalWaitElapsedMs = Date.now() - waitT0;

  for (const r of waitResults) {
    if (r.status === "fulfilled") {
      result.successCount++;
      result.perSessionElapsed.push(r.value.elapsed);
    } else {
      result.failCount++;
      result.errors.push(`reply: ${r.reason?.message ?? "unknown"}`);
    }
  }

  // 计算峰值
  const relevantSnapshots = allSnapshots.filter(
    (s) => s.ts >= (t0 - 10000) && s.ts <= (Date.now() + 1000),
  );
  for (const snap of relevantSnapshots) {
    const agent = snap.pods.find((p) => p.name === "agent");
    if (agent) {
      result.peakAgentCpu = Math.max(result.peakAgentCpu, agent.cpu);
      result.peakAgentMem = Math.max(result.peakAgentMem, agent.mem);
    }
    const api = snap.pods.find((p) => p.name === "api");
    if (api) {
      result.peakApiCpu = Math.max(result.peakApiCpu, api.cpu);
      result.peakApiMem = Math.max(result.peakApiMem, api.mem);
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
    console.log(`    Agent 峰值: CPU=${result.peakAgentCpu}m, MEM=${result.peakAgentMem}Mi`);
    console.log(`    API 峰值: CPU=${result.peakApiCpu}m, MEM=${result.peakApiMem}Mi`);

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
  console.log(`${C.dim}API: ${API_ORIGIN}${C.reset}`);
  console.log(`${C.dim}Space: ${TEST_SPACE_ID}${C.reset}`);
  console.log(`${C.dim}时间: ${new Date().toISOString()}${C.reset}`);

  startMonitoring(1500);

  // ── 渐进式压测 ──────────────────────────────────────────────────────────────

  // 每轮并发度：从 5 开始逐步增加，直到失败率 > 30%
  const concurrencyLevels = [5, 10, 20, 30, 50];
  let stopEarly = false;

  for (let i = 0; i < concurrencyLevels.length; i++) {
    if (stopEarly) break;

    const concurrency = concurrencyLevels[i];
    const result = await runConcurrencyRound(concurrency, i + 1);

    // 如果失败率 > 30%，停止
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

  section("持续负载测试: 20 并发持续 60s");

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
      Array.from({ length: sustainedConcurrency }, (_, i) => createSession(`sustained-${sustainedBatches}-${i}`)),
    );

    await Promise.all(
      sessionIds.map((sid, i) => sendMessage(sid, `Sustained load test batch ${sustainedBatches}, session ${i}. Reply "SUSTAINED-${sustainedBatches}-${i}"`)),
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

    // 短暂休息
    await new Promise((r) => setTimeout(r, 1000));
  }

  console.log(`\n  ${C.cyan}持续负载结果:${C.reset}`);
  console.log(`    总批次: ${sustainedBatches}`);
  console.log(`    总消息: ${sustainedTotal}`);
  console.log(`    成功率: ${sustainedSuccess}/${sustainedTotal} (${((sustainedSuccess / sustainedTotal) * 100).toFixed(1)}%)`);
  console.log(`    失败: ${sustainedFail}`);
  console.log(`    吞吐率: ${((sustainedSuccess / sustainedDuration) * 1000).toFixed(2)} 条/s`);

  // ── 停止监控 & 输出报告 ────────────────────────────────────────────────────

  stopMonitoring();
  printMetricsReport();

  // ── 汇总报告 ────────────────────────────────────────────────────────────────

  section("📈 压测汇总报告");

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

  // 极限判断
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

    // Agent 资源分析
    if (lastRound.peakAgentCpu > 800) {
      console.log(`    ${C.yellow}Agent CPU 峰值 ${lastRound.peakAgentCpu}m (Limit 1000m)，接近 CPU 瓶颈${C.reset}`);
    }
    if (lastRound.peakAgentMem > 800) {
      console.log(`    ${C.yellow}Agent MEM 峰值 ${lastRound.peakAgentMem}Mi (Limit 1024Mi)，接近内存瓶颈${C.reset}`);
    }

    // 吞吐率
    const totalSuccess = roundResults.reduce((a, r) => a + r.successCount, 0);
    const totalWaitTime = roundResults.reduce((a, r) => a + r.totalWaitElapsedMs, 0);
    const overallThroughput = totalWaitTime > 0 ? (totalSuccess / (totalWaitTime / 1000)).toFixed(2) : "N/A";
    console.log(`    整体吞吐率: ${overallThroughput} 条/s`);
  }

  console.log("");
}

main().catch((err) => {
  console.error("\n❌ 脚本执行失败:", err);
  stopMonitoring();
  process.exit(1);
});
