import type { Command } from "commander";
import { resolveToken, saveToken, clearToken, tokenSource, getTokenPath } from "../auth.js";
import { createClient } from "../client.js";
import { table, json as outJson, ok, error, spinner, handleHttp } from "../output.js";

export function registerAuth(program: Command): void {
  const auth = program.command("auth").description("Authentication management");

  auth
    .command("login <token>")
    .description("Set auth token for the current environment")
    .action((token: string) => {
      try {
        saveToken(token);
        ok(`Token saved to ${getTokenPath()}`);
      } catch (e: unknown) {
        return error(e instanceof Error ? e.message : String(e));
      }
    });

  auth
    .command("whoami")
    .description("Show current user info")
    .option("--json", "Output as JSON")
    .action(async (opts: { json?: boolean }) => {
      const token = resolveToken();
      if (!token) return error("Not authenticated", "Run 'cohub auth login <token>'");

      const client = createClient(token);
      const sp = spinner();
      sp.start("Fetching user info");

      try {
        const user = await client.user.getMe();
        sp.stop("Done");

        if (opts.json) return outJson(user);
        const src = tokenSource();
        const u = user as Record<string, unknown>;
        console.log(`  Auth source: ${src}\n`);
        table([u], [
          { key: "id", label: "ID" },
          { key: "name", label: "Name" },
          { key: "email", label: "Email" },
          { key: "created_at", label: "Created" },
        ]);
      } catch (e: unknown) {
        sp.stop("Failed");
        handleHttp(e);
      }
    });

  auth
    .command("logout")
    .description("Clear stored token")
    .action(() => {
      clearToken();
      ok("Token cleared");
    });
}
