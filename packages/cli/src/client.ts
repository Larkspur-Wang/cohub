import { CohubHttpClient } from "@neta-art/cohub";

export function createClient(token: string): CohubHttpClient {
  return new CohubHttpClient({
    getAccessToken: () => token,
  });
}
