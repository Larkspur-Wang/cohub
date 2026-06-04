<script lang="ts">
import {
	AlertCircle,
	ChevronDown,
	Loader2,
	Play,
	Terminal,
	Video,
} from "lucide-svelte";
import { onMount } from "svelte";
import { browser } from "$app/environment";
import { goto } from "$app/navigation";
import { type MediaItem, mediaLightbox } from "$lib/components/media-lightbox";
import { buildSpaceTaskRoute } from "$lib/space-routes";

export type SessionTaskNotice = {
	id: string;
	kind: "generation" | "background_bash";
	spaceId: string;
	sessionId: string;
	turnId: string | null;
	status: "pending" | "running" | "completed" | "failed";
	title: string;
	subtitle: string | null;
	preview: string | null;
	mediaItems: MediaItem[];
	createdAt: string;
	startedAt: string | null;
	updatedAt: string;
	finishedAt: string | null;
};

export type GenerationTaskNotice = SessionTaskNotice & { kind: "generation" };

type Props = {
	notices: SessionTaskNotice[];
};

const props: Props = $props();
const TICK_MS = 1000;

let collapsed = $state(true);
let now = $state(Date.now());

const sortedNotices = $derived.by(() =>
	[...props.notices].sort((a, b) => taskTime(b) - taskTime(a)),
);
const counts = $derived.by(() => ({
	running: sortedNotices.filter(isActive).length,
	ready: sortedNotices.filter((notice) => notice.status === "completed").length,
	failed: sortedNotices.filter((notice) => notice.status === "failed").length,
	commands: sortedNotices.filter((notice) => notice.kind === "background_bash")
		.length,
	generations: sortedNotices.filter((notice) => notice.kind === "generation")
		.length,
	total: sortedNotices.length,
}));
const summaryText = $derived.by(() => {
	const parts = [
		counts.running ? `Running ${counts.running}` : null,
		counts.ready ? `Ready ${counts.ready}` : null,
		counts.failed ? `Failed ${counts.failed}` : null,
	].filter(Boolean);
	return parts.length > 0 ? parts.join(" · ") : `Tasks ${counts.total}`;
});
const statusItems = $derived.by(() =>
	[
		counts.running
			? {
					key: "running",
					label: "Running",
					count: counts.running,
					dotClass: "bg-brand shadow-[0_0_0_3px_var(--brand-muted)]",
				}
			: null,
		counts.ready
			? {
					key: "ready",
					label: "Ready",
					count: counts.ready,
					dotClass: "bg-status-running/80",
				}
			: null,
		counts.failed
			? {
					key: "failed",
					label: "Failed",
					count: counts.failed,
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

function taskTime(notice: SessionTaskNotice) {
	return Date.parse(notice.updatedAt || notice.createdAt || "") || 0;
}

function isCompletedGeneration(notice: SessionTaskNotice) {
	return (
		notice.kind === "generation" &&
		notice.status === "completed" &&
		notice.mediaItems.length > 0
	);
}

function isActive(notice: SessionTaskNotice) {
	return notice.status === "pending" || notice.status === "running";
}

function isInteractive(notice: SessionTaskNotice) {
	return (
		isCompletedGeneration(notice) ||
		notice.status === "failed" ||
		notice.kind === "background_bash"
	);
}

function elapsedSeconds(notice: SessionTaskNotice) {
	const start = Date.parse(
		notice.startedAt || notice.createdAt || notice.updatedAt || "",
	);
	if (!start) return 0;
	return Math.max(0, Math.floor((now - start) / 1000));
}

function formatElapsed(seconds: number) {
	if (seconds < 60) return `${seconds}s`;
	const minutes = Math.floor(seconds / 60);
	const rest = seconds % 60;
	if (minutes < 60) return `${minutes}m ${rest}s`;
	const hours = Math.floor(minutes / 60);
	return `${hours}h ${minutes % 60}m`;
}

function getTaskReferenceUri(notice: SessionTaskNotice) {
	return `cohub://tasks/${notice.id}`;
}

function handleNoticeDragStart(event: DragEvent, notice: SessionTaskNotice) {
	const uri = getTaskReferenceUri(notice);
	event.dataTransfer?.setData("application/x-cohub-uri", uri);
	event.dataTransfer?.setData("text/cohub-path", uri);
	event.dataTransfer?.setData("text/plain", uri);
	if (event.dataTransfer) event.dataTransfer.effectAllowed = "copy";
}

function handleCardClick(notice: SessionTaskNotice) {
	if (isCompletedGeneration(notice)) {
		mediaLightbox.show(notice.mediaItems);
		return;
	}
	void goto(buildSpaceTaskRoute(notice.spaceId, notice.id));
}

onMount(() => {
	collapsed = true;
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
				aria-label={collapsed ? `Expand tasks: ${summaryText}` : `Collapse tasks: ${summaryText}`}
			>
				{#if counts.commands > 0 && counts.generations === 0}
					<Terminal class="h-3.5 w-3.5 shrink-0 text-text-tertiary" />
				{:else}
					<Video class="h-3.5 w-3.5 shrink-0 text-text-tertiary" />
				{/if}
				<span class="sr-only">Tasks</span>
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
					<div class="max-h-[min(64vh,560px)] columns-1 gap-px overflow-y-auto overscroll-contain sm:max-w-[560px] sm:columns-2">
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

{#snippet CardInner(notice: SessionTaskNotice, elapsed: number)}
	{#if isCompletedGeneration(notice)}
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
	{:else}
		<div class="flex min-h-[68px] flex-col gap-2 p-2">
			<div class="flex items-center gap-2 text-[12px] font-medium text-text-primary">
				{#if notice.status === "failed"}
					<AlertCircle class="h-3.5 w-3.5 shrink-0 text-error-soft" />
				{:else if isActive(notice)}
					<Loader2 class="h-3.5 w-3.5 shrink-0 animate-spin text-brand" />
				{:else if notice.kind === "background_bash"}
					<Terminal class="h-3.5 w-3.5 shrink-0 text-text-tertiary" />
				{:else}
					<Video class="h-3.5 w-3.5 shrink-0 text-text-tertiary" />
				{/if}
				<span class="min-w-0 flex-1 truncate">{notice.title}</span>
				{#if isActive(notice)}
					<span class="shrink-0 text-text-tertiary tabular-nums">{formatElapsed(elapsed)}</span>
				{/if}
			</div>
			{#if notice.subtitle}
				<div class="truncate text-[11px] leading-relaxed text-text-tertiary">{notice.subtitle}</div>
			{/if}
			{#if notice.preview}
				<div class="line-clamp-3 whitespace-pre-wrap text-[11px] leading-relaxed text-text-tertiary">{notice.preview}</div>
			{/if}
		</div>
	{/if}
{/snippet}
