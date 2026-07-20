import type { HtmlPageMeta } from "./html-meta.js";

export type WorkExtractedPageMeta = HtmlPageMeta & {
  sourcePath?: string;
  extractedAt?: string;
};

/** Raw page fields returned by the publish-asset worker before CDN materialization. */
export type WorkPublishExtractedPageMeta = {
  title: string | null;
  description: string | null;
  icon: string | null;
  image: string | null;
  sourcePath: string;
};

/** Effective presentation fields stored on work / version meta. */
export type WorkPageFields = {
  title?: string;
  description?: string;
  icon?: string;
  image?: string;
};

export type WorkPageMetaInput = Record<string, unknown> | null | undefined;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

export const cleanWorkMetaText = (value: unknown, max = 500): string | null => {
  if (typeof value !== "string") return null;
  const text = value.replace(/\s+/g, " ").trim();
  if (!text) return null;
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
};

export function workTitleFromMeta(meta: WorkPageMetaInput, fallback: string): string {
  if (!isRecord(meta)) return fallback;
  return (
    cleanWorkMetaText(meta.title) ??
    cleanWorkMetaText(meta.name) ??
    fallback
  );
}

export function readWorkPageFields(meta: WorkPageMetaInput): {
  title: string | null;
  description: string | null;
  icon: string | null;
  image: string | null;
} {
  if (!isRecord(meta)) {
    return { title: null, description: null, icon: null, image: null };
  }
  return {
    title: cleanWorkMetaText(meta.title) ?? cleanWorkMetaText(meta.name),
    description: cleanWorkMetaText(meta.description, 300),
    icon: cleanWorkMetaText(meta.icon, 2048),
    image: cleanWorkMetaText(meta.image, 2048),
  };
}

function isBlockedAbsoluteHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (
    host === "localhost" ||
    host === "0.0.0.0" ||
    host === "::1" ||
    host === "::" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host.endsWith(".internal")
  ) {
    return true;
  }
  if (/^127\.\d+\.\d+\.\d+$/.test(host)) return true;
  if (/^10\.\d+\.\d+\.\d+$/.test(host)) return true;
  if (/^192\.168\.\d+\.\d+$/.test(host)) return true;
  if (/^169\.254\.\d+\.\d+$/.test(host)) return true;
  // 172.16.0.0 – 172.31.255.255
  const m172 = host.match(/^172\.(\d+)\.\d+\.\d+$/);
  if (m172) {
    const second = Number(m172[1]);
    if (second >= 16 && second <= 31) return true;
  }
  // Unique local IPv6 fc00::/7 and link-local fe80::/10 (prefix check).
  if (host.includes(":")) {
    if (host.startsWith("fc") || host.startsWith("fd") || host.startsWith("fe8") || host.startsWith("fe9") || host.startsWith("fea") || host.startsWith("feb")) {
      return true;
    }
  }
  return false;
}

/**
 * Resolve a page asset reference to a public URL.
 * Relative paths are joined under the published asset directory.
 * Absolute https URLs are kept when host looks public.
 */
export function resolveWorkPageAssetRef(
  ref: string | null | undefined,
  assetKey: string | null | undefined,
  toPublicUrl: (objectKey: string) => string,
): string | null {
  const value = cleanWorkMetaText(ref, 2048);
  if (!value) return null;
  if (/^https:\/\//i.test(value) || value.startsWith("//")) {
    try {
      const url = new URL(value.startsWith("//") ? `https:${value}` : value);
      if (url.protocol !== "https:") return null;
      if (isBlockedAbsoluteHost(url.hostname)) return null;
      return url.toString();
    } catch {
      return null;
    }
  }
  if (/^http:\/\//i.test(value)) return null;
  if (!assetKey) return null;

  const baseDir = assetKey.replace(/\/[^/]*$/, "");
  if (!baseDir || baseDir === assetKey) return null;

  const normalized = value
    .replace(/\\/g, "/")
    .replace(/^\.\//, "")
    .replace(/^\/+/, "");
  if (!normalized || normalized.includes("\0")) return null;
  const parts = normalized.split("/");
  if (parts.some((part) => !part || part === "." || part === "..")) return null;

  return toPublicUrl(`${baseDir}/${parts.join("/")}`);
}

export function materializeHtmlPageMeta(
  page: HtmlPageMeta & { sourcePath?: string },
  assetKey: string | null | undefined,
  toPublicUrl: (objectKey: string) => string,
  extractedAt = new Date().toISOString(),
): WorkExtractedPageMeta {
  return {
    title: cleanWorkMetaText(page.title),
    description: cleanWorkMetaText(page.description, 300),
    icon: resolveWorkPageAssetRef(page.icon, assetKey, toPublicUrl),
    image: resolveWorkPageAssetRef(page.image, assetKey, toPublicUrl),
    sourcePath: page.sourcePath,
    extractedAt,
  };
}

function preferExistingOrExtracted(
  existing: unknown,
  extracted: unknown,
  max = 500,
): string | null {
  // Keep manual / previous effective values; only fill blanks from the page.
  return cleanWorkMetaText(existing, max) ?? cleanWorkMetaText(extracted, max);
}

/**
 * Merge extracted page fields into work/version meta.
 * - `extracted` snapshot is always refreshed (raw provenance)
 * - effective title/description/icon/image keep existing values and only fill blanks
 */
export function mergeWorkPageMeta(
  current: WorkPageMetaInput,
  extracted: WorkExtractedPageMeta | null | undefined,
): Record<string, unknown> | null {
  const meta: Record<string, unknown> = isRecord(current) ? { ...current } : {};
  if (extracted) {
    meta.extracted = {
      title: extracted.title,
      description: extracted.description,
      icon: extracted.icon,
      image: extracted.image,
      sourcePath: extracted.sourcePath ?? null,
      extractedAt: extracted.extractedAt ?? new Date().toISOString(),
    };

    // Legacy `name` counts as an existing title so republish does not clobber it.
    const existingTitle = cleanWorkMetaText(meta.title) ?? cleanWorkMetaText(meta.name);
    const nextTitle = existingTitle ?? cleanWorkMetaText(extracted.title);
    const nextDescription = preferExistingOrExtracted(meta.description, extracted.description, 300);
    const nextIcon = preferExistingOrExtracted(meta.icon, extracted.icon, 2048);
    const nextImage = preferExistingOrExtracted(meta.image, extracted.image, 2048);

    if (nextTitle) meta.title = nextTitle;
    else delete meta.title;
    // Promote legacy `name` into `title` once, then drop the duplicate.
    delete meta.name;

    if (nextDescription) meta.description = nextDescription;
    else delete meta.description;

    if (nextIcon) meta.icon = nextIcon;
    else delete meta.icon;

    if (nextImage) meta.image = nextImage;
    else delete meta.image;
  }
  return Object.keys(meta).length ? meta : null;
}
