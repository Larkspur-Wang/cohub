import type { ReferenceKind, ReferenceResourceType } from "@cohub/db";

export type { ReferenceKind, ReferenceResourceType };

/**
 * A single reference observed from a source resource to a target resource.
 * Produced by the pure extractors and consumed by the idempotent writer.
 */
export type ReferenceInput = {
  kind: ReferenceKind;
  sourceType: ReferenceResourceType;
  sourceId: string;
  /** Turn where the reference occurred; omit for structural references. */
  sourceTurnId?: string | null;
  targetType: ReferenceResourceType;
  targetId: string;
  spaceId: string;
  sessionId?: string | null;
  /** Occurrences within the source turn. Defaults to 1. */
  count?: number;
  meta?: Record<string, unknown> | null;
};
