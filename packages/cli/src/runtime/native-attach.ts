import { createInterface } from "node:readline/promises";
import { installNativeSync } from "./native-install.js";
import { nativeRuntimeRoot, readNativeSyncConfig, type NativeSyncConfig } from "./native-sync.js";
import { serializeDiagnosticError } from "./diagnostics.js";

type Harness = "pi" | "codex";
export type NativeSyncReport = { enabled: boolean; harnesses: Harness[]; note?: string };

/** Already enabled for this exact directory and every requested Harness: installation is idempotent. */
export function nativeSyncSatisfied(config: NativeSyncConfig | null, input: { spaceId: string; root: string; harnesses: Harness[] }): boolean {
  return Boolean(config && config.spaceId === input.spaceId && config.root === input.root && input.harnesses.every((harness) => config.harnesses.includes(harness)));
}

/** One explicit consent prompt, defaulting to yes; native history may contain secrets. */
export async function askNativeSyncConsent(harnesses: Harness[], ask: (question: string) => Promise<string> = defaultAsk) {
  const answer = await ask(`Sync native ${harnesses.join(" / ")} chats in this folder and upload their history (may contain secrets) to this Space? [Y/n] `);
  return /^(|y(es)?)$/i.test(answer.trim());
}

async function defaultAsk(question: string) {
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  try { return await rl.question(question); } finally { rl.close(); }
}

/** Enable native sync after consent; capability or write failures warn and never block the Runtime. */
export async function ensureNativeSync(input: { root: string; spaceId: string; identity: string; harnesses: Harness[]; yes?: boolean; executables?: { pi?: string; codex?: string } }, log: (line: string) => void = (line) => process.stderr.write(line)): Promise<NativeSyncReport> {
  const config = await readNativeSyncConfig(nativeRuntimeRoot(input.spaceId), input.identity).catch(() => null);
  if (nativeSyncSatisfied(config, input)) return { enabled: true, harnesses: config?.harnesses ?? [] };
  if (!input.yes) {
    // Non-interactive sessions cannot consent; they continue without sync instead of failing `up`.
    if (!process.stdin.isTTY) {
      log("Native sync off · rerun interactively or with --yes to enable\n");
      return { enabled: false, harnesses: input.harnesses, note: "non-interactive" };
    }
    if (!await askNativeSyncConsent(input.harnesses)) return { enabled: false, harnesses: input.harnesses, note: "declined" };
  }
  try {
    const result = await installNativeSync(input);
    log(`Native sync enabled. Reload Pi or restart Codex and review its hook trust prompt.\n${result.configPath}`);
    return { enabled: true, harnesses: result.harnesses };
  } catch (error) {
    const message = serializeDiagnosticError(error).message;
    log(`Native sync unavailable; Runtime continues without it — ${message}\n`);
    return { enabled: false, harnesses: input.harnesses, note: message };
  }
}
