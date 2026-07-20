/** Lightweight HTML head parsing for Work page presentation fields. */

export type HtmlPageMeta = {
  title: string | null;
  description: string | null;
  /** Site-relative path, root-absolute path, or absolute URL. */
  icon: string | null;
  image: string | null;
};

const MAX_HTML_SCAN = 200_000;
const MAX_FIELD = 500;

const cleanText = (value: string | null | undefined): string | null => {
  if (!value) return null;
  const text = value
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&#(\d+);/g, (_, code: string) => {
      const n = Number(code);
      return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : "";
    })
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => {
      const n = Number.parseInt(hex, 16);
      return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : "";
    })
    .replace(/\s+/g, " ")
    .trim();
  if (!text) return null;
  return text.length > MAX_FIELD ? `${text.slice(0, MAX_FIELD - 1).trimEnd()}…` : text;
};

const headSection = (html: string): string => {
  const slice = html.length > MAX_HTML_SCAN ? html.slice(0, MAX_HTML_SCAN) : html;
  const match = slice.match(/<head\b[^>]*>([\s\S]*?)<\/head>/i);
  // Some tiny/hand-written pages omit <head>; fall back to the scanned prefix so
  // bare <title>/<meta> still work. Body tags may match, which is acceptable.
  return match?.[1] ?? slice;
};

const attr = (tag: string, name: string): string | null => {
  const re = new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "i");
  const match = tag.match(re);
  return match?.[1] ?? match?.[2] ?? match?.[3] ?? null;
};

const metaContent = (head: string, keys: string[]): string | null => {
  const wanted = new Set(keys.map((key) => key.toLowerCase()));
  const re = /<meta\b[^>]*>/gi;
  for (const match of head.matchAll(re)) {
    const tag = match[0];
    const key = (attr(tag, "property") ?? attr(tag, "name") ?? "").trim().toLowerCase();
    if (!wanted.has(key)) continue;
    const content = cleanText(attr(tag, "content"));
    if (content) return content;
  }
  return null;
};

const firstTitle = (head: string): string | null => {
  const match = head.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i);
  return cleanText(match?.[1]?.replace(/<[^>]+>/g, " ") ?? null);
};

const iconHref = (head: string): string | null => {
  const re = /<link\b[^>]*>/gi;
  const ranked: Array<{ rank: number; href: string }> = [];
  for (const match of head.matchAll(re)) {
    const tag = match[0];
    const rel = (attr(tag, "rel") ?? "").toLowerCase();
    if (!rel) continue;
    const relTokens = new Set(rel.split(/\s+/).filter(Boolean));
    const isIcon =
      relTokens.has("icon") ||
      relTokens.has("shortcut") ||
      relTokens.has("apple-touch-icon") ||
      relTokens.has("apple-touch-icon-precomposed") ||
      relTokens.has("mask-icon");
    if (!isIcon) continue;
    const href = cleanText(attr(tag, "href"));
    if (!href) continue;
    let rank = 50;
    if (relTokens.has("apple-touch-icon") || relTokens.has("apple-touch-icon-precomposed")) rank = 10;
    else if (relTokens.has("mask-icon")) rank = 30;
    else if (relTokens.has("icon") || relTokens.has("shortcut")) rank = 20;
    const sizes = (attr(tag, "sizes") ?? "").toLowerCase();
    if (sizes.includes("512")) rank -= 3;
    else if (sizes.includes("192") || sizes.includes("180")) rank -= 2;
    ranked.push({ rank, href });
  }
  ranked.sort((a, b) => a.rank - b.rank);
  return ranked[0]?.href ?? null;
};

/**
 * Extract title / description / icon / image from HTML without executing it.
 * Prefers document title and standard meta / link tags.
 */
export function extractHtmlPageMeta(html: string): HtmlPageMeta {
  const head = headSection(html);
  return {
    title: firstTitle(head) ?? metaContent(head, ["og:title", "twitter:title"]),
    description: metaContent(head, [
      "description",
      "og:description",
      "twitter:description",
    ]),
    icon: iconHref(head),
    image: metaContent(head, ["og:image", "twitter:image", "og:image:url"]),
  };
}

export const DEFAULT_PAGE_ICON_CANDIDATES = [
  "favicon.ico",
  "favicon.svg",
  "favicon.png",
  "apple-touch-icon.png",
  "apple-touch-icon-precomposed.png",
  "icon.svg",
  "icon.png",
] as const;

/**
 * Normalize a head asset ref into a site-relative path suitable for publish packing.
 * Absolute http(s) / protocol-relative / data / blob refs return null.
 */
export function normalizeLocalPageAssetRef(ref: string | null | undefined): string | null {
  if (typeof ref !== "string") return null;
  const value = ref.replace(/\\/g, "/").trim();
  if (!value) return null;
  if (/^[a-z][a-z0-9+.-]*:/i.test(value) || value.startsWith("//")) return null;
  const cleaned = value.replace(/^\.\//, "").replace(/^\/+/, "");
  if (!cleaned || cleaned.includes("\0")) return null;
  const parts = cleaned.split("/");
  if (parts.some((part) => !part || part === "." || part === "..")) return null;
  return parts.join("/");
}

/** Local asset refs we should try to pack next to a published HTML entry. */
export function collectLocalPageAssetRefs(meta: HtmlPageMeta): string[] {
  const refs = new Set<string>();
  const icon = normalizeLocalPageAssetRef(meta.icon);
  const image = normalizeLocalPageAssetRef(meta.image);
  if (icon) refs.add(icon);
  if (image) refs.add(image);
  if (!icon) {
    for (const candidate of DEFAULT_PAGE_ICON_CANDIDATES) refs.add(candidate);
  }
  return Array.from(refs);
}

/** Fill missing icon from common static filenames present in a site. */
export function fillIconFromSiteFiles(
  meta: HtmlPageMeta,
  relativePaths: Iterable<string>,
): HtmlPageMeta {
  if (meta.icon) return meta;
  const available = new Set(
    Array.from(relativePaths, (path) => path.replace(/^\/+/, "").toLowerCase()),
  );
  for (const candidate of DEFAULT_PAGE_ICON_CANDIDATES) {
    if (available.has(candidate)) {
      return { ...meta, icon: candidate };
    }
  }
  return meta;
}
