<script lang="ts">
  import { mockWorlds } from '$lib/mock';
</script>

<div class="max-w-7xl mx-auto px-6 py-12">
  <div class="flex items-baseline justify-between mb-10">
    <div>
      <h1 class="text-4xl font-bold tracking-tight text-brand">Explore Worlds</h1>
      <p class="mt-2 text-gray-500">Pick a world to start your journey.</p>
    </div>
    <div class="text-sm font-medium text-gray-400">Total Worlds: {mockWorlds.length}</div>
  </div>

  <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
    {#each mockWorlds as world}
      <a href="/worlds/{world.id}" class="group block bg-white border border-gray-100 rounded-2xl overflow-hidden shadow-sm hover:shadow-xl hover:-translate-y-1 transition-all duration-300">
        <div class="aspect-video relative overflow-hidden">
          <img src={world.image} alt={world.name} class="object-cover w-full h-full group-hover:scale-105 transition-transform duration-700" />
          <div class="absolute inset-0 bg-gradient-to-t from-black/40 to-transparent"></div>
        </div>
        <div class="p-6">
          <h2 class="text-xl font-bold mb-2 group-hover:text-brand transition-colors">{world.name}</h2>
          <p class="text-sm text-gray-600 line-clamp-2 leading-relaxed">{world.description}</p>
        </div>
      </a>
    {/each}

    <!-- Empty/Create Card -->
    <button class="border-2 border-dashed border-gray-200 rounded-2xl flex flex-col items-center justify-center p-12 text-gray-400 hover:border-brand hover:text-brand transition-all cursor-not-allowed group">
      <div class="w-12 h-12 rounded-full bg-gray-50 flex items-center justify-center mb-4 group-hover:bg-brand/5">
        <svg xmlns="http://www.w3.org/2000/svg" class="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4" />
        </svg>
      </div>
      <span class="font-medium text-sm">Create New World</span>
      <span class="text-xs text-gray-400 mt-1 italic">(Coming Soon)</span>
    </button>
  </div>
</div>
