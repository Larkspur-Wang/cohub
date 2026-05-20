import { randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import { basename, dirname, relative, resolve, sep } from "node:path";
import type { Command } from "commander";
import { createClient } from "../client.js";
import { table, json as outJson, ok, error, handleHttp } from "../output.js";

function requireSpace(program: Command): string {
  let current: Command | null = program;
  while (current) {
    const opts = current.opts() as Record<string, unknown>;
    if (opts.space) return String(opts.space);
    current = current.parent ?? null;
  }
  return error("Missing required option", "Add -s, --space <id> to target a space");
}

type ModOptions = {
  json?: boolean;
  name?: string;
  slug?: string;
  yes?: boolean;
};

type PromptOptions = {
  session?: string;
  title?: string;
  model?: string;
  provider?: string;
  delayMs?: string;
  at?: string;
  cron?: string;
  timezone?: string;
  json?: boolean;
};

type UploadFile = {
  id: string;
  localPath: string;
  relativePath: string;
  name: string;
  size: number;
  mimeType: string | null;
};

type UploadOptions = {
  dir?: string;
  json?: boolean;
};

const parseAutoDestroy = (opts: { autoDestroy?: string; idleTtl?: string }) => {
  const mode = opts.autoDestroy ?? (opts.idleTtl ? "idle" : undefined);
  if (!mode) return undefined;
  if (mode === "never") return { mode: "never" as const };
  if (mode !== "idle") return error("Invalid auto destroy mode", "Use --auto-destroy idle or --auto-destroy never");
  const ttlSeconds = Number.parseInt(opts.idleTtl ?? "172800", 10);
  if (!Number.isSafeInteger(ttlSeconds) || ttlSeconds < 60 || ttlSeconds > 30 * 24 * 60 * 60) {
    return error("Invalid idle TTL", "--idle-ttl must be an integer between 60 and 2592000 seconds");
  }
  return { mode: "idle" as const, ttlSeconds };
};

const formatAutoDestroy = (policy: { mode: "idle"; ttlSeconds: number } | { mode: "never" } | undefined) => {
  if (!policy) return "48h (default)";
  if (policy.mode === "never") return "never";
  if (policy.ttlSeconds % 86400 === 0) return `${policy.ttlSeconds / 86400}d`;
  if (policy.ttlSeconds % 3600 === 0) return `${policy.ttlSeconds / 3600}h`;
  if (policy.ttlSeconds % 60 === 0) return `${policy.ttlSeconds / 60}m`;
  return `${policy.ttlSeconds}s`;
};

const slashPath = (value: string) => value.split(sep).join("/");

const walkUploadPath = async (input: string, root: string, prefix = ""): Promise<UploadFile[]> => {
  const localPath = resolve(input);
  const info = await stat(localPath);
  const name = basename(localPath);
  const relativePath = slashPath(prefix ? `${prefix}/${name}` : relative(root, localPath) || name);

  if (info.isDirectory()) {
    const children = await readdir(localPath);
    const nested = await Promise.all(children.map((child) => walkUploadPath(resolve(localPath, child), root, relativePath)));
    return nested.flat();
  }
  if (!info.isFile()) return [];

  return [{
    id: randomUploadEntryId(),
    localPath,
    relativePath,
    name,
    size: info.size,
    mimeType: null,
  }];
};

const randomUploadEntryId = () => randomUUID();

async function collectUploadFiles(paths: string[]): Promise<UploadFile[]> {
  if (paths.length === 0) return error("No files provided", "Pass one or more local files or directories.");
  const roots = paths.map((path) => {
    const resolved = resolve(path);
    return dirname(resolved);
  });
  const nested = await Promise.all(paths.map((path, index) => walkUploadPath(path, roots[index] ?? process.cwd())));
  const files = nested.flat();
  if (files.length === 0) return error("No regular files found");
  return files;
}

async function putUploadEntry(entry: UploadFile, uploadUrl: string, headers?: Record<string, string>): Promise<void> {
  const response = await fetch(uploadUrl, {
    method: "PUT",
    headers,
    body: createReadStream(entry.localPath) as never,
    duplex: "half",
  } as RequestInit & { duplex: "half" });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`Failed to upload ${entry.relativePath}: HTTP ${response.status}${detail ? ` — ${detail}` : ""}`);
  }
}

async function uploadFiles(command: Command, paths: string[], opts: UploadOptions): Promise<void> {
  const spaceId = requireSpace(command);
  const client = createClient();
  try {
    const files = await collectUploadFiles(paths);
    const plan = await client.space(spaceId).files.createUpload({
      targetDir: opts.dir,
      entries: files.map((file) => ({
        id: file.id,
        name: file.name,
        relativePath: file.relativePath,
        size: file.size,
        mimeType: file.mimeType,
      })),
    });
    const byId = new Map(files.map((file) => [file.id, file]));
    for (const entry of plan.entries) {
      const file = byId.get(entry.id);
      if (!file) throw new Error(`Missing upload entry: ${entry.id}`);
      await putUploadEntry(file, entry.uploadUrl, entry.headers);
    }
    const result = await client.space(spaceId).files.completeUpload(plan.uploadId, {
      entries: plan.entries.map((entry) => ({ id: entry.id })),
    });
    if (opts.json) return outJson({ ...result, uploadId: plan.uploadId, files: files.length });
    ok(`Uploaded ${files.length} file${files.length === 1 ? "" : "s"} — taskRunId: ${result.taskRunId}`);
  } catch (e: unknown) {
    handleHttp(e);
  }
}

