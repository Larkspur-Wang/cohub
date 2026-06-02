<script lang="ts">
import { AlertCircle, ChevronDown, Loader2, Play, Video } from "lucide-svelte";
import { onMount } from "svelte";
import { browser } from "$app/environment";
import { goto } from "$app/navigation";
import { type MediaItem, mediaLightbox } from "$lib/components/media-lightbox";
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

const props: Props = $props();
const TICK_MS = 1000;

let collapsed = $state(false);
let now = $state(Date.now());

const sortedNotices = $derived.by(() =>
	[...props.notices].sort((a, b) => taskTime(b) - taskTime(a)),
);
const generationCounts = $derived.by(() => ({
	generating: sortedNotices.filter(isActive).length,
	ready: sortedNotices.filter((notice) => notice.status === "completed").length,
	failed: sortedNotices.filter((notice) => notice.status === "failed").length,
	total: sortedNotices.length,
}));
const summaryText = $derived.by(() => {
	const parts = [
		generationCounts.generating
			? `Generating ${generationCounts.generating}`
			: null,
		generationCounts.ready ? `Ready ${generationCounts.ready}` : null,
		generationCounts.failed ? `Failed ${generationCounts.failed}` : null,
	].filter(Boolean);
	return parts.length > 0 ? parts.join(" · ") : `${generationCounts.total}`;
});
const statusItems = $derived.by(() =>
	[
		generationCounts.generating
			? {
					key: "generating",
					label: "Generating",
					count: generationCounts.generating,
					dotClass: "bg-brand shadow-[0_0_0_3px_var(--brand-muted)]",
				}
			: null,
		generationCounts.ready
			? {
					key: "ready",
					label: "Ready",
					count: generationCounts.ready,
					dotClass: "bg-status-running/80",
				}
			: null,
		generationCounts.failed
			? {
					key: "failed",
					label: "Failed",
					count: generationCounts.failed,
					dotClass: "bg-status-error",
				}
			: null,
	].filter(
		(
			item,
		): item is {
			key: string;
			label: string;
			count: number;
			dotClass: string;
		} => item !== null,
	),
);

function taskTime(notice: GenerationTaskNotice) {
	return Date.parse(notice.updatedAt || notice.createdAt || "") || 0;
}

function isCompleted(notice: GenerationTaskNotice) {
	return notice.status === "completed" && notice.mediaItems.length > 0;
}

function isActive(notice: GenerationTaskNotice) {
	return notice.status === "pending" || notice.status === "running";
}

function isInteractive(notice: GenerationTaskNotice) {
	return isCompleted(notice) || notice.status === "failed";
}

function elapsedSeconds(notice: GenerationTaskNotice) {
	const start = Date.parse(
		notice.startedAt || notice.createdAt || notice.updatedAt || "",
	);
	if (!start) return 0;
	return Math.max(0, Math.floor((now - start) / 1000));
}

function getTaskReferenceUri(notice: GenerationTaskNotice) {
	return `cohub://tasks/${notice.id}`;
}

