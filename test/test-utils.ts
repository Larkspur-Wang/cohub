#!/usr/bin/env tsx
/**
 * Cohub 测试共享工具模块
 *
 * 提供所有 E2E / 压力测试脚本的公共功能:
 * - 配置加载 (TOKEN, API_ORIGIN, K8s 等)
 * - HTTP API 辅助
 * - 测试运行器 (run / ok / fail / warn)
 * - K8s 动态 Pod 发现 & 监控
 * - 健康监控 (字段名与 healthz 实际返回对齐)
 * - WebSocket 辅助
 * - 限流器 / 批量执行
 */

import "dotenv/config";

// ── 配置 ──────────────────────────────────────────────────────────────────────

export const config = {
  token: process.env.COHUB_TOKEN ?? process.env.TOKEN ?? "",
  apiOrigin: process.env.COHUB_API_ORIGIN ?? "https://api-dev.cohub.run",
  gatewayOrigin: process.env.COHUB_GATEWAY_ORIGIN ?? "",
  gatewayWs: process.env.COHUB_GATEWAY_WS ?? "",
  testSpaceId: process.env.TEST_SPACE_ID ?? "",
  kubeconfig: process.env.KUBECONFIG ?? "/Users/tzwm/.kube/config_us",
  namespace: process.env.K8S_NAMESPACE ?? "cohub-dev",
  sessionsNamespace: process.env.K8S_SESSIONS_NAMESPACE ?? "cohub-sessions-dev",
  skipWsTest: process.env.SKIP_WS_TEST === "1",
  skipAgentTest: process.env.SKIP_AGENT_TEST === "1",
};

// 自动推导 gateway 地址
if (!config.gatewayOrigin) {
  config.gatewayOrigin = config.apiOrigin.replace("api-dev", "gateway-dev");
}
if (!config.gatewayWs) {
  config.gatewayWs = `${config.gatewayOrigin.replace("https://", "wss://")}/ws`;
}

export function assertConfig() {
  if (!config.token) {
    console.error("❌ 错误: 请设置 COHUB_TOKEN 或 TOKEN 环境变量 (也可放在 .env 文件中)");
    process.exit(1);
  }
}

// ── 超时常量 ──────────────────────────────────────────────────────────────────

export const TIMEOUTS = {
  ASSISTANT_REPLY: 120_000,
  AGENT_REPLY_HEAVY: 180_000,
  WS_CONNECT: 10_000,
  WS_MESSAGE: 15_000,
  WS_AGENT_REPLY: 120_000,
  BURST_REPLY: 300_000,
};

// ── 配色 ──────────────────────────────────────────────────────────────────────

export const C = {
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

export const PASS = `${C.green}✅ PASS${C.reset}`;
export const FAIL = `${C.red}❌ FAIL${C.reset}`;
export const WARN = `${C.yellow}⚠️ WARN${C.reset}`;
export const STEP = `${C.blue}▶${C.reset}`;
export const SEC = `${C.magenta}━━━${C.reset}`;

export function section(title: string) {
  console.log(`\n${SEC} ${C.white}${title}${C.reset} ${SEC}`);
}

export function step(name: string) {
  console.log(`  ${STEP} ${name}`);
}

// ── API 辅助 ──────────────────────────────────────────────────────────────────

export async function api(path: string, init?: RequestInit, apiOrigin?: string): Promise<unknown> {
  const origin = apiOrigin ?? config.apiOrigin;
  const headers = new Headers(init?.headers);
  headers.set("Authorization", `Bearer ${config.token}`);
  if (!headers.has("Content-Type") && init?.body) {
    headers.set("Content-Type", "application/json");
  }

  const url = path.startsWith("http") ? path : `${origin}${path}`;
  const resp = await fetch(url, { ...init, headers });
  const text = await resp.text();
  let body: unknown = null;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }

  if (!resp.ok) {
    const detail = typeof body === "string" ? body.slice(0, 500) : JSON.stringify(body).slice(0, 500);
    throw new Error(`HTTP ${resp.status} ${path}\n  Response: ${detail}`);
  }
  return body;
}

export async function createSession(spaceId: string, title: string): Promise<string> {
  const body = await api(`/api/spaces/${spaceId}/sessions`, {
    method: "POST",
    body: JSON.stringify({ title }),
  }) as { session: { id: string } };
  return body.session.id;
}

export async function sendMessage(sessionId: string, text: string): Promise<{ ok: boolean; userMessageId: string }> {
  return api(`/api/sessions/${sessionId}/messages`, {
    method: "POST",
    body: JSON.stringify({ content: [{ type: "text" as const, text }] }),
  }) as Promise<{ ok: boolean; userMessageId: string }>;
}