async function confirmRestart(opts: { yes?: boolean }): Promise<void> {
  if (opts.yes) return;
  if (!process.stdin.isTTY || !process.stdout.isTTY) return error("Confirmation required", "Pass --yes to restart the sandbox automatically.");
  process.stdout.write("Changing mods restarts the sandbox and may interrupt running work. Continue? [y/N] ");
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk);
    break;
  }
  const answer = Buffer.concat(chunks).toString().trim().toLowerCase();
  if (answer !== "y" && answer !== "yes") return error("Cancelled");
}

async function readPromptContent(words: string[]): Promise<string> {
  let content = words.join(" ");
  if (!content && !process.stdin.isTTY) {
    const chunks: Buffer[] = [];
    for await (const chunk of process.stdin) chunks.push(chunk);
    content = Buffer.concat(chunks).toString().trim();
  }
  if (!content) return error("No content", "Pass as argument or pipe via stdin");
  return content;
}

async function sendPrompt(command: Command, words: string[], opts: PromptOptions): Promise<void> {
    const content = await readPromptContent(words);
  const scheduleFlags = [opts.delayMs, opts.at, opts.cron].filter((value) => value !== undefined);
  if (scheduleFlags.length > 1) return error("Conflicting schedule", "Use only one of --delay-ms, --at, or --cron");
  if (opts.cron && !opts.timezone) return error("Missing timezone", "--timezone is required with --cron");

  const spaceId = requireSpace(command);
  const client = createClient();
  try {
    const schedule = opts.delayMs
      ? { mode: "delay" as const, delayMs: Number.parseInt(opts.delayMs, 10) }
      : opts.at
        ? { mode: "at" as const, sendAt: opts.at }
        : opts.cron
          ? { mode: "repeat" as const, cronExpression: opts.cron, timezone: opts.timezone as string }
          : undefined;
    const result = await client.space(spaceId).prompt({
      sessionId: opts.session,
      title: opts.title,
      content: [{ type: "text", text: content }],
      model: opts.model,
      provider: opts.provider,
      schedule,
    });
    if (opts.json) return outJson(result);
    if (result.mode === "immediate") return ok(`Prompt sent — sessionId: ${result.sessionId}, turnId: ${result.turnId}`);
    if (result.mode === "repeat") return ok(`Prompt scheduled — cronJobId: ${result.cronJobId}, nextRunAt: ${result.nextRunAt}`);
    return ok(`Prompt scheduled — taskRunId: ${result.taskRunId}, scheduledAt: ${result.scheduledAt}`);
  } catch (e: unknown) {
    handleHttp(e);
  }
}

export function registerPrompt(program: Command): void {
  program
    .command("prompt [content...]")
    .description("Send or schedule a prompt in a space")
    .option("--session <id>", "Target session ID")
    .option("--title <title>", "Title for a newly created session or schedule")
    .option("-m, --model <model>", "Model name")
    .option("-p, --provider <provider>", "Provider name")
    .option("--delay-ms <ms>", "Delay sending by milliseconds")
    .option("--at <iso>", "Send once at an ISO 8601 time with timezone")
    .option("--cron <expression>", "Repeat using a 5-field cron expression")
    .option("--timezone <tz>", "IANA timezone for --cron, e.g. Asia/Shanghai")
    .option("--json", "Output as JSON")
    .action((words: string[], opts: PromptOptions) => sendPrompt(program, words, opts));
}

