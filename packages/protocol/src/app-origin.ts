import { isUuid } from "./identifiers.js";

export type CohubAppEnvironment = "prod" | "dev";

export const COHUB_APP_HOST_SUFFIXES = {
  prod: "apps.cohub.live",
  dev: "apps-dev.cohub.live",
} as const satisfies Record<CohubAppEnvironment, string>;

export function createCohubAppHostname(
  appId: string,
  environment: CohubAppEnvironment,
): string {
  return `${appId}.${COHUB_APP_HOST_SUFFIXES[environment]}`;
}

export function createCohubAppOrigin(
  appId: string,
  environment: CohubAppEnvironment,
): string {
  return `https://${createCohubAppHostname(appId, environment)}`;
}

export function isCohubAppHostname(
  hostname: string,
  environment: CohubAppEnvironment,
): boolean {
  const suffix = COHUB_APP_HOST_SUFFIXES[environment];
  const normalized = hostname.trim().toLowerCase();
  if (!normalized.endsWith(`.${suffix}`)) return false;
  return isUuid(normalized.slice(0, -(suffix.length + 1)));
}

/** Resolves only Cohub-owned standalone origins. Custom domains can be added behind the same API later. */
export function resolveCohubAppOrigin(
  origin: string | null | undefined,
  environment: CohubAppEnvironment,
): string | null {
  if (!origin) return null;
  try {
    const url = new URL(origin);
    if (url.protocol !== "https:" || url.port || url.origin !== origin) return null;
    if (!isCohubAppHostname(url.hostname, environment)) return null;
    const suffix = COHUB_APP_HOST_SUFFIXES[environment];
    return url.hostname.slice(0, -(suffix.length + 1)).toLowerCase();
  } catch {
    return null;
  }
}
