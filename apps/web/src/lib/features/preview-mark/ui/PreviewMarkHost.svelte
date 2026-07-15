<script lang="ts">
import { Loader2, PenLine } from "lucide-svelte";
import { onDestroy } from "svelte";
import { attachComposerFiles } from "../attach/to-composer";
import {
	detectCaptureCapabilities,
	iframeCaptureSupportedMessage,
} from "../capture/capabilities";
import { captureIframeElement } from "../capture/iframe-capture";
import { captureImageSource } from "../capture/image-capture";
import { exportMarkedFrame } from "../mark/export";
import { createMarkSession, type MarkSession } from "../mark/session.svelte";
import type { PreviewCaptureTarget } from "../types";
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
	if (!open || !surface) {
		surfaceBox = null;
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

async function runCapture() {
	if (!target || disposed) return;
	const gen = ++captureGen;
	error = null;
	phase = "capturing";
	const hadSession = Boolean(session);
	// Never cover the preview while capturing. A full-surface overlay hides the
	// iframe from tab share / Element Capture and stalls frame grab on Chrome.
	// Progress is already visible on the mark button spinner.
	open = false;

	if (target.kind === "iframe") {
		const caps = detectCaptureCapabilities();
		const blocked = iframeCaptureSupportedMessage(caps);
		if (blocked) {
			if (gen !== captureGen || disposed) return;
			error = blocked;
			phase = hadSession ? "marking" : "idle";
			open = true;
			return;
		}
	}

	const result =
		target.kind === "image"
			? await captureImageSource({ src: target.src, path: target.path })
			: await captureIframeElement({
					element: target.element,
					source: target.source,
				});

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
	phase = "marking";
	open = true;
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
	title="Mark preview"
	aria-label="Mark preview"
	disabled={!target || phase === "capturing"}
	onclick={() => void handleMarkClick()}
>
	{#if phase === "capturing"}
		<Loader2 class="h-4 w-4 animate-spin" />
	{:else}
		<PenLine class="h-4 w-4" />
	{/if}
</button>

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
				{#if phase === "capturing"}
					<Loader2 class="h-5 w-5 animate-spin text-text-tertiary" />
					<div class="mark-status-title">Capturing…</div>
					<div class="mark-status-hint">
						Prefer this Cohub tab when prompted. Full screen also works — crop after.
					</div>
				{:else if error}
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
					<div class="mark-status-title">Mark preview</div>
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