export function registerSpaces(program: Command): void {
  const spacesCmd = program.command("spaces").description("Space management");

  // ── spaces ls ──
  spacesCmd
    .command("ls")
    .alias("list")
    .description("List all spaces")
    .option("--json", "Output as JSON")
    .action(async (opts: { json?: boolean }) => {
      const client = createClient();
      try {
        const items = await client.spaces.list();
        if (opts.json) return outJson(items);
        table(items, [
          { key: "id", label: "ID" },
          { key: "name", label: "Name" },
          { key: "createdAt", label: "Created" },
        ]);
      } catch (e: unknown) {
        handleHttp(e);
      }
    });

  // ── spaces get ──
  spacesCmd
    .command("get <id>")
    .description("Show space details")
    .option("--json", "Output as JSON")
    .action(async (id: string, opts: { json?: boolean }) => {
      const client = createClient();
      try {
        const space = await client.spaces.get(id);
        if (opts.json) return outJson(space);
        table([space], [
          { key: "id", label: "ID" },
          { key: "name", label: "Name" },
          { key: "description", label: "Description" },
          { key: "status", label: "Status" },
          { key: "createdAt", label: "Created" },
        ]);
      } catch (e: unknown) {
        handleHttp(e);
      }
    });

  // ── spaces create ──
  spacesCmd
    .command("create")
    .description("Create a new space")
    .option("-n, --name <name>", "Space name")
    .option("-d, --description <desc>", "Space description")
    .option("--auto-destroy <mode>", "Sandbox auto destroy mode: idle or never")
    .option("--idle-ttl <seconds>", "Idle auto destroy TTL in seconds, max 2592000 (30d)")
    .option("--json", "Output as JSON")
    .action(async (opts: { name?: string; description?: string; autoDestroy?: string; idleTtl?: string; json?: boolean }) => {
      const client = createClient();
      try {
        const autoDestroy = parseAutoDestroy(opts);
        const result = await client.spaces.create({
          name: opts.name,
          description: opts.description,
          ...(autoDestroy ? { config: { sandbox: { autoDestroy } } } : {}),
        });
        if (opts.json) return outJson(result);
        ok(`Space created: ${result.space.id}`);
        table([result.space], [
          { key: "id", label: "ID" },
          { key: "name", label: "Name" },
          { key: "taskRunId", label: "Task" },
        ]);
      } catch (e: unknown) {
        handleHttp(e);
      }
    });

  // ── spaces rename ──
  spacesCmd
    .command("rename <id> <name>")
    .description("Rename a space")
    .action(async (id: string, name: string) => {
      const client = createClient();
      try {
        await client.space(id).rename(name);
        ok(`Space renamed to "${name}"`);
      } catch (e: unknown) {
        handleHttp(e);
      }
    });

  // ── spaces config ──
  spacesCmd
    .command("config <id>")
    .description("Show or update space configuration")
    .option("--auto-destroy <mode>", "Sandbox auto destroy mode: idle or never")
    .option("--idle-ttl <seconds>", "Idle auto destroy TTL in seconds, max 2592000 (30d)")
    .option("--json", "Output as JSON")
    .action(async (id: string, opts: { autoDestroy?: string; idleTtl?: string; json?: boolean }) => {
      const client = createClient();
      try {
        const autoDestroy = parseAutoDestroy(opts);
        if (autoDestroy) {
          const result = await client.space(id).updateConfig({ sandbox: { autoDestroy } });
          if (opts.json) return outJson(result);
          ok(`Space config updated — sandbox auto destroy: ${formatAutoDestroy(autoDestroy)}`);
          return;
        }
        const result = await client.space(id).getConfig();
        if (opts.json) return outJson(result);
        table([{ key: "sandbox.autoDestroy", value: formatAutoDestroy(result.config.sandbox.autoDestroy) }], [
          { key: "key", label: "Key" },
          { key: "value", label: "Value" },
        ]);
      } catch (e: unknown) {
        handleHttp(e);
      }
    });

  // ── spaces prompt ──
  spacesCmd
    .command("prompt [content...]", { hidden: true })
    .alias("send")
    .description("Send or schedule a prompt in the target space")
    .option("--session <id>", "Target session ID")
    .option("--title <title>", "Title for a newly created session or schedule")
    .option("-m, --model <model>", "Model name")
    .option("-p, --provider <provider>", "Provider name")
    .option("--delay-ms <ms>", "Delay sending by milliseconds")
    .option("--at <iso>", "Send once at an ISO 8601 time with timezone")
    .option("--cron <expression>", "Repeat using a 5-field cron expression")
    .option("--timezone <tz>", "IANA timezone for --cron, e.g. Asia/Shanghai")
    .option("--json", "Output as JSON")
    .action((words: string[], opts: PromptOptions) => sendPrompt(spacesCmd, words, opts));

  // ── spaces files ──
  registerFiles(spacesCmd);

  // ── spaces sessions ──
  registerSessions(spacesCmd);

  // ── spaces members ──
  registerMembers(spacesCmd);

  // ── spaces access ──
  registerAccess(spacesCmd);

  // ── spaces checkpoints ──
  registerCheckpoints(spacesCmd);

  // ── spaces mods ──
  registerMods(spacesCmd);

  // ── spaces usage ──
  spacesCmd
    .command("usage [days]")
    .description("Space usage statistics (default: 30 days)")
    .option("--json", "Output as JSON")
    .action(async (days: string | undefined, opts: { json?: boolean }) => {
      const spaceId = requireSpace(spacesCmd);
      const client = createClient();
      try {
        const usage = await client.space(spaceId).usage.get(Number.parseInt(days ?? "30", 10));
        if (opts.json) return outJson(usage);
        console.log("\n  Summary:");
        table([usage.summary], [
          { key: "totalTokens", label: "Tokens" },
          { key: "costTotal", label: "Cost ($)" },
          { key: "requestCount", label: "Requests" },
          { key: "successCount", label: "Success" },
          { key: "errorCount", label: "Errors" },
        ]);
      } catch (e: unknown) {
        handleHttp(e);
      }
    });
}

