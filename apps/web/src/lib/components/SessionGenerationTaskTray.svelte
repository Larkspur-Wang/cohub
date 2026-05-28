<script lang="ts">
import {
	AlertCircle,
	ChevronDown,
	ChevronUp,
	Loader2,
	Play,
	X,
} from "lucide-svelte";
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
	activeSessionId: string | null;
	onDismiss: (id: string) => void;
};

const props = $props<Props>();
const MAX_EXPANDED_CARDS = 9;
const MAX_STACKED_CARDS = 3;
const HOLD_MS = 4000;
const FADE_MS = 3000;
const TICK_MS = 1000;

let collapsed = $state(false);
let now = $state(Date.now());
let hoveredIds = $state<string[]>([]);
let visibleIds = $state<string[]>([]);
let fadingIds = $state<string[]>([]);
let timers = new Map<string, ReturnType<typeof setTimeout>>();
let fadeTimers = new Map<string, ReturnType<typeof setTimeout>>();
let observer: IntersectionObserver | null = null;
let nodeById = new Map<string, HTMLElement>();
let prefersCollapsed = false;

const sortedNotices = $derived.by(() =>
	[...props.notices].sort((a, b) => taskTime(a) - taskTime(b)),
);
const expandedNotices = $derived(sortedNotices.slice(0, MAX_EXPANDED_CARDS));
const stackNotices = $derived(sortedNotices.slice(0, MAX_STACKED_CARDS));
const extraCount = $derived(
	Math.max(0, sortedNotices.length - MAX_STACKED_CARDS),
);
const displayedNotices = $derived(collapsed ? stackNotices : expandedNotices);