function handleNoticeDragStart(event: DragEvent, notice: GenerationTaskNotice) {
	const uri = getTaskReferenceUri(notice);

	event.dataTransfer?.setData("application/x-cohub-uri", uri);
	event.dataTransfer?.setData("text/cohub-path", uri);
	event.dataTransfer?.setData("text/plain", uri);

	if (event.dataTransfer) {
		event.dataTransfer.effectAllowed = "copy";
	}
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
	<div class="pointer-events-none absolute right-3 top-3 z-30 flex w-[calc(100vw-1.5rem)] justify-end sm:right-10 sm:top-4 lg:right-12">
		<section class={`pointer-events-auto overflow-hidden rounded-[9px] border border-border-subtle/50 bg-bg-primary/76 text-text-secondary opacity-90 shadow-[0_10px_26px_rgba(0,0,0,0.08)] backdrop-blur-md transition-opacity duration-150 hover:opacity-100 ${collapsed ? "w-fit" : "w-full max-w-[560px]"}`}>
			<button
				type="button"
				tabindex="-1"
				class={`flex h-7 items-center gap-1.5 px-2 text-left text-[11px] leading-none transition duration-150 hover:bg-bg-hover/60 hover:text-text-primary ${collapsed ? "w-fit" : "w-full"}`}
				onclick={() => {
					collapsed = !collapsed;
				}}
				aria-expanded={!collapsed}
				aria-label={collapsed ? `Expand generation items: ${summaryText}` : `Collapse generation items: ${summaryText}`}
			>
				<Video class="h-3.5 w-3.5 shrink-0 text-text-tertiary" />
				<span class="sr-only">Generation</span>
				{#if collapsed}
					{#each statusItems as item (item.key)}
						<span class="inline-flex shrink-0 items-center gap-1" title={`${item.label} ${item.count}`}>
							<span class={`h-1.5 w-1.5 rounded-full ${item.dotClass}`}></span>
							<span class="text-text-tertiary tabular-nums">{item.count}</span>
						</span>
					{/each}
				{:else}
					<div class="flex min-w-0 flex-1 items-center gap-2 overflow-hidden">
						{#each statusItems as item (item.key)}
							<span class="inline-flex min-w-0 shrink-0 items-center gap-1" title={`${item.label} ${item.count}`}>
								<span class={`h-1.5 w-1.5 shrink-0 rounded-full ${item.dotClass}`}></span>
								<span class="truncate text-text-tertiary">{item.label}</span>
								<span class="text-text-tertiary tabular-nums">{item.count}</span>
							</span>
						{/each}
					</div>
				{/if}
				<ChevronDown class={`h-3.5 w-3.5 shrink-0 text-text-tertiary transition-transform duration-150 ${collapsed ? "" : "rotate-180"}`} />
			</button>

			{#if !collapsed}
				<div class="border-t border-border-subtle/45 bg-bg-surface/25 p-px">
					<div class="max-h-[min(64vh,560px)] columns-2 gap-px overflow-y-auto overscroll-contain sm:max-w-[560px] sm:columns-3">
						{#each sortedNotices as notice (notice.id)}
							{#if isInteractive(notice)}
								<button
									type="button"
									tabindex="-1"
									draggable={true}
									class="group mb-px block w-full break-inside-avoid overflow-hidden rounded-[3px] border border-transparent bg-bg-primary/72 text-left transition duration-150 hover:border-border-strong/65 hover:bg-bg-primary/90"
									onclick={() => handleCardClick(notice)}
									ondragstart={(e) => handleNoticeDragStart(e, notice)}
								>
									{@render CardInner(notice, elapsedSeconds(notice))}
								</button>
							{:else}
								<div
									role="status"
									draggable={true}
									class="group mb-px break-inside-avoid overflow-hidden rounded-[3px] border border-transparent bg-bg-primary/72 text-left transition duration-150"
									ondragstart={(e) => handleNoticeDragStart(e, notice)}
								>
									{@render CardInner(notice, elapsedSeconds(notice))}
								</div>
							{/if}
						{/each}
					</div>
				</div>
			{/if}
		</section>
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
		<div class="flex min-h-[68px] flex-col justify-between gap-2 p-2">
			<div class="flex items-center gap-2 text-[12px] font-medium text-text-primary">
				<Loader2 class="h-3.5 w-3.5 animate-spin text-brand" />
				<span>Generating</span>
				<span class="text-text-tertiary tabular-nums">{elapsed}s</span>
			</div>
			{#if notice.promptPreview}
				<div class="line-clamp-3 text-[11px] leading-relaxed text-text-tertiary">{notice.promptPreview}</div>
			{/if}
		</div>
	{:else}
		<div class="flex min-h-[56px] items-center justify-center gap-2 p-2 text-[12px] font-medium text-error-soft">
			<AlertCircle class="h-3.5 w-3.5" />
			<span>Failed</span>
		</div>
	{/if}
{/snippet}