function registerMods(spacesCmd: Command): void {
  const modsCmd = spacesCmd
    .command("mods")
    .description("Manage space mods")
    .hook("preAction", () => { requireSpace(spacesCmd); });

  modsCmd
    .command("ls")
    .alias("list")
    .description("List mods")
    .option("--json", "Output as JSON")
    .action(async (opts: ModOptions) => {
      const spaceId = requireSpace(spacesCmd);
      const client = createClient();
      try {
        const result = await client.space(spaceId).mods.list();
        if (opts.json) return outJson(result.items);
        table(result.items, [
          { key: "id", label: "ID" },
          { key: "modSpaceName", label: "Name" },
          { key: "mountPath", label: "Mount" },
          { key: "enabled", label: "On" },
        ]);
      } catch (e: unknown) {
        handleHttp(e);
      }
    });

  modsCmd
    .command("add <modSpaceId>")
    .description("Add a mod")
    .option("--name <name>", "Display name")
    .option("--slug <slug>", "Mount slug")
    .option("-y, --yes", "Confirm sandbox restart")
    .option("--json", "Output as JSON")
    .action(async (modSpaceId: string, opts: ModOptions) => {
      await confirmRestart(opts);
      const spaceId = requireSpace(spacesCmd);
      const client = createClient();
      try {
        const result = await client.space(spaceId).mods.create({ modSpaceId, name: opts.name, mountSlug: opts.slug });
        if (opts.json) return outJson(result);
        ok(`Mod added — ${result.item.mountPath}; sandbox restarting`);
      } catch (e: unknown) {
        handleHttp(e);
      }
    });

  modsCmd
    .command("enable <modId>")
    .description("Enable a mod")
    .option("-y, --yes", "Confirm sandbox restart")
    .option("--json", "Output as JSON")
    .action(async (modId: string, opts: ModOptions) => {
      await confirmRestart(opts);
      const spaceId = requireSpace(spacesCmd);
      const client = createClient();
      try {
        const result = await client.space(spaceId).mods.update(modId, { enabled: true });
        if (opts.json) return outJson(result);
        ok("Mod enabled; sandbox restarting");
      } catch (e: unknown) {
        handleHttp(e);
      }
    });

  modsCmd
    .command("disable <modId>")
    .description("Disable a mod")
    .option("-y, --yes", "Confirm sandbox restart")
    .option("--json", "Output as JSON")
    .action(async (modId: string, opts: ModOptions) => {
      await confirmRestart(opts);
      const spaceId = requireSpace(spacesCmd);
      const client = createClient();
      try {
        const result = await client.space(spaceId).mods.update(modId, { enabled: false });
        if (opts.json) return outJson(result);
        ok("Mod disabled; sandbox restarting");
      } catch (e: unknown) {
        handleHttp(e);
      }
    });

  modsCmd
    .command("rm <modId>")
    .alias("remove")
    .description("Remove a mod")
    .option("-y, --yes", "Confirm sandbox restart")
    .option("--json", "Output as JSON")
    .action(async (modId: string, opts: ModOptions) => {
      await confirmRestart(opts);
      const spaceId = requireSpace(spacesCmd);
      const client = createClient();
      try {
        const result = await client.space(spaceId).mods.remove(modId);
        if (opts.json) return outJson(result);
        ok("Mod removed; sandbox restarting");
      } catch (e: unknown) {
        handleHttp(e);
      }
    });
}

// ── File operations ──

