<script lang="ts">
import { goto } from "$app/navigation";
import { fade } from "svelte/transition";
import { setAuthToken } from "$lib/api";

let inputToken = $state("");
let isSubmitting = $state(false);
let errorMessage = $state("");

async function handleLogin() {
  if (!inputToken.trim() || isSubmitting) return;
  isSubmitting = true;
  errorMessage = "";

  try {
    await setAuthToken(inputToken.trim());
    await goto("/");
  } catch (error) {
    errorMessage = error instanceof Error ? error.message : "Login failed";
  } finally {
    isSubmitting = false;
  }
}
</script>

<div class="min-h-screen flex items-center justify-center px-5 py-10 bg-[#FFF9F0]">
  <div class="w-full max-w-md neo-card p-6 md:p-8 bg-white" transition:fade>
    <div class="mb-8 text-center">
      <div class="inline-flex items-center justify-center w-14 h-14 rounded-2xl border-[4px] border-black bg-[#FF5A5F] text-white font-black text-2xl shadow-[5px_5px_0_0_#000]">
        C
      </div>
      <h1 class="mt-5 text-4xl font-black tracking-tighter uppercase">Access Cohub</h1>
      <p class="mt-3 text-sm font-bold text-black/60">Enter your Neta token to continue.</p>
    </div>

    <form onsubmit={(e) => { e.preventDefault(); handleLogin(); }} class="space-y-4">
      <div>
        <label for="token" class="neo-meta mb-2 block">Neta Token</label>
        <input type="password" id="token" bind:value={inputToken} placeholder="ey..." class="neo-input font-mono" required />
      </div>

      <button
        type="submit"
        disabled={isSubmitting || !inputToken.trim()}
        class="neo-btn neo-btn-primary w-full disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:translate-x-0 disabled:hover:translate-y-0 disabled:hover:shadow-[4px_4px_0_0_#000]"
      >
        {isSubmitting ? "Validating..." : "Enter Cohub"}
      </button>
    </form>

    {#if errorMessage}
      <div class="mt-4 neo-card-sm neo-fill-red p-4 text-white text-sm font-bold break-all">
        {errorMessage}
      </div>
    {/if}

    <div class="mt-6 pt-5 border-t-[3px] border-black text-center text-xs font-bold text-black/60">
      Need a token? <a href="https://cohub.run" class="text-black underline decoration-[3px] underline-offset-4">Visit Hub</a>
    </div>
  </div>
</div>
