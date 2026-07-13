export type WorkspacePreviewKind = "file" | "canvas" | "port";

export type WorkspacePreviewRef = {
	kind: WorkspacePreviewKind;
	key: string;
};

export const PREVIEW_QUERY_KEY = "preview";

/** Accept only integer ports in 1..65535. Reject host-injection forms. */
export function isValidPortKey(key: string): boolean {
	if (!/^\d{1,5}$/.test(key)) return false;
	const n = Number(key);
	return Number.isInteger(n) && n >= 1 && n <= 65535;
}

export function encodePreviewParam(ref: WorkspacePreviewRef): string {
	return `${ref.kind}:${ref.key}`;
}

export function parsePreviewParam(
	value: string | null | undefined,
): WorkspacePreviewRef | null {
	if (!value) return null;
	const separator = value.indexOf(":");
	if (separator <= 0) return null;
	const kind = value.slice(0, separator);
	const key = value.slice(separator + 1);
	if (!key) return null;
	if (kind !== "file" && kind !== "canvas" && kind !== "port") return null;
	if (kind === "port" && !isValidPortKey(key)) return null;
	return { kind, key };
}

export function readPreviewFromSearch(
	search: string | URLSearchParams | null | undefined,
): WorkspacePreviewRef | null {
	if (!search) return null;
	const params =
		typeof search === "string"
			? new URLSearchParams(search.startsWith("?") ? search.slice(1) : search)
			: search;
	return parsePreviewParam(params.get(PREVIEW_QUERY_KEY));
}

export function withPreviewParam(
	pathname: string,
	search: string | URLSearchParams | null | undefined,
	ref: WorkspacePreviewRef | null,
): string {
	const params =
		typeof search === "string"
			? new URLSearchParams(search.startsWith("?") ? search.slice(1) : search)
			: new URLSearchParams(search ?? undefined);
	if (ref) params.set(PREVIEW_QUERY_KEY, encodePreviewParam(ref));
	else params.delete(PREVIEW_QUERY_KEY);
	const query = params.toString();
	return query ? `${pathname}?${query}` : pathname;
}

/** Deterministic ingress for legacy `/spaces/:id/files/...` routes. */
export function buildFileIngressMainRoute(
	spaceId: string,
	path: string,
): string {
	const cleaned = path
		.split("/")
		.map((segment) => {
			try {
				return decodeURIComponent(segment);
			} catch {
				return segment;
			}
		})
		.filter(Boolean)
		.join("/");
	return withPreviewParam(`/spaces/${spaceId}/sessions/new`, null, {
		kind: "file",
		key: cleaned,
	});
}
