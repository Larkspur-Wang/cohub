import type { Command } from "commander";
import { createClient } from "../client.js";
import { table, json as outJson, jsonRequested, error, handleHttp } from "../output.js";

const SPACE_ROLES = ["host", "builder", "guest"] as const;

function parseAnonymousRole(value: string | undefined): "host" | "builder" | "guest" | null {
  if (value === undefined || value === "null") return null;
  if ((SPACE_ROLES as readonly string[]).includes(value)) return value as "host" | "builder" | "guest";
  return error("Invalid anonymous role", "Use one of: host, builder, guest, null");
}

export function registerSessionAccess(program: Command): void {
  const cmd = program
    .command("session-access")
    .description("Session-level access control");

  cmd
    .command("get <id>")
    .description("Get session access policy")
    .option("--json", "Output as JSON")
    .action(async (id: string, opts: { json?: boolean }) => {
      const client = createClient();
      try {
        const policy = await client.sessionAccess.get(id);
        if (jsonRequested(opts)) return outJson(policy);
        table([policy], [
          { key: "signed_in_user", label: "Signed-in" },
          { key: "anonymous_user", label: "Anonymous" },
        ]);
      } catch (e: unknown) {
        handleHttp(e);
      }
    });

  cmd
    .command("set <id>")
    .description("Set session anonymous access")
    .option("--anonymous <role>", "Anonymous role (host|builder|guest|null)")
    .option("--json", "Output as JSON")
    .action(async (id: string, opts: { anonymous?: string; json?: boolean }) => {
      const client = createClient();
      try {
        const policy = await client.sessionAccess.set(id, {
          anonymous_user: parseAnonymousRole(opts.anonymous),
        });
        if (jsonRequested(opts)) return outJson(policy);
        console.log("Session access updated");
        table([policy], [
          { key: "signed_in_user", label: "Signed-in" },
          { key: "anonymous_user", label: "Anonymous" },
        ]);
      } catch (e: unknown) {
        handleHttp(e);
      }
    });

  cmd
    .command("remove <id>")
    .description("Remove session access override")
    .action(async (id: string) => {
      const client = createClient();
      try {
        await client.sessionAccess.remove(id);
        console.log(`Session access override removed: ${id}`);
      } catch (e: unknown) {
        handleHttp(e);
      }
    });
}