/**
 * 通过 HTTP 发消息后，轮询消息列表直到出现 assistant 回复
 * 对 transient 404 有容忍度（可能因为 session 刚创建还未同步）
 */
export async function waitForAssistantReply(
  sessionId: string,
  options?: {
    timeoutMs?: number;
    intervalMs?: number;
    max404Retries?: number;
    apiOrigin?: string;
  },
): Promise<Array<{ id: string; role: string; text: string | null }>> {
  const timeoutMs = options?.timeoutMs ?? TIMEOUTS.ASSISTANT_REPLY;
  const intervalMs = options?.intervalMs ?? 3000;
  const max404Retries = options?.max404Retries ?? 5;
  const startedAt = Date.now();
  let consecutive404s = 0;

  while (Date.now() - startedAt < timeoutMs) {
    try {
      const data = await api(
        `/api/sessions/${sessionId}/messages`,
        undefined,
        options?.apiOrigin,
      ) as {
        messages: Array<{ id: string; role: string; text: string | null }>;
      };
      consecutive404s = 0;

      const assistantMsgs = data.messages.filter(
        (m) => m.role === "assistant" && m.text && m.text.trim().length > 0,
      );

      if (assistantMsgs.length > 0) {
        return data.messages;
      }
    } catch (err) {
      if (err instanceof Error && err.message.includes("HTTP 404")) {
        consecutive404s++;
        if (consecutive404s >= max404Retries) {
          throw new Error(`Session messages endpoint returned 404 for ${consecutive404s} consecutive retries (sessionId=${sessionId})`);
        }
        console.log(`      ${C.dim}  轮询消息列表遇到 404 (第 ${consecutive404s}/${max404Retries} 次)，继续重试...${C.reset}`);
      } else {
        throw err;
      }
    }

    await new Promise((r) => setTimeout(r, intervalMs));
  }

  throw new Error(`Waiting for assistant reply timed out (${timeoutMs}ms)`);
}

// ── 测试运行器 ────────────────────────────────────────────────────────────────

export type TestResult = { name: string; status: "pass" | "fail" | "warn"; detail?: string; duration?: number };

export function createTestRunner() {
  const results: TestResult[] = [];

  function ok(name: string, detail?: string, duration?: number) {
    results.push({ name, status: "pass", detail, duration });
    const durStr = duration ? ` ${C.dim}(${duration}ms)${C.reset}` : "";
    console.log(`    ${PASS} ${name}${detail ? ` ${C.dim}${detail}${C.reset}` : ""}${durStr}`);
  }

  function fail(name: string, detail?: string, duration?: number) {
    if (results.length && results[results.length - 1].name === name) {
      results[results.length - 1] = { name, status: "fail", detail, duration };
    } else {
      results.push({ name, status: "fail", detail, duration });
    }
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

  function summary() {
    const passCount = results.filter((r) => r.status === "pass").length;
    const failCount = results.filter((r) => r.status === "fail").length;
    const warnCount = results.filter((r) => r.status === "warn").length;
    const totalCount = results.length;

    section("汇总报告");
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
    return { passCount, failCount, warnCount, totalCount, results };
  }

  return { results, ok, fail, warn, run, summary };
}

// ── WebSocket 辅助 ────────────────────────────────────────────────────────────

/**
 * 通过 WebSocket 发送消息并等待 agent 实时事件
 */
export async function wsSendAndWaitForAgentReply(
  params: {
    spaceId: string;
    sessionId: string;
    text: string;
  },
  options?: {
    timeoutMs?: number;
  },
): Promise<{
  accepted: boolean;
  agentEvents: Array<{ type: string; payload: Record<string, unknown> }>;
  connectionId: string;
}> {
  const timeoutMs = options?.timeoutMs ?? TIMEOUTS.WS_AGENT_REPLY;
  const ws = new WebSocket(config.gatewayWs);
  const agentEvents: Array<{ type: string; payload: Record<string, unknown> }> = [];
  let connectionId = "";
  let authOk = false;
  let accepted = false;

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      ws.close(1000, "timeout");
      resolve({ accepted, agentEvents, connectionId });
    }, timeoutMs);

    ws.onopen = () => {
      ws.send(JSON.stringify({
        type: "auth",
        requestId: "e2e-ws-agent",
        payload: { token: config.token },
      }));
    };

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
          type: "message.create",
          requestId: "e2e-ws-agent-msg",
          payload: {
            spaceId: params.spaceId,
            sessionId: params.sessionId,
            text: params.text,
          },
        }));
      }

      if (authOk && msg.type === "message.accepted") {
        accepted = true;
      }

      if (authOk && msg.type === "event" && msg.payload) {
        agentEvents.push({ type: msg.type, payload: msg.payload });
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
}