function registerFiles(spacesCmd: Command): void {
  const filesCmd = spacesCmd
    .command("files")
    .description("File operations")
    .hook("preAction", () => { requireSpace(spacesCmd); });

  filesCmd
    .command("ls [path]")
    .alias("list")
    .description("List directory tree")
    .option("--json", "Output as JSON")
    .action(async (path: string | undefined, opts: { json?: boolean }) => {
      const spaceId = requireSpace(spacesCmd);
      const client = createClient();
      try {
        const tree = await client.space(spaceId).files.list(path ?? "");
        if (opts.json) return outJson(tree);
        if (tree.entries.length === 0) {
          console.log("  (empty)");
          return;
        }
        table(tree.entries, [
          { key: "name", label: "Name" },
          { key: "type", label: "Type" },
          { key: "size", label: "Size" },
          { key: "mtimeMs", label: "Modified" },
        ]);
      } catch (e: unknown) {
        handleHttp(e);
      }
    });

  filesCmd
    .command("cat <path>")
    .description("Read file content")
    .action(async (path: string) => {
      const spaceId = requireSpace(spacesCmd);
      const client = createClient();
      try {
        const file = await client.space(spaceId).files.read(path);
        if (!("content" in file)) return error("File is being prepared. Please retry shortly.");
        if (file.delivery === "url" && file.url) {
          console.log(`[CDN] ${file.url}`);
        }
        console.log(file.content);
      } catch (e: unknown) {
        handleHttp(e);
      }
    });

  filesCmd
    .command("write <path>")
    .description("Write file content")
    .option("-c, --content <text>", "File content")
    .option("-e, --encoding <enc>", "Encoding (utf-8 or base64)", "utf-8")
    .action(async (path: string, opts: { content?: string; encoding?: string }) => {
      let content = opts.content ?? "";
      if (!content && !process.stdin.isTTY) {
        const chunks: Buffer[] = [];
        for await (const chunk of process.stdin) chunks.push(chunk);
        content = Buffer.concat(chunks).toString();
      }
      if (!content) return error("No content provided", "Use -c or pipe via stdin");

      const spaceId = requireSpace(spacesCmd);
      const client = createClient();
      try {
        const result = await client.space(spaceId).files.write({
          path,
          content,
          encoding: opts.encoding as "utf-8" | "base64",
        });
        ok(`Written ${result.size} bytes to ${result.path}`);
      } catch (e: unknown) {
        handleHttp(e);
      }
    });

  filesCmd
    .command("upload <paths...>")
    .description("Upload local files or directories")
    .option("--dir <path>", "Target directory in the space")
    .option("--json", "Output as JSON")
    .action((paths: string[], opts: UploadOptions) => uploadFiles(spacesCmd, paths, opts));

  filesCmd
    .command("mkdir <path>")
    .description("Create a directory")
    .action(async (path: string) => {
      const spaceId = requireSpace(spacesCmd);
      const client = createClient();
      try {
        await client.space(spaceId).files.createDir(path);
        ok(`Directory created: ${path}`);
      } catch (e: unknown) {
        handleHttp(e);
      }
    });

  filesCmd
    .command("rm <path>")
    .description("Delete a file or directory")
    .option("-r, --recursive", "Delete recursively")
    .action(async (path: string, opts: { recursive?: boolean }) => {
      const spaceId = requireSpace(spacesCmd);
      const client = createClient();
      try {
        await client.space(spaceId).files.delete(path, opts.recursive ?? false);
        ok(`Deleted: ${path}`);
      } catch (e: unknown) {
        handleHttp(e);
      }
    });

  filesCmd
    .command("mv <from> <to>")
    .description("Move or rename")
    .action(async (from: string, to: string) => {
      const spaceId = requireSpace(spacesCmd);
      const client = createClient();
      try {
        await client.space(spaceId).files.move({ fromPath: from, toPath: to });
        ok(`Moved: ${from} → ${to}`);
      } catch (e: unknown) {
        handleHttp(e);
      }
    });
}

// ── Session operations ──

function registerSessions(spacesCmd: Command): void {
  const sessionsCmd = spacesCmd
    .command("sessions")
    .description("Browse sessions and turns")
    .hook("preAction", () => { requireSpace(spacesCmd); });

  sessionsCmd
    .command("ls")
    .alias("list")
    .description("List sessions")
    .option("--json", "Output as JSON")
    .action(async (opts: { json?: boolean }) => {
      const spaceId = requireSpace(spacesCmd);
      const client = createClient();
      try {
        const result = await client.space(spaceId).sessions.list();
        if (opts.json) return outJson(result);
        if (result.sessions.length === 0) {
          console.log("  (empty)");
          return;
        }
        table(result.sessions, [
          { key: "id", label: "ID" },
          { key: "title", label: "Title" },
          { key: "totalMessages", label: "Messages" },
          { key: "createdAt", label: "Created" },
        ]);
      } catch (e: unknown) {
        handleHttp(e);
      }
    });

  sessionsCmd
    .command("create [title]")
    .description("Create a session")
    .option("--json", "Output as JSON")
    .action(async (title: string | undefined, opts: { json?: boolean }) => {
      const spaceId = requireSpace(spacesCmd);
      const client = createClient();
      try {
        const result = await client.space(spaceId).sessions.create({ title });
        if (opts.json) return outJson(result);
        ok(`Session created: ${result.session.id}`);
        table([result.session], [
          { key: "id", label: "ID" },
          { key: "title", label: "Title" },
        ]);
      } catch (e: unknown) {
        handleHttp(e);
      }
    });

  sessionsCmd
    .command("get <id>")
    .description("Session details")
    .option("--json", "Output as JSON")
    .action(async (id: string, opts: { json?: boolean }) => {
      const spaceId = requireSpace(spacesCmd);
      const client = createClient();
      try {
        const result = await client.space(spaceId).session(id).get();
        if (opts.json) return outJson(result);
        table([result.session], [
          { key: "id", label: "ID" },
          { key: "title", label: "Title" },
          { key: "totalMessages", label: "Messages" },
          { key: "totalToolCalls", label: "Tool Calls" },
          { key: "createdAt", label: "Created" },
        ]);
      } catch (e: unknown) {
        handleHttp(e);
      }
    });

  sessionsCmd
    .command("rename <id> <name>")
    .description("Rename a session")
    .action(async (id: string, name: string) => {
      const spaceId = requireSpace(spacesCmd);
      const client = createClient();
      try {
        await client.space(spaceId).session(id).rename(name);
        ok(`Session renamed to "${name}"`);
      } catch (e: unknown) {
        handleHttp(e);
      }
    });

  // ── sessions tail ──
  sessionsCmd
    .command("tail <id>")
    .description("Stream realtime session events")
    .option("--json", "Output as JSON")
    .action(async (id: string, opts: { json?: boolean }) => {
      const spaceId = requireSpace(spacesCmd);
      const client = createClient();
      const session = client.space(spaceId).session(id);

      process.stdout.write("  Listening for events...\n\n");

      let lastAppendPath: string | null = null;
      session.on("turn.patch", (e: { payload?: Record<string, unknown> }) => {
        if (opts.json) {
          console.log(JSON.stringify(e));
        } else {
          const ops = e.payload?.ops as Array<{ o?: string; p?: string; v?: unknown }> | undefined;
          for (const op of ops ?? []) {
            if (op.o === "append" && typeof op.v === "string" && op.p?.endsWith("/text")) {
              lastAppendPath = op.p;
              process.stdout.write(op.v);
              continue;
            }
            if (op.o === "append" && typeof op.p === "string") {
              lastAppendPath = op.p;
              continue;
            }
            if (!op.o && !op.p && typeof op.v === "string" && lastAppendPath?.endsWith("/text")) {
              process.stdout.write(op.v);
            }
          }
        }
      });

      session.on("turn.final", () => {
        process.stdout.write("\n\n  ✓ Done\n");
        process.exit(0);
      });

      session.on("turn.error", (e: unknown) => {
        process.stderr.write(`\n  ✗ Error\n`);
        if (opts.json) process.stderr.write(`${JSON.stringify(e)}\n`);
        process.exit(1);
      });
    });

  // ── sessions turns ──
  registerTurns(sessionsCmd);

  // ── sessions access ──
  registerSessionAccess(sessionsCmd);
}

