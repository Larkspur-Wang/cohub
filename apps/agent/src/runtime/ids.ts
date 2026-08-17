import { isUuidOrShortUuid, UUID_OR_SHORT_UUID_PATTERN } from "@cohub/protocol/identifiers";

export { UUID_OR_SHORT_UUID_PATTERN };

export function isValidId(value: string): boolean {
  return isUuidOrShortUuid(value);
}

export function assertValidId(value: string, label = "id") {
  const trimmed = value.trim();
  if (!trimmed || !isValidId(trimmed)) {
    throw new Error(`Invalid ${label}: expected a UUID, got ${JSON.stringify(value)}.`);
  }
  return trimmed;
}

export function assertValidUserId(userId: string) {
  return assertValidId(userId, "userId");
}

export function assertValidSpaceId(spaceId: string) {
  return assertValidId(spaceId, "space_id");
}
