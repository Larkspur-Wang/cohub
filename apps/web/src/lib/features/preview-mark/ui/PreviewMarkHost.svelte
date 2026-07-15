<script lang="ts">
import { Loader2, Scissors } from "lucide-svelte";
import { onDestroy } from "svelte";
import { attachComposerFiles } from "../attach/to-composer";
import {
	detectCaptureCapabilities,
	iframeCaptureSupportedMessage,
} from "../capture/capabilities";
import {
	captureIframeElementFromStream,
	requestDisplayMedia,
} from "../capture/iframe-capture";
import { captureImageSource } from "../capture/image-capture";
import { exportMarkedFrame } from "../mark/export";
import { createMarkSession, type MarkSession } from "../mark/session.svelte";
import type { CaptureResult, PreviewCaptureTarget } from "../types";
import { suggestedMarkedName } from "../types";
import ImageMarkSurface from "./ImageMarkSurface.svelte";
import MarkToolbar from "./MarkToolbar.svelte";

type Props = {
	open?: boolean;
	target: PreviewCaptureTarget | null;
	/**
	 * Relative container for the mark overlay. When set, the host fills this
	 * element via fixed positioning against its bounding rect — no DOM moves.
	 */
	surface?: HTMLElement | null;
	buttonClass?: string;
	onAttached?: () => void;
};

let {
	open = $bindable(false),
	target,
	surface = null,
	buttonClass = "preview-icon-btn",
	onAttached,
}: Props = $props();

let session = $state<MarkSession | null>(null);
let phase = $state<"idle" | "capturing" | "marking" | "attaching">("idle");
let error = $state<string | null>(null);
let captureGen = 0;
let disposed = false;
let surfaceBox = $state<{
	top: number;
	left: number;
	width: number;
	height: number;
} | null>(null);

const canRecapture = $derived(target?.kind === "iframe");
/** Lightweight chip while sharing — must not cover the iframe. */
const showCaptureChip = $derived(phase === "capturing" && !open);

/** User can sit on the share picker; after this we surface an error instead of spinning forever. */
const SHARE_PICKER_TIMEOUT_MS = 90_000;

function measureSurface() {
	if (!surface) {
		surfaceBox = null;
		return;
	}
	const rect = surface.getBoundingClientRect();
	surfaceBox = {
		top: rect.top,
		left: rect.left,
		width: rect.width,
		height: rect.height,
	};
}

$effect(() => {
	if ((!open && !showCaptureChip) || !surface) {
		if (!open) surfaceBox = null;
		return;
	}
	measureSurface();
	const onResize = () => measureSurface();
	window.addEventListener("resize", onResize);
	window.addEventListener("scroll", onResize, true);
	window.visualViewport?.addEventListener("resize", onResize);
	window.visualViewport?.addEventListener("scroll", onResize);
	const ro =
		typeof ResizeObserver !== "undefined" ? new ResizeObserver(onResize) : null;
	ro?.observe(surface);
	return () => {
		window.removeEventListener("resize", onResize);
		window.removeEventListener("scroll", onResize, true);
		window.visualViewport?.removeEventListener("resize", onResize);
		window.visualViewport?.removeEventListener("scroll", onResize);
		ro?.disconnect();
	};
});

$effect(() => {
	if (!open) return;
	const onKey = (event: KeyboardEvent) => {
		if (event.key === "Escape" && phase !== "attaching") {
			event.preventDefault();
			close();
		}
	};
	window.addEventListener("keydown", onKey);
	return () => window.removeEventListener("keydown", onKey);
});

function close() {
	captureGen += 1;
	session?.dispose();
	session = null;
	phase = "idle";
	error = null;
	open = false;
}

function cancelCapture() {
	if (phase !== "capturing") return;
	captureGen += 1;
	const hadSession = Boolean(session);
	phase = hadSession ? "marking" : "idle";
	error = hadSession ? null : "Capture cancelled.";
	// Recapture cancel: reopen mark UI with previous frame. First capture: show error sheet.
	open = hadSession || Boolean(error);
}

function applyCaptureResult(
	result: CaptureResult,
	gen: number,
	hadSession: boolean,
) {
	if (gen !== captureGen || disposed) {
		if (result.ok) {
			try {
				result.frame.bitmap.close();
			} catch {
				// ignore
			}
		}
		return;
	}

	if (!result.ok) {
		error = result.message;
		// Keep existing marks if recapture failed; otherwise show status UI.
		phase = hadSession ? "marking" : "idle";
		open = true;
		return;
	}

	if (session) {
		session.replaceCapture(result.frame);
	} else {
		session = createMarkSession(result.frame);
	}
	error = null;
	phase = "marking";
	open = true;
}

/**
 * Capture must start getDisplayMedia in the click turn — before any await that
 * yields past the user gesture (rAF, microtask-heavy state work, etc.).
 */