// ── Turn operations ──

function registerTurns(sessionsCmd: Command): void {
  const turnsCmd = sessionsCmd.command("turns").description("Inspect session turns");

  turnsCmd
    .command("ls <sessionId>")
    .alias("list")
    .description("List recent turns")
    .option("--cursor <sequence>", "Turn sequence cursor")
    .option("--direction <older|newer>", "Page direction", "older")
    .option("--limit <n>", "Page size", "30")
    .option("--json", "Output as JSON")
    .action(async (sessionId: string, opts: { cursor?: string; direction?: string; limit?: string; json?: boolean }) => {
      const spaceId = requireSpace(sessionsCmd);
      const client = createClient();
      try {
        const result = await client.space(spaceId).session(sessionId).turns.listPaginated({
          cursor: opts.cursor === undefined ? undefined : Number.parseInt(opts.cursor, 10),
          direction: opts.direction as "older" | "newer",
          limit: Number.parseInt(opts.limit ?? "30", 10),
        });
        if (opts.json) return outJson(result);
        if (result.turns.length === 0) return console.log("  No turns found");
        table(result.turns, [
          { key: "sequence", label: "Seq" },
          { key: "id", label: "ID" },
          { key: "status", label: "Status" },
          { key: "userText", label: "User" },
          { key: "assistantText", label: "Assistant" },
          { key: "updatedAt", label: "Updated" },
        ]);
        if (result.hasMore) console.log(`\n  More turns available — next cursor: ${result.nextCursor}`);
      } catch (e: unknown) {
        handleHttp(e);
      }
    });

  turnsCmd
    .command("get <sessionId> <turnId>")
    .description("Show turn details")
    .option("--json", "Output as JSON")
    .action(async (sessionId: string, turnId: string, opts: { json?: boolean }) => {
      const spaceId = requireSpace(sessionsCmd);
      const client = createClient();
      try {
        const result = await client.space(spaceId).session(sessionId).turns.get(turnId);
        if (opts.json) return outJson(result);
        table([result.turn], [
          { key: "sequence", label: "Seq" },
          { key: "id", label: "ID" },
          { key: "status", label: "Status" },
          { key: "provider", label: "Provider" },
          { key: "model", label: "Model" },
          { key: "stopReason", label: "Stop" },
          { key: "errorMessage", label: "Error" },
        ]);
        if (result.turn.userText) console.log(`\nUser:\n${result.turn.userText}`);
        if (result.turn.assistantText) console.log(`\nAssistant:\n${result.turn.assistantText}`);
      } catch (e: unknown) {
        handleHttp(e);
      }
    });

  turnsCmd
    .command("index <sessionId>", { hidden: true })
    .description("List lightweight turn index")
    .option("--cursor <sequence>", "Turn sequence cursor")
    .option("--limit <n>", "Page size", "100")
    .option("--json", "Output as JSON")
    .action(async (sessionId: string, opts: { cursor?: string; limit?: string; json?: boolean }) => {
      const spaceId = requireSpace(sessionsCmd);
      const client = createClient();
      try {
        const result = await client.space(spaceId).session(sessionId).turns.index({
          cursor: opts.cursor === undefined ? undefined : Number.parseInt(opts.cursor, 10),
          limit: Number.parseInt(opts.limit ?? "100", 10),
        });
        if (opts.json) return outJson(result);
        if (result.turns.length === 0) return console.log("  No turns found");
        table(result.turns, [
          { key: "sequence", label: "Seq" },
          { key: "id", label: "ID" },
          { key: "status", label: "Status" },
          { key: "userPreview", label: "User" },
          { key: "assistantPreview", label: "Assistant" },
        ]);
        if (result.hasMore) console.log(`\n  More turns available — next cursor: ${result.nextCursor}`);
      } catch (e: unknown) {
        handleHttp(e);
      }
    });

  turnsCmd
    .command("window <sessionId>", { hidden: true })
    .description("Load turns around a sequence or turn ID")
    .option("--sequence <n>", "Anchor turn sequence")
    .option("--turn <id>", "Anchor turn ID")
    .option("--before <n>", "Turns before anchor", "10")
    .option("--after <n>", "Turns after anchor", "20")
    .option("--json", "Output as JSON")
    .action(async (sessionId: string, opts: { sequence?: string; turn?: string; before?: string; after?: string; json?: boolean }) => {
      const spaceId = requireSpace(sessionsCmd);
      if (!opts.sequence && !opts.turn) return error("Missing anchor", "Use --sequence <n> or --turn <id>");
      const client = createClient();
      try {
        const result = await client.space(spaceId).session(sessionId).turns.window({
          sequence: opts.sequence === undefined ? undefined : Number.parseInt(opts.sequence, 10),
          turnId: opts.turn,
          before: Number.parseInt(opts.before ?? "10", 10),
          after: Number.parseInt(opts.after ?? "20", 10),
        });
        if (opts.json) return outJson(result);
        if (result.turns.length === 0) return console.log("  No turns found");
        table(result.turns, [
          { key: "sequence", label: "Seq" },
          { key: "id", label: "ID" },
          { key: "status", label: "Status" },
          { key: "userText", label: "User" },
          { key: "assistantText", label: "Assistant" },
        ]);
        console.log(`\n  Window — older: ${result.hasMoreOlder ? "yes" : "no"}, newer: ${result.hasMoreNewer ? "yes" : "no"}`);
      } catch (e: unknown) {
        handleHttp(e);
      }
    });
}

