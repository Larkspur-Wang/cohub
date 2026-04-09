<script lang="ts">
import { logtoClient } from "$lib/auth";
import { onMount } from "svelte";

let error = $state("");

onMount(async () => {
	try {
		// Exchange the authorization code from the URL for tokens.
		await logtoClient.handleSignInCallback(window.location.href);
		// Full page redirect to ensure all components, styles, and state are freshly initialized
		window.location.replace("/");
	} catch (err) {
		error = err instanceof Error ? err.message : "Authentication failed";
	}
});
</script>

<div class="flex-1 flex items-center justify-center">
  {#if error}
    <div class="text-center">
      <p class="text-sm text-rose-400">{error}</p>
      <a href="/" class="mt-4 inline-block text-xs text-text-tertiary hover:text-text-secondary underline">Back to home</a>
    </div>
  {:else}
    <div class="flex flex-col items-center gap-3 text-text-tertiary">
      <div class="w-8 h-8 rounded-full border-2 border-white/15 border-t-emerald-400 animate-spin"></div>
      <p class="text-xs font-mono">Authenticating...</p>
    </div>
  {/if}
</div>
