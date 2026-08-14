<script lang="ts">
import { X } from "lucide-svelte";
import { onMount } from "svelte";
import type { BoardAssetSource } from "$lib/board/board-asset-source";
import { playableBoardMedia } from "$lib/board/board-media-playback";
import type { BoardEditor } from "$lib/board/editor.svelte";

const {
	editor,
	assetSource,
	playingId,
	active = true,
	surface,
	onClose,
}: {
	editor: BoardEditor;
	assetSource: BoardAssetSource;
	playingId: string | null;
	active?: boolean;
	surface: { width: number; height: number };
	onClose: () => void;
} = $props();

let mediaEl: HTMLMediaElement | null = $state(null);
let src = $state<string | null>(null);
let loading = $state(false);
let error = $state<string | null>(null);

const item = $derived(playingId ? editor.itemById(playingId) : null);
const media = $derived(playableBoardMedia(item, assetSource));
const layout = $derived.by(() => {
	if (!item || !media) return null;
	const camera = editor.camera;
	const zoom = camera.zoom;
	const nodeWidth = item.frame.width * zoom;
	const nodeHeight = item.frame.height * zoom;
	const width = Math.max(nodeWidth, media.kind === "audio" ? 220 : 1);
	const height = media.kind === "audio" ? Math.max(72, nodeHeight) : nodeHeight;
	const centerX = (item.frame.x + item.frame.width / 2) * zoom + camera.x;
	const centerY = (item.frame.y + item.frame.height / 2) * zoom + camera.y;
	return {
		left: centerX - width / 2,
		top: centerY - height / 2,
		width,
		height,
		rotation: item.frame.rotation || 0,
	};
});

$effect(() => {
	const target = media;
	const id = playingId;
	if (!target || !id) {
		src = null;
		loading = false;
		error = null;
		return;
	}
	let cancelled = false;
	src = null;
	loading = true;
	error = null;
	void target
		.resolveUrl()
		.then((url) => {
			if (cancelled) return;
			if (!url) {
				error = "Media is not ready";
				return;
			}
			src = url;
		})
		.catch(() => {
			if (!cancelled) error = "Could not load media";
		})
		.finally(() => {
			if (!cancelled) loading = false;
		});
	return () => {
		cancelled = true;
	};
});

$effect(() => {
	const element = mediaEl;
	const currentLayout = layout;
	const currentMedia = media;
	if (!element) return;
	if (!active) {
		element.pause();
		return;
	}
	if (
		currentMedia?.kind === "video" &&
		currentLayout &&
		(currentLayout.left + currentLayout.width < 0 ||
			currentLayout.top + currentLayout.height < 0 ||
			currentLayout.left > surface.width ||
			currentLayout.top > surface.height)
	)
		element.pause();
});

$effect(() => {
	const element = mediaEl;
	const url = src;
	if (!element || !url || !active) return;
	queueMicrotask(() => {
		element.focus({ preventScroll: true });
		void element.play().catch(() => {
			// Native controls remain available when autoplay policy requires a second tap.
		});
	});
	return () => {
		element.pause();
		element.removeAttribute("src");
		element.load();
	};
});

onMount(() => {
	const pauseWhenHidden = () => {
		if (document.hidden) mediaEl?.pause();
	};
	document.addEventListener("visibilitychange", pauseWhenHidden);
	return () =>
		document.removeEventListener("visibilitychange", pauseWhenHidden);
});

function stopPropagation(event: Event) {
	event.stopPropagation();
}
</script>

{#if item && media && layout}
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div
		class:board-audio-player={media.kind === "audio"}
		class:board-video-player={media.kind === "video"}
		class="board-media-player"
		style:left="{layout.left}px"
		style:top="{layout.top}px"
		style:width="{layout.width}px"
		style:height="{layout.height}px"
		style:transform="rotate({layout.rotation}deg)"
		onpointerdown={stopPropagation}
		onwheel={stopPropagation}
		data-drawer-swipe-ignore
	>
		{#if src}
			{#key `${playingId}:${src}`}
				{#if media.kind === "video"}
					<!-- svelte-ignore a11y_media_has_caption -->
					<video
						bind:this={mediaEl}
						class="board-video-el"
						{src}
						controls
						playsinline
						preload="metadata"
						aria-label={media.title}
						onended={onClose}
					></video>
				{:else}
					<div class="board-audio-content">
						<div class="board-audio-title">{media.title}</div>
						<!-- svelte-ignore a11y_media_has_caption -->
						<audio
							bind:this={mediaEl}
							class="board-audio-el"
							{src}
							controls
							preload="metadata"
							aria-label={media.title}
							onended={onClose}
						></audio>
					</div>
				{/if}
			{/key}
		{:else}
			<div class="board-media-status">
				{loading ? "Loading..." : (error ?? "Unavailable")}
			</div>
		{/if}
		<button
			type="button"
			class="board-media-close"
			title="Close player"
			aria-label="Close player"
			onclick={onClose}
		>
			<X size={14} strokeWidth={2} />
		</button>
	</div>
{/if}

<style>
	.board-media-player {
		position: absolute;
		z-index: 28;
		transform-origin: center;
		overflow: hidden;
		border: 1.5px solid var(--brand-border);
		border-radius: 6px;
		background: var(--bg-primary);
		box-shadow: 0 10px 28px color-mix(in srgb, var(--overlay-scrim-strong) 20%, transparent);
	}

	.board-video-el {
		display: block;
		width: 100%;
		height: 100%;
		object-fit: contain;
		background: var(--bg-primary);
		pointer-events: auto;
	}

	.board-audio-player {
		display: flex;
		align-items: center;
	}

	.board-audio-content {
		width: 100%;
		padding: 10px 38px 8px 10px;
	}

	.board-audio-title {
		overflow: hidden;
		margin-bottom: 6px;
		color: var(--text-secondary);
		font-size: 11px;
		font-weight: 500;
		line-height: 1.2;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.board-audio-el {
		display: block;
		width: 100%;
		height: 32px;
	}

	.board-media-status {
		display: flex;
		height: 100%;
		align-items: center;
		justify-content: center;
		padding: 12px;
		color: var(--text-tertiary);
		font-size: 12px;
	}

	.board-media-close {
		position: absolute;
		top: 6px;
		right: 6px;
		display: inline-flex;
		width: 28px;
		height: 28px;
		align-items: center;
		justify-content: center;
		border: 0;
		border-radius: 6px;
		background: color-mix(in srgb, var(--bg-elevated) 90%, transparent);
		color: var(--text-secondary);
		cursor: pointer;
	}

	.board-media-close:hover {
		background: var(--bg-hover);
		color: var(--text-primary);
	}
</style>
