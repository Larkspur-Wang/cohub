<script lang="ts">
import ChatMessageBubble from "$lib/components/ChatMessageBubble.svelte";
import ToolExecutionCard from "$lib/components/ToolExecutionCard.svelte";
import type { TimelineItem } from "$lib/session-tree";

type Props = {
	timeline: TimelineItem[];
	bindListEl?: HTMLDivElement | null;
	bindContentEl?: HTMLDivElement | null;
	onScrollChange?: () => void;
};

let {
	timeline,
	bindListEl = $bindable(null),
	bindContentEl = $bindable(null),
	onScrollChange,
}: Props = $props();
</script>

<div
  bind:this={bindListEl}
  class="flex-1 min-h-0 overflow-y-auto bg-bg-content px-3 sm:px-5 py-3"
  onscroll={() => onScrollChange?.()}
>
  <div bind:this={bindContentEl} class="mx-auto flex w-full max-w-4xl flex-col gap-2">
    {#each timeline as item (item.id)}
      {#if item.kind === 'message'}
        <ChatMessageBubble message={item.message} />
      {:else}
        <ToolExecutionCard tool={item.tool} />
      {/if}
    {/each}
  </div>
</div>
