export const UUID_SHAPE_PATTERN = "[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}";
export const UUID_PATTERN = "[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}";
export const SHORT_UUID_PATTERN = "[0-9a-fA-F]{32}";
export const UUID_OR_SHORT_UUID_PATTERN = `^(?:${UUID_PATTERN}|${SHORT_UUID_PATTERN})$`;

const UUID_SHAPE_REGEX = new RegExp(`^${UUID_SHAPE_PATTERN}$`);
const UUID_REGEX = new RegExp(`^${UUID_PATTERN}$`);
const UUID_OR_SHORT_UUID_REGEX = new RegExp(UUID_OR_SHORT_UUID_PATTERN);

export function isUuidLike(value: string): boolean;
export function isUuidLike(value: unknown): value is string;
export function isUuidLike(value: unknown): boolean {
  return typeof value === "string" && UUID_SHAPE_REGEX.test(value);
}

export function isUuid(value: string): boolean;
export function isUuid(value: unknown): value is string;
export function isUuid(value: unknown): boolean {
  return typeof value === "string" && UUID_REGEX.test(value);
}

export function isUuidOrShortUuid(value: string | null | undefined): boolean;
export function isUuidOrShortUuid(value: unknown): value is string;
export function isUuidOrShortUuid(value: unknown): boolean {
  return typeof value === "string" && UUID_OR_SHORT_UUID_REGEX.test(value);
}
