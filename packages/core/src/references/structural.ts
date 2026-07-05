import type { ReferenceInput } from "./types.js";

/**
 * Structural reference builders. Unlike turn references, these correspond to
 * discrete lifecycle events (a fork, a mod mount, a checkpoint save) that do not
 * belong to a turn, so `sourceTurnId` is left null. Each builder is pure so the
 * same logic serves both the live double-write and the backfill scan.
 */

/** A session forked from another session. */
export const sessionForkReference = (input: {
  spaceId: string;
  parentSessionId: string;
  childSessionId: string;
  anchorTurnId?: string | null;
  createdBy?: string | null;
}): ReferenceInput => ({
  kind: "session_fork",
  sourceType: "session",
  sourceId: input.childSessionId,
  targetType: "session",
  targetId: input.parentSessionId,
  spaceId: input.spaceId,
  sessionId: input.childSessionId,
  meta: {
    ...(input.anchorTurnId ? { anchorTurnId: input.anchorTurnId } : {}),
    ...(input.createdBy ? { createdBy: input.createdBy } : {}),
  },
});

/** A space forked from a checkpoint of another space. */
export const spaceForkReference = (input: {
  spaceId: string;
  baseCheckpointId: string;
  sourceSpaceId?: string | null;
}): ReferenceInput => ({
  kind: "space_fork",
  sourceType: "space",
  sourceId: input.spaceId,
  targetType: "checkpoint",
  targetId: input.baseCheckpointId,
  spaceId: input.spaceId,
  meta: input.sourceSpaceId ? { sourceSpaceId: input.sourceSpaceId } : null,
});

/** A checkpoint derived from a parent checkpoint. */
export const checkpointForkReference = (input: {
  spaceId: string;
  checkpointId: string;
  parentCheckpointId: string;
  rootCheckpointId?: string | null;
}): ReferenceInput => ({
  kind: "checkpoint_fork",
  sourceType: "checkpoint",
  sourceId: input.checkpointId,
  targetType: "checkpoint",
  targetId: input.parentCheckpointId,
  spaceId: input.spaceId,
  meta: input.rootCheckpointId ? { rootCheckpointId: input.rootCheckpointId } : null,
});

/** A space mounting another space as a mod. */
export const modReference = (input: {
  spaceId: string;
  modSpaceId: string;
  mountSlug?: string | null;
}): ReferenceInput => ({
  kind: "mod",
  sourceType: "space",
  sourceId: input.spaceId,
  targetType: "space",
  targetId: input.modSpaceId,
  spaceId: input.spaceId,
  meta: input.mountSlug ? { mountSlug: input.mountSlug } : null,
});

/** A user participating in a session (turn-less structural form, e.g. on join). */
export const participantReference = (input: {
  spaceId: string;
  sessionId: string;
  userUuid: string;
}): ReferenceInput => ({
  kind: "participant",
  sourceType: "user",
  sourceId: input.userUuid,
  targetType: "session",
  targetId: input.sessionId,
  spaceId: input.spaceId,
  sessionId: input.sessionId,
});
