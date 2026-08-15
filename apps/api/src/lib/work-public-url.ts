import { config } from "../config.js";

export function getWorkPublicOrigin() {
  return (config.webOrigin ?? (config.env === "prod" ? "https://cohub.live" : "https://dev.cohub.live")).replace(/\/+$/, "");
}

/** Build a public Work URL. Returns null when status is provided and not published. */
export function createWorkPublicUrl(input: {
  ownerUsername: string;
  spaceSlug: string;
  workSlug: string;
  status?: string;
}): string | null {
  if (input.status !== undefined && input.status !== "published") return null;
  return `${getWorkPublicOrigin()}/${encodeURIComponent(input.ownerUsername)}/${encodeURIComponent(input.spaceSlug)}/w/${encodeURIComponent(input.workSlug)}`;
}
