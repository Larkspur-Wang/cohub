<script lang="ts">
import { ChevronRight } from "lucide-svelte";
import { page } from "$app/state";

type Cta = "start" | "open-app" | "none";

const {
	sticky = false,
	cta = "open-app",
	onStart,
}: {
	sticky?: boolean;
	cta?: Cta;
	onStart?: () => void | Promise<void>;
} = $props();

const path = $derived(page.url.pathname);
const isPricing = $derived(path === "/pricing" || path.startsWith("/pricing/"));
const isChangelog = $derived(
	path === "/changelog" || path.startsWith("/changelog/"),
);

function navClass(active: boolean): string {
	return active
		? "rounded-full px-2.5 py-2 text-text-primary sm:px-3"
		: "rounded-full px-2.5 py-2 text-text-secondary transition-colors hover:text-text-primary sm:px-3";
}
</script>

<header
	class={sticky
		? "sticky top-0 z-30 border-b border-border-subtle bg-bg-primary/80 backdrop-blur-md"
		: ""}
>
	<div
		class="mx-auto flex w-full max-w-6xl items-center justify-between gap-3 px-5 sm:px-8 {sticky
			? 'py-3.5'
			: 'py-5'}"
	>
		<a href="/" class="inline-flex items-center gap-2.5" aria-label="Cohub home">
			{#if sticky}
				<div
					class="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-border-subtle bg-bg-surface text-[14px] font-semibold text-brand"
				>
					C
				</div>
				<span class="text-[15px] font-semibold tracking-tight text-text-primary"
					>Cohub</span
				>
			{:else}
				<div
					class="flex h-7 w-7 items-center justify-center rounded-[6px] bg-brand text-[12px] font-semibold text-brand-contrast-fg"
				>
					C
				</div>
				<span class="text-[13px] font-semibold tracking-tight text-text-primary"
					>Cohub</span
				>
			{/if}
		</a>

		<nav class="flex items-center gap-1 text-[13px] sm:gap-2">
			<a href="/pricing" class={navClass(isPricing)} aria-current={isPricing ? "page" : undefined}
				>Pricing</a
			>
			<a
				href="/changelog"
				class={navClass(isChangelog)}
				aria-current={isChangelog ? "page" : undefined}>Changelog</a
			>

			{#if cta === "start"}
				<button
					type="button"
					onclick={() => void onStart?.()}
					class="inline-flex cursor-pointer items-center gap-1.5 rounded-full bg-brand px-4 py-2 font-medium text-brand-contrast-fg transition-colors hover:bg-brand-hover"
				>
					Start
				</button>
			{:else if cta === "open-app"}
				<a
					href="/"
					class="inline-flex items-center gap-1.5 rounded-[5px] border border-border-subtle bg-bg-input px-2.5 py-1.5 text-[12px] font-medium text-text-secondary transition-colors hover:bg-bg-hover hover:text-text-primary"
				>
					Open app
					<ChevronRight class="h-3.5 w-3.5" />
				</a>
			{/if}
		</nav>
	</div>
</header>
