<script lang="ts">
  import { mockAgents } from '$lib/mock';
  import { fade } from 'svelte/transition';
</script>

<div class="max-w-7xl mx-auto px-6 py-12">
  <div class="flex items-baseline justify-between mb-10">
    <div>
      <h1 class="text-4xl font-bold tracking-tight text-brand">My Personas</h1>
      <p class="mt-2 text-gray-500">The souls you've forged across reality.</p>
    </div>
    <div class="text-sm font-medium text-gray-400">Total: {mockAgents.length}</div>
  </div>

  <div class="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-4 gap-6">
    {#each mockAgents as agent}
      <a href="/agents/{agent.id}" class="group block bg-white border border-gray-100 rounded-2xl p-6 shadow-sm hover:shadow-xl hover:-translate-y-1 transition-all duration-300">
        <div class="w-24 h-24 mx-auto rounded-3xl overflow-hidden border-4 border-white shadow-lg bg-gray-50 mb-6 group-hover:scale-110 group-hover:rotate-3 transition-transform">
          <img src={agent.avatar} alt={agent.name} class="w-full h-full object-cover" />
        </div>
        
        <div class="text-center">
          <h2 class="text-xl font-bold mb-1 text-gray-800 group-hover:text-brand transition-colors">{agent.name}</h2>
          <div class="text-[10px] uppercase tracking-widest font-black text-brand mb-4 opacity-60 italic">{agent.personality}</div>
          <p class="text-xs text-gray-400 line-clamp-2 leading-relaxed h-8">{agent.description}</p>
        </div>

        <div class="mt-8 pt-6 border-t border-gray-50 flex items-center justify-between">
            <span class="text-[10px] font-black uppercase text-gray-300">Identity-00{agent.id.slice(-1)}</span>
            <div class="flex gap-1">
                <span class="w-1.5 h-1.5 rounded-full bg-brand"></span>
                <span class="w-1.5 h-1.5 rounded-full bg-brand/30"></span>
            </div>
        </div>
      </a>
    {/each}

    <!-- Create Card -->
    <button class="border-2 border-dashed border-gray-200 rounded-2xl flex flex-col items-center justify-center p-8 text-gray-300 hover:border-brand hover:text-brand/40 transition-all cursor-not-allowed group">
      <div class="w-10 h-10 rounded-full bg-gray-50 flex items-center justify-center mb-4">
        <svg xmlns="http://www.w3.org/2000/svg" class="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4" />
        </svg>
      </div>
      <span class="font-bold text-sm">Forge Persona</span>
      <span class="text-[10px] uppercase mt-1 opacity-50 font-black">Coming Soon</span>
    </button>
  </div>
</div>
