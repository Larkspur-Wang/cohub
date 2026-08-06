export type ResolvedSpaceCreateSource =
  | { type: "blank" }
  | {
      type: "git_repo";
      repoUrl: string;
      ref: string | null;
    }
  | { type: "checkpoint"; checkpointId: string };

export type ResolvedCreateSpaceTaskSource = {
  source: ResolvedSpaceCreateSource;
  gitToken?: string;
};

type CreateSpaceTaskPayload = {
  data?: {
    source?: unknown;
    gitToken?: unknown;
  } | null;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function resolveCreateSpaceSource(
  payload: CreateSpaceTaskPayload,
): ResolvedCreateSpaceTaskSource {
  const source = payload.data?.source;
  if (source === undefined || source === null) {
    return { source: { type: "blank" } };
  }
  if (!isRecord(source) || typeof source.type !== "string") {
    throw new Error("invalid create space source");
  }
  if (source.type === "blank") return { source: { type: "blank" } };

  if (source.type === "git_repo") {
    const repoUrl = typeof source.repoUrl === "string" ? source.repoUrl.trim() : "";
    if (!repoUrl) throw new Error("git repo url is required");
    if (source.ref !== undefined && source.ref !== null && typeof source.ref !== "string") {
      throw new Error("git ref must be a string");
    }
    const gitToken =
      typeof payload.data?.gitToken === "string"
        ? payload.data.gitToken.trim() || undefined
        : undefined;
    return {
      source: {
        type: "git_repo",
        repoUrl,
        ref: typeof source.ref === "string" ? source.ref.trim() || null : null,
      },
      ...(gitToken ? { gitToken } : {}),
    };
  }

  if (source.type === "checkpoint") {
    const checkpointId =
      typeof source.checkpointId === "string" ? source.checkpointId.trim() : "";
    if (!checkpointId) throw new Error("checkpoint id is required");
    return { source: { type: "checkpoint", checkpointId } };
  }

  throw new Error("invalid create space source");
}
