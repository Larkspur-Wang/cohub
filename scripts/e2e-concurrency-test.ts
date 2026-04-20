#!/usr/bin/env tsx
/**
 * Cohub Dev — 真实并发验证 & K8s 资源实时监控
 *
 * 功能:
 *   1. 启动后台 K8s 资源监控 (agent + sandbox pods)
 *   2. 发送并发消息并通过时间戳验证是否真正并行执行
 *   3. 输出完整的并发分析报告
 */

const API_ORIGIN = process.env.COHUB_API_ORIGIN ?? "https://api-dev.cohub.run";
const TOKEN = process.env.COHUB_TOKEN ?? "";
const TEST_SPACE_ID = process.env.TEST_SPACE_ID ?? "";

if (!TOKEN) {
  console.error("❌ 请设置 COHUB_TOKEN 环境变量");
  process.exit(1);
}

if (!TEST_SPACE_ID) {
  console.error("❌ 请设置 TEST_SPACE_ID 环境变量 (ready sandbox 的 space id)");
  process.exit(1);
}

const C = {
  reset: "\x1b[0m", dim: "\x1b[2m", green: "\x1b[32m", red: "\x1b[31m",
  yellow: "\x1b[33m", blue: "\x1b[36m", magenta: "\x1b[35m", white: "\x1b[1m",
  cyan: "\x1b[96m",
};

const PASS = `${C.green}✅ PASS${C.reset}`;
const FAIL = `${C.red}❌ FAIL${C.reset}`;
const WARN = `${C.yellow}⚠️ WARN${C.reset}`;
const SEC = `${C.magenta}━━━${C.reset}`;

function section(title: string) {
  console.log(`\n${SEC} ${C.white}${title}${C.reset} ${SEC}`);
}

// ── K8s 资源监控 ──────────────────────────────────────────────────────────────

import { exec } from "node:child_process";
import { promisify } from "node:util";

const execAsync = promisify(exec);

interface K8sMetrics {
  ts: number;
  tsStr: string;
  agent: { cpu: string; mem: string };
  sandboxes: Array<{ name: string; cpu: string; mem: string }>;
}

const metricsLog: K8sMetrics[] = [];
let monitorInterval: ReturnType<typeof setInterval> | null = null;

async function collectK8sMetrics(): Promise<K8sMetrics> {
  const tsStr = new Date().toISOString();
  const ts = Date.now();

  try {
    const [agentOut, sandboxOut] = await Promise.all([
      execAsync("KUBECONFIG=/Users/tzwm/.kube/config_us kubectl top pod cohub-agent-dev-574f98c8b9-qqkts -n cohub-dev --no-headers 2>/dev/null"),
      execAsync("KUBECONFIG=/Users/tzwm/.kube/config_us kubectl top pods -n cohub-sessions-dev --no-headers 2>/dev/null"),
    ]);

    const agentLine = agentOut.stdout.trim().split(/\s+/);
    const agent = {
      cpu: agentLine[1] ?? "0m",
      mem: agentLine[2] ?? "0Mi",
    };

    const sandboxes: Array<{ name: string; cpu: string; mem: string }> = [];
    for (const line of sandboxOut.stdout.trim().split("\n")) {
      const parts = line.trim().split(/\s+/);
      if (parts.length >= 3 && parts[0]?.startsWith("sandbox-")) {
        sandboxes.push({
          name: parts[0],
          cpu: parts[1] ?? "0m",
          mem: parts[2] ?? "0Mi",
        });
      }
    }

    return { ts, tsStr, agent, sandboxes };
  } catch {
    return { ts, tsStr, agent: { cpu: "N/A", mem: "N/A" }, sandboxes: [] };
  }
}

function startK8sMonitoring(intervalMs = 2000) {
  console.log(`${C.dim}📊 K8s 监控已启动 (每 ${intervalMs}ms 采样)...${C.reset}`);
  const collect = async () => {
    const m = await collectK8sMetrics();
    metricsLog.push(m);
  };
  void collect();
  monitorInterval = setInterval(collect, intervalMs);
}

