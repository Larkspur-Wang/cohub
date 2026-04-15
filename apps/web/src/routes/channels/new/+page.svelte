<script lang="ts">
import { goto } from "$app/navigation";
import { onMount } from "svelte";
import { ArrowLeft, MessageSquare, Webhook, Copy, ExternalLink, Check, Loader2, ChevronDown } from "lucide-svelte";
import { createChannel } from "$lib/api";
import { ensureAuth, logtoClient } from "$lib/auth";

type Provider = "discord" | "feishu" | "web";
type Step = "select" | "form";

let selectedProvider = $state<Provider | null>(null);
let formName = $state("");
let formToken = $state("");
let formAppId = $state("");
let formAppSecret = $state("");
let formBrand = $state<"feishu" | "lark">("feishu");

let isSubmitting = $state(false);
let submitError = $state("");
let copiedField = $state<string | null>(null);

// Guide accordion state
let discordGuideOpen = $state(false);
let feishuGuideOpen = $state(false);

function selectProvider(provider: Provider) {
  selectedProvider = provider;
  submitError = "";
}

function goBack() {
  selectedProvider = null;
  submitError = "";
}

function copyToClipboard(text: string, field: string) {
  navigator.clipboard.writeText(text).then(() => {
    copiedField = field;
    setTimeout(() => { copiedField = null; }, 1500);
  });
}

async function handleSubmit(e: Event) {
  e.preventDefault();
  if (!selectedProvider || isSubmitting) return;

  // Validate
  if (!formName.trim()) {
    submitError = "Channel name is required.";
    return;
  }

  if (selectedProvider === "discord" && !formToken.trim()) {
    submitError = "Bot Token is required.";
    return;
  }

  if (selectedProvider === "feishu") {
    if (!formAppId.trim()) {
      submitError = "App ID is required.";
      return;
    }
    if (!formAppSecret.trim()) {
      submitError = "App Secret is required.";
      return;
    }
  }

  if (!(await ensureAuth())) return;

  isSubmitting = true;
  submitError = "";

  try {
    let credentials: Record<string, unknown>;
    if (selectedProvider === "discord") {
      credentials = { token: formToken.trim() };
    } else if (selectedProvider === "feishu") {
      credentials = {
        appId: formAppId.trim(),
        appSecret: formAppSecret.trim(),
        brand: formBrand,
      };
    } else {
      credentials = {};
    }

    await createChannel({
      provider: selectedProvider,
      name: formName.trim(),
      credentials,
    });

    await goto("/channels");
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to create channel";
    if (message.includes("unauthorized") || message.includes("401")) {
      await logtoClient.signIn(`${window.location.origin}/callback`);
      return;
    }
    submitError = message;
  } finally {
    isSubmitting = false;
  }
}
</script>

