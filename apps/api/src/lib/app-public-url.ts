import {
  createCohubAppOrigin,
  type CohubAppHostTemplate,
} from "@cohub/protocol";
import { config } from "../config.js";

export function getWorkPublicOrigin() {
  return (config.webOrigin ?? (config.env === "prod" ? "https://cohub.live" : "https://dev.cohub.live")).replace(/\/+$/, "");
}

/** Build a public app URL. Returns null when status is provided and not published. */
export function createAppPublicUrl(input: {
  ownerUsername: string;
  spaceSlug: string;
  appSlug: string;
  status?: string;
}): string | null {
  if (input.status !== undefined && input.status !== "published") return null;
  return `${getWorkPublicOrigin()}/${encodeURIComponent(input.ownerUsername)}/${encodeURIComponent(input.spaceSlug)}/w/${encodeURIComponent(input.appSlug)}`;
}

/** Builds a standalone App origin, or null when the feature is not configured or the App is ineligible. */
export function createAppStandaloneUrl(
  input: {
    appId: string;
    status: string;
    visibility: string;
    targetType: string;
    contentKind: string | null | undefined;
  },
  hostTemplate: CohubAppHostTemplate | null = config.appStandaloneHostTemplate,
): string | null {
  if (!hostTemplate) return null;
  if (
    input.status !== "published" ||
    input.visibility !== "public" ||
    (input.targetType !== "file" && input.targetType !== "directory") ||
    input.contentKind !== "web"
  ) return null;
  return createCohubAppOrigin(input.appId, hostTemplate);
}
