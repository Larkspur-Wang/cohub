export const SPACE_HOOKS_DIR = ".cohub/hooks";
export const SPACE_HOOK_SCHEMA = "cohub.space-hook.v1";
export const SPACE_HOOK_TASK_TYPE = "space_hook";
export const SPACE_HOOKS_CACHE_TTL_SEC = 5 * 60;

export const SPACE_HOOKABLE_EVENTS = [
  "space.fs.changed",
  "space.workspace.ready",
  "session.turn.finalized",
  "checkpoint.created",
] as const;

export type SpaceHookableEvent = (typeof SPACE_HOOKABLE_EVENTS)[number];

export const isSpaceHookableEvent = (type: string): type is SpaceHookableEvent =>
  (SPACE_HOOKABLE_EVENTS as readonly string[]).includes(type);

export const getSpaceHooksRedisKey = (spaceId: string) => `cohub:space-hooks:v1:${spaceId}`;