async function runCapture() {
	if (!target || disposed) return;
	if (phase === "capturing" || phase === "attaching") return;

	const gen = ++captureGen;
	const hadSession = Boolean(session);

	if (target.kind === "image") {
		error = null;
		phase = "capturing";
		// Image capture doesn't need the live preview uncovered.
		const result = await captureImageSource({
			src: target.src,
			path: target.path,
		});
		applyCaptureResult(result, gen, hadSession);
		return;
	}

	const caps = detectCaptureCapabilities();
	const blocked = iframeCaptureSupportedMessage(caps);
	if (blocked) {
		if (gen !== captureGen || disposed) return;
		error = blocked;
		phase = hadSession ? "marking" : "idle";
		open = true;
		return;
	}

	// 1) Start the picker first, still inside the click call stack.
	// 2) Only then flip reactive UI state. Writing $state / awaiting rAF before
	// getDisplayMedia can drop the user gesture on Chrome and leave a silent hang.
	let streamPromise: Promise<MediaStream>;
	try {
		streamPromise = requestDisplayMedia();
	} catch (caught) {
		if (gen !== captureGen || disposed) return;
		error =
			caught instanceof Error
				? caught.message
				: "Screen capture isn’t available.";
		phase = hadSession ? "marking" : "idle";
		open = true;
		return;
	}

	error = null;
	phase = "capturing";
	// Keep preview visible under the browser share UI and while grabbing frames.
	open = false;
	if (surface) measureSurface();

	let stream: MediaStream;
	try {
		stream = await new Promise<MediaStream>((resolve, reject) => {
			const timer = setTimeout(() => {
				reject(
					new Error(
						"Share dialog timed out. Click the scissors icon and choose this tab.",
					),
				);
			}, SHARE_PICKER_TIMEOUT_MS);
			streamPromise.then(
				(value) => {
					clearTimeout(timer);
					resolve(value);
				},
				(err) => {
					clearTimeout(timer);
					reject(err);
				},
			);
		});
	} catch (caught) {
		if (gen !== captureGen || disposed) return;
		const name =
			caught && typeof caught === "object" && "name" in caught
				? String((caught as { name?: string }).name)
				: "";
		if (name === "NotAllowedError" || name === "PermissionDeniedError") {
			error = "Capture cancelled or permission denied.";
		} else if (name === "AbortError") {
			error = "Capture cancelled.";
		} else {
			error =
				caught instanceof Error
					? caught.message
					: "Failed to start screen capture.";
		}
		phase = hadSession ? "marking" : "idle";
		// Only open error UI if user didn't cancel via close() meanwhile.
		if (gen === captureGen && !disposed) open = true;
		return;
	}

	if (gen !== captureGen || disposed) {
		for (const track of stream.getTracks()) track.stop();
		return;
	}

	const result = await captureIframeElementFromStream({
		stream,
		element: target.element,
		source: target.source,
	});
	applyCaptureResult(result, gen, hadSession);
}

async function handleMarkClick() {
	if (phase === "capturing" || phase === "attaching") return;
	if (phase === "marking" && session) return;
	await runCapture();
}

async function handleRecapture() {
	if (!canRecapture) return;
	await runCapture();
}

async function handleAttach() {
	if (!session || phase === "attaching") return;
	phase = "attaching";
	error = null;
	try {
		// Apply pending crop so Attach matches what the user outlined.
		if (session.cropDraft) {
			await session.applyCropDraft();
		}
		const file = await exportMarkedFrame({
			frame: session.frame,
			strokes: session.strokes,
			filename: suggestedMarkedName(session.frame.source),
		});
		attachComposerFiles(file);
		onAttached?.();
		close();
	} catch (err) {
		error =
			err instanceof Error ? err.message : "Failed to export marked image.";
		phase = "marking";
	}
}

async function handleApplyCrop() {
	if (!session) return;
	const ok = await session.applyCropDraft();
	if (!ok) error = "Drag a larger area to crop.";
	else error = null;
}

onDestroy(() => {
	disposed = true;
	captureGen += 1;
	session?.dispose();
	session = null;
});
</script>

<button
	type="button"
	class={buttonClass}
	title="Capture & mark"
	aria-label="Capture and mark preview"
	disabled={!target || phase === "capturing" || phase === "attaching"}
	onclick={() => void handleMarkClick()}
