<script lang="ts">
import type { Channel } from "@neta-art/cohub";
import {
	MessageSquare,
	MonitorPlay,
	Plus,
	Trash2,
	Webhook,
} from "lucide-svelte";
import { onMount } from "svelte";
import { page } from "$app/state";
import { ensureAuth } from "$lib/auth";
import { handleUnauthorizedError } from "$lib/auth-redirect";
import CenteredLoading from "$lib/components/CenteredLoading.svelte";
import { sdk } from "$lib/sdk";
import { buildSpaceLandingRoute } from "$lib/space-routes";

const currentPath = $derived(page.url.pathname);
const currentSearch = $derived(page.url.search);

let channels = $state<Channel[]>([]);
let isLoading = $state(true);
let loadError = $state("");

const providerIcons: Record<string, typeof MessageSquare> = {
	discord: MessageSquare,
	feishu: Webhook,
	web: MonitorPlay,
};

const providerDotColor: Record<string, string> = {
	discord: "bg-provider-discord",
	feishu: "bg-provider-feishu",
	web: "bg-status-running",
};

async function loadChannels() {
	if (!(await ensureAuth({ redirectPath: `${currentPath}${currentSearch}` })))
		return;
	isLoading = true;
	loadError = "";
	try {
		channels = await sdk.channels.list();
	} catch (error) {
		if (
			await handleUnauthorizedError(error, `${currentPath}${currentSearch}`)
		) {
			return;
		}
		loadError =
			error instanceof Error ? error.message : "Failed to load channels";
	} finally {
		isLoading = false;
	}
}

onMount(() => {
	void loadChannels();
});

async function handleDelete(id: string) {
	if (!confirm("Are you sure you want to delete this channel?")) return;
	try {
		await sdk.channels.delete(id);
		await loadChannels();
	} catch (error) {
		alert(error instanceof Error ? error.message : "Failed to delete channel");
	}
}
</script>

<svelte:head>
	<title>Channels — Cohub</title>
</svelte:head>

