<script lang="ts">
import {
	ArrowLeft,
	Check,
	ChevronDown,
	Copy,
	Loader2,
	MessageCircle,
	MessageSquare,
	Webhook,
} from "lucide-svelte";
import { onDestroy } from "svelte";
import { goto } from "$app/navigation";
import { page } from "$app/state";
import { ensureAuth } from "$lib/auth";
import { handleUnauthorizedError } from "$lib/auth-redirect";
import { sdk } from "$lib/sdk";

const currentPath = $derived(page.url.pathname);
const currentSearch = $derived(page.url.search);

type Provider = "discord" | "feishu" | "wechat" | "web";
type Step = "select" | "form";

let selectedProvider = $state<Provider | null>(null);
let formName = $state("");
let formToken = $state("");
let formAppId = $state("");
let formAppSecret = $state("");
let formBrand = $state<"feishu" | "lark">("feishu");
let wechatQrDataUrl = $state("");
let wechatSessionKey = $state("");
let wechatStatus = $state("");
let wechatVerifyCode = $state("");
let wechatNeedsVerifyCode = $state(false);
let wechatExpiresAt = $state(0);
let wechatRemainingSeconds = $state(0);
let wechatTimer: ReturnType<typeof setInterval> | null = null;
let wechatPolling = $state(false);

let isSubmitting = $state(false);
let submitError = $state("");
let copiedField = $state<string | null>(null);

onDestroy(() => {
	wechatPolling = false;
	if (wechatTimer) {
		clearInterval(wechatTimer);
		wechatTimer = null;
	}
});

function formatWeChatCountdown(seconds: number) {
	const safe = Math.max(0, seconds);
	const minutes = Math.floor(safe / 60);
	const rest = safe % 60;
	return `${minutes}:${String(rest).padStart(2, "0")}`;
}

function syncWeChatCountdown() {
	if (!wechatExpiresAt) {
		wechatRemainingSeconds = 0;
		return;
	}
	wechatRemainingSeconds = Math.max(
		0,
		Math.ceil((wechatExpiresAt - Date.now()) / 1000),
	);
}

function startWeChatCountdown(expiresInSeconds: number) {
	wechatExpiresAt = Date.now() + expiresInSeconds * 1000;
	syncWeChatCountdown();
	if (wechatTimer) clearInterval(wechatTimer);
	wechatTimer = setInterval(() => {
		syncWeChatCountdown();
		if (wechatRemainingSeconds <= 0 && wechatTimer) {
			clearInterval(wechatTimer);
			wechatTimer = null;
		}
	}, 1000);
}

function stopWeChatPolling() {
	wechatPolling = false;
	if (wechatTimer) {
		clearInterval(wechatTimer);
		wechatTimer = null;
	}
}

function cancelToChannels() {
	stopWeChatPolling();
	void goto("/settings/channels");
}

function selectProvider(provider: Provider) {
	selectedProvider = provider;
	submitError = "";
}

function goBack() {
	selectedProvider = null;
	submitError = "";
	wechatQrDataUrl = "";
	wechatSessionKey = "";
	wechatStatus = "";
	wechatVerifyCode = "";
	wechatNeedsVerifyCode = false;
	wechatExpiresAt = 0;
	wechatRemainingSeconds = 0;
	stopWeChatPolling();
}

function copyToClipboard(text: string, field: string) {
	navigator.clipboard.writeText(text).then(() => {
		copiedField = field;
		setTimeout(() => {
			copiedField = null;
		}, 1500);
	});
}

