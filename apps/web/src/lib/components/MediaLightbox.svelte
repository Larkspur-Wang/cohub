<script lang="ts">
import { mediaLightbox } from "$lib/components/media-lightbox.svelte";

// ─── Keyboard ───
$effect(() => {
	function onKey(e: KeyboardEvent) {
		if (!mediaLightbox.open) return;
		if (e.key === "Escape") mediaLightbox.close();
		if (e.key === "ArrowLeft") mediaLightbox.prev();
		if (e.key === "ArrowRight") mediaLightbox.next();
	}
	window.addEventListener("keydown", onKey);
	return () => window.removeEventListener("keydown", onKey);
});

// ─── Touch swipe ───
let startX = $state(0);
let startY = $state(0);

function _onTouchStart(e: TouchEvent) {
	if (e.target !== e.currentTarget) return;
	startX = e.touches[0].clientX;
	startY = e.touches[0].clientY;
}

function _onTouchEnd(e: TouchEvent) {
	if (e.target !== e.currentTarget) return;
	const dx = e.changedTouches[0].clientX - startX;
	const dy = e.changedTouches[0].clientY - startY;
	if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > 50) {
		dx > 0 ? mediaLightbox.prev() : mediaLightbox.next();
	}
}

// ─── Backdrop ───
function _onBackdropClick(e: MouseEvent) {
	if (e.target === e.currentTarget) mediaLightbox.close();
}

function _onBackdropKeyDown(e: KeyboardEvent) {
	if (e.key === "Escape") {
		e.preventDefault();
		mediaLightbox.close();
	}
}

// ─── Lock body scroll ───
$effect(() => {
	if (!mediaLightbox.open) return;
	const original = document.body.style.overflow;
	document.body.style.overflow = "hidden";
	return () => {
		document.body.style.overflow = original;
	};
});

// ─── Download ───
let downloading = $state(false);
let _downloadError = $state<string | null>(null);

async function _handleDownload() {
	const item = mediaLightbox.current;
	if (!item || downloading) return;

	downloading = true;
	_downloadError = null;
	try {
		const filename = extractFilename(item.src, item.alt);
		const blob = item.src.startsWith("data:")
			? await dataUrlToBlob(item.src)
			: await fetchUrlAsBlob(item.src);

		const url = URL.createObjectURL(blob);
		const a = document.createElement("a");
		a.href = url;
		a.download = filename;
		document.body.appendChild(a);
		a.click();
		a.remove();
		URL.revokeObjectURL(url);
	} catch (err) {
		_downloadError = err instanceof Error ? err.message : "Download failed";
	} finally {
		downloading = false;
	}
}

function extractFilename(src: string, fallback?: string): string {
	if (fallback) return fallback;
	try {
		const pathname = new URL(src).pathname;
		const name = pathname.split("/").filter(Boolean).pop();
		if (name) return decodeURIComponent(name);
	} catch {
		// ignore
	}
	return "download";
}

async function dataUrlToBlob(dataUrl: string): Promise<Blob> {
	const res = await fetch(dataUrl);
	if (!res.ok) throw new Error(`Download failed: ${res.status}`);
	return res.blob();
}

async function fetchUrlAsBlob(url: string): Promise<Blob> {
	const res = await fetch(url);
	if (!res.ok) throw new Error(`Download failed: ${res.status}`);
	return res.blob();
}
</script>

{#if mediaLightbox.open && mediaLightbox.current}
	<div
		class="fixed inset-0 z-[9999] flex items-center justify-center bg-black/85"
		onclick={onBackdropClick}
		onkeydown={onBackdropKeyDown}
		ontouchstart={onTouchStart}
		ontouchend={onTouchEnd}
		tabindex="-1"
		role="dialog"
		aria-modal="true"
		aria-label="Media preview"
	>
		<!-- Top toolbar -->
		<div class="absolute top-3 right-3 z-10 flex items-center gap-2 sm:top-4 sm:right-4">
			<!-- Download button -->
			<button
				type="button"
				class="flex items-center justify-center w-9 h-9 rounded-full bg-white/10 text-white hover:bg-white/20 transition-colors disabled:opacity-50"
				onclick={handleDownload}
				disabled={downloading}
				title="Download"
			>
				{#if downloading}
					<svg class="w-5 h-5 animate-spin" viewBox="0 0 24 24" fill="none">
						<circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
						<path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
					</svg>
				{:else}
					<Download class="w-5 h-5" />
				{/if}
			</button>
			<!-- Close button -->
			<button
				type="button"
				class="flex items-center justify-center w-9 h-9 rounded-full bg-white/10 text-white hover:bg-white/20 transition-colors"
				onclick={() => mediaLightbox.close()}
			>
				<X class="w-5 h-5" />
			</button>
		</div>

		<!-- Nav arrows (desktop only, multi-item) -->
		{#if mediaLightbox.items.length > 1}
			<button
				type="button"
				class="absolute left-3 z-10 hidden items-center justify-center w-9 h-9 rounded-full bg-white/10 text-white hover:bg-white/20 transition-colors sm:flex sm:top-1/2 sm:-translate-y-1/2 sm:left-4"
				onclick={() => mediaLightbox.prev()}
			>
				<ChevronLeft class="w-5 h-5" />
			</button>
			<button
				type="button"
				class="absolute right-3 z-10 hidden items-center justify-center w-9 h-9 rounded-full bg-white/10 text-white hover:bg-white/20 transition-colors sm:flex sm:top-1/2 sm:-translate-y-1/2 sm:right-4"
				onclick={() => mediaLightbox.next()}
			>
				<ChevronRight class="w-5 h-5" />
			</button>
		{/if}

		<!-- Media -->
		{#if mediaLightbox.current.type === "image"}
			<div class="max-w-[90vw] max-h-[85vh] rounded-lg" role="presentation" onclick={(e) => e.stopPropagation()}>
				<img
					src={mediaLightbox.current.src}
					alt={mediaLightbox.current.alt ?? ""}
					class="max-w-[90vw] max-h-[85vh] object-contain rounded-lg select-none"
				/>
			</div>
		{:else}
			<div class="w-full max-w-[95vw] max-h-[85vh] rounded-lg" role="presentation" onclick={(e) => e.stopPropagation()}>
				<!-- svelte-ignore a11y_media_has_caption: User-generated preview videos do not provide caption tracks. -->
				<video
					src={mediaLightbox.current.src}
					poster={mediaLightbox.current.poster}
					controls
					autoplay
					playsinline
					aria-label={mediaLightbox.current.alt ?? "Video preview"}
					class="w-full max-w-[95vw] max-h-[85vh] rounded-lg"
				>
				</video>
			</div>
		{/if}

		<!-- Download error hint -->
		{#if downloadError}
			<div class="absolute bottom-16 left-1/2 -translate-x-1/2 px-3 py-1.5 rounded-full bg-error-500/90 text-white text-[13px] whitespace-nowrap">
				{downloadError}
			</div>
		{/if}

		<!-- Dots indicator (multi-item) -->
		{#if mediaLightbox.items.length > 1}
			<div class="absolute bottom-6 flex items-center gap-1.5 {downloadError ? 'bottom-24' : ''}">
				{#each mediaLightbox.items as _, i}
					<span
						class="block w-1.5 h-1.5 rounded-full transition-colors {i === mediaLightbox.index ? 'bg-white' : 'bg-white/40'}"
					></span>
				{/each}
			</div>
		{/if}
	</div>
{/if}
