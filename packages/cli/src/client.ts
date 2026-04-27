import { CohubHttpClient } from "@neta-art/cohub/http";

export function createClient(token: string, baseUrl?: string): CohubHttpClient {
  return new CohubHttpClient({
    baseUrl,
    getAccessToken: () => token,
  });
}
