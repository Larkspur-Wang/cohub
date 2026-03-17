<script lang="ts">
  import { page } from '$app/state';
  import { mockWorlds, mockAgents } from '$lib/mock';
  import { fade, slide } from 'svelte/transition';

  const id = page.params.id;
  const world = mockWorlds.find(w => w.id === id);

  let showModal = $state(false);
  let selectedAgentId = $state<string | null>(null);

  function openSelection() {
    showModal = true;
  }

  function handleStart() {
    if (!selectedAgentId) return;
    alert(`Starting session with World: ${world?.name}, Agent: ${selectedAgentId}\n(API implementation coming next step)`);
    // window.location.href = `/sessions/mock-session-id`;
  }
</script>

{#if world}
<div class="max-w-7xl mx-auto px-6 py-12 flex flex-col lg:flex-row gap-12">
  <!-- Left Side: World Visual & Info -->
  <div class="flex-1">
    <div class="relative rounded-3xl overflow-hidden shadow-2xl group border-4 border-white aspect-video lg:aspect-square">
      <img src={world.image} alt={world.name} class="w-full h-full object-cover transition-transform duration-700 group-hover:scale-105" />
      <div class="absolute inset-0 bg-gradient-to-t from-black/60 via-black/20 to-transparent"></div>
      <div class="absolute bottom-10 left-10 right-10">
        <h1 class="text-5xl font-black text-white leading-tight drop-shadow-lg">{world.name}</h1>
      </div>
    </div>
  </div>

  <!-- Right Side: Interaction -->
  <div class="flex-1 flex flex-col justify-center">
    <div class="p-8 bg-white border border-gray-100 rounded-3xl shadow-sm relative overflow-hidden">
      <!-- Fun Background Detail -->
      <div class="absolute top-0 right-0 w-32 h-32 bg-brand/5 rounded-bl-full -mr-10 -mt-10"></div>
      
      <div class="mb-10">
        <div class="text-xs uppercase font-black text-brand tracking-widest mb-4 flex items-center gap-2">
          <span class="w-2 h-2 rounded-full bg-brand animate-pulse"></span>
          Realm Core Setting
        </div>
        <p class="text-lg leading-relaxed text-gray-700 font-serif italic">
          "{world.description}"
        </p>
      </div>

      <div class="space-y-4">
        <button 
          onclick={openSelection}
          class="w-full bg-brand text-white text-lg font-bold py-5 rounded-2xl shadow-lg shadow-brand/20 hover:shadow-brand/40 hover:-translate-y-1 active:translate-y-0 transition-all cursor-pointer flex items-center justify-center gap-3 group"
        >
          <span>Start Session</span>
          <svg xmlns="http://www.w3.org/2000/svg" class="w-6 h-6 group-hover:translate-x-1 transition-transform" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 5l7 7-7 7M5 5l7 7-7 7" />
          </svg>
        </button>
        <p class="text-center text-sm text-gray-400">Takes your agent into the void.</p>
      </div>
    </div>
  </div>
</div>

<!-- Modal: Choose Agent -->
{#if showModal}
<div 
  transition:fade={{ duration: 200 }} 
  class="fixed inset-0 z-50 flex items-center justify-center p-6 bg-black/60 backdrop-blur-sm"
>
  <div 
    transition:slide={{ duration: 300, axis: 'y' }}
    class="bg-white w-full max-w-lg rounded-3xl shadow-2xl overflow-hidden p-8 border border-white"
  >
    <div class="flex justify-between items-center mb-6">
      <h2 class="text-2xl font-black tracking-tight text-gray-800">Who shall enter?</h2>
      <button onclick={() => showModal = false} class="text-gray-400 hover:text-gray-600 transition-colors p-2 cursor-pointer">
        <svg xmlns="http://www.w3.org/2000/svg" class="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
    </div>

    <div class="grid grid-cols-1 gap-4 mb-8">
      {#each mockAgents as agent}
        <button 
          onclick={() => selectedAgentId = agent.id}
          class="flex items-center gap-5 p-4 rounded-2xl border-2 transition-all group {selectedAgentId === agent.id ? 'border-brand bg-brand/5 shadow-inner' : 'border-gray-100 hover:border-brand/30 hover:bg-gray-50'}"
        >
          <div class="w-16 h-16 rounded-full overflow-hidden border-2 border-white shadow-sm transition-transform group-hover:scale-110 {selectedAgentId === agent.id ? 'border-brand/40' : ''}">
            <img src={agent.avatar} alt={agent.name} class="w-full h-full object-cover" />
          </div>
          <div class="text-left flex-1">
            <div class="font-black text-lg {selectedAgentId === agent.id ? 'text-brand' : 'text-gray-700'}">{agent.name}</div>
            <div class="text-sm text-gray-400 line-clamp-1">{agent.description}</div>
          </div>
          {#if selectedAgentId === agent.id}
            <div class="text-brand pr-2">
              <svg xmlns="http://www.w3.org/2000/svg" class="w-6 h-6" viewBox="0 0 20 20" fill="currentColor">
                <path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clip-rule="evenodd" />
              </svg>
            </div>
          {/if}
        </button>
      {/each}
    </div>

    <div class="flex gap-4">
      <button 
        onclick={() => showModal = false}
        class="flex-1 py-4 text-gray-500 font-bold hover:text-gray-700 transition-colors cursor-pointer"
      >
        Wait, I'm not ready
      </button>
      <button 
        onclick={handleStart}
        disabled={!selectedAgentId}
        class="flex-[1.5] py-4 bg-brand text-white font-bold rounded-xl shadow-lg hover:shadow-brand/30 disabled:opacity-30 disabled:cursor-not-allowed transition-all cursor-pointer"
      >
        Confirm Session
      </button>
    </div>
  </div>
</div>
{/if}

{:else}
<div class="h-[60vh] flex flex-col items-center justify-center text-gray-400 font-black text-4xl italic">
  World Disintegrated...
  <a href="/worlds" class="mt-8 text-brand text-lg font-bold underline not-italic">Go Back Home</a>
</div>
{/if}