/** 统计事件类型分布，用于格式化输出 */
export function summarizeEvents(
  events: Array<{ type: string; payload?: Record<string, unknown> }>,
): string {
  const counts = new Map<string, number>();
  for (const e of events) {
    const type = String(e.payload?.eventType ?? e.type);
    counts.set(type, (counts.get(type) ?? 0) + 1);
  }
  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([t, c]) => `${t}(${c})`)
    .join(", ");
}

// ── 限流器 ────────────────────────────────────────────────────────────────────

/**
 * 分批执行 Promise.allSettled，避免瞬间打满
 * 返回 R | null 数组 (rejected 的项为 null)
 */
export async function batchedAll<T, R>(
  items: T[],
  fn: (item: T, index: number) => Promise<R>,
  batchSize = 10,
): Promise<Array<R | null>> {
  const results: Array<R | null> = [];
  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize);
    const batchResults = await Promise.allSettled(batch.map((item, j) => fn(item, i + j)));
    results.push(...batchResults.map((r) => (r.status === "fulfilled" ? r.value : null)));
  }
  return results;
}

// ── K8s 动态 Pod 发现 ────────────────────────────────────────────────────────

import { exec } from "node:child_process";
import { promisify } from "node:util";

const execAsync = promisify(exec);

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

/** 各服务对应的 K8s label selector
 *
 * Agent 使用 `app=xxx` (自定)，其他使用 `app.kubernetes.io/name=xxx` (Helm 标准)
 */
const SERVICE_LABELS: Record<string, string> = {
  agent: "app=cohub-agent-dev",
  api: "app.kubernetes.io/name=cohub-api-dev",
  gateway: "app.kubernetes.io/name=cohub-gateway-dev",
  worker: "app.kubernetes.io/name=cohub-worker-dev",
};

/** 从 K8s pod name 中标准化为服务名 (e.g. cohub-agent-dev-97bc74c78-gs52h → agent) */
function normalizePodName(podName: string): string {
  for (const [svc, label] of Object.entries(SERVICE_LABELS)) {
    const labelValue = label.split("=")[1];
    if (podName.startsWith(labelValue)) return svc;
  }
  return podName;
}

/** 采集 pod 指标 (使用 label selector) */
async function collectPodMetricsByLabel(label: string, namespace: string): Promise<PodMetrics[]> {
  try {
    const { stdout } = await execAsync(
      `KUBECONFIG=${config.kubeconfig} kubectl top pods -n ${namespace} -l "${label}" --no-headers 2>/dev/null`,
    );
    const metrics: PodMetrics[] = [];
    for (const line of stdout.trim().split("\n")) {
      if (!line.trim()) continue;
      const parts = line.trim().split(/\s+/);
      const rawName = parts[0] ?? "";
      const cpuStr = parts[1] ?? "0m";
      const memStr = parts[2] ?? "0Mi";

      let cpu = 0;
      if (cpuStr.endsWith("m")) cpu = Number.parseInt(cpuStr);
      else cpu = Math.round(Number.parseFloat(cpuStr) * 1000);

      let mem = 0;
      if (memStr.endsWith("Mi")) mem = Math.round(Number.parseFloat(memStr));
      else if (memStr.endsWith("Gi")) mem = Math.round(Number.parseFloat(memStr) * 1024);
      else if (memStr.endsWith("Ki")) mem = Math.round(Number.parseFloat(memStr) / 1024);
      else mem = Math.round(Number.parseFloat(memStr) / (1024 * 1024));

      metrics.push({ name: rawName, cpu, mem });
    }
    return metrics;
  } catch {
    return [];
  }
}

async function collectAllMetrics(): Promise<PodMetrics[]> {
  const entries = Object.entries(SERVICE_LABELS);
  const allPods = await Promise.all(
    entries.map(([svc, label]) =>
      collectPodMetricsByLabel(label, config.namespace).then((pods) =>
        pods.map((p) => ({ ...p, name: svc })),
      ),
    ),
  );

  // sandbox pods (独立 namespace)
  let sandboxPods: PodMetrics[] = [];
  try {
    const { stdout } = await execAsync(
      `KUBECONFIG=${config.kubeconfig} kubectl top pods -n ${config.sessionsNamespace} --no-headers 2>/dev/null`,
    );
    for (const line of stdout.trim().split("\n")) {
      if (!line.trim()) continue;
      const parts = line.trim().split(/\s+/);
      const name = parts[0] ?? "";
      if (!name.startsWith("sandbox-")) continue;
      const cpuStr = parts[1] ?? "0m";
      const memStr = parts[2] ?? "0Mi";
      let cpu = cpuStr.endsWith("m") ? Number.parseInt(cpuStr) : 0;
      let mem = memStr.endsWith("Mi") ? Math.round(Number.parseFloat(memStr)) : 0;
      sandboxPods.push({ name, cpu, mem });
    }
  } catch { /* ignore */ }

  return [...allPods.flat(), ...sandboxPods];
}

