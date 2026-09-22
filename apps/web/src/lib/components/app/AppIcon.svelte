<script lang="ts">
import type { AppMeta } from "@neta-art/cohub";
import { appDisplayTitle, appIconUrl } from "$lib/app-page-meta";

type Size = "xs" | "sm" | "md";

type Props = {
	meta?: AppMeta | null;
	slug?: string | null;
	size?: Size;
	class?: string;
	loading?: "eager" | "lazy";
};

let {
	meta = null,
	slug = null,
	size = "sm",
	class: className = "",
	loading = "lazy",
}: Props = $props();

const iconUrl = $derived(appIconUrl(meta));
const label = $derived(appDisplayTitle(meta, slug ?? "App"));

const sizeClass = $derived(
	size === "xs"
		? "h-4 w-4 rounded-[4px] text-[8px]"
		: size === "md"
			? "h-8 w-8 rounded-[6px] text-[11px]"
			: "h-5 w-5 rounded-[5px] text-[9px]",
);

/**
 * Transient CDN failures should not strand a row on the placeholder, but a
 * URL that is genuinely broken must not retry forever either. A short budget
 * of retries keeps the list calm while still healing a flaky first paint.
 */
const MAX_ICON_RETRIES = 2;
let failures = $state(0);
let attempt = $state(0);

// A different icon (space or app switch) always starts from a clean slate.
$effect(() => {
	iconUrl;
	failures = 0;
	attempt = 0;
});

const showIcon = $derived(Boolean(iconUrl) && failures < MAX_ICON_RETRIES);
const src = $derived(
	attempt > 0 && iconUrl
		? `${iconUrl}${iconUrl.includes("?") ? "&" : "?"}cohub_icon_retry=${attempt}`
		: iconUrl,
);

/** Two-letter mark from the display title, CJK-safe via `slice`. */
function initials(value: string) {
	const text = value.replace(/[-_]+/g, " ").replace(/\s+/g, " ").trim();
	if (!text) return "A";
	const parts = text.split(" ");
	const letters =
		parts.length >= 2
			? `${parts[0]?.[0] ?? ""}${parts[1]?.[0] ?? ""}`
			: text.slice(0, 2);
	return letters.toUpperCase();
}
</script>

<span
	class={`inline-flex shrink-0 items-center justify-center overflow-hidden border border-border-subtle bg-bg-elevated font-semibold text-text-tertiary ${sizeClass} ${className}`}
	aria-hidden="true"
>
	{#if showIcon && src}
		<img
			{src}
			alt=""
			class="h-full w-full object-cover"
			{loading}
			decoding="async"
			onerror={() => {
				failures += 1;
				if (failures < MAX_ICON_RETRIES) attempt += 1;
			}}
		/>
	{:else}
		<span class="translate-y-px tracking-[0.02em]">{initials(label)}</span>
	{/if}
</span>
