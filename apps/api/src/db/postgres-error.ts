type ErrorRecord = {
  cause?: unknown;
  code?: unknown;
  constraint?: unknown;
  constraint_name?: unknown;
};

function asErrorRecord(value: unknown): ErrorRecord | null {
  return typeof value === "object" && value !== null ? value as ErrorRecord : null;
}

const SQLSTATE_PATTERN = /^[0-9A-Z]{5}$/;

function findPostgresError(error: unknown): ErrorRecord | null {
  const seen = new Set<object>();
  let current = asErrorRecord(error);

  while (current && !seen.has(current)) {
    seen.add(current);
    if (typeof current.code === "string" && SQLSTATE_PATTERN.test(current.code)) return current;
    current = asErrorRecord(current.cause);
  }

  return null;
}

export function getPostgresErrorCode(error: unknown): string | null {
  const code = findPostgresError(error)?.code;
  return typeof code === "string" ? code : null;
}

export function getPostgresErrorConstraint(error: unknown): string | null {
  const record = findPostgresError(error);
  if (!record) return null;
  const constraint = record.constraint_name ?? record.constraint;
  return typeof constraint === "string" ? constraint : null;
}

export function isPostgresUniqueViolation(error: unknown, constraint?: string): boolean {
  if (getPostgresErrorCode(error) !== "23505") return false;
  return constraint === undefined || getPostgresErrorConstraint(error) === constraint;
}
