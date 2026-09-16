<script lang="ts">
import {
	AlertTriangle,
	Loader2,
	Monitor,
	RefreshCw,
	Square,
	X,
} from "lucide-svelte";
import Sheet from "$lib/components/Sheet.svelte";
import { getLocale } from "$lib/i18n/locale.svelte";
import { m } from "$lib/paraglide/messages.js";
import { sdk } from "$lib/sdk";
import {
	cachedRuntimeStatus,
	refreshRuntimeStatus,
} from "../runtime-status.svelte";

const { spaceId }: { spaceId: string } = $props();
const locale = $derived(getLocale());
const status = $derived(cachedRuntimeStatus(spaceId));
let open = $state(false);
let busy = $state(false);
let confirmed = $state(false);
let submitted = $state(false);
let error = $state("");
let confirmationRevision = $state<string | null>(null);
const label = $derived(
	status?.recovery.pending
		? m.runtime_attention({}, { locale })
		: status?.online
			? m.runtime_online({}, { locale })
			: m.runtime_offline({}, { locale }),
);

$effect(() => {
	const target = spaceId;
	open = false;
	const refresh = () => {
		if (document.visibilityState === "visible")
			void refreshRuntimeStatus(target).catch(() => {});
	};
	refresh();
	const timer = setInterval(refresh, 30_000);
	window.addEventListener("focus", refresh);
	return () => {
		clearInterval(timer);
		window.removeEventListener("focus", refresh);
	};
});
$effect(() => {
	if (!open) return;
	const target = spaceId;
	const timer = setInterval(() => {
		void refreshRuntimeStatus(target).catch(() => {});
	}, 3000);
	return () => clearInterval(timer);
});
function show() {
	open = true;
	confirmed = false;
	submitted = false;
	error = "";
	confirmationRevision = status?.recovery.revision ?? null;
	void refreshRuntimeStatus(spaceId).catch(() => {});
}
async function confirmStopped() {
	const revision = confirmationRevision;
	if (busy || submitted || !status?.canManage || !confirmed || !revision)
		return;
	const target = spaceId;
	busy = true;
	error = "";
	try {
		await sdk
			.space(target)
			.confirmRuntimeStopped({ confirmed: true, revision });
		if (spaceId === target) {
			confirmed = false;
			submitted = true;
		}
		await refreshRuntimeStatus(target);
	} catch (cause) {
		if (spaceId === target)
			error = cause instanceof Error ? cause.message : String(cause);
	} finally {
		busy = false;
	}
}
</script>

{#if status?.kind === "local" || status?.recovery.pending}
  <button type="button" class="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-text-tertiary hover:bg-bg-hover hover:text-text-primary" title={`Runtime: ${label}`}  aria-label={`Runtime: ${label}`} onclick={show}>
    {#if status.recovery.pending}<AlertTriangle class="h-4 w-4 text-error-text" />{:else}<Monitor class="h-4 w-4" />{/if}
  </button>
{/if}

<Sheet {open} onClose={() => { open = false; }}>
  <div class="flex items-center justify-between border-b border-border-subtle px-4 py-3">
    <h2 class="text-sm font-medium">Runtime</h2>
    <button type="button" class="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-text-tertiary hover:bg-bg-hover hover:text-text-primary" title={m.common_close({}, { locale })} onclick={() => { open = false; }}><X class="h-4 w-4" /></button>
  </div>
  <div class="space-y-4 p-4 text-sm">
    <div class="flex items-center justify-between gap-3"><span>{label}</span><span class="text-text-muted">{status?.capabilities?.harnesses.join(" / ") ?? ""}</span></div>
    {#if status?.recovery.pending}
      <p class="text-text-secondary">{m.runtime_pending({ count: status.recovery.pending }, { locale })}</p>
    {/if}
    {#if status?.canManage}
      {#if status.recovery.pending}
        {#if confirmationRevision !== status.recovery.revision}
          <p role="status" class="text-text-secondary">{m.runtime_state_changed({}, { locale })}</p>
          <button type="button" class="inline-flex min-h-9 items-center gap-2" onclick={() => { confirmationRevision = status.recovery.revision; confirmed = false; submitted = false; }}><RefreshCw class="h-4 w-4" />{m.runtime_refresh_confirmation({}, { locale })}</button>
        {:else}
          <label class="flex items-start gap-2 border-t border-border-subtle pt-4 text-text-secondary">
            <input type="checkbox" class="mt-0.5 shrink-0" bind:checked={confirmed} disabled={busy || submitted} />
            <span>{m.runtime_confirm_stopped({}, { locale })}</span>
          </label>
          <button type="button" class="inline-flex min-h-9 items-center gap-2 rounded-md border border-border-subtle px-3 text-error-text disabled:opacity-50" disabled={!confirmed || busy || submitted} onclick={confirmStopped}>{#if busy}<Loader2 class="h-3.5 w-3.5 animate-spin" />{:else}<Square class="h-3.5 w-3.5" />{/if}{m.runtime_end_unknown({}, { locale })}</button>
        {/if}
      {/if}
    {/if}
    {#if submitted}<p role="status" class="text-text-secondary">{m.runtime_confirmation_queued({}, { locale })}</p>{/if}
    {#if error}<p role="alert" class="break-words text-error-text">{error}</p>{/if}
  </div>
</Sheet>
