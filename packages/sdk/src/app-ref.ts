import { isUuid } from "@cohub/protocol/identifiers";
import { parseSpaceSlug, parseUsername } from "@cohub/protocol/public-identifiers";

/**
 * Accepts every way an app is named across Cohub — id, management URL, public
 * URL, `cohub://apps` URI, or `username/space/app` — and normalizes it.
 *
 * The legacy `work://` and `cohub://works` schemes stay accepted so existing
 * scripts keep working; new references use the `app://` spelling.
 *
 * Public and mention forms may carry launch state (`?query#hash`); it is kept
 * separately so it can be forwarded to the app while the stable identity stays
 * clean.
 */

export type AppPublicRef = {
  username: string;
  spaceSlug: string;
  appSlug: string;
};

export type ParsedAppRef = ({ id: string } | AppPublicRef) & {
  /** Query string including `?`, when the reference carried one. */
  search?: string;
  /** Hash including `#`, when the reference carried one. */
  hash?: string;
};

export const isAppId = (value: string): boolean => isUuid(value.trim());

function decodePart(value: string) {
  try {
    return decodeURIComponent(value).trim();
  } catch {
    return "";
  }
}

function publicRef(parts: string[]): AppPublicRef | null {
  if (parts.length !== 3) return null;
  const [usernameRaw = "", spaceSlugRaw = "", appSlugRaw = ""] = parts.map(decodePart);
  const username = parseUsername(usernameRaw);
  const spaceSlug = parseSpaceSlug(spaceSlugRaw);
  const appSlug = parseSpaceSlug(appSlugRaw);
  return username && spaceSlug && appSlug ? { username, spaceSlug, appSlug } : null;
}

function launchState(url: URL) {
  return {
    ...(url.search ? { search: url.search } : {}),
    ...(url.hash ? { hash: url.hash } : {}),
  };
}

function parseUrlRef(value: string): ParsedAppRef | null {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  const parts = url.pathname.split("/").filter(Boolean);
  if (url.protocol === "cohub:" && (url.hostname === "apps" || url.hostname === "works")) {
    const ref = publicRef(parts);
    return ref ? { ...ref, ...launchState(url) } : null;
  }
  if (url.protocol === "app:" || url.protocol === "work:") {
    // `app://alice/studio/launch` parses as hostname=alice, path=/studio/launch.
    const ref = publicRef([url.hostname, ...parts]);
    return ref ? { ...ref, ...launchState(url) } : null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  if (
    parts.length === 4 &&
    parts[0] === "spaces" &&
    isUuid(parts[1] ?? "") &&
    (parts[2] === "apps" || parts[2] === "works") &&
    isUuid(parts[3] ?? "")
  ) {
    return { id: parts[3] as string };
  }
  // The public app path segment `/w/` is frozen: links to published apps are
  // scattered in the wild, so both the app shell and this parser keep it.
  if (parts.length === 4 && parts[2] === "w") {
    const ref = publicRef([parts[0] as string, parts[1] as string, parts[3] as string]);
    return ref ? { ...ref, ...launchState(url) } : null;
  }
  return null;
}

export class AppRefParseError extends Error {
  constructor() {
    super("App must be an id, public URL, cohub://apps URI, or username/space/app reference");
    this.name = "AppRefParseError";
  }
}

export function parseAppRef(input: string): ParsedAppRef {
  const value = input.trim();
  if (isUuid(value)) return { id: value };

  const parsedUrl = parseUrlRef(
    value.includes("://") ? value : value.startsWith("/") ? `https://cohub.invalid${value}` : value,
  );
  if (parsedUrl) return parsedUrl;

  const parts = value.split("/").filter(Boolean);
  const parsedPublic = parts.length === 3 ? publicRef(parts) : null;
  if (parsedPublic) return parsedPublic;

  throw new AppRefParseError();
}

export function formatAppRef(ref: ParsedAppRef): string {
  return "id" in ref ? ref.id : `${ref.username}/${ref.spaceSlug}/${ref.appSlug}`;
}

// ── Legacy aliases ────────────────────────────────────────────────────────────
// The work-era names stay exported so existing SDK consumers keep compiling.

/** @deprecated Use `AppPublicRef`. */
export type WorkPublicRef = AppPublicRef;
/** @deprecated Use `ParsedAppRef`. */
export type ParsedWorkRef = ParsedAppRef;
/** @deprecated Use `isAppId`. */
export const isWorkId = isAppId;
/** @deprecated Use `AppRefParseError`. */
export const WorkRefParseError = AppRefParseError;
/** @deprecated Use `parseAppRef`. */
export const parseWorkRef = parseAppRef;
/** @deprecated Use `formatAppRef`. */
export const formatWorkRef = formatAppRef;
