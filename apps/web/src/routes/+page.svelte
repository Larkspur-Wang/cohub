<script lang="ts">
import { mockWorkspaces } from "$lib/mock";
import { fade, fly } from "svelte/transition";

// Hero feature workspace
const featuredWorkspace = mockWorkspaces[0];
</script>

<div class="max-w-7xl mx-auto px-6 pt-16 pb-24">
  <!-- Hero Section -->
  <div class="relative rounded-[3rem] overflow-hidden bg-brand shadow-2xl p-8 lg:p-20 group min-h-[600px] flex flex-col justify-end">
    <!-- Background Decor -->
    <div class="absolute inset-0 z-0">
      <img src={featuredWorkspace.image} alt={featuredWorkspace.name} class="w-full h-full object-cover opacity-60 mix-blend-overlay group-hover:scale-110 transition-transform duration-1000" />
      <div class="absolute inset-0 bg-gradient-to-t from-brand via-brand/40 to-transparent"></div>
    </div>

    <!-- Content -->
    <div class="relative z-10 max-w-2xl" in:fly={{ y: 50, duration: 800 }}>
      <div class="inline-flex items-center gap-2 px-4 py-2 bg-white/10 backdrop-blur-md text-white text-xs font-black uppercase tracking-[0.2em] rounded-full mb-8 border border-white/20">
        <span class="w-2 h-2 rounded-full bg-green-400 animate-pulse"></span>
        Featured Workspace
      </div>
      
      <h1 class="text-6xl lg:text-8xl font-black text-white leading-tight mb-6 tracking-tighter drop-shadow-2xl">
        Enter the <br/> <span class="text-white/80">{featuredWorkspace.name}</span>
      </h1>
      
      <p class="text-xl lg:text-2xl text-white/80 font-serif italic mb-10 leading-relaxed max-w-xl">
        "{featuredWorkspace.description}"
      </p>

      <div class="flex flex-wrap gap-4">
        <a 
          href="/workspaces/{featuredWorkspace.id}" 
          class="px-10 py-5 bg-white text-brand text-lg font-black rounded-2xl shadow-xl hover:shadow-white/20 hover:-translate-y-1 active:translate-y-0 transition-all flex items-center gap-3 group/btn"
        >
          <span>Start Session</span>
          <svg xmlns="http://www.w3.org/2000/svg" class="w-5 h-5 group-hover/btn:translate-x-1 transition-transform" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M14 5l7 7-7 7" />
          </svg>
        </a>
        <a 
          href="/workspaces" 
          class="px-10 py-5 bg-white/10 backdrop-blur-md text-white border-2 border-white/20 text-lg font-black rounded-2xl hover:bg-white/20 transition-all"
        >
          Browse All Workspaces
        </a>
      </div>
    </div>

    <!-- Decorative floating info -->
    <div class="absolute top-20 right-20 hidden lg:block" in:fade={{ delay: 400 }}>
        <div class="bg-white/10 backdrop-blur-xl border border-white/20 p-6 rounded-3xl shadow-2xl rotate-3 hover:rotate-0 transition-transform cursor-default">
            <div class="text-[10px] font-black uppercase tracking-[0.2em] text-white/60 mb-2">Protocol</div>
            <div class="text-3xl font-black text-white">Workspace Studio</div>
        </div>
    </div>
  </div>

  <!-- Quick Explore Section -->
  <div class="mt-24">
    <div class="flex items-center justify-between mb-12">
      <div>
        <h2 class="text-4xl font-black text-gray-800 tracking-tight">Public Workspaces</h2>
        <p class="mt-2 text-gray-400 font-medium">Curated workspaces waiting for a story.</p>
      </div>
      <a href="/workspaces" class="font-black text-brand hover:underline underline-offset-8">Explore All →</a>
    </div>

    <div class="grid grid-cols-1 md:grid-cols-3 gap-8">
      {#each mockWorkspaces as workspace}
        <a href="/workspaces/{workspace.id}" class="group bg-white rounded-3xl overflow-hidden border border-gray-100 shadow-sm hover:shadow-2xl hover:-translate-y-1 transition-all duration-500">
          <div class="aspect-[4/3] overflow-hidden">
            <img src={workspace.image} alt={workspace.name} class="w-full h-full object-cover group-hover:scale-110 transition-transform duration-700" />
          </div>
          <div class="p-8">
            <h3 class="text-2xl font-black text-gray-800 mb-2 group-hover:text-brand transition-colors">{workspace.name}</h3>
            <p class="text-sm text-gray-400 font-medium line-clamp-2 leading-relaxed">{workspace.description}</p>
          </div>
        </a>
      {/each}
      
      <!-- Placeholder Create Card -->
      <button class="bg-gray-50 border-4 border-dashed border-gray-100 rounded-3xl p-12 flex flex-col items-center justify-center text-gray-300 hover:border-brand/20 hover:text-brand/40 transition-all cursor-not-allowed group">
        <div class="w-16 h-16 rounded-full bg-white flex items-center justify-center mb-6 shadow-sm group-hover:scale-110 transition-transform">
          <svg xmlns="http://www.w3.org/2000/svg" class="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
          </svg>
        </div>
        <span class="font-black text-xl tracking-tight">Create New Workspace</span>
        <span class="text-xs mt-2 uppercase tracking-widest font-black opacity-40">Coming Soon</span>
      </button>
    </div>
  </div>
</div>