function stopK8sMonitoring() {
  if (monitorInterval) clearInterval(monitorInterval);
  monitorInterval = null;
}

function parseMemBytes(memStr: string): number {
  if (memStr.endsWith("Mi")) return Number.parseFloat(memStr) * 1024 * 1024;
  if (memStr.endsWith("Gi")) return Number.parseFloat(memStr) * 1024 * 1024 * 1024;
  if (memStr.endsWith("Ki")) return Number.parseFloat(memStr) * 1024;
  return Number.parseFloat(memStr);
}

function printK8sReport() {
  if (metricsLog.length < 2) {
    console.log(`${C.yellow}⚠️ K8s 采样数据不足 (${metricsLog.length} 次)，跳过报告${C.reset}`);
    return;
  }

  section("📊 K8s 资源监控报告");

  // Agent 统计
  const agentSamples = metricsLog.filter((m) => m.agent.cpu !== "N/A");
  if (agentSamples.length > 0) {
    const cpuVals = agentSamples.map((m) => Number.parseInt(m.agent.cpu));
    const memVals = agentSamples.map((m) => parseMemBytes(m.agent.mem));

    const avgCpu = cpuVals.reduce((a, b) => a + b, 0) / cpuVals.length;
    const maxCpu = Math.max(...cpuVals);
    const avgMem = memVals.reduce((a, b) => a + b, 0) / memVals.length;
    const maxMem = Math.max(...memVals);

    console.log(`\n  ${C.cyan}Agent Pod (cohub-agent-dev)${C.reset}`);
    console.log(`    CPU  平均: ${avgCpu.toFixed(1)}m  峰值: ${maxCpu}m  样本数: ${agentSamples.length}`);
    console.log(`    MEM  平均: ${(avgMem / 1024 / 1024).toFixed(1)}Mi  峰值: ${(maxMem / 1024 / 1024).toFixed(1)}Mi`);
  }

  // Sandbox 统计
  const sandboxNames = new Set<string>();
  for (const m of metricsLog) {
    for (const s of m.sandboxes) sandboxNames.add(s.name);
  }

  console.log(`\n  ${C.cyan}Sandbox Pods (cohub-sessions-dev)${C.reset}`);
  console.log(`  监控到 ${sandboxNames.size} 个 sandbox pod`);

  // 只显示我们测试相关的 sandbox
  const testSandboxes = Array.from(sandboxNames).filter((n) => n.includes(TEST_SPACE_ID));
  if (testSandboxes.length > 0) {
    console.log(`\n  ${C.dim}测试相关 Sandbox:${C.reset}`);
    for (const name of testSandboxes) {
      const samples = metricsLog.flatMap((m) =>
        m.sandboxes.filter((s) => s.name === name),
      );
      if (samples.length === 0) continue;
      const cpuVals = samples.map((s) => Number.parseInt(s.cpu));
      const memVals = samples.map((s) => parseMemBytes(s.mem));
      const maxCpu = Math.max(...cpuVals);
      const maxMem = Math.max(...memVals);
      console.log(`    ${name}`);
      console.log(`      CPU 峰值: ${maxCpu}m  MEM 峰值: ${(maxMem / 1024 / 1024).toFixed(1)}Mi`);
    }
  }

  // 所有 sandbox 峰值排序
  const allSandboxPeakCpu = new Map<string, number>();
  const allSandboxPeakMem = new Map<string, number>();
  for (const m of metricsLog) {
    for (const s of m.sandboxes) {
      const cpu = Number.parseInt(s.cpu);
      const mem = parseMemBytes(s.mem);
      allSandboxPeakCpu.set(s.name, Math.max(allSandboxPeakCpu.get(s.name) ?? 0, cpu));
      allSandboxPeakMem.set(s.name, Math.max(allSandboxPeakMem.get(s.name) ?? 0, mem));
    }
  }

  console.log(`\n  ${C.dim}所有 Sandbox 峰值排名 (按 CPU):${C.reset}`);
  const sortedByCpu = Array.from(allSandboxPeakCpu.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10);
  for (const [name, cpu] of sortedByCpu) {
    const mem = allSandboxPeakMem.get(name) ?? 0;
    console.log(`    ${name.padEnd(55)} CPU: ${cpu}m  MEM: ${(mem / 1024 / 1024).toFixed(1)}Mi`);
  }

  // 时间序列可视化
  console.log(`\n  ${C.dim}Agent CPU 时间线 (${agentSamples.length} 个采样点):${C.reset}`);
  const maxAgentCpu = Math.max(...agentSamples.map((m) => Number.parseInt(m.agent.cpu)), 1);
  const barWidth = 50;
  for (const m of agentSamples) {
    const cpu = Number.parseInt(m.agent.cpu);
    const bar = "█".repeat(Math.round((cpu / maxAgentCpu) * barWidth)) || "░";
    const ts = new Date(m.ts).toISOString().slice(11, 19);
    console.log(`    ${ts} │${bar} ${cpu}m`);
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
  if (!resp.ok) throw new Error(`HTTP ${resp.status} ${path}\n  ${typeof body === "string" ? body : JSON.stringify(body, null, 2)}`);
  return body;
}

async function createSession(title: string): Promise<string> {
  const body = await api(`/api/spaces/${TEST_SPACE_ID}/sessions`, {
    method: "POST",
    body: JSON.stringify({ title }),
  }) as { session: { id: string } };
  return body.session.id;
}

async function sendMessage(sessionId: string, text: string): Promise<{ ok: boolean; userMessageId: string }> {
  return api(`/api/sessions/${sessionId}/messages`, {
    method: "POST",
    body: JSON.stringify({ content: [{ type: "text" as const, text }] }),
  }) as Promise<{ ok: boolean; userMessageId: string }>;
}

async function waitForAssistantReply(
  sessionId: string,
  timeoutMs = 180_000,
  intervalMs = 2000,
): Promise<Array<{ id: string; role: string; text: string | null; createdAt?: string }>> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const data = await api(`/api/sessions/${sessionId}/messages`) as {
      messages: Array<{ id: string; role: string; text: string | null; createdAt?: string }>;
    };
    const assistantMsgs = data.messages.filter((m) => m.role === "assistant" && m.text?.trim());
    if (assistantMsgs.length > 0) return data.messages;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error(`Timeout waiting for assistant reply on session ${sessionId}`);
}

