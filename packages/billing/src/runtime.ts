/** Minimal redis surface used by checkout locks. */
export type CheckoutLockRedis = {
  get: (key: string) => Promise<string | null>;
  set: (key: string, value: string, ...args: never[]) => Promise<unknown>;
  eval: (script: string, numKeys: number, ...args: never[]) => Promise<unknown>;
};

/** Shared checkout-lock redis handle used by the Talesofai provider. */
export const checkoutLockRedisRef: { current: CheckoutLockRedis | null } = {
  current: null,
};
