/**
 * System-reserved environment variables that users cannot create or override.
 * Shared between API (validation) and Agent (process injection).
 */
export const SYSTEM_ENV_KEYS = [
  // sandbox pod-level
  "SPACE_ID",
  "WORKSPACE_DIR",
  "PLATFORM_AGENTS_DIR",
  "USER_AGENTS_DIR",
  "IMAGE_VERSION",
  "POD_IP",
  "INTERNAL_API_BASE_URL",
  "PUBLIC_URL_PREFIX",
  "SANDBOX_REPORT_TOKEN",
  // agent process-level
  "COHUB_EXECUTION_TOKEN",
] as const;

export const SYSTEM_ENV_KEY_SET: Set<string> = new Set(SYSTEM_ENV_KEYS);

/** Redis key pattern for space-level user env cache */
export const SPACE_ENV_REDIS_KEY = (spaceId: string) => `space:env:${spaceId}`;