<div class="flex-1 flex flex-col min-h-0 overflow-y-auto">
  <!-- Header -->
  <div class="h-[40px] flex items-center px-4 border-b border-border-subtle shrink-0 bg-bg-primary">
    <div class="flex items-center gap-3 min-w-0">
      <a href="/channels" class="text-text-tertiary hover:text-text-primary transition-colors shrink-0"
        onclick={(e) => { e.preventDefault(); goto("/channels"); }}>
        <ArrowLeft class="w-4 h-4" />
      </a>
      <div class="w-[1px] h-4 bg-border-subtle shrink-0"></div>
      <span class="text-[11px] font-medium text-text-secondary">New Channel</span>
    </div>
  </div>

  <div class="flex-1 p-4 overflow-y-auto max-w-2xl mx-auto w-full">
    {#if !selectedProvider}
      <!-- Step 1: Provider Selection -->
      <div class="space-y-3">
        <div>
          <div class="text-[10px] uppercase tracking-wider text-text-placeholder font-medium">Select Platform</div>
          <p class="text-[13px] text-text-tertiary mt-1">Choose the messaging platform you want to connect.</p>
        </div>

        <!-- Discord Card -->
        <button
          type="button"
          onclick={() => selectProvider("discord")}
          class="w-full text-left rounded-md border border-border-subtle bg-bg-surface p-4 hover:border-indigo-400/40 hover:bg-indigo-500/5 transition-all group"
        >
          <div class="flex items-start gap-3">
            <div class="w-10 h-10 rounded-[7px] bg-[#5865F2]/10 border border-[#5865F2]/20 flex items-center justify-center shrink-0">
              <MessageSquare class="w-5 h-5 text-[#5865F2]" />
            </div>
            <div class="flex-1 min-w-0">
              <div class="text-[14px] font-medium text-text-primary group-hover:text-text-primary">Discord</div>
              <p class="text-[12px] text-text-tertiary mt-0.5">Connect to a Discord server via bot. Requires a bot token and appropriate server permissions.</p>
            </div>
            <div class="text-text-placeholder group-hover:text-text-secondary transition-colors mt-1">
              <ChevronDown class="w-4 h-4 -rotate-90" />
            </div>
          </div>
        </button>

        <!-- Feishu Card -->
        <button
          type="button"
          onclick={() => selectProvider("feishu")}
          class="w-full text-left rounded-md border border-border-subtle bg-bg-surface p-4 hover:border-cyan-400/40 hover:bg-cyan-500/5 transition-all group"
        >
          <div class="flex items-start gap-3">
            <div class="w-10 h-10 rounded-[7px] bg-cyan-400/10 border border-cyan-400/20 flex items-center justify-center shrink-0">
              <Webhook class="w-5 h-5 text-cyan-400" />
            </div>
            <div class="flex-1 min-w-0">
              <div class="text-[14px] font-medium text-text-primary group-hover:text-text-primary">Feishu / Lark</div>
              <p class="text-[12px] text-text-tertiary mt-0.5">Connect via Feishu open platform app. Requires App ID and App Secret from the developer console.</p>
            </div>
            <div class="text-text-placeholder group-hover:text-text-secondary transition-colors mt-1">
              <ChevronDown class="w-4 h-4 -rotate-90" />
            </div>
          </div>
        </button>
      </div>

    {:else}
      <!-- Step 2: Provider-specific Form -->
      <div class="space-y-4">
        <!-- Provider Header -->
        <div class="flex items-center gap-2 mb-2">
          <button type="button" onclick={goBack} class="text-text-tertiary hover:text-text-secondary transition-colors text-[12px]">
            ← Back
          </button>
        </div>

        {#if selectedProvider === "discord"}
          <!-- Discord Guide -->
          <div class="rounded-md border border-border-subtle bg-bg-surface overflow-hidden">
            <button
              type="button"
              onclick={() => discordGuideOpen = !discordGuideOpen}
              class="w-full flex items-center justify-between p-3 hover:bg-bg-hover transition-colors"
            >
              <span class="text-[12px] font-medium text-text-secondary flex items-center gap-2">
                <ExternalLink class="w-3.5 h-3.5" />
                How to get your Discord Bot Token
              </span>
              <ChevronDown class="w-4 h-4 text-text-placeholder transition-transform {discordGuideOpen ? 'rotate-180' : ''}" />
            </button>
            {#if discordGuideOpen}
              <div class="px-3 pb-3 text-[12px] text-text-tertiary space-y-2 border-t border-border-subtle">
                <ol class="list-decimal list-inside space-y-1.5 pt-2">
                  <li>Go to the <a href="https://discord.com/developers/applications" target="_blank" rel="noopener" class="text-brand hover:underline">Discord Developer Portal</a></li>
                  <li>Create a new application or select an existing one</li>
                  <li>Navigate to <strong>Bot</strong> in the left sidebar</li>
                  <li>Click <strong>Reset Token</strong> and copy the bot token</li>
                  <li>Enable the following <strong>Privileged Gateway Intents</strong>:
                    <ul class="list-disc list-inside ml-4 mt-1 text-text-placeholder">
                      <li>Message Content Intent</li>
                      <li>Server Members Intent (optional)</li>
                    </ul>
                  </li>
                  <li>Invite the bot to your server using the <strong>OAuth2 → URL Generator</strong> with <code class="px-1 py-0.5 bg-bg-code rounded text-[11px]">bot</code> scope</li>
                </ol>
              </div>
            {/if}
          </div>

          <form onsubmit={handleSubmit} class="space-y-3">
            <div>
              <label class="block text-[10px] font-medium uppercase tracking-wider text-text-tertiary mb-1.5" for="ch-name">Channel Name</label>
              <input
                id="ch-name"
                type="text"
                bind:value={formName}
                placeholder="e.g. Support Bot"
                class="w-full px-3 py-[6px] rounded-[5px] bg-bg-input border border-border-subtle text-[13px] text-text-primary placeholder:text-text-placeholder focus:border-brand/40 focus:outline-none transition-colors"
                required
              />
            </div>

            <div>
              <label class="block text-[10px] font-medium uppercase tracking-wider text-text-tertiary mb-1.5" for="ch-token">Bot Token</label>
              <input
                id="ch-token"
                type="password"
                bind:value={formToken}
                placeholder="MTIzNDU2Nzg5MA.Gxxx.xxxxxxxxxxxxxx"
                class="w-full px-3 py-[6px] rounded-[5px] bg-bg-input border border-border-subtle text-[13px] text-text-primary placeholder:text-text-placeholder focus:border-brand/40 focus:outline-none font-mono transition-colors"
                required
              />
            </div>

            {#if submitError}
              <div class="rounded-md border border-error-soft/30 bg-error-bg p-3 text-[12px] font-mono text-error-soft break-all">{submitError}</div>
            {/if}

            <div class="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onclick={() => goto("/channels")}
                class="px-4 py-[6px] rounded-[5px] bg-bg-hover hover:bg-bg-hover-strong border border-border-subtle text-[12px] text-text-tertiary hover:text-text-secondary transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isSubmitting}
                class="px-4 py-[6px] rounded-[5px] bg-[#FF3E00] hover:bg-brand-hover text-[12px] text-white font-medium transition-colors disabled:opacity-50 cursor-pointer"
              >
                {#if isSubmitting}
                  <Loader2 class="w-3.5 h-3.5 animate-spin inline mr-1.5" />
                  Saving...
                {:else}
                  Save Channel
                {/if}
              </button>
            </div>
          </form>

        {:else if selectedProvider === "feishu"}
          <!-- Feishu Guide -->
          <div class="rounded-md border border-border-subtle bg-bg-surface overflow-hidden">
            <button
              type="button"
              onclick={() => feishuGuideOpen = !feishuGuideOpen}
              class="w-full flex items-center justify-between p-3 hover:bg-bg-hover transition-colors"
            >
              <span class="text-[12px] font-medium text-text-secondary flex items-center gap-2">
                <ExternalLink class="w-3.5 h-3.5" />
                How to create a Feishu App & get credentials
              </span>
              <ChevronDown class="w-4 h-4 text-text-placeholder transition-transform {feishuGuideOpen ? 'rotate-180' : ''}" />
            </button>
            {#if feishuGuideOpen}
              <div class="px-3 pb-3 text-[12px] text-text-tertiary space-y-2 border-t border-border-subtle">
                <ol class="list-decimal list-inside space-y-1.5 pt-2">
                  <li>Go to the <a href="https://open.feishu.cn/app" target="_blank" rel="noopener" class="text-brand hover:underline">Feishu Open Platform</a></li>
                  <li>Click <strong>Create App</strong> (创建应用) and choose <strong>Enterprise Self-built</strong> (企业自建)</li>
                  <li>In the app settings, go to <strong>Credentials & Basic Info</strong> (凭证与基础信息)</li>
                  <li>Copy the <strong>App ID</strong> and <strong>App Secret</strong></li>
                  <li>Enable required <strong>Bot</strong> capability in the app:
                    <ul class="list-disc list-inside ml-4 mt-1 text-text-placeholder">
                      <li>Go to <strong>Capabilities → Bot</strong> and enable it</li>
                    </ul>
                  </li>
                  <li>Configure <strong>Event Subscriptions</strong>:
                    <ul class="list-disc list-inside ml-4 mt-1 text-text-placeholder">
                      <li>Use <strong>Long Connection (WebSocket)</strong> mode — no webhook URL needed</li>
                      <li>Subscribe to <code class="px-1 py-0.5 bg-bg-code rounded text-[11px]">im.message.receive_v1</code></li>
                    </ul>
                  </li>
                  <li>Publish the app and get it approved by your org admin</li>
                </ol>
                <div class="mt-2 p-2 rounded bg-amber-500/10 border border-amber-500/20 text-amber-300">
                  <strong>Note:</strong> If using international Lark, select "Lark" brand below.
                </div>
              </div>
            {/if}
          </div>

          <form onsubmit={handleSubmit} class="space-y-3">
            <div>
              <label class="block text-[10px] font-medium uppercase tracking-wider text-text-tertiary mb-1.5" for="ch-name">Channel Name</label>
              <input
                id="ch-name"
                type="text"
                bind:value={formName}
                placeholder="e.g. Feishu Bot"
                class="w-full px-3 py-[6px] rounded-[5px] bg-bg-input border border-border-subtle text-[13px] text-text-primary placeholder:text-text-placeholder focus:border-brand/40 focus:outline-none transition-colors"
                required
              />
            </div>

            <div>
              <p id="channel-platform-label" class="block text-[10px] font-medium uppercase tracking-wider text-text-tertiary mb-1.5">Platform</p>
              <div class="flex gap-2" aria-labelledby="channel-platform-label">
                <button
                  type="button"
                  onclick={() => formBrand = "feishu"}
                  class="flex-1 px-3 py-[6px] rounded-[5px] border text-[13px] transition-colors cursor-pointer {
                    formBrand === 'feishu'
                      ? 'border-brand/40 bg-brand-bg text-text-primary'
                      : 'border-border-subtle bg-bg-code text-text-tertiary hover:border-border-primary'
                  }"
                >
                  飞书 Feishu
                </button>
                <button
                  type="button"
                  onclick={() => formBrand = "lark"}
                  class="flex-1 px-3 py-[6px] rounded-[5px] border text-[13px] transition-colors cursor-pointer {
                    formBrand === 'lark'
                      ? 'border-brand/40 bg-brand-bg text-text-primary'
                      : 'border-border-subtle bg-bg-code text-text-tertiary hover:border-border-primary'
                  }"
                >
                  Lark (International)
                </button>
              </div>
            </div>

            <div>
              <label class="block text-[10px] font-medium uppercase tracking-wider text-text-tertiary mb-1.5" for="ch-app-id">App ID</label>
              <div class="relative">
                <input
                  id="ch-app-id"
                  type="text"
                  bind:value={formAppId}
                  placeholder="cli_a5xxxxxxxxx"
                  class="w-full px-3 py-[6px] pr-10 rounded-[5px] bg-bg-input border border-border-subtle text-[13px] text-text-primary placeholder:text-text-placeholder focus:border-brand/40 focus:outline-none font-mono transition-colors"
                  required
                />
                <button
                  type="button"
                  onclick={() => copyToClipboard("cli_a5xxxxxxxxx", "appId")}
                  class="absolute right-2 top-1/2 -translate-y-1/2 text-text-placeholder hover:text-text-secondary transition-colors"
                  title="Copy format hint"
                >
                  {#if copiedField === "appId"}
                    <Check class="w-4 h-4 text-green-400" />
                  {:else}
                    <Copy class="w-4 h-4" />
                  {/if}
                </button>
              </div>
            </div>

            <div>
              <label class="block text-[10px] font-medium uppercase tracking-wider text-text-tertiary mb-1.5" for="ch-app-secret">App Secret</label>
              <input
                id="ch-app-secret"
                type="password"
                bind:value={formAppSecret}
                placeholder="Enter your App Secret..."
                class="w-full px-3 py-[6px] rounded-[5px] bg-bg-input border border-border-subtle text-[13px] text-text-primary placeholder:text-text-placeholder focus:border-brand/40 focus:outline-none font-mono transition-colors"
                required
              />
            </div>

            {#if submitError}
              <div class="rounded-md border border-error-soft/30 bg-error-bg p-3 text-[12px] font-mono text-error-soft break-all">{submitError}</div>
            {/if}

            <div class="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onclick={() => goto("/channels")}
                class="px-4 py-[6px] rounded-[5px] bg-bg-hover hover:bg-bg-hover-strong border border-border-subtle text-[12px] text-text-tertiary hover:text-text-secondary transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isSubmitting}
                class="px-4 py-[6px] rounded-[5px] bg-[#FF3E00] hover:bg-brand-hover text-[12px] text-white font-medium transition-colors disabled:opacity-50 cursor-pointer"
              >
                {#if isSubmitting}
                  <Loader2 class="w-3.5 h-3.5 animate-spin inline mr-1.5" />
                  Saving...
                {:else}
                  Save Channel
                {/if}
              </button>
            </div>
          </form>
        {/if}
      </div>
    {/if}
  </div>
</div>
