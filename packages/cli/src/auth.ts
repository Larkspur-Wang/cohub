import { resolveCohubEnvironment } from "@neta-art/cohub";
import { readFileSync, existsSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const TOKEN_DIR = join(homedir(), ".config", "cohub");
export const getTokenPath = () =>
  join(TOKEN_DIR, resolveCohubEnvironment() === "dev" ? "token.dev" : "token");

/**
 * Resolve auth token with priority:
 *   1. COHUB_EXECUTION_TOKEN environment variable
 *   2. current environment token file
 *      - prod: ~/.config/cohub/token
 *      - dev: ~/.config/cohub/token.dev
 */
export function resolveToken(): string | null {
  if (process.env.COHUB_EXECUTION_TOKEN) {
    return process.env.COHUB_EXECUTION_TOKEN.trim();
  }
  const path = getTokenPath();
  if (existsSync(path)) {
    return readFileSync(path, "utf-8").trim();
  }
  return null;
}

export function saveToken(token: string): void {
  const trimmed = token.trim();
  if (!trimmed) throw new Error("Token cannot be empty");
  mkdirSync(TOKEN_DIR, { recursive: true });
  writeFileSync(getTokenPath(), trimmed);
}

export function clearToken(): void {
  const path = getTokenPath();
  if (existsSync(path)) {
    rmSync(path);
  }
}

export function tokenSource(): "env" | "file" | null {
  if (process.env.COHUB_EXECUTION_TOKEN) return "env";
  if (existsSync(getTokenPath())) return "file";
  return null;
}
