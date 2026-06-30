import type { Context } from "hono";

export function jsonError(
  c: Context,
  input: {
    status: number;
    message: string;
    code?: string;
    extra?: Record<string, unknown>;
  },
) {
  return c.json({
    message: input.message,
    ...(input.code ? { code: input.code } : {}),
    ...(input.extra ?? {}),
  }, input.status as never);
}
