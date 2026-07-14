import { DURATION_PANEL } from "$lib/motion.svelte";

/** Approx CSS expo-out cubic-bezier(0.16, 1, 0.3, 1). */
function easePanelOut(t: number): number {
	return t === 0 || t === 1 ? t : 1 - (1 - t) ** 4;
}

export type PreviewPanelClipParams = {
	duration?: number;
	/** Explicit target width (preferred — available before CSS vars settle). */
	targetWidth?: number;
	/** Desktop shell min width — below this, skip clip (mobile full-bleed). */
	desktopMinWidth?: number;
};

/**
 * Desktop-only width clip for preview pane mount/unmount.
 * Intro: 0 → measured width. Outro: measured width → 0 (node kept until done).
 * Skips on compact viewports, reduced motion, and immersive full-bleed.
 */
export function previewPanelClip(
	node: HTMLElement,
	params: PreviewPanelClipParams = {},
) {
	const duration = params.duration ?? DURATION_PANEL;
	const desktopMinWidth = params.desktopMinWidth ?? 960;

	if (duration <= 0 || typeof window === "undefined") {
		return { duration: 0 };
	}
	if (window.innerWidth < desktopMinWidth) {
		return { duration: 0 };
	}
	if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
		return { duration: 0 };
	}
	if (node.classList.contains("workspace-preview-pane--immersive")) {
		return { duration: 0 };
	}

	const fromVar = Number.parseFloat(
		getComputedStyle(node).getPropertyValue("--workspace-preview-width"),
	);
	const target =
		(params.targetWidth && params.targetWidth > 0
			? params.targetWidth
			: Number.isFinite(fromVar) && fromVar > 0
				? fromVar
				: node.getBoundingClientRect().width) || 480;

	return {
		duration,
		easing: easePanelOut,
		css: (t: number) => {
			const w = Math.max(0, target * t);
			// Inline styles override the stylesheet width transition so open/close
			// is driven solely by this tween (resize still uses CSS transition).
			return (
				`width: ${w}px;` +
				`overflow: hidden;` +
				`flex-shrink: 0;` +
				`transition: none;` +
				`border-left-width: ${w < 1 ? 0 : 1}px;`
			);
		},
	};
}
