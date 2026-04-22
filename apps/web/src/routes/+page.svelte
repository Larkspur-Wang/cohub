<script lang="ts">
import { Loader2, LogIn, Terminal } from "lucide-svelte";
import { onMount } from "svelte";
import { goto } from "$app/navigation";
import { logtoClient } from "$lib/auth";
import { sdk } from "$lib/sdk";

let isLoading = $state(true);
let spaceCount = $state(0);

async function handleSignIn() {
	try {
		await logtoClient.signIn({
			redirectUri: `${window.location.origin}/callback`,
		});
	} catch (error) {
		console.error("[home] Sign in failed:", error);
	}
}

onMount(async () => {
	const authenticated = await logtoClient.isAuthenticated();
	if (!authenticated) {
		isLoading = false;
		return;
	}
	try {
		const spaces = await sdk.spaces.list();
		spaceCount = spaces.length;
		if (spaces.length > 0) {
			const firstSpace = spaces[0];
			await goto(`/spaces/${firstSpace.id}`);
			return;
		}
	} catch {
		// ignore
	} finally {
		isLoading = false;
	}
});
</script>

<div class="flex-1 flex flex-col min-h-0 overflow-y-auto">
  <div class="flex-1 flex flex-col items-center justify-center p-6 text-center">
    {#if isLoading}
      <div class="flex items-center gap-2 text-text-tertiary">
        <Loader2 class="w-5 h-5 animate-spin" />
        <span class="text-[13px]">Loading...</span>
      </div>
    {:else if spaceCount > 0}
      <div class="flex items-center gap-2 text-text-tertiary">
        <Loader2 class="w-5 h-5 animate-spin" />
        <span class="text-[13px]">Redirecting...</span>
      </div>
    {:else}
      <!-- Brand -->
      <div class="w-14 h-14 bg-[#FF3E00] rounded-[10px] flex items-center justify-center font-bold text-2xl text-white mb-5">
        C
      </div>

      <h1 class="text-[18px] font-semibold text-text-primary tracking-tight">
        Welcome to Cohub
      </h1>
      <p class="mt-1.5 text-[13px] text-text-tertiary max-w-sm leading-relaxed">
        Sign in to manage your spaces, agents, and workflows.
      </p>

      <!-- CTA Buttons -->
      <div class="mt-6 flex flex-col sm:flex-row items-center gap-3">
        <button
          type="button"
          onclick={handleSignIn}
          class="inline-flex items-center gap-2 px-5 py-2 rounded-[6px] bg-[#FF3E00] text-[13px] text-white font-medium hover:bg-[#FF3E00]/90 transition-colors shadow-sm"
        >
          <LogIn class="w-[14px] h-[14px]" />
          Sign In
        </button>
        <a
          href="/spaces/new"
          class="inline-flex items-center gap-2 px-4 py-2 rounded-[6px] bg-[#FF3E00]/10 border border-[#FF3E00]/20 text-[13px] text-brand font-medium hover:bg-[#FF3E00]/15 transition-colors"
        >
          <Terminal class="w-[14px] h-[14px]" />
          Create a Space
        </a>
      </div>

      <!-- Info Cards -->
      <div class="mt-10 w-full max-w-md grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div class="rounded-[6px] border border-border-subtle bg-bg-content px-3 py-3 text-left">
          <p class="text-[12px] font-medium text-text-primary">Spaces</p>
          <p class="text-[11px] text-text-tertiary mt-1 leading-relaxed">Isolated environments for your agents and files</p>
        </div>
        <div class="rounded-[6px] border border-border-subtle bg-bg-content px-3 py-3 text-left">
          <p class="text-[12px] font-medium text-text-primary">Chats</p>
          <p class="text-[11px] text-text-tertiary mt-1 leading-relaxed">Conversation threads within each space</p>
        </div>
        <div class="rounded-[6px] border border-border-subtle bg-bg-content px-3 py-3 text-left">
          <p class="text-[12px] font-medium text-text-primary">Sandboxes</p>
          <p class="text-[11px] text-text-tertiary mt-1 leading-relaxed">Cloud execution with full file access</p>
        </div>
      </div>
    {/if}
  </div>
</div>
