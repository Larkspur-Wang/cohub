<script lang="ts">
import type { Channel } from "@neta-art/cohub";
import {
	MessageCircle,
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
	wechat: MessageCircle,
	web: MonitorPlay,
};

const providerDotColor: Record<string, string> = {
	discord: "bg-provider-discord",
	feishu: "bg-provider-feishu",
	wechat: "bg-provider-wechat",
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

async function handleDelete(channel: Channel) {
	if (channel.boundSpace) {
		alert("Unbind this channel from its Space before deleting it.");
		return;
	}
	if (!confirm("Are you sure you want to delete this channel?")) return;
	try {
		await sdk.channels.delete(channel.id);
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
  <div class="flex-1 overflow-y-auto px-4 py-5 sm:p-6">
    <section class="max-w-2xl">
      <div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div class="min-w-0">
          <h1 class="text-[18px] font-semibold text-text-primary tracking-tight">Channels</h1>
          <p class="mt-1 text-[13px] text-text-tertiary">
            Connect external platforms so your agents can send messages.
          </p>
        </div>
        <a
          href="/settings/channels/new"
          class="inline-flex min-h-10 items-center justify-center gap-1.5 rounded-[5px] border border-brand-border bg-brand-muted px-3 py-2 text-[12px] font-medium text-brand transition-colors hover:bg-brand-muted-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand/50 sm:min-h-8 sm:px-2.5 sm:py-1.5"
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
        <div class="flex flex-col items-center justify-center py-14 text-center sm:py-16">
          <div class="w-11 h-11 rounded-md bg-bg-surface border border-border-subtle flex items-center justify-center mb-3">
            <Webhook class="w-5 h-5 text-text-placeholder" />
          </div>
          <p class="text-[14px] text-text-tertiary">No channels yet</p>
          <p class="text-[12px] text-text-placeholder mt-1">Connect a platform to let your agents communicate.</p>
        </div>
      {:else}
        <div class="mt-5 overflow-hidden rounded-md border border-border-subtle sm:mt-6 max-lg:border-0 max-lg:overflow-visible">
          <div class="hidden lg:grid lg:grid-cols-[auto_1fr_auto_1fr_auto] lg:gap-3 lg:px-3 lg:py-2 bg-bg-header-alt text-[10px] font-medium uppercase tracking-[0.08em] text-text-placeholder border-b border-border-subtle">
            <span></span>
            <span>Channel</span>
            <span>Status</span>
            <span>Bound Space</span>
            <span></span>
          </div>
          <div class="space-y-2 lg:space-y-0 lg:divide-y lg:divide-border-subtle">
          {#each channels as channel (channel.id)}
            {@const Icon = providerIcons[channel.provider] || Webhook}
            {@const dotColor = providerDotColor[channel.provider] || providerDotColor.web}
            <div class="rounded-md border border-border-subtle bg-bg-surface transition-colors duration-100 hover:bg-bg-hover lg:rounded-none lg:border-0 lg:bg-transparent">
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
                    onclick={() => handleDelete(channel)}
                    disabled={Boolean(channel.boundSpace)}
                    class="p-2 rounded-[4px] text-text-tertiary hover:text-error-soft hover:bg-error-bg transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand/50 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-text-tertiary"
                    title={channel.boundSpace ? "Unbind this channel before deleting it" : "Delete channel"}
                  >
                    <Trash2 class="w-4 h-4" />
                  </button>
                </div>
              </div>

              <!-- Mobile: card layout -->
              <div class="lg:hidden p-3.5">
                <div class="flex items-start gap-3">
                  <div class="flex h-10 w-10 shrink-0 items-center justify-center rounded-[6px] border border-border-subtle bg-bg-primary">
                    <div class="mr-0.5 h-2 w-2 rounded-full {dotColor}"></div>
                    <Icon class="h-4 w-4 text-text-tertiary" />
                  </div>
                  <div class="min-w-0 flex-1">
                    <div class="flex min-w-0 items-start justify-between gap-3">
                      <div class="min-w-0">
                        <div class="truncate text-[14px] font-medium text-text-primary">{channel.name}</div>
                        <div class="mt-0.5 text-[10px] uppercase tracking-wider text-text-tertiary">{channel.provider}</div>
                      </div>
                      <button
                        onclick={() => handleDelete(channel)}
                        disabled={Boolean(channel.boundSpace)}
                        class="flex h-10 w-10 shrink-0 items-center justify-center rounded-[5px] text-text-tertiary transition-colors hover:bg-error-bg hover:text-error-soft focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand/50 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-text-tertiary"
                        title={channel.boundSpace ? "Unbind this channel before deleting it" : "Delete channel"}
                        aria-label={channel.boundSpace ? "Unbind this channel before deleting it" : "Delete channel"}
                      >
                        <Trash2 class="h-4 w-4" />
                      </button>
                    </div>
                    <div class="mt-3 flex flex-wrap items-center gap-2">
                      <span class="rounded-sm border border-border-subtle bg-bg-hover px-1.5 py-0.5 text-[11px] text-text-tertiary">{channel.status}</span>
                      {#if channel.boundSpace}
                        <a href={buildSpaceLandingRoute(channel.boundSpace.id)} class="min-w-0 max-w-full truncate text-[12px] font-mono text-text-secondary transition-colors hover:text-text-primary">
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
