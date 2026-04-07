<script lang="ts">
import { ArrowUp } from "lucide-svelte";

type Props = {
	value: string;
	disabled?: boolean;
	streamError?: string;
	onsubmit: () => void;
};

let {
	value = $bindable(""),
	disabled = false,
	streamError = "",
	onsubmit,
}: Props = $props();
</script>

<div class="px-4 py-3 bg-bg-primary">
  {#if streamError}
    <div class="mb-3 rounded-md border border-rose-500/20 bg-rose-500/8 px-3 py-2 text-[11px] text-rose-400">{streamError}</div>
  {/if}

  <form
    class="flex items-end gap-3"
    onsubmit={(event) => {
      event.preventDefault();
      onsubmit();
    }}
  >
    <textarea
      bind:value
      rows="3"
      placeholder="Message session..."
      class="min-h-[76px] flex-1 resize-none rounded-md border border-border-primary bg-bg-elevated px-3 py-2.5 text-[13px] leading-6 text-text-primary outline-none transition-colors placeholder:text-text-placeholder focus:border-brand/40 focus:bg-bg-surface"
      onkeydown={(event) => {
        if (event.key === 'Enter' && !event.shiftKey) {
          event.preventDefault();
          if (!disabled && value.trim()) {
            onsubmit();
          }
        }
      }}
    ></textarea>
    <button
      type="submit"
      disabled={disabled || !value.trim()}
      class="h-10 w-10 shrink-0 rounded-md flex items-center justify-center border border-border-primary bg-hover text-text-secondary transition-colors hover:bg-brand hover:border-brand hover:text-white disabled:cursor-not-allowed disabled:opacity-35 disabled:hover:bg-hover disabled:hover:border-border-primary disabled:hover:text-text-secondary"
    >
      <ArrowUp class="w-4 h-4" />
    </button>
  </form>
</div>
