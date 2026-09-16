import { spawn } from "node:child_process";
import { stat } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { resolveCohubEnvironment, resolveWebsocketUrl } from "@neta-art/cohub";
import type { Command } from "commander";
import { requireAccessToken } from "../auth.js";
import { createClient } from "../client.js";
import { error, json as outJson, jsonRequested } from "../output.js";
import { resolveSpace } from "../space.js";
import { discoverHarnesses } from "../runtime/harness.js";
import { serveRuntime } from "../runtime/connection.js";
import { RuntimeSessionStore } from "../runtime/session-store.js";
import { ensureSandboxdBinary } from "./sandboxd-binary.js";

export const resolveLocalSpaceName = (root: string, name?: string) => name?.trim() || basename(root) || "local-space";

type Options = { space?: string; name?: string; harness: string[]; pi?: string; codex?: string; yes?: boolean; json?: boolean };
export function parseRuntimeHarnesses(values: string[]): ("pi" | "codex")[] {
  const names = values.flatMap((value) => value.split(",")).map((name) => name.trim()).filter(Boolean);
  if (names.some((name) => name !== "pi" && name !== "codex")) throw new Error("Harness must be pi or codex / Harness 必须是 pi 或 codex");
  return [...new Set(names.length ? names : ["pi"])] as ("pi" | "codex")[];
}

export function registerRuntime(program: Command) {
  const runtime = program.command("runtime").description("Connect a local workspace / 连接本地工作区");
  runtime.command("up [dir]")
    .description("Connect local Harnesses and files / 连接本地 Harness 与文件")
    .option("-s, --space <id>", "Target Space / 目标 Space")
    .option("-n, --name <name>", "New Space name / 新 Space 名称")
    .option("--harness <name>", "Pi or Codex; repeatable / Pi 或 Codex，可重复", (value: string, previous: string[]) => [...previous, value], [])
    .option("--pi <path>", "Pi executable / Pi 可执行文件")
    .option("--codex <path>", "Codex executable / Codex 可执行文件")
    .option("-y, --yes", "Accept local execution access / 同意本机执行权限")
    .option("--json", "JSON output / JSON 输出")
    .action(async (dir: string | undefined, options: Options) => {
      const controller = new AbortController();
      const stop = () => controller.abort();
      process.once("SIGINT", stop); process.once("SIGTERM", stop);
      try {
        const root = resolve(dir ?? process.cwd());
        if (!(await stat(root)).isDirectory()) throw new Error("Workspace is not a directory / 工作区不是目录");
        const harnesses = parseRuntimeHarnesses(options.harness);
        if (!options.yes) {
          if (!process.stdin.isTTY) throw new Error("Use --yes to authorize local execution / 请使用 --yes 授权本机执行");
          const rl = createInterface({ input: process.stdin, output: process.stderr });
          try {
            const answer = await rl.question(`Connect ${root}? Space collaborators can run commands as your OS user, beyond this folder.\n连接此目录？Space 协作者可使用当前系统用户执行命令，权限不限于此目录。 [y/N] `);
            if (!/^y(es)?$/i.test(answer.trim())) return;
          } finally { rl.close(); }
        }
        const capabilities = await discoverHarnesses(harnesses, options, root);
        const client = createClient();
        const requested = options.space?.trim() || (program.opts().space as string | undefined)?.trim();
        const spaceId = requested || (await client.spaces.create({ name: resolveLocalSpaceName(root, options.name), config: { sandbox: { provider: "local" } } })).space.id;
        const sandbox = (await client.space(spaceId).sandbox.get()).sandbox;
        if (sandbox?.provider !== "local") throw new Error("Space does not have a local Runtime / Space 不是本地 Runtime");
        const binary = await ensureSandboxdBinary();
        const wsBase = resolveWebsocketUrl({ url: process.env.COHUB_WS_URL });
        const url = new URL(wsBase); url.pathname = "/runtime/relay";
        const relay = new URL(wsBase); relay.pathname = "/sandbox/relay";
        let bridge: ReturnType<typeof spawn> | null = null;
        let bridgeClosed: Promise<void> = Promise.resolve();
        const token = await requireAccessToken();
        try {
          await serveRuntime({
            spaceId, cwd: root, url: url.toString(), capabilities, harnesses: options,
            token: requireAccessToken, signal: controller.signal, store: new RuntimeSessionStore(spaceId),
            onReady: () => {
              if (!bridge) {
                bridge = spawn(binary, ["--local", "--space", spaceId, "--root", root, "--relay", process.env.COHUB_RELAY_URL?.trim() || relay.toString()], { stdio: ["ignore", "inherit", "inherit"], env: { ...process.env, COHUB_RELAY_TOKEN: token } });
                bridgeClosed = new Promise((resolveClosed) => bridge?.once("close", () => resolveClosed()));
                bridge.on("error", (cause) => { console.error(cause); controller.abort(); });
                bridge.once("exit", () => controller.abort());
              }
              const webUrl = `${resolveCohubEnvironment() === "prod" ? "https://cohub.live" : "https://dev.cohub.live"}/spaces/${spaceId}`;
              if (jsonRequested(options)) outJson({ spaceId, root, harnesses, url: webUrl });
              else console.error(`Runtime connected / Runtime 已连接: ${webUrl}`);
            },
          });
        } finally {
          if (bridge) {
            const child = bridge as ReturnType<typeof spawn>;
            child.kill("SIGTERM");
            const timeout = setTimeout(() => child.kill("SIGKILL"), 3000);
            await bridgeClosed;
            clearTimeout(timeout);
          }
        }
      } catch (cause) { if (!controller.signal.aborted) error("Runtime failed / Runtime 失败", cause instanceof Error ? cause.message : String(cause)); }
      finally { process.removeListener("SIGINT", stop); process.removeListener("SIGTERM", stop); }
    });
  runtime.command("status").description("Runtime status / Runtime 状态").option("-s, --space <id>", "Target Space / 目标 Space").action(async (options: { space?: string }) => {
    const spaceId = options.space?.trim() || await resolveSpace(program);
    outJson(await createClient().space(spaceId).getRuntime());
  });
}