/**
 * 创建 K8s 监控器
 */
export function createK8sMonitor(intervalMs = 1500) {
  const snapshots: MetricsSnapshot[] = [];
  let monitorInterval: ReturnType<typeof setInterval> | null = null;

  function start() {
    console.log(`${C.dim}📊 K8s 监控已启动 (每 ${intervalMs}ms 采样)...${C.reset}`);
    const collect = async () => {
      const pods = await collectAllMetrics();
      snapshots.push({ ts: Date.now(), tsStr: new Date().toISOString(), pods });
    };
    void collect();
    monitorInterval = setInterval(collect, intervalMs);
  }

  function stop() {
    if (monitorInterval) clearInterval(monitorInterval);
    monitorInterval = null;
  }

  function printReport() {
    if (snapshots.length < 2) {
      console.log(`${C.yellow}⚠️ K8s 采样数据不足 (${snapshots.length} 次)，跳过报告${C.reset}`);
      return;
    }

    section("📊 K8s 资源监控报告");

    const podNames = ["agent", "api", "gateway", "worker"];
    // K8s resource limits (dev 环境实际配置)
    const limits: Record<string, { cpu: number; mem: number }> = {
      agent: { cpu: 1000, mem: 1024 },
      api: { cpu: 500, mem: 512 },
      gateway: { cpu: 500, mem: 512 },
      worker: { cpu: 500, mem: 512 },
    };

    for (const podName of podNames) {
      const samples = snapshots.flatMap((s) => s.pods.filter((p) => p.name === podName));
      if (samples.length === 0) {
        console.log(`\n  ${C.cyan}${podName.toUpperCase()} Pod${C.reset} — ${C.yellow}未采集到数据 (可能 pod label 不匹配)${C.reset}`);
        continue;
      }

      const cpuVals = samples.map((s) => s.cpu);
      const memVals = samples.map((s) => s.mem);
      const avgCpu = cpuVals.reduce((a, b) => a + b, 0) / cpuVals.length;
      const maxCpu = Math.max(...cpuVals);
      const avgMem = memVals.reduce((a, b) => a + b, 0) / memVals.length;
      const maxMem = Math.max(...memVals);

      const lim = limits[podName] ?? { cpu: 1000, mem: 1024 };
      const cpuUtil = ((maxCpu / lim.cpu) * 100).toFixed(1);
      const memUtil = ((maxMem / lim.mem) * 100).toFixed(1);

      console.log(`\n  ${C.cyan}${podName.toUpperCase()} Pod${C.reset} (Limit: CPU=${lim.cpu}m, MEM=${lim.mem}Mi)`);
      console.log(`    CPU  平均: ${avgCpu.toFixed(1)}m  峰值: ${maxCpu}m  利用率: ${cpuUtil}%`);
      console.log(`    MEM  平均: ${avgMem.toFixed(0)}Mi  峰值: ${maxMem}Mi  利用率: ${memUtil}%`);
    }

    // Sandbox 统计
    const sandboxSamples = snapshots.flatMap((s) => s.pods.filter((p) => p.name.startsWith("sandbox-")));
    if (sandboxSamples.length > 0) {
      const sandboxNames = new Set(sandboxSamples.map((s) => s.name));
      console.log(`\n  ${C.cyan}SANDBOX Pods${C.reset} (${sandboxNames.size} 个)`);
      for (const name of [...sandboxNames].slice(0, 5)) {
        const ss = sandboxSamples.filter((s) => s.name === name);
        const maxCpu = Math.max(...ss.map((s) => s.cpu));
        const maxMem = Math.max(...ss.map((s) => s.mem));
        console.log(`    ${name.padEnd(60)} CPU: ${maxCpu}m  MEM: ${maxMem}Mi`);
      }
    }

    // 时间线
    console.log(`\n  ${C.dim}资源时间线 (${snapshots.length} 个采样点):${C.reset}`);
    const barWidth = 40;
    const maxCpu = Math.max(...snapshots.flatMap((s) => s.pods.map((p) => p.cpu)), 1);

    for (const s of snapshots) {
      const ts = new Date(s.ts).toISOString().slice(11, 19);
      const parts: string[] = [];
      for (const pn of podNames) {
        const pod = s.pods.find((p) => p.name === pn);
        if (!pod || pod.cpu === 0) continue;
        const bar = "█".repeat(Math.round((pod.cpu / maxCpu) * barWidth)) || "░";
        parts.push(`${pn} ${bar} ${pod.cpu}m/${pod.mem}Mi`);
      }
      if (parts.length > 0) {
        console.log(`    ${ts} │ ${parts.join(" │ ")}`);
      }
    }
  }

  function getPeak(podName: string): { cpu: number; mem: number } {
    const samples = snapshots.flatMap((s) => s.pods.filter((p) => p.name === podName));
    if (samples.length === 0) return { cpu: 0, mem: 0 };
    return {
      cpu: Math.max(...samples.map((s) => s.cpu)),
      mem: Math.max(...samples.map((s) => s.mem)),
    };
  }

  return { snapshots, start, stop, printReport, getPeak };
}

