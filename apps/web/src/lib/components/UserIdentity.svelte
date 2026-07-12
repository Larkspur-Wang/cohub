<script lang="ts">
import UserAvatar from "$lib/components/UserAvatar.svelte";
import { buildUserProfileHref } from "$lib/space-routes";

type AvatarSize = "xxs" | "xs" | "sm" | "md" | "lg";

type Props = {
	name: string;
	avatarUrl?: string | null;
	username?: string | null;
	/** Optional extra title text (e.g. uuid); always includes the display name. */
	title?: string | null;
	size?: AvatarSize;
	class?: string;
	avatarClass?: string;
	nameClass?: string;
	showName?: boolean;
	/** When false, never link even if username exists. */
	linkable?: boolean;
};

let {
	name,
	avatarUrl = null,
	username = null,
	title = null,
	size = "xxs",
	class: className = "",
	avatarClass = "border-0 bg-bg-elevated",
	nameClass = "min-w-0 truncate",
	showName = true,
	linkable = true,
}: Props = $props();

const href = $derived(linkable ? buildUserProfileHref(username) : null);
const resolvedTitle = $derived(
	[title?.trim() || name, username?.trim() ? `@${username.trim()}` : null]
		.filter(Boolean)
		.join(" · "),
);
</script>

{#if href}
	<a
		{href}
		class={`inline-flex min-w-0 max-w-full cursor-pointer items-center gap-1.5 transition-colors hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/70 focus-visible:ring-offset-1 focus-visible:ring-offset-bg-primary ${className}`}
		title={resolvedTitle}
		data-sveltekit-preload-data="hover"
	>
		<UserAvatar {name} {avatarUrl} {size} class={avatarClass} />
		{#if showName}
			<span class={nameClass}>{name}</span>
		{/if}
	</a>
{:else}
	<span
		class={`inline-flex min-w-0 max-w-full cursor-default items-center gap-1.5 ${className}`}
		title={resolvedTitle}
	>
		<UserAvatar {name} {avatarUrl} {size} class={avatarClass} />
		{#if showName}
			<span class={nameClass}>{name}</span>
		{/if}
	</span>
{/if}
