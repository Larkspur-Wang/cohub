<script lang="ts">
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
      class="min-h-[76px] flex-1 resize-none rounded-md border border-border-primary bg-bg-elevated px-3 py-2.5 text-[13px] leading-6 text-text-primary outline-none transition-colors placeholder:text-text-placeholder focus:border-border-primary/20 focus:bg-bg-surface"
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
      class="h-10 shrink-0 rounded-md border border-border-primary bg-hover px-4 text-[11px] font-medium uppercase tracking-[0.18em] text-text-secondary transition-colors hover:bg-hover-strong hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-35"
    >
      {disabled ? 'Sending' : 'Send'}
    </button>
  </form>
</div>
