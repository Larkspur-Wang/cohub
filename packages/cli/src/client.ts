import { CohubHttpClient } from "@neta-art/cohub";
import { clearDeviceCode, resolveAccessToken } from "./auth.js";

export function createClient(): CohubHttpClient {
  return new CohubHttpClient({
    getAccessToken: resolveAccessToken,
    onUnauthorized: clearDeviceCode,
  });
}
