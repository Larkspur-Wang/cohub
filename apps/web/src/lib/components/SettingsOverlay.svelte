<script lang="ts">
import Dialog from "./Dialog.svelte";

const {
  open,
  onClose,
  children,
}: {
  open: boolean;
  onClose: () => void;
  children: import("svelte").Snippet;
} = $props();
</script>

<Dialog {open} {onClose} title="Settings">
  <div class="flex flex-col h-full">
    <div class="flex-1 overflow-y-auto">
      {@render children()}
    </div>
  </div>
</Dialog>
