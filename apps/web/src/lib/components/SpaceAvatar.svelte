<script lang="ts">
import type { SpacePublicProfile } from "@neta-art/cohub";
import { avatarImageUrl } from "$lib/avatar-url";

type Size = "xxs" | "xs" | "sm" | "md" | "lg";

type Props = {
	name?: string | null;
	profile?: SpacePublicProfile | null;
	avatarUrl?: string | null;
	size?: Size;
	class?: string;
	loading?: "eager" | "lazy";
};

let {
	name = null,
	profile = null,
	avatarUrl = null,
	size = "sm",
	class: className = "",
	loading = "lazy",
}: Props = $props();

const sizeClass = $derived.by(() => {
	if (size === "xxs") return "h-4 w-4 rounded-[5px] text-[7px]";
	if (size === "xs") return "h-5 w-5 rounded-[6px] text-[8px]";
	if (size === "sm") return "h-7 w-7 rounded-[8px] text-[10px]";
	if (size === "lg") return "h-12 w-12 rounded-[14px] text-[13px]";
	return "h-9 w-9 rounded-[10px] text-[11px]";
});

const rawAvatarUrl = $derived(
	avatarUrl?.trim() || profile?.avatarUrl?.trim() || null,
);
const imageSize = $derived(size === "lg" ? "lg" : size === "md" ? "md" : "sm");
const resolvedAvatarUrl = $derived(avatarImageUrl(rawAvatarUrl, imageSize));

function initials(value: string | null | undefined) {
	const text = (value ?? "").replace(/[-_]/g, " ").replace(/\s+/g, " ").trim();
	if (!text) return "SP";
	const parts = text.split(" ").filter(Boolean);
	const letters =
		parts.length >= 2
			? `${parts[0]?.[0] ?? ""}${parts[1]?.[0] ?? ""}`
			: text.slice(0, 2);
	return letters.toUpperCase();
}
</script>

<span
	class={`inline-flex shrink-0 items-center justify-center overflow-hidden border border-border-subtle bg-bg-elevated font-semibold text-text-secondary shadow-[inset_0_1px_0_var(--color-border-subtle)] ${sizeClass} ${className}`}
	aria-hidden="true"
>
	{#if resolvedAvatarUrl}
		<img src={resolvedAvatarUrl} alt="" class="h-full w-full object-cover" {loading} decoding="async" />
	{:else}
		<span class="translate-y-px tracking-[0.02em]">{initials(name)}</span>
	{/if}
</span>