// ── 健康监控 ──────────────────────────────────────────────────────────────────

/**
 * healthz 返回的队列指标 (字段名与 API 实际返回对齐)
 *
 * 注意:
 * - inboundStreamLength = stream:gateway:inbound 的总长度
 * - inboundPending    = inbound stream consumer group 的待确认消息数
 * - logsStreamLength  = stream:gateway:logs 的总长度 (NOT outbound command queue)
 *
 * 这些是 stream length，不是 pending / lag，不代表消息积压。
 */
interface HealthSnapshot {
  ts: string;
  redisReady: boolean;
  inboundStreamLength: number;
  inboundPending: number;
  logsStreamLength: number;
}

export function createHealthMonitor(intervalMs = 2000) {
  const snapshots: HealthSnapshot[] = [];
  let monitorInterval: ReturnType<typeof setInterval> | null = null;

  function start() {
    snapshots.length = 0;
    monitorInterval = setInterval(async () => {
      try {
        const data = await api("/healthz") as Record<string, unknown>;
        snapshots.push({
          ts: new Date().toISOString(),
          redisReady: data.redisReady === true,
          inboundStreamLength: ((data.inboundInfo as { length?: number } | null)?.length) ?? 0,
          inboundPending: ((data.pendingInbound as { total?: number } | null)?.total) ?? 0,
          logsStreamLength: ((data.outboundInfo as { length?: number } | null)?.length) ?? 0,
        });
      } catch { /* ignore */ }
    }, intervalMs);
  }

  function stop() {
    if (monitorInterval) clearInterval(monitorInterval);
    monitorInterval = null;
  }

  function printReport() {
    if (snapshots.length === 0) return;

    console.log(`\n${C.cyan}📊 健康监控报告 (${snapshots.length} 次采样)${C.reset}`);

    const maxInbound = Math.max(...snapshots.map((s) => s.inboundStreamLength));
    const maxPending = Math.max(...snapshots.map((s) => s.inboundPending));
    const maxLogs = Math.max(...snapshots.map((s) => s.logsStreamLength));

    console.log(`${C.dim}  inbound stream length 峰值: ${maxInbound}${C.reset}`);
    console.log(`${C.dim}  inbound pending 峰值:       ${maxPending}${C.reset}`);
    console.log(`${C.dim}  gateway logs stream 长度:    ${maxLogs}${C.reset}`);
    console.log(`${C.dim}  (注: logs stream 长度不代表消息积压，仅反映日志流当前大小)${C.reset}`);
  }

  return { snapshots, start, stop, printReport };
}

// ── 查找 Ready Sandbox ────────────────────────────────────────────────────────

export async function findReadySpace(): Promise<string | null> {
  const spaces = await api("/api/spaces") as Array<Record<string, unknown>>;
  for (const sp of spaces) {
    if (sp.sandboxStatus === "ready") {
      return sp.id as string;
    }
  }
  return null;
}

// ── 测试资源清理 ──────────────────────────────────────────────────────────────

export async function cleanupTestResources(spaceId: string | null, sessionIds: string[]) {
  if (sessionIds.length === 0 && !spaceId) return;
  console.log(`\n${C.dim}🧹 清理测试资源...${C.reset}`);

  for (const sid of sessionIds) {
    try {
      await api(`/api/sessions/${sid}`, { method: "DELETE" });
    } catch { /* session 可能不支持删除，忽略 */ }
  }

  if (spaceId) {
    try {
      await api(`/api/spaces/${spaceId}`, { method: "DELETE" });
      console.log(`${C.dim}  已清理 space: ${spaceId}${C.reset}`);
    } catch { /* space 可能不支持删除，忽略 */ }
  }
}
