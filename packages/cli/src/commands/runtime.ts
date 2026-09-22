import { setTimeout as delay } from "node:timers/promises";
import { createInterface } from "node:readline/promises";
import type { Command } from "commander";
import { createClient } from "../client.js";
import { json as outJson, jsonRequested } from "../output.js";
import { currentIdentityKey } from "../space.js";
import { resolveRuntimeTarget, runtimeUp, parseRuntimeHarnesses, type RuntimeUpOptions } from "../runtime/launch.js";
import { canonicalRuntimeRoot, getRuntimeSpaceBinding } from "../runtime/space-binding.js";
import { installNativeSync } from "../runtime/native-install.js";
import { listNativeSyncStores } from "../runtime/native-sync-store.js";
import { requestRuntimeInstance, runtimeInstanceDirectory } from "../runtime/instance.js";
import { atLeastLevel, diagnosticLevels, formatDiagnostic, printRuntimeSummary } from "../runtime/presentation.js";
import { RuntimeSessionStore } from "../runtime/session-store.js";
import { readRuntimeDiagnosticEvents, RuntimeDiagnosticReader, runtimeDiagnosticsDirectory, serializeDiagnosticError, type RuntimeDiagnosticLevel } from "../runtime/diagnostics.js";

export { resolveLocalSpaceName, parseRuntimeHarnesses } from "../runtime/launch.js";

const reportFailure = (cause: unknown) => {
  process.stderr.write(`Runtime failed: ${serializeDiagnosticError(cause).message}\n`);
  process.exitCode = 1;
};
type TargetOptions = { space?: string; json?: boolean };

