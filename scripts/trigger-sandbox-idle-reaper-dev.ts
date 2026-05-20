#!/usr/bin/env tsx
import { execFileSync } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";

type CliOptions = {
  kubeconfig: string;
  apiNamespace: string;
  apiLabel: string;
  limit: number;
  dryRun: boolean;
  timeoutMs: number;
};

type PodItem = {
  metadata?: { name?: string; creationTimestamp?: string };
  status?: { phase?: string };
};

const parseArgs = (argv: string[]) => {
  const options: CliOptions = {
    kubeconfig: process.env.KUBECONFIG || "~/.kube/config_us",
    apiNamespace: process.env.COHUB_API_NAMESPACE || "cohub-dev",
    apiLabel: process.env.COHUB_API_LABEL || "app.kubernetes.io/name=cohub-api-dev",
    limit: Number.parseInt(process.env.COHUB_SANDBOX_IDLE_REAPER_LIMIT ?? "100000", 10) || 100000,
    dryRun: false,
    timeoutMs: Number.parseInt(process.env.COHUB_SANDBOX_IDLE_REAPER_TIMEOUT_MS ?? "1200000", 10) || 1_200_000,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];

    if (arg === "--kubeconfig" && next) {
      options.kubeconfig = next;
      index += 1;
      continue;
    }
    if (arg === "--namespace" && next) {
      options.apiNamespace = next;
      index += 1;
      continue;
    }
    if (arg === "--label" && next) {
      options.apiLabel = next;
      index += 1;
      continue;
    }
    if (arg === "--limit" && next) {
      options.limit = Math.max(1, Number.parseInt(next, 10) || options.limit);
      index += 1;
      continue;
    }
    if (arg === "--timeout-ms" && next) {
      options.timeoutMs = Math.max(30_000, Number.parseInt(next, 10) || options.timeoutMs);
      index += 1;
      continue;
    }
    if (arg === "--dry-run") {
      options.dryRun = true;
    }
  }

  return options;
};

const expandPath = (path: string) => (path === "~" ? homedir() : path.startsWith("~/") ? join(homedir(), path.slice(2)) : path);

const options = parseArgs(process.argv.slice(2));
options.kubeconfig = expandPath(options.kubeconfig);

const runKubectl = (args: string[]) =>
  execFileSync(
    "kubectl",
    [...(options.kubeconfig ? ["--kubeconfig", options.kubeconfig] : []), ...args],
    { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] },
  ).trim();

const apiPods = JSON.parse(
  runKubectl([
    "-n",
    options.apiNamespace,
    "get",
    "pods",
    "-l",
    options.apiLabel,
    "-o",
    "json",
  ]),
) as { items?: PodItem[] };

const apiPod = [...(apiPods.items ?? [])]
  .sort((left, right) => {
    const leftRunning = left.status?.phase === "Running" ? 1 : 0;
    const rightRunning = right.status?.phase === "Running" ? 1 : 0;
    if (leftRunning !== rightRunning) return rightRunning - leftRunning;
    const leftTime = Date.parse(left.metadata?.creationTimestamp ?? "") || 0;
    const rightTime = Date.parse(right.metadata?.creationTimestamp ?? "") || 0;
    return rightTime - leftTime;
  })[0]?.metadata?.name;

if (!apiPod) {
  throw new Error(`No API pod found in namespace ${options.apiNamespace} with label ${options.apiLabel}`);
}

