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

<div>
  {#if streamError}
    <div class="mb-3 neo-card-sm neo-fill-red px-3 py-2 text-[11px] font-bold text-white">{streamError}</div>
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
      class="neo-input min-h-[72px] flex-1 resize-none font-medium"
    ></textarea>
    <button type="submit" disabled={disabled || !value.trim()} class="neo-btn neo-btn-primary disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:translate-x-0 disabled:hover:translate-y-0 disabled:hover:shadow-[4px_4px_0_0_#000]">
      {disabled ? 'Sending' : 'Send'}
    </button>
  </form>
</div>
