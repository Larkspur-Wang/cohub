<script lang="ts">
import { User } from "lucide-svelte";
import { avatarImageUrl } from "$lib/avatar-url";

type Size = "xxs" | "xs" | "sm" | "md" | "lg";

type Props = {
	name?: string | null;
	avatarUrl?: string | null;
	size?: Size;
	class?: string;
	loading?: "eager" | "lazy";
	decoding?: "async" | "auto" | "sync";
	alt?: string;
};

let {
	name = null,
	avatarUrl = null,
	size = "sm",
	class: className = "",
	loading = "lazy",
	decoding = "async",
	alt = "",
}: Props = $props();

const sizeClass = $derived.by(() => {
	if (size === "xxs") return "h-4 w-4 text-[7px]";
	if (size === "xs") return "h-5 w-5 text-[8px]";
	if (size === "sm") return "h-7 w-7 text-[10px]";
	if (size === "lg") return "h-12 w-12 text-[13px]";
	return "h-9 w-9 text-[11px]";
});

const imageSize = $derived(size === "lg" ? "lg" : size === "md" ? "md" : "sm");
const resolvedAvatarUrl = $derived(avatarImageUrl(avatarUrl, imageSize));

function initials(value: string | null | undefined) {
	const text = (value ?? "").replace(/[-_]/g, " ").replace(/\s+/g, " ").trim();
	if (!text) return null;
	const parts = text.split(" ").filter(Boolean);
	const letters =
		parts.length >= 2
			? `${parts[0]?.[0] ?? ""}${parts[1]?.[0] ?? ""}`
			: text.slice(0, 2);
	return letters.toUpperCase();
}
</script>

<span
	class={`inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full border border-border-subtle bg-bg-hover-strong font-semibold text-text-tertiary ${sizeClass} ${className}`}
	aria-hidden={alt ? undefined : "true"}
>
	{#if resolvedAvatarUrl}
		<img src={resolvedAvatarUrl} {alt} class="h-full w-full object-cover" {loading} {decoding} />
	{:else if initials(name)}
		<span class="translate-y-px tracking-[0.02em]">{initials(name)}</span>
	{:else}
		<User class="h-[55%] w-[55%] text-text-tertiary" />
	{/if}
</span>