// ── Session access operations ──

function registerSessionAccess(sessionsCmd: Command): void {
  const accessCmd = sessionsCmd.command("access").description("Session access control");

  accessCmd
    .command("get <id>")
    .description("Get session access policy")
    .option("--json", "Output as JSON")
    .action(async (id: string, opts: { json?: boolean }) => {
      const client = createClient();
      try {
        const policy = await client.sessionAccess.get(id);
        if (opts.json) return outJson(policy);
        table([policy], [
          { key: "signed_in_user", label: "Signed-in" },
          { key: "anonymous_user", label: "Anonymous" },
        ]);
      } catch (e: unknown) {
        handleHttp(e);
      }
    });

  accessCmd
    .command("set <id>")
    .description("Set session anonymous access")
    .option("--anonymous <role>", "Anonymous role (host|builder|guest|null)")
    .option("--json", "Output as JSON")
    .action(async (id: string, opts: { anonymous?: string; json?: boolean }) => {
      const client = createClient();
      try {
        const policy = await client.sessionAccess.set(id, {
          anonymous_user: (opts.anonymous ?? null) as never,
        });
        if (opts.json) return outJson(policy);
        ok("Session access updated");
        table([policy], [
          { key: "signed_in_user", label: "Signed-in" },
          { key: "anonymous_user", label: "Anonymous" },
        ]);
      } catch (e: unknown) {
        handleHttp(e);
      }
    });

  accessCmd
    .command("remove <id>")
    .description("Remove session access override")
    .action(async (id: string) => {
      const client = createClient();
      try {
        await client.sessionAccess.remove(id);
        ok(`Session access override removed: ${id}`);
      } catch (e: unknown) {
        handleHttp(e);
      }
    });
}

// ── Member operations ──