function taskTime(notice: GenerationTaskNotice) {
	return Date.parse(notice.createdAt || notice.updatedAt || "") || 0;
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

function hasId(list: string[], id: string) {
	return list.includes(id);
}

function addId(list: string[], id: string) {
	return list.includes(id) ? list : [...list, id];
}

function removeId(list: string[], id: string) {
	return list.filter((item) => item !== id);
}

function clearNoticeTimers(id: string) {
	const timer = timers.get(id);
	if (timer) clearTimeout(timer);
	timers.delete(id);
	const fadeTimer = fadeTimers.get(id);
	if (fadeTimer) clearTimeout(fadeTimer);
	fadeTimers.delete(id);
	fadingIds = removeId(fadingIds, id);
}

function canAutoDismiss(notice: GenerationTaskNotice) {
	if (!browser) return false;
	if (!isCompleted(notice)) return false;
	if (mediaLightbox.open) return false;
	if (document.visibilityState !== "visible") return false;
	if (notice.sessionId !== props.activeSessionId) return false;
	if (hasId(hoveredIds, notice.id)) return false;
	if (!hasId(visibleIds, notice.id)) return false;
	return displayedNotices.some((item) => item.id === notice.id);
}

function scheduleAutoDismiss(notice: GenerationTaskNotice) {
	if (
		!canAutoDismiss(notice) ||
		timers.has(notice.id) ||
		fadeTimers.has(notice.id)
	)
		return;
	const holdTimer = setTimeout(() => {
		timers.delete(notice.id);
		if (!canAutoDismiss(notice)) return;
		fadingIds = addId(fadingIds, notice.id);
		const fadeTimer = setTimeout(() => {
			fadeTimers.delete(notice.id);
			if (!canAutoDismiss(notice)) {
				fadingIds = removeId(fadingIds, notice.id);
				scheduleAutoDismiss(notice);
				return;
			}
			props.onDismiss(notice.id);
		}, FADE_MS);
		fadeTimers.set(notice.id, fadeTimer);
	}, HOLD_MS);
	timers.set(notice.id, holdTimer);
}

function rescheduleVisibleCompleted() {
	for (const notice of displayedNotices) {
		if (canAutoDismiss(notice)) scheduleAutoDismiss(notice);
		else clearNoticeTimers(notice.id);
	}
}

function setCardNode(node: HTMLElement, id: string) {
	nodeById.set(id, node);
	observer?.observe(node);
	return {
		destroy() {
			observer?.unobserve(node);
			nodeById.delete(id);
			visibleIds = removeId(visibleIds, id);
			clearNoticeTimers(id);
		},
	};
}

function handleMouseEnter(id: string) {
	hoveredIds = addId(hoveredIds, id);
	clearNoticeTimers(id);
}

function handleMouseLeave(id: string) {
	hoveredIds = removeId(hoveredIds, id);
	const notice = displayedNotices.find((item) => item.id === id);
	if (notice) scheduleAutoDismiss(notice);
}

function handleCardClick(notice: GenerationTaskNotice) {
	if (isCompleted(notice)) {
		clearNoticeTimers(notice.id);
		mediaLightbox.show(notice.mediaItems);
		return;
	}
	if (notice.status === "failed") {
		void goto(buildSpaceTaskRoute(notice.spaceId, notice.id));
	}
}

$effect(() => {
	if (!browser) return;
	prefersCollapsed = window.matchMedia("(max-width: 768px)").matches;
	collapsed = prefersCollapsed;
});

$effect(() => {
	if (!browser) return;
	const interval = setInterval(() => {
		now = Date.now();
	}, TICK_MS);
	return () => clearInterval(interval);
});

$effect(() => {
	if (!browser) return;
	observer = new IntersectionObserver(
		(entries) => {
			for (const entry of entries) {
				const id = (entry.target as HTMLElement).dataset.noticeId;
				if (!id) continue;
				visibleIds = entry.isIntersecting
					? addId(visibleIds, id)
					: removeId(visibleIds, id);
			}
			rescheduleVisibleCompleted();
		},
		{ threshold: 0.65 },
	);
	for (const node of nodeById.values()) observer.observe(node);
	return () => {
		observer?.disconnect();
		observer = null;
	};
});

$effect(() => {
	displayedNotices;
	hoveredIds;
	visibleIds;
	mediaLightbox.open;
	rescheduleVisibleCompleted();
});

$effect(() => {
	const ids = new Set(props.notices.map((notice) => notice.id));
	for (const id of [...timers.keys(), ...fadeTimers.keys()]) {
		if (!ids.has(id)) clearNoticeTimers(id);
	}
});
</script>

{#if sortedNotices.length > 0}
	<div class="pointer-events-none absolute right-3 top-3 z-30 flex max-w-[min(92vw,520px)] flex-col items-end gap-2 sm:right-4 sm:top-4">
		<button
			type="button"
			class="pointer-events-auto flex h-7 items-center gap-1 rounded-full border border-border-subtle/70 bg-bg-primary/85 px-2.5 text-[11px] text-text-tertiary shadow-sm backdrop-blur-md transition hover:bg-bg-hover hover:text-text-primary"
			onclick={() => { collapsed = !collapsed; }}
			aria-label={collapsed ? "Expand generation cards" : "Collapse generation cards"}
		>
			{#if collapsed}
				<ChevronDown class="h-3.5 w-3.5" />
				<span>{sortedNotices.length}</span>
			{:else}
				<ChevronUp class="h-3.5 w-3.5" />
			{/if}
		</button>

		{#if collapsed}
			<button
				type="button"
				class="pointer-events-auto relative h-[104px] w-[144px] outline-none"
				onclick={() => { collapsed = false; }}
				aria-label="Expand generation cards"
			>
				{#each stackNotices as notice, index (notice.id)}
					<div
						use:setCardNode={notice.id}
						data-notice-id={notice.id}
						class="absolute left-0 top-0 h-[96px] w-[132px] overflow-hidden rounded-xl border border-border-subtle/75 bg-bg-primary/90 shadow-[0_10px_32px_rgba(0,0,0,0.16)] backdrop-blur-md transition-all duration-200"
						class:opacity-0={hasId(fadingIds, notice.id)}
						style={`transform: translate(${index * 8}px, ${index * 6}px) scale(${1 - index * 0.045}); z-index: ${MAX_STACKED_CARDS - index}; opacity: ${hasId(fadingIds, notice.id) ? 0 : 1 - index * 0.16}; transition: opacity ${hasId(fadingIds, notice.id) ? FADE_MS : 180}ms ease, transform 180ms cubic-bezier(0.22, 1, 0.36, 1);`}
					>
						{@render CardInner(notice, true, elapsedSeconds(notice))}
					</div>
				{/each}
				{#if extraCount > 0}
					<span class="absolute -right-1 -top-1 z-10 rounded-full border border-border-subtle bg-bg-primary px-1.5 py-0.5 text-[10px] text-text-secondary shadow-sm">+{extraCount}</span>
				{/if}
			</button>
		{:else}
			<div class="pointer-events-auto grid max-h-[min(58vh,430px)] grid-cols-2 gap-2 overflow-y-auto rounded-2xl p-0.5 sm:grid-cols-[repeat(auto-fit,minmax(128px,1fr))] sm:min-w-[288px] sm:max-w-[520px]">
				{#each expandedNotices as notice (notice.id)}
					<div
						role="button"
						tabindex="0"
						use:setCardNode={notice.id}
						data-notice-id={notice.id}
						class="group relative h-[116px] min-w-0 cursor-pointer overflow-hidden rounded-xl border border-border-subtle/75 bg-bg-primary/90 text-left shadow-[0_10px_32px_rgba(0,0,0,0.12)] backdrop-blur-md transition hover:-translate-y-0.5 hover:border-border-strong/80 hover:shadow-[0_14px_40px_rgba(0,0,0,0.16)]"
						class:opacity-0={hasId(fadingIds, notice.id)}
						style={`transition: opacity ${hasId(fadingIds, notice.id) ? FADE_MS : 180}ms ease, transform 180ms cubic-bezier(0.22, 1, 0.36, 1), border-color 160ms ease, box-shadow 160ms ease;`}
						onmouseenter={() => handleMouseEnter(notice.id)}
						onmouseleave={() => handleMouseLeave(notice.id)}
						onclick={() => handleCardClick(notice)}
						onkeydown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); handleCardClick(notice); } }}
					>
						{@render CardInner(notice, false, elapsedSeconds(notice))}
						<button
							type="button"
							class="absolute right-1.5 top-1.5 z-10 flex h-5 w-5 items-center justify-center rounded-full bg-bg-primary/80 text-text-tertiary opacity-0 backdrop-blur-sm transition hover:text-text-primary group-hover:opacity-100"
							onclick={(event) => { event.stopPropagation(); props.onDismiss(notice.id); }}
							aria-label="Dismiss generation card"
						>
							<X class="h-3 w-3" />
						</button>
					</div>
				{/each}
			</div>
		{/if}
	</div>
{/if}

{#snippet CardInner(notice: GenerationTaskNotice, compact: boolean, elapsed: number)}
	{#if isCompleted(notice)}
		{@const first = notice.mediaItems[0]}
		<div class="relative h-full w-full bg-bg-surface">
			{#if first.type === "image"}
				<img src={first.src} alt={first.alt ?? "Generation preview"} class="h-full w-full object-cover" />
			{:else}
				{#if first.poster}
					<img src={first.poster} alt={first.alt ?? "Video preview"} class="h-full w-full object-cover" />
				{:else}
					<video src={first.src} muted playsinline preload="metadata" class="h-full w-full object-cover"></video>
				{/if}
				<div class="absolute inset-0 flex items-center justify-center bg-black/12">
					<span class="flex h-8 w-8 items-center justify-center rounded-full bg-black/45 text-white backdrop-blur-sm"><Play class="ml-0.5 h-4 w-4 fill-current" /></span>
				</div>
			{/if}
			{#if notice.mediaItems.length > 1}
				<span class="absolute bottom-1.5 right-1.5 rounded-full bg-black/55 px-1.5 py-0.5 text-[10px] font-medium text-white backdrop-blur-sm">{notice.mediaItems.length}</span>
			{/if}
		</div>
	{:else if isActive(notice)}
		<div class="flex h-full flex-col justify-between p-3">
			<div class="flex items-center gap-2 text-[12px] font-medium text-text-primary">
				<Loader2 class="h-3.5 w-3.5 animate-spin text-brand" />
				<span>Generating...</span>
				<span class="text-text-tertiary tabular-nums">{elapsed}s</span>
			</div>
			{#if notice.promptPreview && !compact}
				<div class="line-clamp-3 text-[11px] leading-relaxed text-text-tertiary">{notice.promptPreview}</div>
			{:else if notice.promptPreview}
				<div class="line-clamp-2 text-[10px] leading-snug text-text-tertiary">{notice.promptPreview}</div>
			{/if}
		</div>
	{:else}
		<div class="flex h-full items-center justify-center gap-2 p-3 text-[12px] font-medium text-error-soft">
			<AlertCircle class="h-3.5 w-3.5" />
			<span>Failed</span>
		</div>
	{/if}
{/snippet}
