import { createCohubAppOrigin } from "@cohub/protocol";
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

export function createAppStandaloneUrl(input: {
  appId: string;
  status: string;
  visibility: string;
  targetType: string;
  contentKind: string | null | undefined;
}): string | null {
  if (
    input.status !== "published" ||
    input.visibility !== "public" ||
    (input.targetType !== "file" && input.targetType !== "directory") ||
    input.contentKind !== "web"
  ) return null;
  return createCohubAppOrigin(input.appId, config.env);
}
