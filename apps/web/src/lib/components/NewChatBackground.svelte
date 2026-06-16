<script lang="ts">
import type {
	NewChatBackgroundConfig,
	NewChatComposerApplyPayload,
} from "$lib/space-config";
import { emitSpaceConfigBackgroundAction } from "$lib/space-config";

type Props = {
	background: NewChatBackgroundConfig;
};

const { background }: Props = $props();

const objectFit = $derived(background.fit === "fill" ? "fill" : background.fit);
let iframeEl = $state<HTMLIFrameElement | null>(null);

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value && typeof value === "object");
}

function isHttpsUrl(value: unknown) {
	if (typeof value !== "string") return false;
	try {
		return new URL(value).protocol === "https:";
	} catch {
		return false;
	}
}

function parseComposerPayload(
	value: unknown,
): NewChatComposerApplyPayload | null {
	if (!isRecord(value)) return null;
	const payload: NewChatComposerApplyPayload = {};
	if (typeof value.prompt === "string") payload.prompt = value.prompt;
	if (isRecord(value.model)) {
		const { provider, id } = value.model;
		if (typeof provider === "string" && typeof id === "string") {
			payload.model = { provider, id };
		}
	}
	if (Array.isArray(value.images)) {
		payload.images = value.images.filter(isRecord).flatMap((image) => {
			if (!isHttpsUrl(image.url)) return [];
			return [
				{
					url: String(image.url),
					name: typeof image.name === "string" ? image.name : undefined,
				},
			];
		});
	}
	return payload.prompt !== undefined || payload.model || payload.images?.length
		? payload
		: null;
}

function getBackgroundOrigin() {
	try {
		return new URL(background.url).origin;
	} catch {
		return null;
	}
}

const sandbox = $derived.by(() => {
	if (background.type !== "html") return undefined;
	const origin = getBackgroundOrigin();
	if (typeof window !== "undefined" && origin === window.location.origin) {
		return "allow-scripts";
	}
	return "allow-scripts allow-same-origin";
});

$effect(() => {
	if (typeof document === "undefined") return;
	if (background.type !== "html") return;
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
	if (background.type !== "html") return;
	if (event.source !== iframeEl?.contentWindow) return;
	const origin = getBackgroundOrigin();
	if (!origin) return;
	if (event.origin !== origin && event.origin !== "null") return;
	if (!isRecord(event.data)) return;
	if (event.data.source !== "cohub.newChat") return;
	if (event.data.version !== 1) return;
	if (event.data.type !== "composer.apply") return;
	const payload = parseComposerPayload(event.data.payload);
	if (!payload) return;
	emitSpaceConfigBackgroundAction(payload);
}

$effect(() => {
	if (typeof window === "undefined" || background.type !== "html") return;
	window.addEventListener("message", handleMessage);
	return () => window.removeEventListener("message", handleMessage);
});
</script>

<div class="new-chat-background" style:opacity={background.opacity} aria-hidden="true">
  {#if background.type === "image"}
    <img src={background.url} alt="" style:object-fit={objectFit} style:object-position={background.position} draggable="false" />
  {:else if background.type === "video"}
    <video src={background.url} style:object-fit={objectFit} style:object-position={background.position} autoplay muted loop playsinline preload="metadata"></video>
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
  iframe {
    display: block;
    width: 100%;
    height: 100%;
    border: 0;
    user-select: none;
  }

  img,
  video {
    pointer-events: none;
  }
</style>
