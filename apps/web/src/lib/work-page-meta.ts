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
const WORK_SUFFIX = "Cohub Work";

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function cleanText(value: unknown, max = 500) {
	if (typeof value !== "string") return null;
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
};

export type WorkPageMeta = {
	/** Primary work name (no site suffix). */
	name: string;
	/** Document / tab / OG title, usually `name — Cohub Work`. */
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
	const documentTitle = truncateText(
		`${primaryName} — ${WORK_SUFFIX}`,
		MAX_NAME_LENGTH,
	);
	const explicitDescription = isRecord(meta)
		? cleanText(meta.description, 300)
		: null;
	const description = truncate(
		explicitDescription ??
			(space?.name
				? `Open ${primaryName} from ${space.name}`
				: "Open a Cohub Work directly"),
		160,
	);
	const iconUrl = isRecord(meta) ? cleanText(meta.icon, 2048) : null;
	const imageUrl =
		(isRecord(meta) ? cleanText(meta.image, 2048) : null) ??
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
				name: "Cohub",
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
