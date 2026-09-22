import { resolveCohubEnvironment } from "@neta-art/cohub";
import type { NativeSyncConfig } from "./native-sync.js";
import type { RuntimeDiagnostic, RuntimeDiagnosticLevel } from "./diagnostics.js";

export const diagnosticLevels: RuntimeDiagnosticLevel[] = ["debug", "info", "warn", "error"];
export const atLeastLevel = (level: RuntimeDiagnosticLevel, minimum: RuntimeDiagnosticLevel) =>
  diagnosticLevels.indexOf(level) >= diagnosticLevels.indexOf(minimum);
export const runtimeWebUrl = (spaceId: string) =>
  `https://${resolveCohubEnvironment() === "prod" ? "" : "dev."}cohub.live/spaces/${spaceId}`;

const messages: Record<string, string> = {
  "runtime.ready": "Harness connected",
  "runtime.available": "Runtime ready",
  "runtime.websocket.closed": "Connection lost; reconnecting",
  "runtime.heartbeat_timeout": "Connection timed out; reconnecting",
  "runtime.auth_token_failed": "Cannot obtain credentials; retrying",
  "runtime.auth_required": "Sign in with cohub auth login",
  "runtime.stopped": "Runtime stopped",
  "runtime.failed": "Runtime needs attention",
  "runtime.turn_failed": "Turn failed; local files retained",
  "runtime.turn_cleanup_pending": "Turn result saved; tool cleanup still unconfirmed",
  "runtime.connection_failed": "Connection attempt failed; retrying",
  "runtime.execution_transport_detached": "Execution continues locally; result replays after reconnect",
  "runtime.execution_transport_invalidated": "Execution interrupted; outcome needs reconciliation",
  "archive.upload_pending": "Archive upload pending; local data retained",
  "native.sync_pending": "Native sync pending; local records retained",
  "archive.capture_pending": "Archive capture pending",
  "archive.capture_unavailable": "Archive unavailable; original receipt retained",
  "archive.restore_failed": "Native restore unavailable; using saved history",
  "sandboxd.process_exit": "File bridge stopped; restarting",
  "sandboxd.download": "Preparing file bridge",
  "sandboxd.connected": "File bridge connected",
  "sandboxd.disconnected": "File bridge disconnected; reconnecting",
};

export function formatDiagnostic(event: RuntimeDiagnostic, verbose = false): string {
  const text = messages[event.event] ?? (typeof event.data?.message === "string" ? event.data.message : event.event);
  const detail = event.error?.message ? ` — ${event.error.message}` : "";
  const context = verbose ? ` ${JSON.stringify({ ...event.data, runtimeId: event.runtimeId, sessionId: event.sessionId, turnId: event.turnId })}` : "";
  return `${event.timestamp.slice(11, 19)} ${event.level.toUpperCase().padEnd(5)} ${text}${detail}${context}\n`;
}

/** File logs retain every event; repeated terminal warnings are coalesced. */
export function createDiagnosticConsole(verbose = false, write = (line: string) => process.stderr.write(line)) {
  const last = new Map<string, { at: number; suppressed: number }>();
  return (event: RuntimeDiagnostic) => {
    if (!verbose && (event.level === "debug" || !atLeastLevel(event.level, "warn") && !messages[event.event])) return;
    const key = `${event.component}:${event.event}:${event.level}:${event.error?.message ?? event.data?.message ?? ""}`;
    const previous = last.get(key);
    const now = Date.now();
    if (!verbose && previous && now - previous.at < 30_000 && atLeastLevel(event.level, "warn")) {
      previous.suppressed++;
      return;
    }
    if (last.size >= 256) last.delete(last.keys().next().value ?? "");
    last.set(key, { at: now, suppressed: 0 });
    const repeated = previous?.suppressed ? ` (+${previous.suppressed} repeated)` : "";
    write(`${formatDiagnostic(event, verbose).trimEnd()}${repeated}\n`);
  };
}

export type RuntimeSummary = {
  spaceId: string;
  runtimeId: string;
  root: string;
  harnesses: string[];
  pid: number;
  state: "starting" | "ready" | "reconnecting" | "attention" | "stopping";
  harnessConnected: boolean;
  workspaceConnected: boolean;
  diagnosticsPath: string;
  background: boolean;
};

export function printRuntimeSummary(summary: RuntimeSummary, json = false, reused = false) {
  const value = { ...summary, url: runtimeWebUrl(summary.spaceId), reused };
  if (json) { process.stdout.write(`${JSON.stringify(value, null, 2)}\n`); return; }
  const label = summary.state === "ready" ? "Runtime ready" : `Runtime ${summary.state}`;
  process.stdout.write(`\n${label}${reused ? " · reused" : ""}\n\n`);
  const rows = [
    ["Space", summary.spaceId],
    ["URL", value.url],
    ["Directory", summary.root],
    ["Harness", summary.harnesses.join(" · ")],
    ["Mode", summary.background ? "Background" : "Foreground"],
    ["PID", String(summary.pid)],
    ["Logs", summary.diagnosticsPath],
  ];
  for (const [name, text] of rows) process.stdout.write(`  ${name}  ${text}\n`);
  process.stdout.write(`\n  cohub runtime logs --space ${summary.spaceId} --follow\n  cohub runtime down --space ${summary.spaceId}\n`);
  if (!summary.background && !reused) process.stdout.write("  Ctrl+C to stop\n");
  process.stdout.write("\n");
}

export type NativeSessionStatus = { harness: "pi" | "codex"; nativeSessionId: string; sessionId: string | null; pendingTurns: number; pendingArchives: number };

/** `runtime status` native sync block: installation state plus per-Harness pending work. */
export function formatNativeSync(config: NativeSyncConfig | null, sessions: NativeSessionStatus[], error: string | null = null): string {
  if (error) return `Native sync  unknown — ${error} · fix or remove the config, then runtime up\n`;
  if (!config?.harnesses.length) return "Native sync  off · run cohub runtime up to enable\n";
  const lines = [`Native sync  enabled · ${config.harnesses.join(", ")}`];
  for (const session of sessions) {
    lines.push(`  ${session.harness.padEnd(5)} ${session.nativeSessionId.slice(0, 8)}  ${session.pendingTurns} Turns · ${session.pendingArchives} archives pending`);
  }
  if (!sessions.length) lines.push("  No native chats captured yet");
  else if (sessions.every((session) => !session.pendingTurns && !session.pendingArchives)) lines.push("  Up to date");
  return `${lines.join("\n")}\n`;
}
