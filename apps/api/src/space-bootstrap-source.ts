import type { SpaceBootstrapSource } from "./space-create.js";

export type SpaceBootstrapSourceInput =
  | {
      type?: unknown;
      repoUrl?: unknown;
      ref?: unknown;
      checkpointId?: unknown;
    }
  | null
  | undefined;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function sanitizeRepoUrl(url: string): string {
  try {
    const parsed = new URL(url);
    parsed.username = "";
    parsed.password = "";
    return parsed.toString();
  } catch {
    return url;
  }
}

export function sanitizeSpaceBootstrapSource(source: unknown): unknown {
  if (!isRecord(source)) return source;
  const { gitToken: _gitToken, ...sanitized } = source;
  if (sanitized.type === "git_repo" && typeof sanitized.repoUrl === "string") {
    sanitized.repoUrl = sanitizeRepoUrl(sanitized.repoUrl);
  }
  return sanitized;
}

export function normalizeSpaceBootstrapSource(
  source: SpaceBootstrapSourceInput,
  isValidCheckpointId: (value: string) => boolean,
): SpaceBootstrapSource {
  if (!source) return { type: "blank" };
  if (source.type === "blank") return { type: "blank" };

  if (source.type === "git_repo") {
    const repoUrl = typeof source.repoUrl === "string" ? source.repoUrl.trim() : "";
    if (!repoUrl) throw new Error("repoUrl is required");
    if (source.ref !== undefined && source.ref !== null && typeof source.ref !== "string") {
      throw new Error("ref must be a string");
    }
    return {
      type: "git_repo",
      repoUrl,
      ref: typeof source.ref === "string" ? source.ref.trim() || null : null,
    };
  }

  if (source.type === "checkpoint") {
    const checkpointId =
      typeof source.checkpointId === "string" ? source.checkpointId.trim() : "";
    if (!checkpointId || !isValidCheckpointId(checkpointId)) {
      throw new Error("checkpointId is required");
    }
    return { type: "checkpoint", checkpointId };
  }

  throw new Error("invalid bootstrap source");
}
