import type { Command } from "commander";
import { authSource, loginWithDeviceFlow, readAuthSession, refreshAccessToken, requestDeviceCode, revokeAndClearAuthSession, verifyDeviceCode } from "../auth.js";
import { createClient } from "../client.js";
import { table, json as outJson, jsonRequested, ok, error, spinner, handleHttp } from "../output.js";

type LoginOptions = {
  requestCode?: boolean;
  verifyCode?: boolean;
  json?: boolean;
};

export function registerAuth(program: Command): void {
  const auth = program.command("auth").description("Authentication management");

  auth
    .command("login")
    .description("Sign in with Logto device authorization")
    .option("--request-code", "Request a device code without polling")
    .option("--verify-code", "Exchange a previously requested device code")
    .option("--json", "Output as JSON")
    .action(async (opts: LoginOptions) => {
      const asJson = jsonRequested(opts);
      if (opts.requestCode && opts.verifyCode) {
        return error("Conflicting options", "Use only one of --request-code or --verify-code");
      }

      try {
        if (opts.requestCode) {
          const code = await requestDeviceCode();
          if (asJson) return outJson(code);
          printDeviceCode(code);
          return;
        }

        if (opts.verifyCode) {
          await verifyDeviceCode();
          return showSignedIn(asJson);
        }

        const sp = spinner();
        sp.start("Starting login");
        await loginWithDeviceFlow((code) => {
          sp.stop("Login started");
          printDeviceCode(code);
          process.stderr.write("  Waiting for authorization...\n");
        });
        return showSignedIn(asJson);
      } catch (e: unknown) {
        handleHttp(e);
      }
    });

  auth
    .command("whoami")
    .description("Show current user info")
    .option("--json", "Output as JSON")
    .action(async (opts: { json?: boolean }) => {
      const asJson = jsonRequested(opts);
      return showSignedIn(asJson);
    });

  auth
    .command("refresh")
    .description("Refresh the stored Logto access token")
    .action(async () => {
      try {
        if (authSource() === "execution-token") {
          return error("Cannot refresh COHUB_EXECUTION_TOKEN", "Run `cohub auth login` for long-lived Logto auth.");
        }
        await refreshAccessToken();
        ok("Token refreshed");
      } catch (e: unknown) {
        handleHttp(e);
      }
    });

  auth
    .command("logout")
    .description("Clear stored Logto session")
    .action(async () => {
      await revokeAndClearAuthSession();
      if (process.env.COHUB_EXECUTION_TOKEN?.trim()) {
        ok("Local session cleared. COHUB_EXECUTION_TOKEN is still set.");
      } else {
        ok("Signed out");
      }
    });
}

async function showSignedIn(asJson?: boolean): Promise<void> {
  const source = authSource();
  if (!source) return error("Not authenticated", "Run `cohub auth login`.");

  const client = createClient();
  const sp = spinner();
  sp.start("Fetching user info");

  try {
    const user = await client.user.getMe();
    sp.stop("Done");
    const session = readAuthSession();
    const payload = {
      source,
      refreshable: source === "logto" && Boolean(session?.refreshToken),
      user,
    };
    if (asJson) return outJson(payload);
    const u = user as Record<string, unknown>;
    console.log(`  Auth source: ${source}`);
    console.log(`  Token: ${payload.refreshable ? "refreshable" : "ephemeral"}\n`);
    table([u], [
      { key: "id", label: "ID" },
      { key: "username", label: "Username" },
      { key: "name", label: "Name" },
      { key: "email", label: "Email" },
      { key: "created_at", label: "Created" },
    ]);
  } catch (e: unknown) {
    sp.stop("Failed");
    handleHttp(e);
  }
}

function printDeviceCode(code: { userCode: string; verificationUriComplete: string; expiresAt: number }): void {
  console.log("\nOpen this URL to sign in:\n");
  console.log(`  ${code.verificationUriComplete}\n`);
  console.log("Or enter this code manually:\n");
  console.log(`  ${code.userCode}\n`);
  console.log(`Code expires at ${new Date(code.expiresAt).toLocaleString()}.`);
}
