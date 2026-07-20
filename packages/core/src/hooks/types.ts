import type { SpaceHookableEvent } from "@cohub/protocol";

export type SpaceHookPromptDefinition = {
  text: string;
  sessionId?: string | null;
  title?: string | null;
  intent?: "followup" | "steer" | null;
  accessMode?: "read_only" | "full_access" | null;
  model?: string | null;
  provider?: string | null;
  labelRefs?: string[] | null;
};

export type SpaceHookDefinition = {
  schema: "cohub.space-hook.v1";
  path: string;
  event: SpaceHookableEvent;
  paths?: string[];
  ignore?: string[];
  kinds?: Array<"create" | "modify" | "delete" | "rename">;
  action: "run" | "prompt";
  run?: string;
  prompt?: SpaceHookPromptDefinition;
  /** User-declared env for both run and prompt. Cannot override system COHUB_* keys. */
  env?: Record<string, string> | null;
  timeoutSecs?: number;
};

export type SpaceHookRunResult = {
  path: string;
  status: "completed" | "failed" | "skipped";
  action?: "run" | "prompt";
  exitCode?: number | null;
  durationMs?: number;
  output?: string;
  truncated?: boolean;
  error?: string;
  reason?: string;
  sessionId?: string | null;
  turnId?: string | null;
  userMessageId?: string | null;
  taskRunId?: string | null;
};

export type SpaceHookTaskResult = {
  eventId: string;
  eventType: string;
  hooks: SpaceHookRunResult[];
  /** Number of parsed hook definitions considered for this event (cache or disk). */
  definitionsCount?: number;
  /** Whether hook definitions came from Redis cache or a disk load. */
  cache?: "hit" | "miss";
  /** Present when the task exits before matching hooks. */
  skipped?: string;
};

export type CachedSpaceHooksConfig = {
  version: 1;
  spaceId: string;
  updatedAt: string;
  definitions: SpaceHookDefinition[];
};
