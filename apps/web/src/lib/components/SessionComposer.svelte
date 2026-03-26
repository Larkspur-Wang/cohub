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

<div class="border-t border-white/5 bg-[#111111] px-4 py-3">
  {#if streamError}
    <div class="mb-2 text-[11px] text-red-300/76">{streamError}</div>
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
      class="min-h-[72px] flex-1 resize-none rounded-md border border-white/6 bg-white/[0.022] px-3 py-2 text-[12px] leading-6 text-white/84 outline-none transition-all duration-150 placeholder:text-white/18 focus:border-white/11 focus:bg-white/[0.035]"
    ></textarea>
    <button
      type="submit"
      disabled={disabled || !value.trim()}
      class="rounded-md border border-white/6 px-3 py-2 text-[11px] uppercase tracking-[0.18em] text-white/70 transition-all duration-150 hover:bg-white/[0.035] hover:text-white/88 disabled:cursor-not-allowed disabled:opacity-35 cursor-pointer"
    >
      {disabled ? 'sending' : 'send'}
    </button>
  </form>
</div>
