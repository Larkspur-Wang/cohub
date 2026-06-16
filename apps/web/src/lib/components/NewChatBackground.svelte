<script lang="ts">
import type { NewChatBackgroundConfig } from "$lib/space-config";

type Props = {
	background: NewChatBackgroundConfig;
};

const { background }: Props = $props();

const objectFit = $derived(background.fit === "fill" ? "fill" : background.fit);
</script>

<div class="new-chat-background" style:opacity={background.opacity} aria-hidden="true">
  {#if background.type === "image"}
    <img src={background.url} alt="" style:object-fit={objectFit} style:object-position={background.position} draggable="false" />
  {:else if background.type === "video"}
    <video src={background.url} style:object-fit={objectFit} style:object-position={background.position} autoplay muted loop playsinline preload="metadata"></video>
  {:else}
    <iframe src={background.url} title="New chat background" sandbox="allow-scripts" referrerpolicy="no-referrer" loading="lazy"></iframe>
  {/if}
</div>

<style>
  .new-chat-background {
    position: absolute;
    inset: 0;
    z-index: 0;
    overflow: hidden;
    background: var(--bg-content);
    pointer-events: none;
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
    pointer-events: none;
    user-select: none;
  }
</style>
