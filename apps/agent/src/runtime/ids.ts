export const UUID_PATTERN = "[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}";
export const SHORT_UUID_PATTERN = "[0-9a-fA-F]{32}";
export const UUID_OR_SHORT_UUID_PATTERN = `^(?:${UUID_PATTERN}|${SHORT_UUID_PATTERN})$`;

const UUID_OR_SHORT_UUID_REGEX = new RegExp(UUID_OR_SHORT_UUID_PATTERN);

export function isValidId(value: string): boolean {
  return UUID_OR_SHORT_UUID_REGEX.test(value);
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
