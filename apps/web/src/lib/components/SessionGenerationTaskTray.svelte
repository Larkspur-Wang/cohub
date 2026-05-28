<script lang="ts">
import {
	AlertCircle,
	ChevronDown,
	ChevronUp,
	Loader2,
	Play,
} from "lucide-svelte";
import { onMount } from "svelte";
import { browser } from "$app/environment";
import { goto } from "$app/navigation";
import {
	type MediaItem,
	mediaLightbox,
} from "$lib/components/media-lightbox.svelte";
import { buildSpaceTaskRoute } from "$lib/space-routes";

export type GenerationTaskNotice = {
	id: string;
	spaceId: string;
	sessionId: string;
	turnId: string | null;
	status: "pending" | "running" | "completed" | "failed";
	mediaItems: MediaItem[];
	promptPreview: string | null;
	createdAt: string;
	startedAt: string | null;
	updatedAt: string;
	finishedAt: string | null;
};

type Props = {
	notices: GenerationTaskNotice[];
};

const props = $props<Props>();
const TICK_MS = 1000;

let collapsed = $state(false);
let now = $state(Date.now());

const sortedNotices = $derived.by(() =>
	[...props.notices].sort((a, b) => taskTime(b) - taskTime(a)),
);
const summaryParts = $derived.by(() => {
	const generating = sortedNotices.filter(isActive).length;
	const ready = sortedNotices.filter(
		(notice) => notice.status === "completed",
	).length;
	const failed = sortedNotices.filter(
		(notice) => notice.status === "failed",
	).length;
	return [
		generating ? `Generating ${generating}` : null,
		ready ? `Ready ${ready}` : null,
		failed ? `Failed ${failed}` : null,
	].filter(Boolean);
});

function taskTime(notice: GenerationTaskNotice) {
	return Date.parse(notice.updatedAt || notice.createdAt || "") || 0;
}

function isCompleted(notice: GenerationTaskNotice) {
	return notice.status === "completed" && notice.mediaItems.length > 0;
}

function isActive(notice: GenerationTaskNotice) {
	return notice.status === "pending" || notice.status === "running";
}

function elapsedSeconds(notice: GenerationTaskNotice) {
	const start = Date.parse(
		notice.startedAt || notice.createdAt || notice.updatedAt || "",
	);
	if (!start) return 0;
	return Math.max(0, Math.floor((now - start) / 1000));
}

function handleCardClick(notice: GenerationTaskNotice) {
	if (isCompleted(notice)) {
		mediaLightbox.show(notice.mediaItems);
		return;
	}
	if (notice.status === "failed") {
		void goto(buildSpaceTaskRoute(notice.spaceId, notice.id));
	}
}

onMount(() => {
	collapsed = window.matchMedia("(max-width: 768px)").matches;
});

$effect(() => {
	if (!browser) return;
	const interval = setInterval(() => {
		now = Date.now();
	}, TICK_MS);
	return () => clearInterval(interval);
});
</script>

