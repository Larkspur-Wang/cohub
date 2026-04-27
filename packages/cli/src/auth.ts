import { readFileSync, existsSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const TOKEN_DIR = join(homedir(), ".config", "cohub");
const TOKEN_PATH = join(TOKEN_DIR, "token");

/**
 * Resolve auth token with priority:
 *   1. COHUB_EXECUTION_TOKEN environment variable
 *   2. ~/.config/cohub/token file
 */
export function resolveToken(): string | null {
  if (process.env.COHUB_EXECUTION_TOKEN) {
    return process.env.COHUB_EXECUTION_TOKEN.trim();
  }
  if (existsSync(TOKEN_PATH)) {
    return readFileSync(TOKEN_PATH, "utf-8").trim();
  }
  return null;
}

export function saveToken(token: string): void {
  mkdirSync(TOKEN_DIR, { recursive: true });
  writeFileSync(TOKEN_PATH, token.trim());
}

export function clearToken(): void {
  if (existsSync(TOKEN_PATH)) {
    rmSync(TOKEN_PATH);
  }
}

export function tokenSource(): "env" | "file" | null {
  if (process.env.COHUB_EXECUTION_TOKEN) return "env";
  if (existsSync(TOKEN_PATH)) return "file";
  return null;
}
