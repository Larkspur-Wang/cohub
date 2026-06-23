<script lang="ts">
import { Play } from "lucide-svelte";
import type { Snippet } from "svelte";

/**
 * Landing demo placeholder.
 *
 * Shows a dashed recording slot until real media is dropped in.
 * To use a real recording, pass it as children — the placeholder
 * is hidden automatically:
 *
 *   <LandingDemo label="hero">
 *     <video src="/demo/hero.mp4" autoplay muted loop playsinline />
 *   </LandingDemo>
 */
const props = $props<{
	label: string;
	ratio?: string;
	children?: Snippet;
}>();

const ratio = $derived(props.ratio ?? "16:10");
</script>

<div
	class="relative aspect-[16/10] overflow-hidden rounded-2xl border border-dashed border-border-subtle bg-[radial-gradient(circle_at_30%_20%,color-mix(in_srgb,var(--brand)_8%,transparent),transparent_60%),linear-gradient(180deg,var(--bg-content),var(--bg-surface))]"
>
	{#if props.children}
		{@render props.children()}
	{:else}
		<!-- Replace this placeholder with a <video> or <img> for the demo recording. -->
		<div
			class="pointer-events-none absolute inset-0 bg-[linear-gradient(color-mix(in_srgb,var(--border-subtle)_55%,transparent)_1px,transparent_1px),linear-gradient(90deg,color-mix(in_srgb,var(--border-subtle)_55%,transparent)_1px,transparent_1px)] bg-[length:28px_28px] [mask-image:radial-gradient(circle_at_50%_45%,black,transparent_75%)]"
		></div>
		<div class="absolute left-3.5 top-3 flex items-center gap-1.5 text-[11px] text-text-placeholder">
			<span class="live-dot h-1.5 w-1.5 rounded-full bg-brand"></span>
			demo · {props.label}
		</div>
		<div class="absolute inset-0 flex items-center justify-center">
			<span
				class="flex h-[52px] w-[52px] items-center justify-center rounded-full border border-border-primary bg-[color-mix(in_srgb,var(--bg-surface)_70%,transparent)] text-text-tertiary backdrop-blur"
			>
				<Play class="ml-0.5 h-5 w-5 fill-current" />
			</span>
		</div>
		<div class="absolute bottom-3 right-3.5 font-mono text-[11px] text-text-placeholder">{ratio}</div>
	{/if}
</div>

<style>
	@keyframes live-pulse {
		0%,
		100% {
			opacity: 1;
			transform: scale(1);
		}
		50% {
			opacity: 0.4;
			transform: scale(0.8);
		}
	}
	.live-dot {
		animation: live-pulse 2.4s cubic-bezier(0.4, 0, 0.6, 1) infinite;
	}
	@media (prefers-reduced-motion: reduce) {
		.live-dot {
			animation: none;
		}
	}
</style>
