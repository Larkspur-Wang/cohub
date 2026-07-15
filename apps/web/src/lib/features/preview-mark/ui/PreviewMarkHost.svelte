<script lang="ts">
import { Loader2, Scissors } from "lucide-svelte";
import { onDestroy, tick } from "svelte";
import { fade, scale } from "svelte/transition";
import { portal } from "$lib/actions/portal";
import {
	DURATION_MODAL_IN,
	DURATION_MODAL_OUT,
	svelteEaseIn,
	svelteEaseOut,
} from "$lib/motion.svelte";
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
	buttonClass?: string;
	onAttached?: () => void;
};

let {
	open = $bindable(false),
	target,
	buttonClass = "preview-icon-btn",
	onAttached,
}: Props = $props();

let session = $state<MarkSession | null>(null);
let phase = $state<"idle" | "capturing" | "marking" | "attaching">("idle");
/** Sub-state while phase === capturing: waiting for share picker vs grabbing frames. */
let captureStep = $state<"share" | "grab">("share");
let error = $state<string | null>(null);
let captureGen = 0;
let disposed = false;
let panelEl: HTMLDivElement | null = $state(null);

const canRecapture = $derived(target?.kind === "iframe");
/**
 * Chip only during the share-picker wait. Hide before the grab so the floating
 * toast is not baked into the captured tab frame.
 */
const showCaptureChip = $derived(
	phase === "capturing" && !open && captureStep === "share",
);
const captureChipLabel = "Share this tab to capture…";
const canCropApply = $derived(
	Boolean(session?.cropDraft && session.getCropRect()),
);

/** User can sit on the share picker; after this we surface an error instead of spinning forever. */
const SHARE_PICKER_TIMEOUT_MS = 90_000;

const TRANSITION_IN = { duration: DURATION_MODAL_IN, easing: svelteEaseOut };
const TRANSITION_OUT = { duration: DURATION_MODAL_OUT, easing: svelteEaseIn };
const SCALE_IN = { ...TRANSITION_IN, start: 0.98 };
const SCALE_OUT = { ...TRANSITION_OUT, start: 0.98 };