function registerMembers(spacesCmd: Command): void {
  const memCmd = spacesCmd
    .command("members")
    .description("Member management")
    .hook("preAction", () => { requireSpace(spacesCmd); });

  memCmd
    .command("ls")
    .alias("list")
    .description("List space members")
    .option("--json", "Output as JSON")
    .action(async (opts: { json?: boolean }) => {
      const spaceId = requireSpace(spacesCmd);
      const client = createClient();
      try {
        const result = await client.space(spaceId).members.list();
        if (opts.json) return outJson(result);
        if (result.items.length === 0) {
          console.log("  (empty)");
          return;
        }
        table(result.items, [
          { key: "userId", label: "User ID" },
          { key: "role", label: "Role" },
          { key: "createdAt", label: "Since" },
        ]);
      } catch (e: unknown) {
        handleHttp(e);
      }
    });

  memCmd
    .command("update <userId> <role>")
    .description("Change member role (host | builder | guest)")
    .action(async (userId: string, role: string) => {
      const spaceId = requireSpace(spacesCmd);
      const client = createClient();
      try {
        await client.space(spaceId).members.update(userId, role as never);
        ok(`${userId} → ${role}`);
      } catch (e: unknown) {
        handleHttp(e);
      }
    });

  memCmd
    .command("remove <userId>")
    .description("Remove a member")
    .action(async (userId: string) => {
      const spaceId = requireSpace(spacesCmd);
      const client = createClient();
      try {
        await client.space(spaceId).members.remove(userId);
        ok(`${userId} removed`);
      } catch (e: unknown) {
        handleHttp(e);
      }
    });
}

// ── Access control ──

function registerAccess(spacesCmd: Command): void {
  const accCmd = spacesCmd
    .command("access")
    .description("Access control")
    .hook("preAction", () => { requireSpace(spacesCmd); });

  accCmd
    .command("get")
    .description("Get access policy")
    .option("--json", "Output as JSON")
    .action(async (opts: { json?: boolean }) => {
      const spaceId = requireSpace(spacesCmd);
      const client = createClient();
      try {
        const policy = await client.space(spaceId).access.get();
        if (opts.json) return outJson(policy);
        table([policy], [
          { key: "signed_in_user", label: "Signed-in" },
          { key: "anonymous_user", label: "Anonymous" },
        ]);
      } catch (e: unknown) {
        handleHttp(e);
      }
    });

  accCmd
    .command("set")
    .description("Set access policy")
    .option("--signed-in <role>", "Role for signed-in users (host|builder|guest|null)")
    .option("--anonymous <role>", "Role for anonymous users (host|builder|guest|null)")
    .option("--json", "Output as JSON")
    .action(async (opts: { signedIn?: string; anonymous?: string; json?: boolean }) => {
      const spaceId = requireSpace(spacesCmd);
      const client = createClient();
      try {
        const policy = await client.space(spaceId).access.set({
          signed_in_user: (opts.signedIn ?? null) as never,
          anonymous_user: (opts.anonymous ?? null) as never,
        });
        if (opts.json) return outJson(policy);
        ok("Access policy updated");
        table([policy], [
          { key: "signed_in_user", label: "Signed-in" },
          { key: "anonymous_user", label: "Anonymous" },
        ]);
      } catch (e: unknown) {
        handleHttp(e);
      }
    });
}

// ── Checkpoint operations ──

function registerCheckpoints(spacesCmd: Command): void {
  const cpCmd = spacesCmd
    .command("checkpoints")
    .description("Checkpoint management")
    .hook("preAction", () => { requireSpace(spacesCmd); });

  cpCmd
    .command("ls")
    .alias("list")
    .description("List checkpoints")
    .option("--json", "Output as JSON")
    .action(async (opts: { json?: boolean }) => {
      const spaceId = requireSpace(spacesCmd);
      const client = createClient();
      try {
        const result = await client.space(spaceId).checkpoints.list();
        if (opts.json) return outJson(result);
        if (result.checkpoints.length === 0) {
          console.log("  (empty)");
          return;
        }
        table(result.checkpoints, [
          { key: "id", label: "ID" },
          { key: "commitHash", label: "Commit" },
          { key: "description", label: "Description" },
          { key: "createdAt", label: "Created" },
        ]);
      } catch (e: unknown) {
        handleHttp(e);
      }
    });

  cpCmd
    .command("get <id>")
    .description("Checkpoint details")
    .option("--json", "Output as JSON")
    .action(async (id: string, opts: { json?: boolean }) => {
      const spaceId = requireSpace(spacesCmd);
      const client = createClient();
      try {
        const result = await client.space(spaceId).checkpoints.get(id);
        if (opts.json) return outJson(result);
        table([result.checkpoint], [
          { key: "id", label: "ID" },
          { key: "commitHash", label: "Commit" },
          { key: "description", label: "Description" },
          { key: "forkCount", label: "Forks" },
          { key: "createdAt", label: "Created" },
        ]);
      } catch (e: unknown) {
        handleHttp(e);
      }
    });

  cpCmd
    .command("create [description]")
    .description("Create a checkpoint")
    .option("--json", "Output as JSON")
    .action(async (description: string | undefined, opts: { json?: boolean }) => {
      const spaceId = requireSpace(spacesCmd);
      const client = createClient();
      try {
        const result = await client.space(spaceId).checkpoints.create(description ?? null);
        if (opts.json) return outJson(result);
        ok(`Checkpoint created — taskRunId: ${result.taskRunId}`);
      } catch (e: unknown) {
        handleHttp(e);
      }
    });
}
