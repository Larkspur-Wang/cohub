import { SYSTEM_ENV_KEY_SET } from "@cohub/protocol/sandbox";

export class PromptEnvValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PromptEnvValidationError";
  }
}

export type PromptEnv = Record<string, string>;

export function normalizePromptEnv(input: unknown): PromptEnv | null {
  if (input === undefined || input === null) return null;
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new PromptEnvValidationError("env must be an object");
  }

  const env: PromptEnv = {};
  for (const [rawName, rawValue] of Object.entries(input)) {
    const name = rawName.trim();
    if (!name) throw new PromptEnvValidationError("env name is required");
    if (rawValue === undefined || rawValue === null) throw new PromptEnvValidationError(`env value is required for ${name}`);
    if (SYSTEM_ENV_KEY_SET.has(name)) throw new PromptEnvValidationError(`env name "${name}" is reserved by the system`);
    env[name] = String(rawValue);
  }

  return Object.keys(env).length > 0 ? env : null;
}

export function validatePromptEnv(env: PromptEnv | null): PromptEnv | null {
  if (!env) return null;
  const entries = Object.entries(env).map(([name, value]) => ({ name, value }));
  if (entries.length > 50) throw new PromptEnvValidationError("env cannot exceed 50 entries");
  const seen = new Set<string>();
  for (const entry of entries) {
    if (entry.name.length > 128) throw new PromptEnvValidationError("env name too long");
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(entry.name)) {
      throw new PromptEnvValidationError("env name must start with a letter or underscore and contain only letters, numbers, and underscores");
    }
    if (entry.value.length > 4000) throw new PromptEnvValidationError("env value too long");
    if (seen.has(entry.name)) throw new PromptEnvValidationError(`duplicate env name: ${entry.name}`);
    seen.add(entry.name);
  }
  return env;
}

export function parsePromptEnv(input: unknown): PromptEnv | null {
  return validatePromptEnv(normalizePromptEnv(input));
}
