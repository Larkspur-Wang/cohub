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

<div class="min-h-[80vh] flex items-center justify-center px-6">
  <div class="w-full max-w-md bg-white p-10 rounded-3xl border-4 border-white shadow-2xl relative overflow-hidden" transition:fade>
    <!-- Fun background element -->
    <div class="absolute -top-10 -right-10 w-40 h-40 bg-brand/10 rounded-full blur-3xl"></div>
    
    <div class="text-center mb-10">
      <div class="inline-block px-3 py-1 bg-brand text-white text-[10px] font-black uppercase tracking-[0.2em] rounded-full mb-4">
        Authentication
      </div>
      <h1 class="text-4xl font-black text-gray-800 tracking-tight">Access Studio</h1>
      <p class="mt-3 text-gray-400 font-medium">Please enter your Neta Token to continue.</p>
    </div>

    <form onsubmit={(e) => { e.preventDefault(); handleLogin(); }} class="space-y-6">
      <div class="space-y-2">
        <label for="token" class="block text-sm font-bold text-gray-700 ml-1">Neta Token</label>
        <div class="relative group">
          <input 
            type="password" 
            id="token"
            bind:value={inputToken}
            placeholder="ey..."
            class="w-full px-5 py-4 bg-gray-50 border-2 border-gray-100 rounded-2xl focus:border-brand focus:bg-white outline-none transition-all placeholder:text-gray-300 font-mono text-sm group-hover:border-gray-200"
            required
          />
          <div class="absolute inset-y-0 right-4 flex items-center pointer-events-none text-gray-300">
            <svg xmlns="http://www.w3.org/2000/svg" class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
            </svg>
          </div>
        </div>
      </div>

      <button 
        type="submit"
        disabled={isSubmitting || !inputToken.trim()}
        class="w-full py-5 bg-brand text-white font-black text-lg rounded-2xl shadow-xl shadow-brand/30 hover:shadow-brand/50 hover:-translate-y-1 active:translate-y-0 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:translate-y-0 transition-all cursor-pointer flex items-center justify-center gap-2 group"
      >
        {#if isSubmitting}
          <svg class="animate-spin h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
            <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
            <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
          </svg>
          <span>Validating...</span>
        {:else}
          <span>Enter the Studio</span>
          <svg xmlns="http://www.w3.org/2000/svg" class="w-5 h-5 group-hover:translate-x-1 transition-transform" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M14 5l7 7m0 0l-7 7m7-7H3" />
          </svg>
        {/if}
      </button>
    </form>
    
    <div class="mt-8 pt-8 border-t border-gray-100 flex flex-col items-center justify-center gap-3">
      {#if errorMessage}
        <div class="w-full rounded-2xl bg-red-50 border border-red-100 px-4 py-3 text-sm text-red-700 text-left">
          {errorMessage}
        </div>
      {/if}
      <span class="text-xs text-gray-400 font-medium">Don't have a token? <a href="https://cohub.run" class="text-brand font-bold underline">Visit Hub</a></span>
    </div>
  </div>
</div>
