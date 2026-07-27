<script lang="ts">
import {
	ChevronLeft,
	ChevronRight,
	LoaderCircle,
	Minus,
	MoveHorizontal,
	Plus,
} from "lucide-svelte";
import type {
	PDFDocumentLoadingTask,
	PDFDocumentProxy,
	RenderTask,
} from "pdfjs-dist";
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { untrack } from "svelte";

const MIN_SCALE = 0.25;
const MAX_SCALE = 4;
const SCALE_STEP = 1.2;
const MAX_CANVAS_PIXELS = 16_777_216;

type Props = {
	name: string;
	url?: string | null;
	base64?: string | null;
	version: string;
	isMobile?: boolean;
};

let {
	name,
	url = null,
	base64 = null,
	version,
	isMobile = false,
}: Props = $props();

let viewportElement: HTMLDivElement | null = $state(null);
let canvasElement: HTMLCanvasElement | null = $state(null);
let viewportWidth = $state(0);
let pdfDocument: PDFDocumentProxy | null = $state(null);
let pageNumber = $state(1);
let pageCount = $state(0);
let manualScale = $state(1);
let renderedScale = $state(1);
let fitWidth = $state(true);
let loading = $state(true);
let rendering = $state(false);
let progress = $state<number | null>(null);
let error = $state<string | null>(null);
let passwordPrompt = $state(false);
let passwordError = $state<string | null>(null);
let passwordValue = $state("");
let passwordInput: HTMLInputElement | null = $state(null);
let passwordSubmit: ((password: string) => void) | null = null;
let loadAttempt = $state(0);
let loadGeneration = 0;
let renderGeneration = 0;
let loadingTask: PDFDocumentLoadingTask | null = null;
let renderTask: RenderTask | null = null;

const sourceKey = $derived(
	`${version}:${url ?? `inline:${base64?.length ?? 0}`}`,
);
const scaleLabel = $derived(`${Math.round(renderedScale * 100)}%`);

function clampScale(value: number) {
	return Math.min(MAX_SCALE, Math.max(MIN_SCALE, value));
}

function decodeBase64(value: string) {
	const binary = atob(value);
	const bytes = new Uint8Array(binary.length);
	for (let index = 0; index < binary.length; index += 1) {
		bytes[index] = binary.charCodeAt(index);
	}
	return bytes;
}

function readableLoadError(cause: unknown) {
	const errorName =
		cause && typeof cause === "object" && "name" in cause
			? String(cause.name)
			: "";
	if (errorName === "InvalidPDFException")
		return "This PDF is damaged or invalid.";
	if (errorName === "MissingPDFException")
		return "This PDF is no longer available.";
	if (errorName === "UnexpectedResponseException")
		return "The PDF could not be downloaded.";
	return "The PDF could not be opened.";
}

function disposeDocument() {
	renderGeneration += 1;
	renderTask?.cancel();
	renderTask = null;

	const task = loadingTask;
	const document = pdfDocument;
	loadingTask = null;
	pdfDocument = null;
	if (task) void task.destroy();
	else if (document) void document.cleanup();
}

