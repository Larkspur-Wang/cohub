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

<div class="px-4 py-3 bg-[#0A0A0A]">
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
      class="min-h-[76px] flex-1 resize-none rounded-md border border-white/10 bg-[#111111] px-3 py-2.5 text-[13px] leading-6 text-white/88 outline-none transition-colors placeholder:text-white/20 focus:border-white/20 focus:bg-[#141414]"
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
      class="h-10 shrink-0 rounded-md border border-white/10 bg-white/5 px-4 text-[11px] font-medium uppercase tracking-[0.18em] text-white/75 transition-colors hover:bg-white/10 hover:text-white disabled:cursor-not-allowed disabled:opacity-35"
    >
      {disabled ? 'Sending' : 'Send'}
    </button>
  </form>
</div>
