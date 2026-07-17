import { CohubHttpClient, readRequestSourceFromEnv } from "@neta-art/cohub";
import { clearAuthSession, resolveAccessToken } from "./auth.js";

export function createClient(): CohubHttpClient {
  return new CohubHttpClient({
    getAccessToken: resolveAccessToken,
    onUnauthorized: clearAuthSession,
    requestSource: () =>
      readRequestSourceFromEnv(process.env as Record<string, string | undefined>, { via: "cli" }) ?? {
        via: "cli",
      },
  });
}
