import type { CohubHttpClient, WorkGetResponse } from "@neta-art/cohub";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const USERNAME_PATTERN = /^(?!-)(?!.*--)[a-z0-9-]{1,39}(?<!-)$/;
const SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9_-]{0,78}[a-z0-9])?$/;

type WorkPublicRef = {
  username: string;
  spaceSlug: string;
  workSlug: string;
};

export type ParsedWorkRef = { id: string } | WorkPublicRef;

function decodePart(value: string) {
  try {
    return decodeURIComponent(value).trim();
  } catch {
    return "";
  }
}

function publicRef(parts: string[]): WorkPublicRef | null {
  if (parts.length !== 3) return null;
  const [username = "", spaceSlug = "", workSlug = ""] = parts.map(decodePart);
  return USERNAME_PATTERN.test(username) && SLUG_PATTERN.test(spaceSlug) && SLUG_PATTERN.test(workSlug)
    ? { username, spaceSlug, workSlug }
    : null;
}

function parseUrlRef(value: string): ParsedWorkRef | null {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  const parts = url.pathname.split("/").filter(Boolean);
  if (url.protocol === "cohub:" && url.hostname === "works") return publicRef(parts) ?? null;
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  if (parts.length === 4 && parts[0] === "spaces" && UUID_PATTERN.test(parts[1] ?? "") && parts[2] === "works" && UUID_PATTERN.test(parts[3] ?? "")) {
    return { id: parts[3] as string };
  }
  if (parts.length === 4 && parts[2] === "w") return publicRef([parts[0] as string, parts[1] as string, parts[3] as string]);
  return null;
}

export function parseWorkRef(input: string): ParsedWorkRef {
  const value = input.trim();
  if (UUID_PATTERN.test(value)) return { id: value };

  const parsedUrl = parseUrlRef(value.includes("://") ? value : value.startsWith("/") ? `https://cohub.invalid${value}` : value);
  if (parsedUrl) return parsedUrl;

  const parts = value.split("/").filter(Boolean);
  const parsedPublic = parts.length === 3 ? publicRef(parts) : null;
  if (parsedPublic) return parsedPublic;

  throw new Error("Work must be an id, public URL, cohub://works URI, or username/space/work reference");
}

export function formatWorkRef(ref: ParsedWorkRef) {
  return "id" in ref ? ref.id : `${ref.username}/${ref.spaceSlug}/${ref.workSlug}`;
}

export function getWorkByRef(client: CohubHttpClient, input: string): Promise<WorkGetResponse> {
  const ref = parseWorkRef(input);
  return "id" in ref
    ? client.works.get(ref.id)
    : client.works.getBySlug(ref.username, ref.spaceSlug, ref.workSlug);
}