// ── 主测试 ────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`${C.white}Cohub Dev 真实并发验证 & K8s 资源监控${C.reset}`);
  console.log(`${C.dim}API: ${API_ORIGIN}${C.reset}`);
  console.log(`${C.dim}Space: ${TEST_SPACE_ID}${C.reset}`);
  console.log(`${C.dim}时间: ${new Date().toISOString()}${C.reset}`);

  // 启动 K8s 监控
  startK8sMonitoring(1500);

  // ── 实验 1: 时间戳并发验证 ─────────────────────────────────────────────────

  section("实验 1: 时间戳并发验证 (是否真正并行)");

  console.log(`\n${C.dim}原理: 同时给 N 个独立 session 发消息，比较 agent 开始处理的时间戳。${C.reset}`);
  console.log(`${C.dim}如果真正并行，多个 session 的 assistant 第一条消息的 createdAt 应该非常接近 (≤2s)。${C.reset}`);
  console.log(`${C.dim}如果被串行，会呈现明显的阶梯状时间差。${C.reset}\n`);

  const parallelCount = 5;
  const parallelSessionIds: string[] = [];

  // 预先创建 sessions
  for (let i = 0; i < parallelCount; i++) {
    const sid = await createSession(`parallel-verify-${i}`);
    parallelSessionIds.push(sid);
  }
  console.log(`${C.dim}创建了 ${parallelCount} 个 sessions${C.reset}`);

  // 同时发送消息 (记录发送时间戳)
  const sendTimestamps = Date.now();
  const sendResults = await Promise.all(
    parallelSessionIds.map((sid, i) =>
      sendMessage(sid, `Parallel test #${i}. Reply with exactly: "PARALLEL-${i}"`),
    ),
  );
  const sendElapsed = Date.now() - sendTimestamps;
  console.log(`${C.dim}5 路消息发送完成 (耗时 ${sendElapsed}ms)${C.reset}`);

  // 分别等待每个 session 的回复，并记录第一个 assistant 消息的时间
  const replyTimestamps: Array<{ sessionIndex: number; firstAssistantAt: string; firstAssistantId: string; totalMessages: number }> = [];

  const waitResults = await Promise.allSettled(
    parallelSessionIds.map(async (sid, i) => {
      const messages = await waitForAssistantReply(sid, 180_000, 2000);
      const assistantMsgs = messages.filter((m) => m.role === "assistant" && m.text?.trim());
      const first = assistantMsgs[0];
      return {
        sessionIndex: i,
        firstAssistantAt: first?.createdAt ?? "unknown",
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

    // 判断是否并行
    const gaps: number[] = [];
    for (let i = 1; i < timestamps.length; i++) {
      gaps.push((timestamps[i]?.ts ?? 0) - (timestamps[i - 1]?.ts ?? 0));
    }
    const avgGap = gaps.reduce((a, b) => a + b, 0) / gaps.length;
    const maxGap = Math.max(...gaps);

    console.log(`    相邻回复间隔: ${gaps.map((g) => `${g}ms`).join(", ")}`);
    console.log(`    平均间隔: ${avgGap.toFixed(0)}ms, 最大间隔: ${maxGap}ms`);

    if (spreadMs < 3000) {
      console.log(`    ${PASS} ${C.green}真正并行 — 所有回复在 ${spreadMs}ms 内完成${C.reset}`);
    } else if (spreadMs < 10000) {
      console.log(`    ${WARN} ${C.yellow}部分并行 — 时间跨度 ${spreadMs}ms，可能有排队${C.reset}`);
    } else {
      console.log(`    ${FAIL} ${C.red}疑似串行 — 时间跨度 ${spreadMs}ms，间隔明显${C.reset}`);
    }

    // 判断 agent 处理模式
    if (maxGap < 5000) {
      console.log(`    推断: Agent 使用 ${parallelCount === 1 ? "单线程" : "多线程/多实例"} 处理并发请求`);
    } else {
      console.log(`    推断: Agent 可能存在 ${maxGap > 10000 ? "串行队列" : "资源瓶颈"}`);
    }
  }

  // ── 实验 2: 高并发压力测试 ─────────────────────────────────────────────────

  section("实验 2: 高并发压力测试 (10 路并发)");

  const stressCount = 10;
  const stressSessionIds: string[] = [];

  // 预创建
  for (let i = 0; i < stressCount; i++) {
    const sid = await createSession(`stress-test-${i}`);
    stressSessionIds.push(sid);
  }

  // 记录开始时间
  const stressStart = Date.now();

  // 同时发送
  console.log(`${C.dim}同时发送 ${stressCount} 条消息...${C.reset}`);
  await Promise.all(
    stressSessionIds.map((sid, i) =>
      sendMessage(sid, `Stress test #${i}. Count from 1 to 3 and say "STRESS-DONE-${i}".`),
    ),
  );
  console.log(`${C.dim}全部消息已发送，等待所有回复...${C.reset}`);

  // 同时等待
  const t0 = Date.now();
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

  console.log(`\n  ${C.cyan}10 路并发结果:${C.reset}`);
  const stressSucceeded = stressResults.filter((r) => r.status === "fulfilled") as PromiseFulfilledResult<{ index: number; elapsed: number; assistantCount: number; totalMessages: number }>[];
  const stressFailed = stressResults.filter((r) => r.status === "rejected");

  console.log(`    总耗时: ${stressTotalElapsed}ms`);
  console.log(`    成功: ${stressSucceeded.length}/${stressCount}, 失败: ${stressFailed.length}`);

  if (stressSucceeded.length > 0) {
    const elapseds = stressSucceeded.map((r) => r.value.elapsed);
    const minElapsed = Math.min(...elapseds);
    const maxElapsed = Math.max(...elapseds);
    const avgElapsed = elapseds.reduce((a, b) => a + b, 0) / elapseds.length;

    console.log(`    单 session 回复时间: 最快=${minElapsed}ms, 最慢=${maxElapsed}ms, 平均=${avgElapsed.toFixed(0)}ms`);

    // 如果总耗时远小于各 session 耗时之和 → 并行
    const sumElapsed = elapseds.reduce((a, b) => a + b, 0);
    const parallelismRatio = sumElapsed / stressTotalElapsed;
    console.log(`    并行度估算: ${parallelismRatio.toFixed(1)}x (理论最大值=${stressCount}x)`);

    if (parallelismRatio > stressCount * 0.5) {
      console.log(`    ${PASS} 高并发并行度良好 (${parallelismRatio.toFixed(1)}x / ${stressCount}x)`);
    } else if (parallelismRatio > 2) {
      console.log(`    ${WARN} 存在一定并行度 (${parallelismRatio.toFixed(1)}x / ${stressCount}x)`);
    } else {
      console.log(`    ${FAIL} 并行度较低 (${parallelismRatio.toFixed(1)}x / ${stressCount}x)，可能接近串行`);
    }
  }

  // ── 实验 3: 单 Session 并发干扰 ────────────────────────────────────────────

  section("实验 3: 单 Session 并发干扰测试");

  console.log(`${C.dim}原理: 对一个 session 快速连续发消息，观察 agent 是否支持 steer (中断当前流处理新消息)${C.reset}`);

  const interruptSessionId = await createSession("interrupt-test");
  await sendMessage(interruptSessionId, "Start counting from 1 to 100 slowly, saying each number.");
  console.log(`${C.dim}发送了长任务消息，等待 3 秒后发送中断消息...${C.reset}`);
  await new Promise((r) => setTimeout(r, 3000));

  const interruptStart = Date.now();
  await sendMessage(interruptSessionId, "STOP! Reply immediately with 'INTERRUPTED'.");
  console.log(`${C.dim}中断消息已发送${C.reset}`);

  const interruptMessages = await waitForAssistantReply(interruptSessionId, 60_000, 1000);
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
    console.log(`    ${PASS} Agent 支持 steer/中断机制`);
  } else {
    console.log(`    ${WARN} Agent 可能不支持 steer，或消息未被及时处理`);
  }

  // ── 停止监控 & 输出报告 ────────────────────────────────────────────────────

  stopK8sMonitoring();
  printK8sReport();

  // ── 最终汇总 ────────────────────────────────────────────────────────────────

  section("汇总");

  const testDuration = metricsLog.length > 0
    ? (metricsLog[metricsLog.length - 1]?.ts ?? 0) - (metricsLog[0]?.ts ?? 0)
    : 0;

  console.log(`  测试总时长: ${(testDuration / 1000).toFixed(0)}s`);
  console.log(`  K8s 采样次数: ${metricsLog.length}`);
  console.log("  实验 1 (时间戳并发): 已完成");
  console.log("  实验 2 (10 路并发): 已完成");
  console.log("  实验 3 (中断测试): 已完成");
  console.log("");
}

main().catch((err) => {
  console.error(`\n${FAIL} 脚本执行失败:`, err);
  stopK8sMonitoring();
  process.exit(1);
});
