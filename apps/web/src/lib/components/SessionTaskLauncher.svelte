<script lang="ts">
import { AlertCircle, ListTodo, LoaderCircle } from "lucide-svelte";
import type { SessionTaskNotice } from "$lib/components/SessionTaskTray.svelte";
import { getLocale } from "$lib/i18n/locale.svelte";
import { m } from "$lib/paraglide/messages.js";

type Props = {
	notices: SessionTaskNotice[];
	onOpen: () => void;
};

const { notices, onOpen }: Props = $props();

const locale = $derived(getLocale());
const running = $derived(
	notices.filter(
		(notice) => notice.status === "pending" || notice.status === "running",
	).length,
);
const failed = $derived(
	notices.filter((notice) => notice.status === "failed").length,
);
</script>

<div class="pointer-events-none fixed right-3 top-[calc(env(safe-area-inset-top)+3.5rem)] z-40 flex justify-end sm:right-4 lg:absolute lg:right-16 lg:top-4 lg:z-30">
  <button
    type="button"
    class="pointer-events-auto inline-flex h-8 items-center gap-1.5 rounded-[6px] border border-border-primary bg-bg-elevated px-2.5 text-[11px] font-medium text-text-secondary shadow-[0_8px_24px_rgba(0,0,0,0.1)] transition-colors hover:bg-bg-hover hover:text-text-primary"
    aria-label={running > 0 ? `Open tasks, ${running} running` : "Open tasks"}
    title="Tasks"
    onclick={onOpen}
  >
    {#if running > 0}
      <LoaderCircle class="h-3.5 w-3.5 animate-spin text-brand" />
    {:else if failed > 0}
      <AlertCircle class="h-3.5 w-3.5 text-error-soft" />
    {:else}
      <ListTodo class="h-3.5 w-3.5 text-text-tertiary" />
    {/if}
    <span>Tasks</span>
    {#if running > 0}
      <span class="font-mono text-[10px] text-brand tabular-nums">{running}</span>
    {/if}
  </button>
</div>
