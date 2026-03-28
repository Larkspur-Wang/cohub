<script lang="ts">
import { FolderKanban, Network, Activity, ArrowRight, Plus, Rocket, Zap } from "lucide-svelte";
import { getWorkspaces, type Workspace } from "$lib/api";
import { onMount } from "svelte";
import { fly } from "svelte/transition";

let workspaces = $state<Workspace[]>([]);
let isLoading = $state(true);
let loadError = $state("");

const stats = $derived([
  { name: "Workspaces", value: workspaces.length.toString(), icon: FolderKanban, color: "bg-[#4D96FF]" },
  { name: "Channels", value: "0", icon: Network, color: "bg-[#9D4EDD]" },
  { name: "Runtimes", value: "0", icon: Activity, color: "bg-[#28B463]" },
]);

onMount(async () => {
  try {
    workspaces = await getWorkspaces();
  } catch (error) {
    loadError = error instanceof Error ? error.message : "Failed to load workspaces";
  } finally {
    isLoading = false;
  }
});
</script>

<div class="neo-page-shell">
  <div class="flex flex-col lg:flex-row justify-between items-start gap-6 mt-2" in:fly={{ y: 20, duration: 400 }}>
    <div class="max-w-3xl">
      <h1 class="text-5xl md:text-6xl font-black tracking-tighter text-black leading-[1.05] uppercase">
        Deploy <span class="text-[#FF5A5F]">Agents</span><br />
        Like a <span class="bg-[#FFD93D] px-3 py-0.5 border-[4px] border-black rounded-3xl inline-block -rotate-2 shadow-[5px_5px_0px_0px_rgba(0,0,0,1)] mt-1">Boss.</span>
      </h1>
      <p class="mt-5 text-base md:text-lg text-black/70 font-medium max-w-2xl leading-relaxed">
        Orchestrate your autonomous AI workflows with brute force simplicity.
      </p>
    </div>
    
    <div class="flex items-center gap-3 mt-2 lg:mt-0">
      <a href="/workspaces" class="px-5 py-3 rounded-2xl bg-[#FF5A5F] text-white border-[3px] border-black font-black uppercase tracking-tight flex items-center justify-center gap-2 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] hover:-translate-y-1 hover:-translate-x-1 hover:shadow-[6px_6px_0px_0px_rgba(0,0,0,1)] active:translate-y-1 active:translate-x-1 active:shadow-none transition-all">
        <Plus class="w-4 h-4" />
        New Workspace
      </a>
    </div>
  </div>

  <div class="grid grid-cols-1 md:grid-cols-3 gap-4 md:gap-5">
    {#each stats as stat, i}
      <div 
        class="bg-white rounded-[1.5rem] border-[4px] border-black p-5 flex flex-col relative overflow-hidden shadow-[6px_6px_0px_0px_rgba(0,0,0,1)] hover:-translate-y-1 hover:-translate-x-1 hover:shadow-[8px_8px_0px_0px_rgba(0,0,0,1)] transition-all duration-300 group"
        in:fly={{ y: 24, duration: 400, delay: i * 100 }}
      >
        <div class="absolute -right-8 -top-8 w-28 h-28 {stat.color} rounded-full border-[4px] border-black opacity-20 group-hover:opacity-100 transition-all duration-300 z-0"></div>
        
        <div class="z-10 flex justify-between items-start mb-8">
          <div class="p-3 rounded-2xl {stat.color} border-[3px] border-black shadow-[3px_3px_0px_0px_rgba(0,0,0,1)]">
            <stat.icon class="w-5 h-5 text-black" />
          </div>
        </div>
        
        <div class="z-10 mt-auto">
          <p class="text-xs font-black uppercase tracking-[0.18em] mb-1">{stat.name}</p>
          <p class="text-5xl md:text-6xl font-black tracking-tighter leading-none">{stat.value}</p>
        </div>
      </div>
    {/each}
  </div>

  <div class="grid grid-cols-1 lg:grid-cols-12 gap-5 mt-2">
    <div class="lg:col-span-7 bg-[#FFF9F0] rounded-[1.75rem] border-[4px] border-black shadow-[6px_6px_0px_0px_rgba(0,0,0,1)] flex flex-col overflow-hidden" in:fly={{ x: -24, duration: 400, delay: 250 }}>
      <div class="px-5 py-4 border-b-[4px] border-black bg-[#4D96FF] flex items-center justify-between">
        <h2 class="text-xl md:text-2xl font-black uppercase tracking-tighter text-black flex items-center gap-2">
          <Rocket class="w-5 h-5 md:w-6 md:h-6" />
          Active Workspaces
        </h2>
        <a href="/workspaces" class="px-4 py-2 bg-white border-[3px] border-black rounded-full font-black text-[11px] uppercase tracking-widest shadow-[3px_3px_0px_0px_rgba(0,0,0,1)] hover:shadow-none hover:translate-x-1 hover:translate-y-1 transition-all">
          View All
        </a>
      </div>

      <div class="p-5 bg-white flex-1">
        {#if isLoading}
          <div class="flex items-center justify-center h-32">
            <div class="w-10 h-10 border-[4px] border-black border-t-[#FF5A5F] rounded-full animate-spin"></div>
          </div>
        {:else if loadError}
          <div class="p-4 bg-[#FF5A5F] text-white border-[4px] border-black rounded-2xl font-black shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]">
            ERROR: {loadError}
          </div>
        {:else if workspaces.length === 0}
          <div class="h-32 flex flex-col items-center justify-center border-[4px] border-dashed border-black/20 rounded-2xl text-center">
            <div class="w-14 h-14 bg-gray-100 rounded-full flex items-center justify-center mb-3 border-[3px] border-black">
              <FolderKanban class="w-6 h-6 opacity-40" />
            </div>
            <p class="font-black uppercase tracking-widest text-black/40 text-sm">No Workspaces Found</p>
          </div>
        {:else}
          <div class="space-y-3">
            {#each workspaces.slice(0, 4) as workspace, i}
              <a 
                href="/workspaces/{workspace.id}" 
                class="group flex items-center gap-4 p-4 rounded-2xl border-[3px] border-black bg-[#FFF9F0] hover:bg-[#FFD93D] shadow-[3px_3px_0px_0px_rgba(0,0,0,1)] hover:shadow-[5px_5px_0px_0px_rgba(0,0,0,1)] hover:-translate-x-1 hover:-translate-y-1 active:translate-x-1 active:translate-y-1 active:shadow-none transition-all"
                in:fly={{ y: 14, duration: 250, delay: 320 + i * 80 }}
              >
                <div class="w-12 h-12 rounded-xl border-[3px] border-black bg-white flex items-center justify-center shrink-0">
                  <FolderKanban class="w-5 h-5" />
                </div>
                <div class="flex-1 min-w-0">
                  <p class="text-lg font-black truncate uppercase tracking-tight">{workspace.name}</p>
                  <p class="text-xs font-bold text-black/60 truncate mt-1">{workspace.description || 'No Description Provided'}</p>
                </div>
                <div class="w-10 h-10 rounded-full border-[3px] border-black bg-white flex items-center justify-center opacity-0 -translate-x-3 group-hover:opacity-100 group-hover:translate-x-0 transition-all">
                  <ArrowRight class="w-4 h-4" />
                </div>
              </a>
            {/each}
          </div>
        {/if}
      </div>
    </div>

    <div class="lg:col-span-5 bg-[#9D4EDD] rounded-[1.75rem] border-[4px] border-black shadow-[6px_6px_0px_0px_rgba(0,0,0,1)] p-5 flex flex-col relative text-white" in:fly={{ x: 24, duration: 400, delay: 320 }}>
      <div class="absolute top-3 right-3 w-6 h-6 bg-[#FFD93D] border-[3px] border-black rounded-full"></div>
      <div class="absolute top-12 right-10 w-3 h-3 bg-[#FF5A5F] border-[2px] border-black rounded-full"></div>
      
      <div class="flex items-center gap-3 mb-6 relative z-10">
        <div class="p-2.5 bg-white border-[3px] border-black rounded-xl shadow-[3px_3px_0px_0px_rgba(0,0,0,1)]">
          <Zap class="w-5 h-5 text-black" />
        </div>
        <h2 class="text-2xl font-black uppercase tracking-tighter">Fast Track</h2>
      </div>
      
      <div class="space-y-4 flex-1 relative z-10">
        <div class="bg-white text-black p-4 rounded-2xl border-[3px] border-black shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] transform -rotate-1 hover:rotate-0 transition-transform">
          <div class="flex items-start gap-3">
            <div class="w-10 h-10 rounded-full bg-[#FF5A5F] border-[3px] border-black flex items-center justify-center font-black text-base text-white shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]">1</div>
            <div>
              <h3 class="text-base font-black uppercase tracking-tight">Create Workspace</h3>
              <p class="mt-1.5 text-xs font-bold text-black/60 leading-relaxed">Initialize a new repository to host your agent code and core parameters.</p>
            </div>
          </div>
        </div>
        
        <div class="bg-white text-black p-4 rounded-2xl border-[3px] border-black shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] transform rotate-1 hover:rotate-0 transition-transform ml-2">
          <div class="flex items-start gap-3">
            <div class="w-10 h-10 rounded-full bg-[#4D96FF] border-[3px] border-black flex items-center justify-center font-black text-base text-white shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]">2</div>
            <div>
              <h3 class="text-base font-black uppercase tracking-tight">Setup Channels</h3>
              <p class="mt-1.5 text-xs font-bold text-black/60 leading-relaxed">Connect platforms like Discord to allow your agent to interact with the world.</p>
            </div>
          </div>
        </div>

        <div class="bg-white text-black p-4 rounded-2xl border-[3px] border-black shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] transform -rotate-1 hover:rotate-0 transition-transform">
          <div class="flex items-start gap-3">
            <div class="w-10 h-10 rounded-full bg-[#28B463] border-[3px] border-black flex items-center justify-center font-black text-base text-white shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]">3</div>
            <div>
              <h3 class="text-base font-black uppercase tracking-tight">Launch Runtime</h3>
              <p class="mt-1.5 text-xs font-bold text-black/60 leading-relaxed">Ignite the engine and monitor real-time decision making instantly.</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</div>
