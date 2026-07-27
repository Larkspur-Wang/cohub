<script lang="ts">
import {
	ChevronLeft,
	ChevronRight,
	Minus,
	MoveHorizontal,
	Plus,
	RotateCw,
} from "lucide-svelte";
import type {
	PDFDocumentLoadingTask,
	PDFDocumentProxy,
	RenderTask,
} from "pdfjs-dist";
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import CenteredLoading from "$lib/components/CenteredLoading.svelte";

let pdfJsPromise: Promise<typeof import("pdfjs-dist")> | null = null;

function loadPdfJs() {
	pdfJsPromise ??= import("pdfjs-dist").then((pdfJs) => {
		pdfJs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
		return pdfJs;
	});
	return pdfJsPromise;
}

const MIN_SCALE = 0.25;
const MAX_SCALE = 4;
const SCALE_STEP = 0.25;
const PAGE_GUTTER_PX = 32;
const MAX_CANVAS_PIXELS = 20_000_000;

let { source, name }: { source: string; name: string } = $props();

let viewportElement: HTMLDivElement | null = $state(null);
let canvasElement: HTMLCanvasElement | null = $state(null);
let document: PDFDocumentProxy | null = $state(null);
let pageNumber = $state(1);
let pageDraft = $state("1");
let pageCount = $state(0);
let scale = $state(1);
let renderedScale = $state(1);
let fitWidth = $state(true);
let viewportWidth = $state(0);
let loadProgress = $state<number | null>(null);
let loading = $state(true);
let rendering = $state(false);
let error = $state<string | null>(null);
let loadAttempt = $state(0);

const loadingLabel = $derived(
	loadProgress === null ? "Loading PDF…" : `Loading PDF… ${loadProgress}%`,
);
const scaleLabel = $derived(`${Math.round(renderedScale * 100)}%`);

function clampPage(value: number) {
	return Math.min(pageCount || 1, Math.max(1, Math.trunc(value) || 1));
}

function setPage(value: number) {
	pageNumber = clampPage(value);
	pageDraft = String(pageNumber);
}

function commitPageDraft() {
	setPage(Number(pageDraft));
}

function zoomTo(nextScale: number) {
	fitWidth = false;
	scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, nextScale));
}

function zoomBy(delta: number) {
	zoomTo((fitWidth ? renderedScale : scale) + delta);
}

function retry() {
	loadAttempt += 1;
}

function describeError(value: unknown) {
	if (value instanceof Error && value.name === "PasswordException") {
		return "This PDF is password protected.";
	}
	return "PDF preview failed to load.";
}

$effect(() => {
	const element = viewportElement;
	if (!element) return;
	const updateWidth = () => {
		viewportWidth = element.clientWidth;
	};
	updateWidth();
	const observer = new ResizeObserver(updateWidth);
	observer.observe(element);
	return () => observer.disconnect();
});

$effect(() => {
	const requestedSource = source;
	loadAttempt;
	let disposed = false;

	loading = true;
	error = null;
	loadProgress = null;
	document = null;
	pageCount = 0;
	pageNumber = 1;
	pageDraft = "1";
	fitWidth = true;

	let task: PDFDocumentLoadingTask | null = null;
	void loadPdfJs()
		.then((pdfJs) => {
			if (disposed) return null;
			task = pdfJs.getDocument({ url: requestedSource });
			task.onProgress = ({
				loaded,
				total,
			}: {
				loaded: number;
				total: number;
			}) => {
				if (disposed || !total) return;
				loadProgress = Math.min(100, Math.round((loaded / total) * 100));
			};
			return task.promise;
		})
		.then((nextDocument) => {
			if (disposed || !nextDocument) return;
			document = nextDocument;
			pageCount = nextDocument.numPages;
			loading = false;
		})
		.catch((reason) => {
			if (disposed) return;
			error = describeError(reason);
			loading = false;
		});

	return () => {
		disposed = true;
		if (task) void task.destroy();
	};
});

$effect(() => {
	const activeDocument = document;
	const activeCanvas = canvasElement;
	const activePage = pageNumber;
	const availableWidth = viewportWidth;
	const requestedScale = scale;
	const shouldFitWidth = fitWidth;
	if (!activeDocument || !activeCanvas || availableWidth <= 0) return;

	let disposed = false;
	let renderTask: RenderTask | null = null;
	rendering = true;
	error = null;

	void activeDocument
		.getPage(activePage)
		.then((page) => {
			if (disposed) return null;
			const baseViewport = page.getViewport({ scale: 1 });
			const nextScale = shouldFitWidth
				? Math.min(
						MAX_SCALE,
						Math.max(
							MIN_SCALE,
							(availableWidth - PAGE_GUTTER_PX) / baseViewport.width,
						),
					)
				: requestedScale;
			const cssViewport = page.getViewport({ scale: nextScale });
			const desiredPixelRatio = Math.min(window.devicePixelRatio || 1, 2);
			const pixelLimitRatio = Math.sqrt(
				MAX_CANVAS_PIXELS / (cssViewport.width * cssViewport.height),
			);
			const pixelRatio = Math.max(
				1,
				Math.min(desiredPixelRatio, pixelLimitRatio),
			);
			const renderViewport = page.getViewport({
				scale: nextScale * pixelRatio,
			});

			activeCanvas.width = Math.max(1, Math.floor(renderViewport.width));
			activeCanvas.height = Math.max(1, Math.floor(renderViewport.height));
			activeCanvas.style.width = `${Math.round(cssViewport.width)}px`;
			activeCanvas.style.height = `${Math.round(cssViewport.height)}px`;
			renderedScale = nextScale;
			renderTask = page.render({
				canvas: activeCanvas,
				viewport: renderViewport,
			});
			return renderTask.promise;
		})
		.then(() => {
			if (!disposed) rendering = false;
		})
		.catch((reason: unknown) => {
			if (
				disposed ||
				(reason instanceof Error &&
					reason.name === "RenderingCancelledException")
			)
				return;
			error = "This PDF page could not be rendered.";
			rendering = false;
		});

	return () => {
		disposed = true;
		renderTask?.cancel();
	};
});
</script>

