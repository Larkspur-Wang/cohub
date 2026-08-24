<script lang="ts">
import {
	BOARD_TASK_ARTIFACT_LIMIT,
	type BoardTaskSnapshot,
	normalizeBoardRemoteUrl,
	rankedTaskArtifacts,
} from "@neta-art/cohub/board";
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
import { setCohubResourceDragData } from "$lib/drag/cohub-resource-drag";
import { getLocale } from "$lib/i18n/locale.svelte";
import { m } from "$lib/paraglide/messages.js";
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
	hasMore?: boolean;
	loadingMore?: boolean;
	onExpand?: () => void;
	onLoadMore?: () => void;
	onOpenGenerationMedia?: (notice: GenerationTaskNotice) => void;
};

const props: Props = $props();

const locale = $derived(getLocale());
const TICK_MS = 1000;
const INITIAL_VISIBLE_NOTICE_COUNT = 12;
const NOTICE_PAGE_SIZE = 12;
const GENERATION_PREVIEW_OSS_PROCESS =
	"image/resize,w_640/quality,q_82/format,webp";

let collapsed = $state(true);
let now = $state(Date.now());
let visibleNoticeCount = $state(INITIAL_VISIBLE_NOTICE_COUNT);

const sortedNotices = $derived.by(() =>
	[...props.notices].sort((a, b) => taskTime(b) - taskTime(a)),
);
const visibleNotices = $derived.by(() =>
	sortedNotices.slice(0, visibleNoticeCount),
);
const hiddenNoticeCount = $derived.by(() =>
	Math.max(0, sortedNotices.length - visibleNotices.length),
);
const canShowMoreLocalNotices = $derived(hiddenNoticeCount > 0);
const canShowTaskPagination = $derived(
	canShowMoreLocalNotices || props.hasMore,
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
const summaryText = $derived.by(() =>
	counts.running ? `Running ${counts.running}` : `Tasks ${counts.total}`,
);
const expandedSummaryText = $derived.by(() => {
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

function isInlineMediaSrc(src: string | null | undefined) {
	return /^(data|blob):/i.test(src?.trim() ?? "");
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

function isDeferredGeneration(notice: SessionTaskNotice) {
	return (
		isCompletedGeneration(notice) &&
		notice.mediaItems.some(
			(item) =>
				item.deferred ||
				isInlineMediaSrc(item.src) ||
				isInlineMediaSrc(item.poster),
		)
	);
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

function withPreviewOssProcess(src: string | null | undefined) {
	const value = src?.trim();
	if (!value) return "";
	if (isInlineMediaSrc(value)) return value;
	if (/[?&]x-oss-process=/.test(value)) return value;

	const hashIndex = value.indexOf("#");
	const base = hashIndex >= 0 ? value.slice(0, hashIndex) : value;
	const hash = hashIndex >= 0 ? value.slice(hashIndex) : "";
	const separator = base.includes("?") ? "&" : "?";
	return `${base}${separator}x-oss-process=${GENERATION_PREVIEW_OSS_PROCESS}${hash}`;
}

function taskSnapshot(notice: SessionTaskNotice): BoardTaskSnapshot {
	const artifacts = notice.mediaItems.flatMap((media, index) => {
		if (isInlineMediaSrc(media.src)) return [];
		const url = normalizeBoardRemoteUrl(media.src);
		if (!url) return [];
		return [
			{
				id: `output-${index + 1}`,
				type: media.type,
				url,
				title: media.alt,
			},
		];
	});
	return {
		taskType: notice.kind === "generation" ? "generation" : "run_command",
		status: notice.status,
		title: notice.title,
		...(notice.preview ? { promptExcerpt: notice.preview } : {}),
		artifactCount: artifacts.length,
		artifacts: rankedTaskArtifacts(artifacts).slice(
			0,
			BOARD_TASK_ARTIFACT_LIMIT,
		),
		updatedAt: notice.updatedAt,
	};
}

function handleNoticeDragStart(event: DragEvent, notice: SessionTaskNotice) {
	const uri = getTaskReferenceUri(notice);
	setCohubResourceDragData(
		event.dataTransfer,
		{
			version: 1,
			resources: [
				{
					type: "task",
					ref: notice.id,
					taskRunId: notice.id,
					snapshot: taskSnapshot(notice),
				},
			],
			origin: { kind: "task-list" },
			createdAt: Date.now(),
		},
		{ cohubPath: uri, plainText: uri, effectAllowed: "copy" },
	);
}

function handleCardClick(notice: SessionTaskNotice) {
	if (isCompletedGeneration(notice)) {
		if (isDeferredGeneration(notice)) {
			props.onOpenGenerationMedia?.(notice as GenerationTaskNotice);
			return;
		}
		mediaLightbox.show(notice.mediaItems);
		return;
	}
	void goto(buildSpaceTaskRoute(notice.spaceId, notice.id));
}

function handleLoadMore() {
	if (canShowMoreLocalNotices) {
		visibleNoticeCount = Math.min(
			sortedNotices.length,
			visibleNoticeCount + NOTICE_PAGE_SIZE,
		);
		return;
	}
	props.onLoadMore?.();
}

function handleToggle() {
	const nextCollapsed = !collapsed;
	collapsed = nextCollapsed;
	if (!nextCollapsed) {
		visibleNoticeCount = INITIAL_VISIBLE_NOTICE_COUNT;
		props.onExpand?.();
	}
}

onMount(() => {
	collapsed = true;
});

$effect(() => {
	if (sortedNotices.length >= visibleNoticeCount) return;
	visibleNoticeCount = Math.max(
		INITIAL_VISIBLE_NOTICE_COUNT,
		sortedNotices.length,
	);
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
	<div class="pointer-events-none fixed right-3 top-[calc(env(safe-area-inset-top)+3.5rem)] z-40 flex w-[calc(100vw-1.5rem)] justify-end sm:right-4 sm:w-[min(560px,calc(100vw-2rem))] lg:absolute lg:right-16 lg:top-4 lg:z-30 lg:w-[calc(100vw-1.5rem)]">
		<section class={`pointer-events-auto overflow-hidden rounded-[9px] border border-border-primary bg-bg-elevated text-text-secondary shadow-[0_16px_36px_rgba(0,0,0,0.14)] transition-shadow duration-150 ${collapsed ? "w-fit" : "w-full max-w-[560px]"}`}>
			<button
				type="button"
				tabindex="-1"
				class={`flex h-7 items-center gap-1.5 px-2 text-left text-[11px] leading-none transition duration-150 hover:bg-bg-hover hover:text-text-primary ${collapsed ? "w-fit" : "w-full"}`}
				onclick={handleToggle}
				aria-expanded={!collapsed}
				aria-label={collapsed ? `Expand tasks: ${summaryText}` : `Collapse tasks: ${expandedSummaryText}`}
			>
				{#if counts.commands > 0 && counts.generations === 0}
					<Terminal class="h-3.5 w-3.5 shrink-0 text-text-tertiary" />
				{:else}
					<Video class="h-3.5 w-3.5 shrink-0 text-text-tertiary" />
				{/if}
				<span class="sr-only">{m.task_tray_tasks({}, { locale })}</span>
				{#if collapsed}
					{#if counts.running > 0}
						<span class="inline-flex shrink-0 items-center gap-1" title={`Running ${counts.running}`}>
							<span class="h-1.5 w-1.5 rounded-full bg-brand shadow-[0_0_0_3px_var(--brand-muted)]"></span>
							<span class="text-text-tertiary tabular-nums">{counts.running}</span>
						</span>
					{/if}
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
				<div class="border-t border-border-primary bg-bg-primary p-px">
					<div class="max-h-[min(64vh,560px)] columns-1 gap-px overflow-y-auto overscroll-contain sm:max-w-[560px] sm:columns-2">
						{#each visibleNotices as notice (notice.id)}
							{#if isInteractive(notice)}
								<button
									type="button"
									tabindex="-1"
									draggable={true}
									class="group mb-px block w-full break-inside-avoid overflow-hidden rounded-[3px] border border-border-subtle bg-bg-surface text-left transition duration-150 hover:border-border-primary hover:bg-bg-surface-hover"
									onclick={() => handleCardClick(notice)}
									ondragstart={(e) => handleNoticeDragStart(e, notice)}
								>
									{@render CardInner(notice, elapsedSeconds(notice))}
								</button>
							{:else}
								<div
									role="status"
									draggable={true}
									class="group mb-px break-inside-avoid overflow-hidden rounded-[3px] border border-border-subtle bg-bg-surface text-left transition duration-150"
									ondragstart={(e) => handleNoticeDragStart(e, notice)}
								>
									{@render CardInner(notice, elapsedSeconds(notice))}
								</div>
							{/if}
						{/each}
					</div>
					{#if canShowTaskPagination}
						<div class="border-t border-border-primary bg-bg-elevated p-1">
							<button
								type="button"
								class="flex h-7 w-full items-center justify-center gap-1.5 rounded-[4px] text-[11px] text-text-tertiary transition hover:bg-bg-hover hover:text-text-secondary disabled:cursor-not-allowed disabled:opacity-60"
								disabled={props.loadingMore && !canShowMoreLocalNotices}
								onclick={handleLoadMore}
							>
								{#if props.loadingMore && !canShowMoreLocalNotices}
									<Loader2 class="h-3.5 w-3.5 animate-spin" />
									Loading
								{:else if canShowMoreLocalNotices}
									Show more
								{:else}
									Load more
								{/if}
							</button>
						</div>
					{/if}
				</div>
			{/if}
		</section>
	</div>
{/if}

{#snippet CardInner(notice: SessionTaskNotice, elapsed: number)}
	{#if isCompletedGeneration(notice)}
		{@const first = notice.mediaItems[0]}
		<div class="relative flex aspect-[4/3] w-full items-center justify-center bg-bg-surface text-text-tertiary">
			{#if first.deferred || isInlineMediaSrc(first.src) || isInlineMediaSrc(first.poster)}
				<div class="flex flex-col items-center gap-2 px-3 text-center">
					<Video class="h-5 w-5" />
					<div class="text-[11px] font-medium text-text-secondary">{m.task_tray_media_ready({}, { locale })}</div>
					<div class="text-[10px] leading-snug text-text-placeholder">{m.task_tray_open_preview({}, { locale })}</div>
				</div>
			{:else if first.type === "image"}
				<img src={withPreviewOssProcess(first.src)} alt={first.alt ?? m.task_tray_generation_preview({}, { locale })} class="block h-auto w-full object-cover" />
			{:else}
				{#if first.poster}
					<img src={withPreviewOssProcess(first.poster)} alt={first.alt ?? m.task_tray_video_preview({}, { locale })} class="block h-auto w-full object-cover" />
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
