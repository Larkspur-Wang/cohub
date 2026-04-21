<script lang="ts">
import { X } from "lucide-svelte";
import { fade, scale, slide } from "svelte/transition";
import {
	DURATION_MODAL_IN,
	DURATION_MODAL_OUT,
	svelteEaseIn,
	svelteEaseOut,
} from "$lib/motion.svelte";

const {
	open,
	onClose,
	title,
	children,
	footer,
	mobile = true,
	maxWidth = "480px",
}: {
	open: boolean;
	onClose: () => void;
	title?: string;
	children: import("svelte").Snippet;
	footer?: import("svelte").Snippet;
	mobile?: boolean;
	maxWidth?: string;
} = $props();

const TRANSITION_IN = { duration: DURATION_MODAL_IN, easing: svelteEaseOut };
const TRANSITION_OUT = { duration: DURATION_MODAL_OUT, easing: svelteEaseIn };
const SCALE_TRANSITION_IN = { ...TRANSITION_IN, start: 0.95 };
const SCALE_TRANSITION_OUT = { ...TRANSITION_OUT, start: 0.95 };
</script>

{#if open}
  <div
    class="fixed inset-0 z-50 flex items-center justify-center p-4"
    in:fade={TRANSITION_IN}
    out:fade={TRANSITION_OUT}
    role="dialog"
    aria-modal="true"
  >
    <!-- Backdrop -->
    <div
      class="absolute inset-0 bg-black/60"
      onclick={onClose}
      aria-hidden="true"
    ></div>

    {#if mobile}
      <!-- Desktop: centered modal -->
      <div
        class="hidden lg:block relative w-full rounded-xl border border-border-subtle bg-bg-primary shadow-2xl overflow-hidden"
        style="max-width: {maxWidth}"
        in:scale|local={SCALE_TRANSITION_IN}
        out:scale|local={SCALE_TRANSITION_OUT}
      >
        {@render modalContent()}
      </div>

      <!-- Mobile: bottom sheet -->
      <div
        class="lg:hidden relative w-full max-w-[480px] rounded-t-xl border-t border-border-subtle bg-bg-primary shadow-2xl overflow-hidden"
        in:slide|local={{ axis: "y", ...TRANSITION_IN }}
        out:slide|local={{ axis: "y", ...TRANSITION_OUT }}
      >
        {@render mobileSheetContent()}
      </div>
    {:else}
      <!-- Desktop-only modal -->
      <div
        class="relative w-full rounded-xl border border-border-subtle bg-bg-primary shadow-2xl overflow-hidden"
        style="max-width: {maxWidth}"
        in:scale|local={SCALE_TRANSITION_IN}
        out:scale|local={SCALE_TRANSITION_OUT}
      >
        {@render modalContent()}
      </div>
    {/if}
  </div>
{/if}

{#snippet modalContent()}
  <div class="flex flex-col h-full" style="max-height: 70vh">
    {#if title}
      <div class="h-9 flex items-center justify-between px-3 border-b border-border-subtle text-[10px] font-medium uppercase tracking-wider text-text-tertiary select-none shrink-0">
        <span>{title}</span>
        <button
          type="button"
          class="flex items-center justify-center w-6 h-6 rounded-[4px] text-text-tertiary hover:text-text-secondary hover:bg-bg-hover transition-colors duration-100"
          onclick={onClose}
          title="Close"
        >
          <X class="w-3.5 h-3.5" />
        </button>
      </div>
    {/if}
    <div class="flex-1 overflow-y-auto min-h-0">
      {@render children()}
    </div>
    {#if footer}
      {@render footer()}
    {/if}
  </div>
{/snippet}

{#snippet mobileSheetContent()}
  <div class="flex flex-col max-h-[70vh]">
    {#if title}
      <div class="h-9 flex items-center justify-between px-3 border-b border-border-subtle text-[10px] font-medium uppercase tracking-wider text-text-tertiary select-none shrink-0">
        <span>{title}</span>
        <button
          type="button"
          class="flex items-center justify-center w-6 h-6 rounded-[4px] text-text-tertiary hover:text-text-secondary hover:bg-bg-hover transition-colors duration-100"
          onclick={onClose}
          title="Close"
        >
          <X class="w-3.5 h-3.5" />
        </button>
      </div>
    {/if}
    <div class="flex-1 overflow-y-auto min-h-0 pb-safe">
      {@render children()}
    </div>
    {#if footer}
      {@render footer()}
    {/if}
  </div>
{/snippet}