async function pollWeChatLogin(sessionKey: string, verifyCode?: string) {
	wechatPolling = true;
	try {
		while (wechatPolling && selectedProvider === "wechat") {
			const result = await sdk.channels.waitWeChatLogin({
				sessionKey,
				verifyCode,
			});
			verifyCode = undefined;
			if (!wechatPolling || selectedProvider !== "wechat") return;
			wechatStatus = result.message;
			if (result.connected) {
				stopWeChatPolling();
				await goto("/settings/channels");
				return;
			}
			if (result.needVerifyCode) {
				wechatNeedsVerifyCode = true;
				wechatPolling = false;
				return;
			}
			if (result.expired) {
				stopWeChatPolling();
				wechatStatus = "QR code expired. Generate a new one.";
				return;
			}
			if (result.status === "confirming") {
				wechatStatus = "Finalizing connection...";
			}
			if (result.status === "scaned") wechatNeedsVerifyCode = false;
			await new Promise((resolve) => setTimeout(resolve, 1200));
		}
	} catch (error) {
		wechatPolling = false;
		submitError =
			error instanceof Error ? error.message : "Failed to connect WeChat";
	}
}

async function startWeChatLogin() {
	if (!formName.trim()) {
		submitError = "Channel name is required.";
		return;
	}
	if (!(await ensureAuth({ redirectPath: `${currentPath}${currentSearch}` })))
		return;

	isSubmitting = true;
	stopWeChatPolling();
	submitError = "";
	wechatStatus = "";
	try {
		const result = await sdk.channels.startWeChatLogin({
			name: formName.trim(),
		});
		wechatQrDataUrl = result.qrDataUrl;
		wechatSessionKey = result.sessionKey;
		wechatStatus = result.message;
		wechatVerifyCode = "";
		wechatNeedsVerifyCode = false;
		startWeChatCountdown(result.expiresInSeconds);
		void pollWeChatLogin(result.sessionKey);
	} catch (error) {
		if (
			await handleUnauthorizedError(error, `${currentPath}${currentSearch}`)
		) {
			return;
		}
		submitError =
			error instanceof Error ? error.message : "Failed to start WeChat login";
	} finally {
		isSubmitting = false;
	}
}

async function submitWeChatVerifyCode() {
	const code = wechatVerifyCode.trim();
	if (!wechatSessionKey || !code) {
		submitError = "Verification code is required.";
		return;
	}
	submitError = "";
	wechatNeedsVerifyCode = false;
	void pollWeChatLogin(wechatSessionKey, code);
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

	if (selectedProvider === "wechat") {
		await startWeChatLogin();
		return;
	}

	if (!(await ensureAuth({ redirectPath: `${currentPath}${currentSearch}` })))
		return;

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

		await sdk.channels.create({
			provider: selectedProvider,
			name: formName.trim(),
			credentials,
		});

		await goto("/settings/channels");
	} catch (error) {
		if (
			await handleUnauthorizedError(error, `${currentPath}${currentSearch}`)
		) {
			return;
		}
		submitError =
			error instanceof Error ? error.message : "Failed to create channel";
	} finally {
		isSubmitting = false;
	}
}
</script>

<svelte:head>
	<title>New channel — Cohub</title>
</svelte:head>

