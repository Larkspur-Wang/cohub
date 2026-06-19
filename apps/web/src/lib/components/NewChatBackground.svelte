<script lang="ts">
import { page } from "$app/state";
import NewChatWorkBackground from "$lib/components/NewChatWorkBackground.svelte";
import { parseNewChatBackgroundAction } from "$lib/new-chat-background-bridge";
import type { NewChatBackgroundConfig } from "$lib/space-config";
import { emitSpaceConfigBackgroundAction } from "$lib/space-config";
import { parseCohubWorkUrl } from "$lib/work-url";

type Props = {
	background: NewChatBackgroundConfig;
};

const { background }: Props = $props();

const objectFit = $derived(background.fit === "fill" ? "fill" : background.fit);
let iframeEl = $state<HTMLIFrameElement | null>(null);

function getBackgroundOrigin() {
	try {
		return new URL(background.url, page.url.href).origin;
	} catch {
		return null;
	}
}

const workUrl = $derived(
	background.type === "html"
		? parseCohubWorkUrl(background.url, page.url.href)
		: null,
);

const sandbox = $derived.by(() => {
	if (background.type !== "html" || workUrl) return undefined;
	const origin = getBackgroundOrigin();
	if (typeof window !== "undefined" && origin === window.location.origin) {
		return "allow-scripts";
	}
	return "allow-scripts allow-same-origin";
});

$effect(() => {
	if (typeof document === "undefined") return;
	if (background.type !== "html" || workUrl) return;
	const origin = getBackgroundOrigin();
	if (!origin) return;
	const link = document.createElement("link");
	link.rel = "preconnect";
	link.href = origin;
	link.crossOrigin = "anonymous";
	document.head.append(link);
	return () => link.remove();
});

function handleMessage(event: MessageEvent) {
	if (background.type !== "html" || workUrl) return;
	if (event.source !== iframeEl?.contentWindow) return;
	const origin = getBackgroundOrigin();
	if (!origin) return;
	if (event.origin !== origin && event.origin !== "null") return;
	const payload = parseNewChatBackgroundAction(event.data);
	if (!payload) return;
	emitSpaceConfigBackgroundAction(payload);
}

function handleWorkBackgroundError(error: unknown) {
	console.warn("[NewChatBackground] work background failed", error);
}

$effect(() => {
	if (typeof window === "undefined" || background.type !== "html" || workUrl)
		return;
	window.addEventListener("message", handleMessage);
	return () => window.removeEventListener("message", handleMessage);
});
</script>

<div class="new-chat-background" style:opacity={background.opacity} aria-hidden="true">
  {#if background.type === "image"}
    <img src={background.url} alt="" style:object-fit={objectFit} style:object-position={background.position} draggable="false" />
  {:else if background.type === "video"}
    <video src={background.url} style:object-fit={objectFit} style:object-position={background.position} autoplay muted loop playsinline preload="metadata"></video>
  {:else if workUrl}
    <svelte:boundary onerror={handleWorkBackgroundError}>
      <NewChatWorkBackground workUrl={workUrl} />
      {#snippet failed()}
        <div class="new-chat-background-state">Work background is unavailable.</div>
      {/snippet}
    </svelte:boundary>
  {:else}
    <iframe bind:this={iframeEl} src={background.url} title="New chat background" sandbox={sandbox} referrerpolicy="no-referrer" loading="eager"></iframe>
  {/if}
</div>

<style>
  .new-chat-background {
    position: absolute;
    inset: 0;
    z-index: 0;
    overflow: hidden;
    background: var(--bg-content);
    pointer-events: auto;
  }

  .new-chat-background::after {
    content: "";
    position: absolute;
    right: 0;
    bottom: 0;
    left: 0;
    height: min(34dvh, 260px);
    background: linear-gradient(
      to top,
      var(--bg-content) 0%,
      color-mix(in srgb, var(--bg-content) 76%, transparent) 42%,
      transparent 100%
    );
    pointer-events: none;
  }

  img,
  video,
  iframe,
  :global(.new-chat-background > svelte-boundary) {
    display: block;
    width: 100%;
    height: 100%;
    border: 0;
    user-select: none;
  }

  .new-chat-background-state {
    display: flex;
    width: 100%;
    height: 100%;
    align-items: center;
    justify-content: center;
    background: var(--bg-content);
    font-size: 0.875rem;
    color: var(--text-tertiary);
  }

  img,
  video {
    pointer-events: none;
  }
</style>