const remoteScript = [
  'import { drizzle } from "drizzle-orm/postgres-js";',
  'import { asc, eq, inArray } from "drizzle-orm";',
  'import postgres from "postgres";',
  'import Redis from "ioredis";',
  'import { config } from "/app/dist/config.js";',
  'import { createSandboxLifecycleController, getIdleBaseAt, getSpaceSandboxAutoDestroyDeadline, isSandboxUsableStatus, resolveSpaceSandboxAutoDestroyPolicy } from "@cohub/sandbox-controller";',
  'import { spaceSandboxes, spaces } from "@cohub/db";',
  'import * as schema from "@cohub/db";',
  `const limit = ${JSON.stringify(options.limit)};`,
  `const dryRun = ${JSON.stringify(options.dryRun)};`,
  `const timeoutMs = ${JSON.stringify(options.timeoutMs)};`,
  'const sessionsNamespace = config.env === "dev" ? "cohub-sessions-dev" : "cohub-sessions";',
  'const dbClient = postgres(process.env.DATABASE_URL, { prepare: false });',
  'const db = drizzle(dbClient, { schema });',
  'const redisCommandClient = dryRun ? null : new Redis(process.env.REDIS_URL);',
  'const getK8sCoreApi = async () => {',
  '  const { CoreV1Api, KubeConfig } = await import("@kubernetes/client-node");',
  '  const kubeConfig = new KubeConfig();',
  '  kubeConfig.loadFromDefault();',
  '  return kubeConfig.makeApiClient(CoreV1Api);',
  '};',
  'const getK8sStatusCode = (error) => error?.statusCode ?? error?.code ?? null;',
  'const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));',
  'const withTimeout = async (promise, ms, label) => {',
  '  let timer;',
  '  try {',
  '    return await Promise.race([',
  '      promise,',
  '      new Promise((_, reject) => {',
  '        timer = setTimeout(() => reject(new Error(label + " timed out after " + ms + "ms")), ms);',
  '      }),',
  '    ]);',
  '  } finally {',
  '    if (timer) clearTimeout(timer);',
  '  }',
  '};',
  'const infra = {',
  '  async deletePod(input) {',
  '    const api = await getK8sCoreApi();',
  '    await api.deleteNamespacedPod({ name: input.podName, namespace: sessionsNamespace }).catch((error) => {',
  '      if (getK8sStatusCode(error) !== 404) throw error;',
  '    });',
  '  },',
  '  async waitForPodDeleted(input) {',
  '    const api = await getK8sCoreApi();',
  '    const timeout = input.timeoutMs ?? 120_000;',
  '    const startedAt = Date.now();',
  '    while (Date.now() - startedAt < timeout) {',
  '      try {',
  '        await api.readNamespacedPod({ name: input.podName, namespace: sessionsNamespace });',
  '        await sleep(1000);',
  '      } catch (error) {',
  '        if (getK8sStatusCode(error) === 404) return true;',
  '        throw error;',
  '      }',
  '    }',
  '    return false;',
  '  },',
  '  async resumeSandbox() {',
  '    throw new Error("manual trigger does not resume sandboxes");',
  '  },',
  '};',
  'const loadCandidates = async () => {',
  '  return await db',
  '    .select({',
  '      spaceId: spaceSandboxes.spaceId,',
  '      status: spaceSandboxes.status,',
  '      lastActivityAt: spaceSandboxes.lastActivityAt,',
  '      lastHeartbeatAt: spaceSandboxes.lastHeartbeatAt,',
  '      createdAt: spaceSandboxes.createdAt,',
  '      sandboxMeta: spaceSandboxes.meta,',
  '      spaceMeta: spaces.meta,',
  '      podName: spaceSandboxes.podName,',
  '    })',
  '    .from(spaceSandboxes)',
  '    .innerJoin(spaces, eq(spaceSandboxes.spaceId, spaces.id))',
  '    .where(inArray(spaceSandboxes.status, ["ready", "running"]))',
  '    .orderBy(asc(spaceSandboxes.lastActivityAt), asc(spaceSandboxes.createdAt))',
  '    .limit(limit);',
  '};',
  '(async () => {',
  '  try {',
  '    if (dryRun) {',
  '      const candidates = await loadCandidates();',
  '      const now = new Date();',
  '      const due = [];',
  '      const skippedByReason = {};',
  '      for (const candidate of candidates) {',
  '        const policy = resolveSpaceSandboxAutoDestroyPolicy(candidate.spaceMeta);',
  '        if (policy.mode === "never") {',
  '          skippedByReason.never = (skippedByReason.never ?? 0) + 1;',
  '          continue;',
  '        }',
  '        if (!isSandboxUsableStatus(candidate.status)) {',
  '          skippedByReason.not_usable = (skippedByReason.not_usable ?? 0) + 1;',
  '          continue;',
  '        }',
  '        const baseAt = getIdleBaseAt(candidate);',
  '        if (!baseAt) {',
  '          skippedByReason.no_base_time = (skippedByReason.no_base_time ?? 0) + 1;',
  '          continue;',
  '        }',
  '        const dueAt = getSpaceSandboxAutoDestroyDeadline(baseAt, policy);',
  '        if (!dueAt || now.getTime() < dueAt.getTime()) {',
  '          skippedByReason.not_due = (skippedByReason.not_due ?? 0) + 1;',
  '          continue;',
  '        }',
  '        due.push({ spaceId: candidate.spaceId, podName: candidate.podName, dueAt: dueAt.toISOString() });',
  '      }',
  '      console.log(JSON.stringify({',
  '        phase: "dry-run",',
  '        env: config.env,',
  '        scanned: candidates.length,',
  '        wouldDestroyCount: due.length,',
  '        skippedCount: candidates.length - due.length,',
  '        skippedByReason,',
  '        sampleDue: due.slice(0, 20),',
  '        limit,',
  '      }));',
  '      await dbClient.end({ timeout: 5 }).catch(() => undefined);',
  '      if (redisCommandClient) await redisCommandClient.quit().catch(() => undefined);',
  '      process.exit(0);',
  '    }',
  '    const sandboxLifecycle = createSandboxLifecycleController({',
  '      db,',
  '      redis: redisCommandClient,',
  '      infra,',
  '    });',
  '    const before = await db',
  '      .select({ spaceId: spaceSandboxes.spaceId })',
  '      .from(spaceSandboxes)',
  '      .where(inArray(spaceSandboxes.status, ["ready", "running"]));',
  '    console.log(JSON.stringify({ phase: "before", env: config.env, candidateCount: before.length, limit }));',
  '    const result = await withTimeout(sandboxLifecycle.reapIdleSandboxes({ limit }), timeoutMs, "sandbox idle reaper");',
  '    const after = await db',
  '      .select({ spaceId: spaceSandboxes.spaceId })',
  '      .from(spaceSandboxes)',
  '      .where(inArray(spaceSandboxes.status, ["ready", "running"]));',
  '    console.log(JSON.stringify({ phase: "after", remainingCount: after.length }));',
  '    console.log(JSON.stringify({ phase: "summary", ...result }));',
  '    if (redisCommandClient) await redisCommandClient.quit().catch(() => undefined);',
  '    await dbClient.end({ timeout: 5 }).catch(() => undefined);',
  '    process.exit(result.failed.length > 0 ? 1 : 0);',
  '  } catch (error) {',
  '    console.error(error);',
  '    if (redisCommandClient) await redisCommandClient.quit().catch(() => undefined);',
  '    await dbClient.end({ timeout: 5 }).catch(() => undefined);',
  '    process.exit(1);',
  '  }',
  '})();',
].join("\n");

const shellCommand = `kubectl --kubeconfig ${JSON.stringify(options.kubeconfig)} exec -n ${options.apiNamespace} ${apiPod} -- sh -lc 'cd /app && node --input-type=module <<"EOF"
${remoteScript}
EOF'`;

try {
  console.log(`Using API pod: ${apiPod}`);
  console.log(`Reaper options: namespace=${options.apiNamespace} limit=${options.limit} dryRun=${options.dryRun}`);
  const output = execFileSync("bash", ["-lc", shellCommand], { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] }).trim();
  const lines = output.split("\n").map((line) => line.trim()).filter(Boolean);
  const summaryLine = [...lines].reverse().find((line) => line.includes('"phase":"summary"') || line.includes('"phase":"dry-run"'));
  if (summaryLine) {
    console.log("---");
    console.log(summaryLine);
  }
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Idle reaper trigger failed: ${message}`);
  process.exit(1);
}