export function registerRuntime(program: Command) {
  const runtime = program.command("runtime").description("Connect a local workspace");
  runtime.command("up [dir]")
    .description("Connect local Harnesses and files")
    .option("-s, --space <id>", "Target Space")
    .option("-n, --new", "Create a new Space")
    .option("--name <name>", "New Space name")
    .option("-d, --detach", "Run in the background")
    .option("--harness <name>", "Pi or Codex; repeatable", (value: string, previous: string[]) => [...previous, value], [])
    .option("--pi <path>", "Pi executable")
    .option("--codex <path>", "Codex executable")
    .option("-y, --yes", "Accept defaults and authorize local execution")
    .option("--verbose", "Show diagnostic details")
    .option("--json", "JSON output")
    .action(async (dir: string | undefined, options: RuntimeUpOptions) => {
      try { await runtimeUp(program, dir, { ...options, json: jsonRequested(options) }); }
      catch (cause) { reportFailure(cause); }
    });

  for (const action of ["attach", "detach"] as const) runtime.command(action)
    .description(action === "attach" ? "Sync native Pi / Codex Turns" : "Pause native sync; retain all receipts")
    .option("-s, --space <id>", "Target Space")
    .option("--harness <name>", "Pi or Codex; repeatable", (value: string, previous: string[]) => [...previous, value], [])
    .option("--pi <path>", "Pi executable for capability checks")
    .option("--codex <path>", "Codex executable for capability checks")
    .option("-y, --yes", "Authorize project conversation and native archive uploads")
    .option("--json", "JSON output")
    .action(async (options: TargetOptions & { harness: string[]; yes?: boolean; pi?: string; codex?: string }) => {
      try {
        const spaceId = await resolveRuntimeTarget(program, options.space);
        const identity = currentIdentityKey();
        if (!identity) throw new Error("Sign in first");
        const root = await canonicalRuntimeRoot(process.cwd());
        if (action === "attach" && (await getRuntimeSpaceBinding(root, identity))?.spaceId !== spaceId) throw new Error("Bind this directory with runtime up --space first");
        const instance = await requestRuntimeInstance(runtimeInstanceDirectory(identity, spaceId));
        if (action === "attach" && (!instance || instance.root !== root)) throw new Error("Start this directory's Runtime first: cohub runtime up -d");
        if (action === "attach" && !instance?.nativeSync) throw new Error("Restart the Runtime with this CLI before attaching");
        const harnesses = parseRuntimeHarnesses(options.harness.length ? options.harness : instance?.harnesses ?? ["pi", "codex"]);
        if (action === "attach" && harnesses.some((harness) => !instance?.harnesses.includes(harness))) throw new Error("Enable these Harnesses with runtime up first");
        if (action === "attach" && !options.yes) {
          if (!process.stdin.isTTY) throw new Error("Use --yes to authorize native sync");
          const rl = createInterface({ input: process.stdin, output: process.stderr });
          try {
            const answer = await rl.question(`Install user-level ${harnesses.join(" / ")} integration and upload this project's opened conversations, tool output and raw archives to this Space? History may contain secrets. [y/N] `);
            if (!/^y(es)?$/i.test(answer.trim())) return;
          } finally { rl.close(); }
        }
        const result = await installNativeSync({ root, spaceId, identity, harnesses, disabled: action === "detach", executables: { pi: options.pi, codex: options.codex } });
        if (jsonRequested(options)) outJson(result);
        else process.stdout.write(action === "attach"
          ? `Native sync enabled. Reload Pi or restart Codex and review its hook trust prompt.\n${result.configPath}\n`
          : "Native sync paused; all local records retained\n");
      } catch (cause) { reportFailure(cause); }
    });

  runtime.command("status").description("Local and server status")
    .option("-s, --space <id>", "Target Space")
    .option("--json", "JSON output")
    .action(async (options: TargetOptions) => {
      try {
        const spaceId = await resolveRuntimeTarget(program, options.space);
        const identity = currentIdentityKey();
        const local = identity ? await requestRuntimeInstance(runtimeInstanceDirectory(identity, spaceId)) : null;
        const space = createClient().space(spaceId);
        const store = new RuntimeSessionStore(spaceId, { projectionSource: space, archiveTransport: null });
        const [remote, pendingLocalArchives, failedLocalArchives, nativeStores] = await Promise.all([
          space.getRuntime(undefined, { signal: AbortSignal.timeout(5000) }).then((value) => ({ value, error: null })).catch((error) => ({ value: null, error: serializeDiagnosticError(error).message })),
          store.archives.pendingCount(), store.archives.failedCaptureCount(),
          identity ? listNativeSyncStores(store.root, spaceId, identity) : [],
        ]);
        const nativeSessions = await Promise.all(nativeStores.map((native) => native.status()));
        const result = { ...remote.value, spaceId, local, remote: remote.value, remoteError: remote.error, diagnosticsPath: runtimeDiagnosticsDirectory(store.root), pendingLocalArchives, failedLocalArchives, nativeSessions };
        if (jsonRequested(options)) outJson(result);
        else {
          if (local) printRuntimeSummary(local);
          else process.stdout.write(`Local process  Not running\nSpace  ${spaceId}\nLogs  ${result.diagnosticsPath}\n`);
          process.stdout.write(`Server  ${remote.error ? `Unknown — ${remote.error}` : remote.value?.online ? "Harness connected" : "Offline"}\nArchives  ${pendingLocalArchives} pending · ${failedLocalArchives} failed\n`);
          if (nativeSessions.length) process.stdout.write(`Native chats  ${nativeSessions.length} · ${nativeSessions.reduce((sum, session) => sum + session.pendingTurns, 0)} Turns pending · ${nativeSessions.reduce((sum, session) => sum + session.pendingArchives, 0)} archives pending\n`);
        }
      } catch (cause) { reportFailure(cause); }
    });

  runtime.command("down").description("Stop this local Runtime; retain all data")
    .option("-s, --space <id>", "Target Space")
    .option("-y, --yes", "Stop even with unconfirmed executions")
    .option("--json", "JSON output")
    .action(async (options: TargetOptions & { yes?: boolean }) => {
      try {
        const spaceId = await resolveRuntimeTarget(program, options.space);
        const identity = currentIdentityKey();
        if (!identity) throw new Error("Sign in to the Runtime account");
        const directory = runtimeInstanceDirectory(identity, spaceId);
        const local = await requestRuntimeInstance(directory, "stop", Boolean(options.yes));
        const until = Date.now() + 15_000;
        let running = Boolean(local);
        while (running && Date.now() < until) {
          await delay(250);
          try { running = Boolean(await requestRuntimeInstance(directory)); }
          catch { running = true; } // An unreachable control socket does not prove the process stopped.
        }
        if (running) throw new Error("Runtime is still stopping; inspect logs");
        if (jsonRequested(options)) outJson({ spaceId, stopped: true });
        else process.stdout.write("Runtime stopped; data retained\n");
      } catch (cause) { reportFailure(cause); }
    });

  runtime.command("logs").description("Read local Runtime diagnostics")
    .option("-s, --space <id>", "Target Space")
    .option("-l, --limit <count>", "Number of events", "100")
    .option("--level <level>", "Minimum level: debug, info, warn, error", "info")
    .option("-f, --follow", "Keep watching")
    .option("--json", "Raw diagnostic events")
    .action(async (options: TargetOptions & { limit: string; level: RuntimeDiagnosticLevel; follow?: boolean }) => {
      const controller = new AbortController();
      const stop = () => controller.abort();
      try {
        const spaceId = await resolveRuntimeTarget(program, options.space);
        const store = new RuntimeSessionStore(spaceId, { projectionSource: createClient().space(spaceId), archiveTransport: null });
        const limit = Number(options.limit);
        if (!Number.isSafeInteger(limit) || limit < 1 || limit > 10_000) throw new Error("Use a limit from 1 to 10000");
        if (!diagnosticLevels.includes(options.level)) throw new Error("Use debug, info, warn or error");
        const asJson = jsonRequested(options);
        const reader = new RuntimeDiagnosticReader(store.root);
        process.once("SIGINT", stop); process.once("SIGTERM", stop);
        do {
          const events = (options.follow ? await reader.read({ limit }) : await readRuntimeDiagnosticEvents(store.root, { limit }))
            .filter((event) => atLeastLevel(event.level, options.level));
          if (asJson && !options.follow) outJson(events);
          else for (const event of events) process.stdout.write(asJson ? `${JSON.stringify(event)}\n` : formatDiagnostic(event, true));
          if (!options.follow) {
            if (!asJson && !events.length) process.stdout.write("No matching diagnostics\n");
            break;
          }
          await delay(1000, undefined, { signal: controller.signal }).catch(() => undefined);
        } while (!controller.signal.aborted);
      } catch (cause) { reportFailure(cause); }
      finally { process.removeListener("SIGINT", stop); process.removeListener("SIGTERM", stop); }
    });
}