<div class="flex-1 flex flex-col min-h-0 overflow-y-auto">
  <!-- Header -->
  <div class="h-[40px] flex items-center px-4 border-b border-border-subtle shrink-0 bg-bg-primary">
    <div class="flex items-center gap-3 min-w-0">
      <a href="/settings/channels" class="text-text-tertiary hover:text-text-primary transition-colors shrink-0"
        onclick={(e) => { e.preventDefault(); cancelToChannels(); }}>
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
          class="w-full text-left rounded-md border border-border-subtle bg-bg-surface p-4 hover:border-provider-discord-border-hover hover:bg-provider-discord-bg-hover transition-all group focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand/50"
        >
          <div class="flex items-start gap-3">
            <div class="w-10 h-10 rounded-[7px] bg-provider-discord-bg border border-provider-discord-border flex items-center justify-center shrink-0">
              <MessageSquare class="w-5 h-5 text-provider-discord" />
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
          class="w-full text-left rounded-md border border-border-subtle bg-bg-surface p-4 hover:border-provider-feishu-border-hover hover:bg-provider-feishu-bg-hover transition-all group focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand/50"
        >
          <div class="flex items-start gap-3">
            <div class="w-10 h-10 rounded-[7px] bg-provider-feishu-bg border border-provider-feishu-border flex items-center justify-center shrink-0">
              <Webhook class="w-5 h-5 text-provider-feishu" />
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

        <!-- WeChat Card -->
        <button
          type="button"
          onclick={() => selectProvider("wechat")}
          class="w-full text-left rounded-md border border-border-subtle bg-bg-surface p-4 hover:border-provider-wechat-border-hover hover:bg-provider-wechat-bg-hover transition-all group focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand/50"
        >
          <div class="flex items-start gap-3">
            <div class="w-10 h-10 rounded-[7px] bg-provider-wechat-bg border border-provider-wechat-border flex items-center justify-center shrink-0">
              <MessageCircle class="w-5 h-5 text-provider-wechat" />
            </div>
            <div class="flex-1 min-w-0">
              <div class="text-[14px] font-medium text-text-primary group-hover:text-text-primary">WeChat</div>
              <p class="text-[12px] text-text-tertiary mt-0.5">Connect by scanning a QR code with WeChat. Supports direct text conversations.</p>
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
          <button type="button" onclick={goBack} class="text-text-tertiary hover:text-text-secondary transition-colors text-[12px] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand/50">
            ← Back
          </button>
        </div>

        {#if selectedProvider === "discord"}
          <div class="space-y-2">
            <div>
              <div class="text-[10px] uppercase tracking-wider text-text-placeholder font-medium">Discord Binding</div>
              <p class="text-[13px] text-text-tertiary mt-1">Create or select a Discord bot, paste its token, then save the channel.</p>
            </div>
            <ol class="grid gap-1.5 text-[12px] text-text-tertiary sm:grid-cols-3">
              <li class="flex items-center gap-2">
                <span class="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-border-subtle bg-bg-surface text-[10px] text-text-secondary">1</span>
                Create a Discord bot
              </li>
              <li class="flex items-center gap-2">
                <span class="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-border-subtle bg-bg-surface text-[10px] text-text-secondary">2</span>
                Copy the bot token
              </li>
              <li class="flex items-center gap-2">
                <span class="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-border-subtle bg-bg-surface text-[10px] text-text-secondary">3</span>
                Save the channel
              </li>
            </ol>
            <div class="space-y-1.5 text-[12px] text-text-tertiary">
              <p>Go to the <a href="https://discord.com/developers/applications" target="_blank" rel="noopener" class="text-brand hover:underline">Discord Developer Portal</a>, create or select an application, then open the Bot page.</p>
              <p>Reset and copy the bot token. Enable Message Content Intent, then invite the bot with the OAuth2 bot scope.</p>
            </div>
          </div>

          <form onsubmit={handleSubmit} class="space-y-4">
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
                onclick={cancelToChannels}
                class="px-4 py-[6px] rounded-[5px] bg-bg-hover hover:bg-bg-hover-strong border border-border-subtle text-[12px] text-text-tertiary hover:text-text-secondary transition-colors cursor-pointer focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand/50"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isSubmitting}
                class="inline-flex min-h-8 items-center justify-center gap-1.5 px-4 py-[6px] rounded-[5px] bg-brand hover:bg-brand-hover active:bg-brand-hover text-[12px] text-brand-contrast-fg font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 cursor-pointer focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand/50"
              >
                {#if isSubmitting}
                  <Loader2 class="w-3.5 h-3.5 animate-spin" />
                  Saving channel
                {:else}
                  Save Channel
                {/if}
              </button>
            </div>
          </form>

        {:else if selectedProvider === "wechat"}
          <form onsubmit={handleSubmit} class="space-y-4">
            <div class="space-y-2">
              <div>
                <div class="text-[10px] uppercase tracking-wider text-text-placeholder font-medium">WeChat Binding</div>
                <p class="text-[13px] text-text-tertiary mt-1">Start a binding session, open the scan page, then confirm in WeChat.</p>
              </div>
              <ol class="grid gap-1.5 text-[12px] text-text-tertiary sm:grid-cols-3">
                <li class="flex items-center gap-2">
                  <span class="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-border-subtle bg-bg-surface text-[10px] text-text-secondary">1</span>
                  Enter Channel Name and start binding
                </li>
                <li class="flex items-center gap-2">
                  <span class="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-border-subtle bg-bg-surface text-[10px] text-text-secondary">2</span>
                  Open the scan page and scan with WeChat
                </li>
                <li class="flex items-center gap-2">
                  <span class="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-border-subtle bg-bg-surface text-[10px] text-text-secondary">3</span>
                  Scan and confirm
                </li>
              </ol>
            </div>

            <div>
              <label class="block text-[10px] font-medium uppercase tracking-wider text-text-tertiary mb-1.5" for="ch-name">Channel Name</label>
              <input
                id="ch-name"
                type="text"
                bind:value={formName}
                placeholder="e.g. Personal WeChat"
                class="w-full px-3 py-[6px] rounded-[5px] bg-bg-input border border-border-subtle text-[13px] text-text-primary placeholder:text-text-placeholder focus:border-brand/40 focus:outline-none transition-colors"
                required
              />
              <p class="mt-1.5 text-[11px] text-text-placeholder">Shown in Cohub to help you identify this channel.</p>
            </div>

            {#if wechatNeedsVerifyCode}
              <div class="space-y-2 rounded-md border border-border-subtle bg-bg-surface p-3">
                <p class="text-[12px] text-text-tertiary">Enter the verification code shown in WeChat.</p>
                <div class="flex gap-2">
                  <input
                    type="text"
                    bind:value={wechatVerifyCode}
                    placeholder="6-digit code"
                    class="min-w-0 flex-1 px-3 py-[6px] rounded-[5px] bg-bg-input border border-border-subtle text-[13px] text-text-primary placeholder:text-text-placeholder focus:border-brand/40 focus:outline-none font-mono transition-colors"
                  />
                  <button
                    type="button"
                    onclick={submitWeChatVerifyCode}
                    class="inline-flex min-h-8 items-center justify-center rounded-[5px] bg-brand px-4 py-[6px] text-[12px] font-medium text-brand-contrast-fg transition-colors hover:bg-brand-hover active:bg-brand-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand/50"
                  >
                    Continue
                  </button>
                </div>
              </div>
            {/if}

            {#if submitError}
              <div class="rounded-md border border-error-soft/30 bg-error-bg p-3 text-[12px] font-mono text-error-soft break-all">{submitError}</div>
            {/if}

            <div class="flex items-end justify-end gap-2 pt-2">
              <button
                type="button"
                onclick={cancelToChannels}
                class="px-4 py-[6px] rounded-[5px] bg-bg-hover hover:bg-bg-hover-strong border border-border-subtle text-[12px] text-text-tertiary hover:text-text-secondary transition-colors cursor-pointer focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand/50"
              >
                Cancel
              </button>
              {#if wechatQrDataUrl}
                <div class="flex flex-col items-end gap-1">
                  <p class="text-[11px] font-medium text-text-secondary">
                    {wechatRemainingSeconds > 0 ? `Expires in ${formatWeChatCountdown(wechatRemainingSeconds)}` : "Scan page expired"}
                  </p>
                  <a
                    href={wechatQrDataUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    class="inline-flex min-h-8 items-center justify-center rounded-[5px] bg-brand px-4 py-[6px] text-[12px] font-medium text-brand-contrast-fg transition-colors hover:bg-brand-hover active:bg-brand-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand/50"
                  >
                    Open scan page to bind
                  </a>
                </div>
              {:else if !wechatNeedsVerifyCode}
                <button
                  type="button"
                  onclick={startWeChatLogin}
                  disabled={isSubmitting || wechatPolling}
                  class="inline-flex min-h-8 items-center justify-center gap-1.5 px-4 py-[6px] rounded-[5px] border border-brand-border bg-brand-muted text-[12px] text-brand font-medium transition-colors hover:bg-brand-muted-hover disabled:cursor-not-allowed disabled:opacity-50 cursor-pointer focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand/50"
                >
                  {#if isSubmitting || wechatPolling}
                    <Loader2 class="w-3.5 h-3.5 animate-spin" />
                    Starting binding
                  {:else}
                    Start WeChat binding
                  {/if}
                </button>
              {/if}
            </div>
          </form>

        {:else if selectedProvider === "feishu"}
          <div class="space-y-2">
            <div>
              <div class="text-[10px] uppercase tracking-wider text-text-placeholder font-medium">Feishu / Lark Binding</div>
              <p class="text-[13px] text-text-tertiary mt-1">Create a platform app, copy its credentials, then save the channel.</p>
            </div>
            <ol class="grid gap-1.5 text-[12px] text-text-tertiary sm:grid-cols-3">
              <li class="flex items-center gap-2">
                <span class="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-border-subtle bg-bg-surface text-[10px] text-text-secondary">1</span>
                Create a platform app
              </li>
              <li class="flex items-center gap-2">
                <span class="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-border-subtle bg-bg-surface text-[10px] text-text-secondary">2</span>
                Copy App ID and Secret
              </li>
              <li class="flex items-center gap-2">
                <span class="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-border-subtle bg-bg-surface text-[10px] text-text-secondary">3</span>
                Save the channel
              </li>
            </ol>
            <div class="space-y-1.5 text-[12px] text-text-tertiary">
              <p>Go to the <a href="https://open.feishu.cn/app" target="_blank" rel="noopener" class="text-brand hover:underline">Feishu Open Platform</a>, create an Enterprise Self-built app, then open Credentials & Basic Info.</p>
              <p>Copy the App ID and App Secret. Enable Bot capability, use Long Connection event subscriptions, then publish the app.</p>
              <p class="text-warning">If using international Lark, select Lark below.</p>
            </div>
          </div>

          <form onsubmit={handleSubmit} class="space-y-4">
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
                  class="flex-1 px-3 py-[6px] rounded-[5px] border text-[13px] transition-colors cursor-pointer focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand/50 {
                    formBrand === 'feishu'
                      ? 'border-brand/40 bg-brand-bg text-text-primary'
                      : 'border-border-subtle bg-bg-code text-text-tertiary hover:border-border-primary'
                  }"
                >
                  Feishu
                </button>
                <button
                  type="button"
                  onclick={() => formBrand = "lark"}
                  class="flex-1 px-3 py-[6px] rounded-[5px] border text-[13px] transition-colors cursor-pointer focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand/50 {
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
                  class="absolute right-2 top-1/2 -translate-y-1/2 text-text-placeholder hover:text-text-secondary transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand/50"
                  title="Copy format hint"
                >
                  {#if copiedField === "appId"}
                    <Check class="w-4 h-4 text-success" />
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
                onclick={cancelToChannels}
                class="px-4 py-[6px] rounded-[5px] bg-bg-hover hover:bg-bg-hover-strong border border-border-subtle text-[12px] text-text-tertiary hover:text-text-secondary transition-colors cursor-pointer focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand/50"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isSubmitting}
                class="inline-flex min-h-8 items-center justify-center gap-1.5 px-4 py-[6px] rounded-[5px] bg-brand hover:bg-brand-hover active:bg-brand-hover text-[12px] text-brand-contrast-fg font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 cursor-pointer focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand/50"
              >
                {#if isSubmitting}
                  <Loader2 class="w-3.5 h-3.5 animate-spin" />
                  Saving channel
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