{#if sortedNotices.length > 0}
	<div class="pointer-events-none absolute right-8 top-3 z-30 flex max-w-[min(88vw,560px)] flex-col items-end gap-1 sm:right-10 sm:top-4 lg:right-12">
		<button
			type="button"
			class="pointer-events-auto flex h-7 min-w-7 items-center justify-center rounded-full border border-border-subtle/70 bg-bg-primary/88 px-2 text-[11px] text-text-tertiary shadow-sm backdrop-blur-sm transition duration-150 hover:border-border-strong/70 hover:bg-bg-hover hover:text-text-primary active:scale-[0.96]"
			onclick={() => { collapsed = !collapsed; }}
			aria-label={collapsed ? "Expand generation items" : "Collapse generation items"}
		>
			{#if collapsed}
				<ChevronDown class="h-3.5 w-3.5" />
			{:else}
				<ChevronUp class="h-3.5 w-3.5" />
			{/if}
		</button>

		{#if collapsed}
			<button
				type="button"
				class="pointer-events-auto flex max-w-[min(86vw,360px)] items-center gap-2 rounded-full border border-border-subtle/75 bg-bg-primary/92 px-2.5 py-1.5 text-[11px] leading-none text-text-tertiary shadow-[0_8px_24px_rgba(0,0,0,0.10)] backdrop-blur-sm transition duration-150 hover:border-border-strong/70 hover:bg-bg-hover hover:text-text-primary active:scale-[0.98]"
				onclick={() => { collapsed = false; }}
				aria-label="Expand generation items"
			>
				<span class="font-medium text-text-secondary">Generation</span>
				{#if summaryParts.length > 0}
					<span class="h-1 w-1 rounded-full bg-border-strong/80"></span>
					<span class="truncate tabular-nums">{summaryParts.join(" · ")}</span>
				{:else}
					<span class="tabular-nums">{sortedNotices.length}</span>
				{/if}
			</button>
		{:else}
			<div class="pointer-events-auto max-h-[min(64vh,560px)] columns-2 gap-1 overflow-y-auto overscroll-contain p-px pr-1 sm:min-w-[300px] sm:max-w-[560px] sm:columns-3">
				{#each sortedNotices as notice (notice.id)}
					<div
						role="button"
						tabindex="0"
						class="group mb-1 break-inside-avoid cursor-pointer overflow-hidden border border-border-subtle/65 bg-bg-primary/94 text-left shadow-[0_4px_14px_rgba(0,0,0,0.09)] backdrop-blur-sm transition hover:-translate-y-px hover:border-border-strong/70 hover:shadow-[0_8px_22px_rgba(0,0,0,0.13)] focus:outline-none focus:ring-1 focus:ring-brand/45"
						onclick={() => handleCardClick(notice)}
						onkeydown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); handleCardClick(notice); } }}
					>
						{@render CardInner(notice, elapsedSeconds(notice))}
					</div>
				{/each}
			</div>
		{/if}
	</div>
{/if}

{#snippet CardInner(notice: GenerationTaskNotice, elapsed: number)}
	{#if isCompleted(notice)}
		{@const first = notice.mediaItems[0]}
		<div class="relative w-full bg-bg-surface">
			{#if first.type === "image"}
				<img src={first.src} alt={first.alt ?? "Generation preview"} class="block h-auto w-full object-cover" />
			{:else}
				{#if first.poster}
					<img src={first.poster} alt={first.alt ?? "Video preview"} class="block h-auto w-full object-cover" />
				{:else}
					<video src={first.src} muted playsinline preload="metadata" class="block w-full object-cover"></video>
				{/if}
				<div class="absolute inset-0 flex items-center justify-center bg-overlay-scrim/20">
					<span class="flex h-8 w-8 items-center justify-center rounded-full bg-overlay-control text-overlay-control-text backdrop-blur-sm"><Play class="ml-0.5 h-4 w-4 fill-current" /></span>
				</div>
			{/if}
			{#if notice.mediaItems.length > 1}
				<span class="absolute bottom-1.5 right-1.5 rounded-full bg-overlay-control px-1.5 py-0.5 text-[10px] font-medium text-overlay-control-text backdrop-blur-sm">{notice.mediaItems.length}</span>
			{/if}
		</div>
	{:else if isActive(notice)}
		<div class="flex min-h-[76px] flex-col justify-between p-2">
			<div class="flex items-center gap-2 text-[12px] font-medium text-text-primary">
				<Loader2 class="h-3.5 w-3.5 animate-spin text-brand" />
				<span>Generating...</span>
				<span class="text-text-tertiary tabular-nums">{elapsed}s</span>
			</div>
			{#if notice.promptPreview}
				<div class="line-clamp-3 text-[11px] leading-relaxed text-text-tertiary">{notice.promptPreview}</div>
			{/if}
		</div>
	{:else}
		<div class="flex min-h-[64px] items-center justify-center gap-2 p-2 text-[12px] font-medium text-error-soft">
			<AlertCircle class="h-3.5 w-3.5" />
			<span>Failed</span>
		</div>
	{/if}
{/snippet}
