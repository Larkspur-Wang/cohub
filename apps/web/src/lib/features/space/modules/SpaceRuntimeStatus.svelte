<script lang="ts">
import { Monitor, X } from "lucide-svelte";
import Sheet from "$lib/components/Sheet.svelte";
import { getLocale } from "$lib/i18n/locale.svelte";
import { m } from "$lib/paraglide/messages.js";
import {
	cachedRuntimeStatus,
	refreshRuntimeStatus,
} from "../runtime-status.svelte";

const { spaceId }: { spaceId: string } = $props();
const locale = $derived(getLocale());
const status = $derived(cachedRuntimeStatus(spaceId));
let open = $state(false);
const label = $derived(
	status?.online
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
function show() {
	open = true;
	void refreshRuntimeStatus(spaceId, { force: true }).catch(() => {});
}
</script>

{#if status?.kind === "local"}
  <button type="button" class="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-text-tertiary hover:bg-bg-hover hover:text-text-primary" title={`Runtime: ${label}`} aria-label={`Runtime: ${label}`} onclick={show}>
    <Monitor class="h-4 w-4" />
  </button>
{/if}

<Sheet {open} onClose={() => { open = false; }}>
  <div class="flex items-center justify-between border-b border-border-subtle px-4 py-3">
    <h2 class="text-sm font-medium">Runtime</h2>
    <button type="button" class="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-text-tertiary hover:bg-bg-hover hover:text-text-primary" title={m.common_close({}, { locale })} onclick={() => { open = false; }}><X class="h-4 w-4" /></button>
  </div>
  <div class="p-4 text-sm">
    <div class="flex items-center justify-between gap-3"><span>{label}</span><span class="text-text-muted">{status?.capabilities?.harnesses.join(" / ") ?? ""}</span></div>
  </div>
</Sheet>
