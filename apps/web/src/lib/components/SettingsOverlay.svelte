<script lang="ts">
import { slide, fade } from "svelte/transition";
import { X } from "lucide-svelte";

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

{#if open}
  <!-- Overlay layer -->
  <div
    class="fixed inset-0 z-40"
    in:fade={{ duration: 150 }}
    out:fade={{ duration: 150 }}
  >
    <!-- Backdrop -->
    <div
      class="absolute inset-0 bg-black/30 lg:bg-black/20"
      onclick={onClose}
      aria-hidden="true"
    ></div>

    <!-- Desktop: right-side drawer -->
    <div
      class="hidden lg:block absolute inset-y-0 right-0 w-[320px] border-l border-border-subtle bg-bg-primary"
      in:slide={{ axis: "x", duration: 200, easing: (t) => t }}
      out:slide={{ axis: "x", duration: 150, easing: (t) => t * t }}
    >
      <div class="flex flex-col h-full">
        <div class="h-9 flex items-center justify-between px-3 border-b border-border-subtle text-[10px] font-medium uppercase tracking-wider text-text-tertiary select-none sticky top-0 bg-bg-primary z-10">
          <span>Settings</span>
          <button
            type="button"
            class="flex items-center justify-center w-6 h-6 rounded-[4px] text-text-tertiary hover:text-text-secondary hover:bg-bg-hover transition-colors duration-100"
            onclick={onClose}
            title="Close settings"
          >
            <X class="w-3.5 h-3.5" />
          </button>
        </div>
        <div class="flex-1 overflow-y-auto">
          {@render children()}
        </div>
      </div>
    </div>

    <!-- Mobile: bottom sheet -->
    <div
      class="lg:hidden fixed inset-x-0 bottom-0 max-h-[70vh] rounded-t-xl border-t border-border-subtle bg-bg-primary overflow-hidden"
      in:slide={{ axis: "y", duration: 200, easing: (t) => t }}
      out:slide={{ axis: "y", duration: 150, easing: (t) => t * t }}
    >
      <!-- Drag handle -->
      <div class="flex items-center justify-center py-2 border-b border-border-subtle">
        <div class="w-10 h-1 rounded-full bg-border-subtle"></div>
      </div>
      <div class="flex-1 overflow-y-auto max-h-[calc(70vh-2.5rem)] pb-safe">
        {@render children()}
      </div>
    </div>
  </div>
{/if}
