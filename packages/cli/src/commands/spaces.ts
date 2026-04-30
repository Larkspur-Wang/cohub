import type { Command } from "commander";
import { resolveToken } from "../auth.js";
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

export function registerSpaces(program: Command): void {
  const spacesCmd = program.command("spaces").description("Space management");

  // ── spaces ls ──
  spacesCmd
    .command("ls")
    .alias("list")
    .description("List all spaces")
    .option("--json", "Output as JSON")
    .action(async (opts: { json?: boolean }) => {
      const token = resolveToken() ?? missingAuth();
      const client = createClient(token);
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
      const token = resolveToken() ?? missingAuth();
      const client = createClient(token);
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
    .option("--json", "Output as JSON")
    .action(async (opts: { name?: string; description?: string; json?: boolean }) => {
      const token = resolveToken() ?? missingAuth();
      const client = createClient(token);
      try {
        const result = await client.spaces.create({
          name: opts.name,
          description: opts.description,
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
      const token = resolveToken() ?? missingAuth();
      const client = createClient(token);
      try {
        await client.space(id).rename(name);
        ok(`Space renamed to "${name}"`);
      } catch (e: unknown) {
        handleHttp(e);
      }
    });

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

  // ── spaces usage ──
  spacesCmd
    .command("usage [days]")
    .description("Space usage statistics (default: 30 days)")
    .option("--json", "Output as JSON")
    .action(async (days: string | undefined, opts: { json?: boolean }) => {
      const token = resolveToken() ?? missingAuth();
      const spaceId = requireSpace(spacesCmd);
      const client = createClient(token);
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
      const token = resolveToken() ?? missingAuth();
      const spaceId = requireSpace(spacesCmd);
      const client = createClient(token);
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
      const token = resolveToken() ?? missingAuth();
      const spaceId = requireSpace(spacesCmd);
      const client = createClient(token);
      try {
        const file = await client.space(spaceId).files.read(path);
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
      const token = resolveToken() ?? missingAuth();

      let content = opts.content ?? "";
      if (!content && !process.stdin.isTTY) {
        const chunks: Buffer[] = [];
        for await (const chunk of process.stdin) chunks.push(chunk);
        content = Buffer.concat(chunks).toString();
      }
      if (!content) return error("No content provided", "Use -c or pipe via stdin");

      const spaceId = requireSpace(spacesCmd);
      const client = createClient(token);
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
    .command("mkdir <path>")
    .description("Create a directory")
    .action(async (path: string) => {
      const token = resolveToken() ?? missingAuth();
      const spaceId = requireSpace(spacesCmd);
      const client = createClient(token);
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
      const token = resolveToken() ?? missingAuth();
      const spaceId = requireSpace(spacesCmd);
      const client = createClient(token);
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
      const token = resolveToken() ?? missingAuth();
      const spaceId = requireSpace(spacesCmd);
      const client = createClient(token);
      try {
        await client.space(spaceId).files.move({ fromPath: from, toPath: to });
        ok(`Moved: ${from} → ${to}`);
      } catch (e: unknown) {
        handleHttp(e);
      }
    });

  filesCmd
    .command("upload <files...>")
    .description("Upload files to a directory")
    .option("--dir <dir>", "Target directory", "")
    .action(async (_files: string[]) => {
      error("Upload requires browser File API", "Use the web interface for now");
    });
}

// ── Session operations ──

function registerSessions(spacesCmd: Command): void {
  const sessionsCmd = spacesCmd
    .command("sessions")
    .description("Session operations")
    .hook("preAction", () => { requireSpace(spacesCmd); });

  sessionsCmd
    .command("ls")
    .alias("list")
    .description("List sessions")
    .option("--json", "Output as JSON")
    .action(async (opts: { json?: boolean }) => {
      const token = resolveToken() ?? missingAuth();
      const spaceId = requireSpace(spacesCmd);
      const client = createClient(token);
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
      const token = resolveToken() ?? missingAuth();
      const spaceId = requireSpace(spacesCmd);
      const client = createClient(token);
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
      const token = resolveToken() ?? missingAuth();
      const spaceId = requireSpace(spacesCmd);
      const client = createClient(token);
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
      const token = resolveToken() ?? missingAuth();
      const spaceId = requireSpace(spacesCmd);
      const client = createClient(token);
      try {
        await client.space(spaceId).session(id).rename(name);
        ok(`Session renamed to "${name}"`);
      } catch (e: unknown) {
        handleHttp(e);
      }
    });

  // ── sessions messages ──
  registerMessages(sessionsCmd);

  // ── sessions tail ──
  sessionsCmd
    .command("tail <id>")
    .description("Stream realtime session events")
    .option("--json", "Output as JSON")
    .action(async (id: string, opts: { json?: boolean }) => {
      const token = resolveToken() ?? missingAuth();
      const spaceId = requireSpace(spacesCmd);
      const client = createClient(token);
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
}

// ── Message operations ──

function registerMessages(sessionsCmd: Command): void {
  const msgsCmd = sessionsCmd.command("messages").description("Message operations");

  msgsCmd
    .command("ls <sessionId>")
    .alias("list")
    .description("List session messages")
    .option("--json", "Output as JSON")
    .option("--limit <n>", "Page size", "50")
    .action(async (sessionId: string, opts: { json?: boolean; limit?: string }) => {
      const token = resolveToken() ?? missingAuth();
      const spaceId = requireSpace(sessionsCmd);
      const client = createClient(token);
      try {
        const result = await client.space(spaceId).session(sessionId).messages.listPaginated({
          limit: Number.parseInt(opts.limit ?? "50", 10),
        });
        if (opts.json) return outJson(result);
        if (result.messages.length === 0) {
          console.log("  (empty)");
          return;
        }
        table(result.messages, [
          { key: "id", label: "ID" },
          { key: "role", label: "Role" },
          { key: "createdAt", label: "Created" },
        ]);
        if (result.hasMore) {
          console.log(`\n  (more — use --cursor ${result.nextCursor} for next page)`);
        }
      } catch (e: unknown) {
        handleHttp(e);
      }
    });

  msgsCmd
    .command("send <sessionId> [content...]")
    .description("Send a message to a session")
    .option("-m, --model <model>", "Model name")
    .option("-p, --provider <provider>", "Provider name")
    .option("--json", "Output as JSON")
    .action(async (sessionId: string, words: string[], opts: { model?: string; provider?: string; json?: boolean }) => {
      const token = resolveToken() ?? missingAuth();

      let content = words.join(" ");
      if (!content && !process.stdin.isTTY) {
        const chunks: Buffer[] = [];
        for await (const chunk of process.stdin) chunks.push(chunk);
        content = Buffer.concat(chunks).toString().trim();
      }
      if (!content) return error("No content", "Pass as argument or pipe via stdin");

      const spaceId = requireSpace(sessionsCmd);
      const client = createClient(token);
      try {
        const result = await client.space(spaceId).session(sessionId).messages.send({
          content: [{ type: "text", text: content }],
          model: opts.model,
          provider: opts.provider,
        });
        if (opts.json) return outJson(result);
        ok(`Message sent — userMessageId: ${result.userMessageId}`);
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
      const token = resolveToken() ?? missingAuth();
      const spaceId = requireSpace(spacesCmd);
      const client = createClient(token);
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
      const token = resolveToken() ?? missingAuth();
      const spaceId = requireSpace(spacesCmd);
      const client = createClient(token);
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
      const token = resolveToken() ?? missingAuth();
      const spaceId = requireSpace(spacesCmd);
      const client = createClient(token);
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
      const token = resolveToken() ?? missingAuth();
      const spaceId = requireSpace(spacesCmd);
      const client = createClient(token);
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
      const token = resolveToken() ?? missingAuth();
      const spaceId = requireSpace(spacesCmd);
      const client = createClient(token);
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
      const token = resolveToken() ?? missingAuth();
      const spaceId = requireSpace(spacesCmd);
      const client = createClient(token);
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
      const token = resolveToken() ?? missingAuth();
      const spaceId = requireSpace(spacesCmd);
      const client = createClient(token);
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
      const token = resolveToken() ?? missingAuth();
      const spaceId = requireSpace(spacesCmd);
      const client = createClient(token);
      try {
        const result = await client.space(spaceId).checkpoints.create(description ?? null);
        if (opts.json) return outJson(result);
        ok(`Checkpoint created — taskRunId: ${result.taskRunId}`);
      } catch (e: unknown) {
        handleHttp(e);
      }
    });
}

function missingAuth(): never {
  return error("Not authenticated", "Run 'cohub auth login <token>'");
}