<div class="flex h-full min-h-0 flex-col bg-bg-content">
	<div class="flex h-10 shrink-0 items-center justify-center gap-1 border-b border-border-subtle bg-bg-surface px-2">
		<button
			type="button"
			class="pdf-control"
			onclick={() => setPage(pageNumber - 1)}
			disabled={pageNumber <= 1 || loading}
			title="Previous page"
			aria-label="Previous page"
		>
			<ChevronLeft class="h-4 w-4" />
		</button>
		<div class="flex h-8 items-center gap-1 text-[11px] text-text-tertiary">
			<input
				type="number"
				class="h-7 w-10 rounded-[5px] border border-border-subtle bg-bg-input px-1 text-center text-[11px] tabular-nums text-text-primary focus:border-brand/40 focus:outline-none"
				min="1"
				max={pageCount || 1}
				bind:value={pageDraft}
				onblur={commitPageDraft}
				onkeydown={(event) => {
					if (event.key === "Enter") {
						event.preventDefault();
						commitPageDraft();
						event.currentTarget.blur();
					}
				}}
				aria-label="Page number"
				disabled={loading || pageCount === 0}
			/>
			<span aria-label={`${pageCount} pages`}>/ {pageCount || "–"}</span>
		</div>
		<button
			type="button"
			class="pdf-control"
			onclick={() => setPage(pageNumber + 1)}
			disabled={pageNumber >= pageCount || loading}
			title="Next page"
			aria-label="Next page"
		>
			<ChevronRight class="h-4 w-4" />
		</button>
		<div class="mx-1 h-4 w-px bg-border-subtle"></div>
		<button
			type="button"
			class="pdf-control"
			onclick={() => zoomBy(-SCALE_STEP)}
			disabled={renderedScale <= MIN_SCALE || loading}
			title="Zoom out"
			aria-label="Zoom out"
		>
			<Minus class="h-4 w-4" />
		</button>
		<span class="w-10 text-center text-[11px] tabular-nums text-text-tertiary">{scaleLabel}</span>
		<button
			type="button"
			class="pdf-control"
			onclick={() => zoomBy(SCALE_STEP)}
			disabled={renderedScale >= MAX_SCALE || loading}
			title="Zoom in"
			aria-label="Zoom in"
		>
			<Plus class="h-4 w-4" />
		</button>
		<button
			type="button"
			class="pdf-control"
			class:active={fitWidth}
			onclick={() => (fitWidth = true)}
			disabled={loading}
			title="Fit width"
			aria-label="Fit width"
			aria-pressed={fitWidth}
		>
			<MoveHorizontal class="h-4 w-4" />
		</button>
	</div>

	<div
		bind:this={viewportElement}
		class="relative min-h-0 flex-1 overflow-auto bg-bg-primary p-4 focus:outline-none"
		role="region"
		aria-label={`PDF preview: ${name}`}
		aria-busy={loading || rendering}
	>
		{#if loading}
			<CenteredLoading label={loadingLabel} size="panel" />
		{:else if error && !document}
			<div class="flex h-full min-h-40 flex-col items-center justify-center gap-3 px-4 text-center">
				<div class="text-[12px] text-error-soft">{error}</div>
				<button type="button" class="retry-control" onclick={retry}>
					<RotateCw class="h-3.5 w-3.5" />
					Retry
				</button>
			</div>
		{:else}
			<div class="flex min-h-full min-w-full items-start justify-center">
				<canvas
					bind:this={canvasElement}
					class:opacity-50={rendering}
					class="block max-w-none border border-border-subtle bg-bg-content shadow-sm transition-opacity motion-reduce:transition-none"
					aria-label={`${name}, page ${pageNumber} of ${pageCount}`}
				>
					{name}, page {pageNumber} of {pageCount}
				</canvas>
			</div>
			{#if error}
				<div class="pointer-events-none absolute inset-x-4 top-4 flex justify-center">
					<div class="rounded-md border border-error-soft/30 bg-error-bg px-3 py-2 text-[11px] text-error-soft shadow-sm">{error}</div>
				</div>
			{/if}
		{/if}
	</div>
</div>

<style>
	.pdf-control {
		display: inline-flex;
		height: 32px;
		width: 32px;
		flex: none;
		align-items: center;
		justify-content: center;
		border-radius: 6px;
		color: var(--text-tertiary);
	}

	.pdf-control:hover:not(:disabled),
	.pdf-control.active {
		background: var(--bg-hover);
		color: var(--text-primary);
	}

	.pdf-control:focus-visible,
	.retry-control:focus-visible {
		outline: 2px solid color-mix(in srgb, var(--brand) 45%, transparent);
		outline-offset: 1px;
	}

	.pdf-control:disabled {
		cursor: not-allowed;
		opacity: 0.35;
	}

	.retry-control {
		display: inline-flex;
		height: 32px;
		align-items: center;
		gap: 6px;
		border: 1px solid var(--border-subtle);
		border-radius: 6px;
		background: var(--bg-surface);
		padding: 0 10px;
		font-size: 12px;
		color: var(--text-secondary);
	}

	.retry-control:hover {
		background: var(--bg-hover);
		color: var(--text-primary);
	}
</style>