$effect(() => {
	if (!open) return;
	// Focus the panel so keyboard shortcuts work without an extra click.
	queueMicrotask(() => panelEl?.focus({ preventScroll: true }));
	const onKey = (event: KeyboardEvent) => {
		if (phase === "attaching") return;
		if (event.key === "Escape") {
			event.preventDefault();
			// Layered cancel: draft/crop selection first, then close the overlay.
			if (session?.draft || session?.cropDraft) {
				session.cancelDraft();
				return;
			}
			close();
			return;
		}
		if (
			event.key === "Enter" &&
			session?.tool === "crop" &&
			canCropApply &&
			!event.metaKey &&
			!event.ctrlKey &&
			!event.altKey
		) {
			event.preventDefault();
			void handleApplyCrop();
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
	captureStep = "share";
	error = null;
	open = false;
}

function cancelCapture() {
	if (phase !== "capturing") return;
	captureGen += 1;
	const hadSession = Boolean(session);
	phase = hadSession ? "marking" : "idle";
	captureStep = "share";
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
		captureStep = "share";
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
	captureStep = "share";
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
	captureStep = "share";
	// Keep preview visible under the browser share UI and while grabbing frames.
	open = false;

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
		captureStep = "share";
		// Only open error UI if user didn't cancel via close() meanwhile.
		if (gen === captureGen && !disposed) open = true;
		return;
	}

	if (gen !== captureGen || disposed) {
		for (const track of stream.getTracks()) track.stop();
		return;
	}

	// Drop the share chip and wait a paint so it is not baked into the frame.
	captureStep = "grab";
	await tick();
	await new Promise<void>((resolve) => {
		requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
	});
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
	if (phase === "marking" && session) {
		open = true;
		return;
	}
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
			const ok = await session.applyCropDraft();
			if (!ok) {
				error = "Drag a larger area to crop, or switch tools to discard.";
				phase = "marking";
				return;
			}
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

function onBackdropPointer(event: MouseEvent) {
	if (event.target !== event.currentTarget) return;
	if (phase === "attaching") return;
	close();
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
		use:portal
		class="mark-capture-chip"
		role="status"
		aria-live="polite"
		in:fade={TRANSITION_IN}
		out:fade={TRANSITION_OUT}
	>
		<Loader2 class="h-3.5 w-3.5 shrink-0 animate-spin" />
		<span>{captureChipLabel}</span>
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
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div
		use:portal
		class="mark-overlay"
		role="presentation"
		in:fade={TRANSITION_IN}
		out:fade={TRANSITION_OUT}
		onmousedown={onBackdropPointer}
	>
		<div
			bind:this={panelEl}
			class="mark-panel"
			role="dialog"
			aria-modal="true"
			aria-label="Mark preview"
			tabindex="-1"
			in:scale|local={SCALE_IN}
			out:scale|local={SCALE_OUT}
		>
			{#if (phase === "marking" || phase === "attaching") && session}
				<MarkToolbar
					tool={session.tool}
					color={session.color}
					canUndo={session.canUndo}
					canClear={session.canClear}
					canCropApply={canCropApply}
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
					<ImageMarkSurface
						{session}
						onApplyCrop={() => void handleApplyCrop()}
					/>
				</div>
				{#if error}
					<div class="mark-error" role="alert">{error}</div>
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
	</div>
{/if}

<style>
	.mark-capture-chip {
		position: fixed;
		top: max(12px, env(safe-area-inset-top, 0px));
		left: 50%;
		z-index: 110;
		display: inline-flex;
		transform: translateX(-50%);
		align-items: center;
		gap: 8px;
		border: 1px solid var(--border-subtle);
		border-radius: 999px;
		background: var(--bg-content);
		padding: 6px 10px 6px 12px;
		color: var(--text-secondary);
		font-size: 12px;
		font-weight: 500;
		line-height: 1.2;
		white-space: nowrap;
		box-shadow: 0 8px 24px color-mix(in srgb, var(--overlay-scrim-strong) 20%, transparent);
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

	.mark-overlay {
		position: fixed;
		inset: 0;
		z-index: 100;
		display: flex;
		align-items: stretch;
		justify-content: center;
		padding: 0;
		background: var(--overlay-scrim);
	}
	@media (min-width: 720px) {
		.mark-overlay {
			align-items: center;
			padding: max(16px, env(safe-area-inset-top, 0px))
				max(16px, env(safe-area-inset-right, 0px))
				max(16px, env(safe-area-inset-bottom, 0px))
				max(16px, env(safe-area-inset-left, 0px));
		}
	}

	.mark-panel {
		display: flex;
		width: 100%;
		height: 100%;
		max-height: 100%;
		flex-direction: column;
		overflow: hidden;
		background: var(--bg-content);
		outline: none;
	}
	@media (min-width: 720px) {
		.mark-panel {
			width: min(960px, 100%);
			height: min(800px, 100%);
			max-height: min(90dvh, 100%);
			border: 1px solid var(--border-subtle);
			border-radius: 10px;
			box-shadow: 0 24px 64px
				color-mix(in srgb, var(--overlay-scrim-strong) 32%, transparent);
		}
	}

	.mark-stage {
		display: flex;
		min-height: 0;
		flex: 1;
		align-items: center;
		justify-content: center;
		container-type: size;
		padding: 12px;
		overflow: hidden;
		background: var(--bg-primary);
	}
	@media (min-width: 720px) {
		.mark-stage {
			padding: 18px;
		}
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
		gap: 8px;
		padding: 28px 24px;
		text-align: center;
	}
	.mark-status-title {
		color: var(--text-primary);
		font-size: 14px;
		font-weight: 600;
	}
	.mark-status-hint {
		max-width: 32ch;
		color: var(--text-tertiary);
		font-size: 12px;
		line-height: 1.5;
	}
	.mark-status-actions {
		display: flex;
		gap: 8px;
		margin-top: 6px;
	}
	.mark-status-btn {
		display: inline-flex;
		min-height: 32px;
		align-items: center;
		justify-content: center;
		border: 1px solid transparent;
		border-radius: 7px;
		background: var(--brand);
		padding: 0 12px;
		color: var(--brand-contrast-fg);
		font-size: 12px;
		font-weight: 600;
		cursor: pointer;
	}
	.mark-status-btn:hover {
		filter: brightness(1.05);
	}
	.mark-status-btn.ghost {
		border-color: var(--border-subtle);
		background: var(--bg-hover);
		color: var(--text-secondary);
		filter: none;
	}
</style>