<div class="flex-1 flex flex-col min-h-0 overflow-y-auto">
  <div class="flex-1 p-6 overflow-y-auto">
    <section class="max-w-2xl">
      <div class="flex items-center justify-between">
        <div>
          <h1 class="text-[18px] font-semibold text-text-primary tracking-tight">Channels</h1>
          <p class="mt-1 text-[13px] text-text-tertiary">
            Connect external platforms so your agents can send messages.
          </p>
        </div>
        <a
          href="/settings/channels/new"
          class="flex items-center gap-1.5 px-2.5 py-1.5 rounded-[5px] text-[12px] bg-brand-muted border border-brand-border text-brand font-medium hover:bg-brand-muted-hover transition-colors"
        >
          <Plus class="w-3.5 h-3.5" />
          Add Channel
        </a>
      </div>

      <!-- Channel List -->
      {#if isLoading}
        <CenteredLoading label="Loading channels…" size="compact" />
      {:else if loadError}
        <div class="mt-6 rounded-md border border-error-soft/30 bg-error-bg p-3 text-[12px] font-mono text-error-soft break-all">{loadError}</div>
      {:else if channels.length === 0}
        <div class="flex flex-col items-center justify-center py-16 text-center">
          <div class="w-11 h-11 rounded-md bg-bg-surface border border-border-subtle flex items-center justify-center mb-3">
            <Webhook class="w-5 h-5 text-text-placeholder" />
          </div>
          <p class="text-[14px] text-text-tertiary">No channels yet</p>
          <p class="text-[12px] text-text-placeholder mt-1">Connect a platform to let your agents communicate</p>
        </div>
      {:else}
        <div class="mt-6 rounded-md border border-border-subtle overflow-hidden">
          <div class="hidden lg:grid lg:grid-cols-[auto_1fr_auto_1fr_auto] lg:gap-3 lg:px-3 lg:py-2 bg-bg-header-alt text-[10px] font-medium uppercase tracking-[0.08em] text-text-placeholder border-b border-border-subtle">
            <span></span>
            <span>Channel</span>
            <span>Status</span>
            <span>Bound Space</span>
            <span></span>
          </div>
          <div class="divide-y divide-border-subtle">
          {#each channels as channel (channel.id)}
            {@const Icon = providerIcons[channel.provider] || Webhook}
            {@const dotColor = providerDotColor[channel.provider] || providerDotColor.web}
            <div class="hover:bg-bg-hover transition-colors duration-100">
              <!-- Desktop: table row -->
              <div class="hidden lg:grid lg:grid-cols-[auto_1fr_auto_1fr_auto] lg:gap-3 lg:px-3 lg:py-2.5">
                <div class="w-7 h-7 rounded-[5px] bg-bg-surface border border-border-subtle flex items-center justify-center shrink-0 mt-0.5">
                  <div class="w-2 h-2 rounded-full {dotColor} mr-0.5"></div>
                  <Icon class="w-3.5 h-3.5 text-text-tertiary" />
                </div>
                <div class="min-w-0">
                  <div class="text-[13px] font-medium text-text-primary truncate">{channel.name}</div>
                  <div class="text-[10px] uppercase tracking-wider text-text-tertiary">{channel.provider}</div>
                </div>
                <div class="flex items-center pt-0.5 shrink-0">
                  <span class="px-1.5 py-0.5 rounded-sm text-[10px] bg-bg-hover text-text-tertiary border border-border-subtle">{channel.status}</span>
                </div>
                <div class="flex items-center gap-1.5 pt-0.5 min-w-0">
                  {#if channel.boundSpace}
                    <a href={buildSpaceLandingRoute(channel.boundSpace.id)} class="text-[12px] text-text-secondary hover:text-text-primary truncate font-mono transition-colors">
                      {channel.boundSpace.title || channel.boundSpace.id.slice(0, 8)}
                    </a>
                  {:else}
                    <span class="text-[12px] text-text-placeholder">Not bound</span>
                  {/if}
                </div>
                <div class="flex items-center justify-end pt-0.5 shrink-0">
                  <button
                    onclick={() => handleDelete(channel.id)}
                    class="p-2 rounded-[4px] text-text-tertiary hover:text-error-soft hover:bg-error-bg transition-colors"
                    title="Delete channel"
                  >
                    <Trash2 class="w-4 h-4" />
                  </button>
                </div>
              </div>

              <!-- Mobile: card layout -->
              <div class="lg:hidden px-3 py-3">
                <div class="flex items-start gap-3">
                  <div class="w-9 h-9 rounded-[5px] bg-bg-surface border border-border-subtle flex items-center justify-center shrink-0">
                    <div class="w-2 h-2 rounded-full {dotColor}"></div>
                    <Icon class="w-4 h-4 text-text-tertiary ml-0.5" />
                  </div>
                  <div class="flex-1 min-w-0">
                    <div class="flex items-center justify-between gap-2">
                      <div class="text-[13px] font-medium text-text-primary truncate">{channel.name}</div>
                      <button
                        onclick={() => handleDelete(channel.id)}
                        class="p-2 rounded-[4px] text-text-tertiary hover:text-error-soft hover:bg-error-bg transition-colors shrink-0"
                        title="Delete channel"
                      >
                        <Trash2 class="w-4 h-4" />
                      </button>
                    </div>
                    <div class="text-[11px] uppercase tracking-wider text-text-tertiary mt-0.5">{channel.provider}</div>
                    <div class="flex items-center gap-3 mt-2">
                      <span class="px-1.5 py-0.5 rounded-sm text-[11px] bg-bg-hover text-text-tertiary border border-border-subtle">{channel.status}</span>
                      {#if channel.boundSpace}
                        <a href={buildSpaceLandingRoute(channel.boundSpace.id)} class="text-[12px] text-text-secondary hover:text-text-primary truncate font-mono transition-colors">
                          {channel.boundSpace.title || channel.boundSpace.id.slice(0, 8)}
                        </a>
                      {:else}
                        <span class="text-[12px] text-text-placeholder">Not bound</span>
                      {/if}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          {/each}
          </div>
        </div>
      {/if}
    </section>
  </div>
</div>
