<script lang="ts">
type Props = {
  value: string;
  sending?: boolean;
  streamError?: string;
  onSubmit: () => void;
};

let {
  value = $bindable(""),
  sending = false,
  streamError = "",
  onSubmit,
}: Props = $props();
</script>

<div class="border-t border-gray-100 p-4 bg-white">
  {#if streamError}
    <div class="mb-3 text-xs text-red-500 font-medium">{streamError}</div>
  {/if}

  <form
    class="flex items-end gap-3"
    onsubmit={(event) => {
      event.preventDefault();
      onSubmit();
    }}
  >
    <textarea
      bind:value
      rows="3"
      placeholder="Talk to your agent..."
      class="flex-1 resize-none rounded-2xl border-2 border-gray-100 bg-gray-50 px-4 py-3 outline-none focus:border-brand focus:bg-white transition-all"
    ></textarea>
    <button
      type="submit"
      disabled={sending || !value.trim()}
      class="px-6 py-3 rounded-2xl bg-brand text-white font-black shadow-lg shadow-brand/20 hover:-translate-y-0.5 transition-all disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
    >
      {sending ? 'Sending...' : 'Send'}
    </button>
  </form>
</div>
