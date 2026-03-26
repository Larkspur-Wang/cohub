<script lang="ts">
import ChatMessageBubble from "$lib/components/ChatMessageBubble.svelte";
import ToolExecutionCard from "$lib/components/ToolExecutionCard.svelte";
import type { TimelineItem } from "$lib/session-tree";

type Props = {
  timeline: TimelineItem[];
  bindListEl?: HTMLDivElement | null;
};

let { timeline, bindListEl = $bindable(null) }: Props = $props();
</script>

<div bind:this={bindListEl} class="flex-1 overflow-y-auto bg-[#141414] px-6 py-5">
  <div class="mx-auto flex w-full max-w-3xl flex-col gap-5">
    {#each timeline as item (item.id)}
      {#if item.kind === 'message'}
        <ChatMessageBubble message={item.message} />
      {:else}
        <ToolExecutionCard tool={item.tool} />
      {/if}
    {/each}
  </div>
</div>
