<script lang="ts">
import { onMount } from "svelte";
import { logtoClient } from "$lib/auth";

let _error = $state("");

onMount(async () => {
	try {
		const stateParams = new URLSearchParams(
			new URLSearchParams(window.location.search).get("state") ?? "",
		);
		const redirectPath = stateParams.get("redirect_path") ?? "/";

		// Exchange the authorization code from the URL for tokens.
		await logtoClient.handleSignInCallback(window.location.href);
		// Full page redirect to ensure all components, styles, and state are freshly initialized

		const redirectUri = new URL(redirectPath, window.location.origin);
		if (redirectUri.origin !== window.location.origin) {
			window.location.replace("/");
			return;
		}
		window.location.replace(redirectUri.toString());
	} catch (err) {
		_error = err instanceof Error ? err.message : "Authentication failed";
	}
});
</script>

<div class="flex-1 flex items-center justify-center min-h-100dvh">
  {#if error}
    <div class="text-center">
      <p class="text-sm text-error-soft">{error}</p>
      <a href="/" class="mt-4 inline-block text-xs text-text-tertiary hover:text-text-secondary underline">Back to home</a>
    </div>
  {:else}
    <div class="flex flex-col items-center gap-3 text-text-tertiary">
      <div class="w-8 h-8 rounded-full border-2 border-border-subtle border-t-brand animate-spin"></div>
      <p class="text-xs font-mono">Authenticating...</p>
    </div>
  {/if}
</div>