async function openPdf(
	generation: number,
	sourceUrl: string | null,
	sourceBase64: string | null,
) {
	loading = true;
	progress = null;
	error = null;
	passwordPrompt = false;
	passwordError = null;
	passwordValue = "";
	passwordSubmit = null;
	pageNumber = 1;
	pageCount = 0;
	fitWidth = true;
	manualScale = 1;

	try {
		const pdfjs = await import("pdfjs-dist");
		if (generation !== loadGeneration) return;
		pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

		if (!sourceUrl && !sourceBase64) {
			throw new Error("PDF source is unavailable.");
		}
		const source = sourceUrl
			? { url: sourceUrl }
			: { data: decodeBase64(sourceBase64 ?? "") };
		const task = pdfjs.getDocument({
			...source,
			enableXfa: false,
			canvasMaxAreaInBytes: MAX_CANVAS_PIXELS * 4,
		});
		loadingTask = task;
		task.onProgress = ({ percent }: { percent: number }) => {
			if (generation !== loadGeneration || !Number.isFinite(percent)) return;
			progress = Math.min(100, Math.max(0, Math.round(percent)));
		};
		task.onPassword = (
			updatePassword: (password: string) => void,
			reason: number,
		) => {
			if (generation !== loadGeneration) return;
			passwordSubmit = updatePassword;
			passwordError =
				reason === pdfjs.PasswordResponses.INCORRECT_PASSWORD
					? "Incorrect password."
					: null;
			passwordPrompt = true;
			loading = false;
		};

		const document = await task.promise;
		if (generation !== loadGeneration) {
			await task.destroy();
			return;
		}
		pdfDocument = document;
		pageCount = document.numPages;
		passwordPrompt = false;
		passwordSubmit = null;
		loading = false;
	} catch (cause) {
		if (generation !== loadGeneration) return;
		error = readableLoadError(cause);
		loading = false;
	}
}

async function renderPage(input: {
	document: PDFDocumentProxy;
	canvas: HTMLCanvasElement;
	page: number;
	width: number;
	fit: boolean;
	scale: number;
}) {
	const generation = ++renderGeneration;
	renderTask?.cancel();
	renderTask = null;
	rendering = true;
	try {
		const page = await input.document.getPage(input.page);
		if (generation !== renderGeneration) return;
		const naturalViewport = page.getViewport({ scale: 1 });
		const horizontalPadding = isMobile ? 16 : 32;
		const availableWidth = Math.max(160, input.width - horizontalPadding);
		const scale = input.fit
			? clampScale(availableWidth / naturalViewport.width)
			: clampScale(input.scale);
		const viewport = page.getViewport({ scale });
		const pixelRatio = Math.max(1, window.devicePixelRatio || 1);
		const maxOutputScale = Math.sqrt(
			MAX_CANVAS_PIXELS / Math.max(1, viewport.width * viewport.height),
		);
		const outputScale = Math.min(pixelRatio, maxOutputScale);

		input.canvas.width = Math.max(1, Math.floor(viewport.width * outputScale));
		input.canvas.height = Math.max(
			1,
			Math.floor(viewport.height * outputScale),
		);
		input.canvas.style.width = `${Math.floor(viewport.width)}px`;
		input.canvas.style.height = `${Math.floor(viewport.height)}px`;

		const task = page.render({
			canvas: input.canvas,
			viewport,
			transform:
				outputScale === 1 ? undefined : [outputScale, 0, 0, outputScale, 0, 0],
		});
		renderTask = task;
		await task.promise;
		if (generation !== renderGeneration) return;
		renderedScale = scale;
	} catch (cause) {
		const errorName =
			cause && typeof cause === "object" && "name" in cause
				? String(cause.name)
				: "";
		if (
			generation === renderGeneration &&
			errorName !== "RenderingCancelledException"
		) {
			error = "This PDF page could not be rendered.";
		}
	} finally {
		if (generation === renderGeneration) rendering = false;
	}
}

function goToPage(page: number) {
	if (!Number.isFinite(pageCount) || pageCount < 1) return;
	pageNumber = Math.min(pageCount, Math.max(1, Math.round(page)));
	if (viewportElement) {
		viewportElement.scrollTop = 0;
		viewportElement.scrollLeft = 0;
	}
}

function commitPageInput(event: Event) {
	const input = event.currentTarget as HTMLInputElement;
	const value = Number.parseInt(input.value, 10);
	if (Number.isFinite(value)) goToPage(value);
	input.value = String(pageNumber);
}

function zoomBy(factor: number) {
	fitWidth = false;
	manualScale = clampScale(renderedScale * factor);
}

function fitPageWidth() {
	fitWidth = true;
}

function submitPassword(event: SubmitEvent) {
	event.preventDefault();
	const password = passwordValue;
	if (!password || !passwordSubmit) return;
	passwordPrompt = false;
	loading = true;
	passwordSubmit(password);
	passwordSubmit = null;
	passwordValue = "";
}

