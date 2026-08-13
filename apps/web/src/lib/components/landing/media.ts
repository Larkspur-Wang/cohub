/**
 * Where marketing captures live.
 *
 * These are product screenshots that get re-shot whenever the UI moves, so
 * they are hosted outside the repo rather than committed as binaries. Set
 * `PUBLIC_LANDING_MEDIA_BASE` to point the landing page at a different bucket
 * (a staging set, or a self-hosted mirror for a fork).
 */
const DEFAULT_BASE =
	"https://public.cohub.run/s/cf327f11-5065-4f3a-bfe5-cdb0a70f3377/cohub-landing";

/** No trailing slash, so callers can always join with a single "/". */
const BASE = (
	import.meta.env?.PUBLIC_LANDING_MEDIA_BASE?.trim() || DEFAULT_BASE
).replace(/\/+$/, "");

export type LandingMediaExt = "webp" | "webm" | "mp4";

/** Resolve an asset basename, e.g. ("hero", "webp") → `<base>/hero.webp`. */
export function landingMediaUrl(name: string, ext: LandingMediaExt): string {
	return `${BASE}/${name}.${ext}`;
}
