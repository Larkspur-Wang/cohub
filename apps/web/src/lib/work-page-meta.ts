import type { WorkDetailResponse, WorkMeta } from "@neta-art/cohub";
import {
	canonicalUrl,
	defaultOgImage,
	plainText,
	siteOrigin,
	truncate,
} from "$lib/seo";

const MAX_NAME_LENGTH = 72;
const MAX_SHORT_NAME_LENGTH = 24;

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function cleanText(value: unknown, max = 500) {
	if (typeof value !== "string") return null;
	// Keep data:image URLs intact for icons.
	if (/^data:image\//i.test(value.trim())) {
		const data = value.trim();
		return data.length > 8192 ? null : data;
	}
	// Strip lightweight markdown used in some meta sources, then normalize spaces.
	const text = plainText(value).replace(/\s+/g, " ").trim();
	if (!text) return null;
	return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

/** Shared display title for Work chrome (bar, iframe title, dialogs). */
export function workDisplayTitle(
	meta: WorkMeta | null | undefined,
	fallback: string,
) {
	if (isRecord(meta)) {
		const titled = cleanText(meta.title) ?? cleanText(meta.name);
		if (titled) return titled;
	}
	return fallback;
}

function truncateText(value: string, maxLength: number) {
	if (value.length <= maxLength) return value;
	return `${value.slice(0, Math.max(1, maxLength - 1)).trimEnd()}…`;
}

function humanizeSlug(value: string) {
	return value
		.split(/[-_]+/)
		.filter(Boolean)
		.map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
		.join(" ")
		.trim();
}

function workPrimaryName(input: {
	meta?: WorkMeta | null;
	slug?: string | null;
	spaceName?: string | null;
}) {
	if (isRecord(input.meta)) {
		const titled = cleanText(input.meta.title) ?? cleanText(input.meta.name);
		if (titled) return titled;
	}
	const spaceName = cleanText(input.spaceName);
	if (spaceName) return spaceName;
	if (input.slug) {
		const humanized = humanizeSlug(input.slug);
		if (humanized) return humanized;
	}
	return "Work";
}

/**
 * Resolve icon/image for the public shell.
 * Root-relative paths like `/favicon.svg` must join the Work content URL,
 * not the Cohub host origin.
 */
function resolveMediaRef(
	ref: string | null | undefined,
	contentUrl: string | null | undefined,
): string | null {
	const value = cleanText(ref, 8192);
	if (!value) return null;
	if (/^data:image\//i.test(value)) return value;
	if (/^https:\/\//i.test(value)) return value;
	if (value.startsWith("//")) {
		try {
			return new URL(`https:${value}`).toString();
		} catch {
			return null;
		}
	}
	if (/^https?:/i.test(value) || /^data:/i.test(value)) return null;
	if (!contentUrl) return null;
	try {
		// Root-relative `/favicon.svg` is the Work package root, not cohub.run/.
		const base = new URL(contentUrl);
		const relative = value.replace(/^\.\//, "").replace(/^\/+/, "");
		if (!relative || relative.includes("\0")) return null;
		const parts = relative.split("/");
		if (parts.some((part) => !part || part === "." || part === ".."))
			return null;
		const dir = base.pathname.replace(/\/[^/]*$/, "/");
		return new URL(parts.join("/"), `${base.origin}${dir}`).toString();
	} catch {
		return null;
	}
}

export type WorkPageDetail = {
	work: Pick<WorkDetailResponse["work"], "meta" | "slug"> &
		Partial<
			Pick<
				WorkDetailResponse["work"],
				"visibility" | "publishedAt" | "updatedAt"
			>
		>;
	space?: Pick<WorkDetailResponse["space"], "name"> | null;
	owner?: Pick<WorkDetailResponse["owner"], "displayName" | "username"> | null;
	publicUrl?: string | null;
	/** Published content URL (…/index.html) used to resolve relative media. */
	contentUrl?: string | null;
};

export type WorkPageMeta = {
	/** Primary work name (no site suffix). */
	name: string;
	/** Document / tab / OG title — prefer the Work's own title. */
	documentTitle: string;
	shortName: string;
	description: string;
	iconUrl: string | null;
	imageUrl: string | null;
	canonical: string;
	robots: string;
	indexable: boolean;
	twitterCard: "summary" | "summary_large_image";
	jsonLd: string;
};

export function buildWorkPageMeta(
	detail: WorkPageDetail | null,
	options?: {
		origin?: string | null;
		path?: string | null;
		/** Force robots when detail is unavailable (e.g. auth-gated shell). */
		indexable?: boolean;
	},
): WorkPageMeta {
	const work = detail?.work ?? null;
	const space = detail?.space ?? null;
	const owner = detail?.owner ?? null;
	const meta = work?.meta ?? null;
	const primaryName = workPrimaryName({
		meta,
		slug: work?.slug ?? null,
		spaceName: space?.name ?? null,
	});
	const shortName = truncateText(primaryName, MAX_SHORT_NAME_LENGTH);
	const hasExplicitTitle = Boolean(
		isRecord(meta) && (cleanText(meta.title) || cleanText(meta.name)),
	);
	// Prefer the Work's own title in previews; only brand generic fallbacks.
	const documentTitle = truncateText(
		hasExplicitTitle ? primaryName : `${primaryName} · Cohub`,
		MAX_NAME_LENGTH,
	);
	const explicitDescription = isRecord(meta)
		? cleanText(meta.description, 300)
		: null;
	const description = truncate(
		explicitDescription ??
			(space?.name
				? `Open ${primaryName} from ${space.name}`
				: `Open ${primaryName}`),
		160,
	);
	const contentUrl = detail?.contentUrl ?? null;
	const iconUrl = resolveMediaRef(
		isRecord(meta) ? meta.icon : null,
		contentUrl,
	);
	const imageUrl =
		resolveMediaRef(isRecord(meta) ? meta.image : null, contentUrl) ??
		iconUrl ??
		defaultOgImage(options?.origin);
	const path =
		options?.path ??
		(detail?.publicUrl
			? (() => {
					try {
						return new URL(detail.publicUrl).pathname;
					} catch {
						return null;
					}
				})()
			: null) ??
		"/";
	const canonical = canonicalUrl(options?.origin, path);
	const indexable =
		typeof options?.indexable === "boolean"
			? options.indexable
			: (work?.visibility ?? "public") === "public";
	const robots = indexable ? "index,follow" : "noindex,nofollow";
	const origin = siteOrigin(options?.origin);
	const authorName =
		cleanText(owner?.displayName) ?? cleanText(owner?.username) ?? "Cohub";
	const graph = [
		{
			"@type": "WebApplication",
			name: primaryName,
			description,
			url: canonical,
			applicationCategory: "WebApplication",
			operatingSystem: "Any",
			image: imageUrl,
			author: {
				"@type": "Person",
				name: authorName,
				url: owner?.username ? `${origin}/${owner.username}` : undefined,
			},
			isPartOf: {
				"@type": "WebSite",
				name: hasExplicitTitle ? primaryName : "Cohub",
				url: origin,
			},
			datePublished: work?.publishedAt ?? undefined,
			dateModified: work?.updatedAt ?? work?.publishedAt ?? undefined,
		},
	];
	const jsonLd = JSON.stringify({
		"@context": "https://schema.org",
		"@graph": graph,
	});

	return {
		name: primaryName,
		documentTitle,
		shortName,
		description,
		iconUrl,
		imageUrl,
		canonical,
		robots,
		indexable,
		twitterCard:
			imageUrl && imageUrl !== defaultOgImage(options?.origin)
				? "summary_large_image"
				: "summary",
		jsonLd,
	};
}

/** Backward-compatible PWA helpers built on the same resolver. */
export function buildWorkPwaMeta(detail: WorkPageDetail | null) {
	const page = buildWorkPageMeta(detail);
	return {
		name: page.documentTitle,
		shortName: page.shortName,
		description: page.description,
		iconUrl: page.iconUrl,
		imageUrl: page.imageUrl,
	};
}
