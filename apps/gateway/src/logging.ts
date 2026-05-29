export function summarizeRedisUrl(value: string | undefined | null): string {
  if (!value) return "not set";
  try {
    const url = new URL(value);
    const db = url.pathname && url.pathname !== "/" ? url.pathname.slice(1) : "0";
    return `${url.protocol}//${url.hostname}${url.port ? `:${url.port}` : ""}/${db}`;
  } catch {
    return "invalid redis url";
  }
}