>
	{#if phase === "capturing"}
		<Loader2 class="h-4 w-4 animate-spin" />
	{:else}
		<Scissors class="h-4 w-4" />
	{/if}
</button>

{#if showCaptureChip}
	<div
		class="mark-capture-chip"
		class:mark-capture-chip--fixed={Boolean(surface && surfaceBox)}
		style={surface && surfaceBox
			? `top:${Math.max(8, surfaceBox.top + 8)}px;left:${surfaceBox.left + surfaceBox.width / 2}px;`
			: undefined}
		role="status"
		aria-live="polite"
	>
		<Loader2 class="h-3.5 w-3.5 shrink-0 animate-spin" />
		<span>Share this tab to capture…</span>
		<button
			type="button"
			class="mark-capture-chip-cancel"
			onclick={cancelCapture}
			title="Cancel capture"
			aria-label="Cancel capture"
			>Cancel</button
		>
	</div>
{/if}

{#if open}
	<div
		class="mark-host"
		class:mark-host--fixed={Boolean(surface && surfaceBox)}
		style={surface && surfaceBox
			? `top:${surfaceBox.top}px;left:${surfaceBox.left}px;width:${surfaceBox.width}px;height:${surfaceBox.height}px;`
			: undefined}
		role="dialog"
		aria-modal="true"
		aria-label="Mark preview"
	>
		{#if (phase === "marking" || phase === "attaching") && session}
			<MarkToolbar
				tool={session.tool}
				color={session.color}
				canUndo={session.canUndo}
				canCropApply={Boolean(session.cropDraft && session.getCropRect())}
				canResetCrop={session.isCropped}
				canRecapture={canRecapture}
				attaching={phase === "attaching"}
				onTool={(t) => session?.setTool(t)}
				onColor={(c) => session?.setColor(c)}
				onUndo={() => session?.undo()}
				onClear={() => session?.clear()}
				onApplyCrop={() => void handleApplyCrop()}
				onResetCrop={() => session?.resetCrop()}
				onRecapture={canRecapture ? () => void handleRecapture() : undefined}
				onAttach={() => void handleAttach()}
				onClose={close}
			/>
			<div class="mark-stage">
				<ImageMarkSurface {session} />
			</div>
			{#if error}
				<div class="mark-error">{error}</div>
			{/if}
		{:else}
			<div class="mark-status">
				{#if error}
					<div class="mark-status-title">Couldn’t capture</div>
					<div class="mark-status-hint">{error}</div>
					<div class="mark-status-actions">
						<button
							type="button"
							class="mark-status-btn"
							onclick={() => void runCapture()}>Try again</button
						>
						<button type="button" class="mark-status-btn ghost" onclick={close}
							>Close</button
						>
					</div>
				{:else}
					<div class="mark-status-title">Capture & mark</div>
					<div class="mark-status-hint">
						Share this Cohub tab when prompted, then annotate the snapshot.
					</div>
					<button
						type="button"
						class="mark-status-btn"
						onclick={() => void runCapture()}>Capture</button
					>
				{/if}
			</div>
		{/if}
	</div>
{/if}

<style>
	.mark-capture-chip {
		position: absolute;
		top: 8px;
		left: 50%;
		z-index: 50;
		display: inline-flex;
		transform: translateX(-50%);
		align-items: center;
		gap: 8px;
		border: 1px solid var(--border-subtle);
		border-radius: 999px;
		background: color-mix(in srgb, var(--bg-content) 92%, transparent);
		padding: 6px 10px 6px 12px;
		color: var(--text-secondary);
		font-size: 12px;
		font-weight: 500;
		line-height: 1.2;
		white-space: nowrap;
		box-shadow: 0 8px 24px color-mix(in srgb, var(--bg-primary) 35%, transparent);
		backdrop-filter: blur(8px);
	}
	.mark-capture-chip--fixed {
		position: fixed;
		z-index: 90;
	}
	.mark-capture-chip-cancel {
		border: 0;
		border-radius: 999px;
		background: var(--bg-hover);
		padding: 3px 8px;
		color: var(--text-tertiary);
		font: inherit;
		font-size: 11px;
		font-weight: 600;
		cursor: pointer;
	}
	.mark-capture-chip-cancel:hover {
		color: var(--text-secondary);
	}
	.mark-host {
		position: absolute;
		inset: 0;
		z-index: 40;
		display: flex;
		flex-direction: column;
		background: color-mix(in srgb, var(--bg-content) 96%, transparent);
		backdrop-filter: blur(8px);
	}
	.mark-host--fixed {
		position: fixed;
		inset: auto;
		z-index: 80;
	}
	.mark-stage {
		display: flex;
		min-height: 0;
		flex: 1;
		align-items: center;
		justify-content: center;
		container-type: size;
		padding: 12px;
		overflow: auto;
	}
	.mark-error {
		padding: 8px 12px;
		border-top: 1px solid var(--border-subtle);
		color: var(--color-error-soft);
		font-size: 12px;
	}
	.mark-status {
		display: flex;
		min-height: 0;
		flex: 1;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 10px;
		padding: 24px;
		text-align: center;
	}
	.mark-status-title {
		color: var(--text-primary);
		font-size: 14px;
		font-weight: 600;
	}
	.mark-status-hint {
		max-width: 320px;
		color: var(--text-tertiary);
		font-size: 12px;
		line-height: 1.5;
	}
	.mark-status-actions {
		display: flex;
		gap: 8px;
		margin-top: 4px;
	}
	.mark-status-btn {
		display: inline-flex;
		min-height: 32px;
		align-items: center;
		justify-content: center;
		border: 1px solid var(--border-subtle);
		border-radius: 7px;
		background: var(--brand);
		padding: 0 12px;
		color: var(--brand-contrast-fg);
		font-size: 12px;
		font-weight: 600;
		cursor: pointer;
	}
	.mark-status-btn.ghost {
		background: var(--bg-hover);
		color: var(--text-secondary);
	}
</style>