$effect(() => {
	const element = viewportElement;
	if (!element) return;
	const updateWidth = () => {
		viewportWidth = Math.floor(element.clientWidth);
	};
	updateWidth();
	const observer = new ResizeObserver(updateWidth);
	observer.observe(element);
	return () => observer.disconnect();
});

$effect(() => {
	if (passwordPrompt) passwordInput?.focus();
});

$effect(() => {
	sourceKey;
	loadAttempt;
	const sourceUrl = url;
	const sourceBase64 = base64;
	const generation = ++loadGeneration;
	untrack(() => {
		disposeDocument();
		void openPdf(generation, sourceUrl, sourceBase64);
	});
	return () => {
		if (generation !== loadGeneration) return;
		loadGeneration += 1;
		disposeDocument();
	};
});

$effect(() => {
	const document = pdfDocument;
	const canvas = canvasElement;
	const page = pageNumber;
	const width = viewportWidth;
	const fit = fitWidth;
	const scale = manualScale;
	if (!document || !canvas || width <= 0 || page < 1) return;
	void renderPage({ document, canvas, page, width, fit, scale });
});
</script>

<div
	class="relative h-full min-h-0 w-full overflow-hidden bg-bg-primary"
	role="region"
	aria-label={`PDF preview: ${name}`}
