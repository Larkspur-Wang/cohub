<script lang="ts">
import { onMount } from "svelte";
import { logtoClient } from "$lib/auth";
import CenteredLoading from "$lib/components/CenteredLoading.svelte";

let error = $state("");

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
		error = err instanceof Error ? err.message : "Authentication failed";
	}
});
</script>

<svelte:head>
	<title>Authenticating — Cohub</title>
</svelte:head>

<div class="flex-1 flex items-center justify-center min-h-100dvh">
  {#if error}
    <div class="text-center">
      <p class="text-sm text-error-soft">{error}</p>
      <a href="/" class="mt-4 inline-block text-xs text-text-tertiary hover:text-text-secondary underline">Back to home</a>
    </div>
  {:else}
    <CenteredLoading label="Authenticating…" size="page" />
  {/if}
</div>
