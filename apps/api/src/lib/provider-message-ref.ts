export const buildProviderMessageRefMeta = (
  meta: Record<string, unknown> | null | undefined,
  providerEvent: unknown,
) => ({
  ...(meta ?? {}),
  ...(providerEvent === undefined ? {} : { providerEvent }),
});