>
	<div
		bind:this={viewportElement}
		class="h-full overflow-auto overscroll-contain px-2 pt-2 pb-20 sm:px-4 sm:pt-4"
	>
		<div class="flex min-h-full min-w-full items-start justify-center">
			{#if pdfDocument}
				<canvas
					bind:this={canvasElement}
					class="shrink-0 shadow-md"
					aria-label={`Page ${pageNumber} of ${pageCount}`}
				></canvas>
			{/if}
		</div>
	</div>

	{#if loading}
		<div class="pointer-events-none absolute inset-0 flex items-center justify-center bg-bg-primary/80">
			<div class="flex items-center gap-2 text-xs text-text-tertiary" role="status">
				<LoaderCircle class="h-4 w-4 animate-spin" />
				<span>{progress === null ? "Loading PDF…" : `Loading PDF · ${progress}%`}</span>
			</div>
		</div>
	{:else if passwordPrompt}
		<div class="absolute inset-0 flex items-center justify-center bg-bg-primary/90 p-4">
			<form
				class="w-full max-w-xs rounded-md border border-border-subtle bg-bg-surface p-4 shadow-lg"
				onsubmit={submitPassword}
			>
				<label for="pdf-password" class="block text-xs font-medium text-text-primary">
					Password protected
				</label>
				{#if passwordError}
					<div class="mt-1 text-[11px] text-error-soft">{passwordError}</div>
				{/if}
				<div class="mt-3 flex gap-2">
					<input
						bind:this={passwordInput}
						id="pdf-password"
						type="password"
						bind:value={passwordValue}
						autocomplete="off"
						class="h-8 min-w-0 flex-1 rounded-md border border-border-subtle bg-bg-input px-2.5 text-xs text-text-primary focus:border-brand/50 focus:outline-none"
						placeholder="Password"
					/>
					<button type="submit" class="action-btn primary" disabled={!passwordValue}>Open</button>
				</div>
			</form>
		</div>
	{:else if error}
		<div class="absolute inset-0 flex items-center justify-center bg-bg-primary/90 p-4">
			<div class="max-w-xs text-center">
				<div class="text-xs text-error-soft">{error}</div>
				<button type="button" class="action-btn mt-3" onclick={() => (loadAttempt += 1)}>Retry</button>
			</div>
		</div>
	{/if}

	{#if pdfDocument && !loading && !passwordPrompt && !error}
		<div
			class="pdf-toolbar absolute bottom-3 left-1/2 z-10 flex -translate-x-1/2 items-center rounded-md border border-border-subtle bg-bg-surface p-1 shadow-lg"
			class:pdf-toolbar--mobile={isMobile}
		>
			<button
				type="button"
				class="pdf-tool-btn"
				disabled={pageNumber <= 1}
				onclick={() => goToPage(pageNumber - 1)}
				title="Previous page"
				aria-label="Previous page"
			>
				<ChevronLeft class="h-4 w-4" />
			</button>
			<div class="pdf-page-control flex h-8 items-center gap-1 px-1 text-[11px] text-text-tertiary tabular-nums">
				<input
					type="number"
					min="1"
					max={pageCount}
					value={pageNumber}
					class="pdf-page-input h-7 w-9 rounded border border-border-subtle bg-bg-input px-1 text-center text-[11px] text-text-primary focus:border-brand/50 focus:outline-none"
					aria-label="Page number"
					onchange={commitPageInput}
					onblur={commitPageInput}
					onkeydown={(event) => {
						if (event.key === "Enter") event.currentTarget.blur();
					}}
				/>
				<span aria-label={`${pageCount} pages`}>/ {pageCount}</span>
			</div>
			<button
				type="button"
				class="pdf-tool-btn"
				disabled={pageNumber >= pageCount}
				onclick={() => goToPage(pageNumber + 1)}
				title="Next page"
				aria-label="Next page"
			>
				<ChevronRight class="h-4 w-4" />
			</button>
			<div class="pdf-divider mx-1 h-4 w-px bg-border-subtle"></div>
			<button
				type="button"
				class="pdf-tool-btn"
				disabled={renderedScale <= MIN_SCALE}
				onclick={() => zoomBy(1 / SCALE_STEP)}
				title="Zoom out"
				aria-label="Zoom out"
			>
				<Minus class="h-4 w-4" />
			</button>
			<span class="hidden w-10 text-center text-[10px] text-text-tertiary tabular-nums sm:inline">
				{scaleLabel}
			</span>
			<button
				type="button"
				class="pdf-tool-btn"
				disabled={renderedScale >= MAX_SCALE}
				onclick={() => zoomBy(SCALE_STEP)}
				title="Zoom in"
				aria-label="Zoom in"
			>
				<Plus class="h-4 w-4" />
			</button>
			<button
				type="button"
				class="pdf-tool-btn"
				class:active={fitWidth}
				onclick={fitPageWidth}
				title="Fit width"
				aria-label="Fit width"
			>
				<MoveHorizontal class="h-4 w-4" />
			</button>
			{#if rendering}
				<span class="absolute -top-7 right-1 rounded-full bg-bg-surface p-1 shadow-sm">
					<LoaderCircle class="h-3.5 w-3.5 animate-spin text-text-tertiary" aria-label="Rendering page" />
				</span>
			{/if}
		</div>
	{/if}
</div>

<style>
	.pdf-tool-btn {
		display: inline-flex;
		height: 32px;
		width: 32px;
		flex: none;
		align-items: center;
		justify-content: center;
		border-radius: 4px;
		color: var(--text-tertiary);
		transition:
			background-color 120ms ease,
			color 120ms ease;
	}

	.pdf-tool-btn:hover:not(:disabled),
	.pdf-tool-btn.active {
		background: var(--bg-hover);
		color: var(--text-primary);
	}

	.pdf-tool-btn:focus-visible {
		outline: 2px solid color-mix(in srgb, var(--brand) 55%, transparent);
		outline-offset: -2px;
	}

	.pdf-tool-btn:disabled {
		opacity: 0.35;
	}

	.pdf-toolbar--mobile .pdf-tool-btn {
		height: 40px;
		width: 40px;
	}

	.pdf-toolbar--mobile .pdf-page-control {
		gap: 2px;
		padding-inline: 0;
	}

	.pdf-toolbar--mobile .pdf-page-input {
		width: 32px;
	}

	.pdf-toolbar--mobile .pdf-divider {
		margin-inline: 0;
	}

	canvas {
		background: white;
	}

	@media (prefers-reduced-motion: reduce) {
		.pdf-tool-btn {
			transition: none;
		}
	}
</style>
