export const SPACE_HOOKS_DIR = ".cohub/hooks";
export const SPACE_HOOK_SCHEMA = "cohub.space-hook.v1";
export const SPACE_HOOK_TASK_TYPE = "space_hook";
/** Positive cache TTL when at least one hook definition was loaded. */
export const SPACE_HOOKS_CACHE_TTL_SEC = 5 * 60;
/** Negative cache TTL for empty definitions — still cuts readdir IO, heals PVC lag quickly. */
export const SPACE_HOOKS_EMPTY_CACHE_TTL_SEC = 30;

export const SPACE_HOOKABLE_EVENTS = [
  "space.fs.changed",
  "space.workspace.ready",
  "session.turn.finalized",
  "checkpoint.created",
] as const;

export type SpaceHookableEvent = (typeof SPACE_HOOKABLE_EVENTS)[number];

/** Lightweight event envelope carried by space_hook tasks. */
export type SpaceHookEventEnvelope = {
  id: string;
  type: string;
  timestamp: number;
  spaceId: string;
  sessionId?: string | null;
  payload: Record<string, unknown>;
};

export const isSpaceHookableEvent = (type: string): type is SpaceHookableEvent =>
  (SPACE_HOOKABLE_EVENTS as readonly string[]).includes(type);

export const getSpaceHooksRedisKey = (spaceId: string) => `cohub:space-hooks:v1:${spaceId}`;
