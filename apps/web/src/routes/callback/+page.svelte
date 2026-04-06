<script lang="ts">
import { onMount } from "svelte";
import { goto } from "$app/navigation";
import { logtoClient } from "$lib/auth";

let error = $state("");

onMount(async () => {
  try {
    // Logto handles the callback automatically via redirect.
    // Just check if we're authenticated now and redirect.
    const isAuth = await logtoClient.isAuthenticated();
    if (isAuth) {
      goto("/");
    }
  } catch (err) {
    error = err instanceof Error ? err.message : "Authentication failed";
  }
});
</script>

<div class="flex-1 flex items-center justify-center">
  {#if error}
    <div class="text-center">
      <p class="text-sm text-rose-400">{error}</p>
      <a href="/" class="mt-4 inline-block text-xs text-white/50 hover:text-white/80 underline">Back to home</a>
    </div>
  {:else}
    <div class="flex flex-col items-center gap-3 text-white/35">
      <div class="w-8 h-8 rounded-full border-2 border-white/15 border-t-emerald-400 animate-spin"></div>
      <p class="text-xs font-mono">Authenticating...</p>
    </div>
  {/if}
</div>
