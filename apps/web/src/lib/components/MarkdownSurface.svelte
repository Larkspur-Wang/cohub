<script lang="ts">
import { onDestroy, onMount } from "svelte";
import { mediaLightbox } from "$lib/components/media-lightbox.svelte";

type MarkdownVariant = "chat" | "document";

type Props = {
	html: string;
	variant?: MarkdownVariant;
	streamingLive?: boolean;
};

const { html, variant = "chat", streamingLive = false }: Props = $props();

let markdownEl = $state<HTMLElement | null>(null);
let copyResetTimer: ReturnType<typeof setTimeout> | null = null;
let themeObserver: MutationObserver | null = null;

const COPY_ICON =
	'<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>';

const CHECK_ICON =
	'<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg>';

$effect(() => {
	const _html = html;
	const _streamingLive = streamingLive;
	if (!markdownEl || _streamingLive) return;
	enhanceCodeBlocks();
	renderMermaid();
});

function markMermaidLoadError() {
	if (!markdownEl) return;
	for (const element of markdownEl.querySelectorAll<HTMLElement>(
		".markdown-mermaid",
	)) {
		if (element.dataset.mermaidRendered === "true") continue;
		element.dataset.mermaidRendered = "true";
		element.textContent = "Preview unavailable.";
	}
}

function renderMermaid() {
	if (!markdownEl) return;
	void import("$lib/mermaid-renderer")
		.then(({ renderMermaidDiagrams }) =>
			markdownEl ? renderMermaidDiagrams(markdownEl) : undefined,
		)
		.catch(() => markMermaidLoadError());
}

function resetMermaidDiagrams() {
	if (!markdownEl) return;
	for (const element of markdownEl.querySelectorAll<HTMLElement>(
		".markdown-mermaid",
	)) {
		element.dataset.mermaidRendered = "false";
		delete element.dataset.mermaidRenderToken;
		element.innerHTML =
			'<div class="markdown-mermaid-loading">Rendering diagram…</div>';
	}
	renderMermaid();
}

function enhanceCodeBlocks() {
	if (!markdownEl) return;

	for (const pre of markdownEl.querySelectorAll("pre")) {
		if (pre.parentElement?.classList.contains("markdown-code-block")) continue;

		const wrapper = document.createElement("div");
		wrapper.className = "markdown-code-block";
		pre.parentNode?.insertBefore(wrapper, pre);
		wrapper.appendChild(pre);

		const button = document.createElement("button");
		button.type = "button";
		button.className = "markdown-code-copy";
		button.dataset.codeCopy = "";
		button.innerHTML = COPY_ICON;
		button.setAttribute("aria-label", "Copy code");
		button.title = "Copy code";
		wrapper.appendChild(button);
	}
}

async function copyText(text: string) {
	if (navigator.clipboard?.writeText) {
		await navigator.clipboard.writeText(text);
		return;
	}

	const textArea = document.createElement("textarea");
	textArea.value = text;
	textArea.style.position = "fixed";
	textArea.style.opacity = "0";
	document.body.appendChild(textArea);
	textArea.select();
	document.execCommand("copy");
	textArea.remove();
}

function markCopied(button: HTMLButtonElement) {
	button.innerHTML = CHECK_ICON;
	button.classList.add("copied");
	button.setAttribute("aria-label", "Code copied");
	button.title = "Code copied";
	if (copyResetTimer) clearTimeout(copyResetTimer);
	copyResetTimer = setTimeout(() => {
		button.innerHTML = COPY_ICON;
		button.classList.remove("copied");
		button.setAttribute("aria-label", "Copy code");
		button.title = "Copy code";
	}, 1400);
}

onMount(() => {
	const el = markdownEl;
	if (!el) return;

	function onClick(e: Event) {
		const target = e.target as HTMLElement;
		const copyButton = target.closest<HTMLButtonElement>("[data-code-copy]");
		if (copyButton) {
			e.preventDefault();
			e.stopPropagation();
			const code = copyButton.parentElement?.querySelector("pre code");
			void copyText(code?.textContent ?? "").then(() => markCopied(copyButton));
			return;
		}

		if (target.tagName === "IMG") {
			e.preventDefault();
			e.stopPropagation();
			const img = target as HTMLImageElement;
			mediaLightbox.show({
				src: img.src,
				type: "image" as const,
				alt: img.alt,
			});
		} else if (
			target.tagName === "VIDEO" ||
			(target.tagName === "SOURCE" && target.parentElement?.tagName === "VIDEO")
		) {
			e.preventDefault();
			e.stopPropagation();
			const video =
				target.tagName === "VIDEO"
					? (target as HTMLVideoElement)
					: (target.parentElement as HTMLVideoElement);
			mediaLightbox.show({
				src: video.src || (video.querySelector("source")?.src ?? ""),
				type: "video" as const,
			});
		}
	}

	el.addEventListener("click", onClick);
	themeObserver = new MutationObserver(() => resetMermaidDiagrams());
	themeObserver.observe(document.documentElement, {
		attributeFilter: ["data-theme"],
	});

	return () => {
		el.removeEventListener("click", onClick);
		themeObserver?.disconnect();
		themeObserver = null;
	};
});

onDestroy(() => {
	if (copyResetTimer) clearTimeout(copyResetTimer);
	themeObserver?.disconnect();
});
</script>

<div
	bind:this={markdownEl}
	class="markdown-content"
	class:streaming-live-markdown={streamingLive}
	data-variant={variant}
>
	{@html html}
</div>
