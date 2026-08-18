import type { Redis } from "ioredis";

/** Minimal redis surface used by checkout locks. */
export type CheckoutLockRedis = Pick<Redis, "get" | "set" | "eval">;

/** Shared checkout-lock redis handle used by the Talesofai provider. */
export const checkoutLockRedisRef: { current: CheckoutLockRedis | null } = {
  current: null,
};
