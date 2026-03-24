<script lang="ts">
import { mockWorkspaces } from "$lib/mock";
import { FolderKanban, Network, Activity, ArrowRight } from "lucide-svelte";

const stats = [
  { name: "Active Workspaces", value: mockWorkspaces.length.toString(), icon: FolderKanban, color: "text-blue-600", bg: "bg-blue-50" },
  { name: "Connected Channels", value: "0", icon: Network, color: "text-indigo-600", bg: "bg-indigo-50" },
  { name: "Running Agents", value: "0", icon: Activity, color: "text-emerald-600", bg: "bg-emerald-50" },
];
</script>

<div class="space-y-8">
  <div class="flex items-center justify-between">
    <div>
      <h1 class="text-3xl font-bold tracking-tight text-gray-900">Overview</h1>
      <p class="mt-2 text-sm text-gray-500">Welcome to Cohub Studio. Manage your workspaces and agent channels.</p>
    </div>
  </div>

  <div class="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
    {#each stats as stat}
      <div class="bg-white overflow-hidden shadow-sm rounded-2xl border border-gray-100 p-6 flex items-center gap-4 hover:shadow-md transition-shadow">
        <div class="p-3 rounded-xl {stat.bg}">
          <stat.icon class="w-6 h-6 {stat.color}" />
        </div>
        <div>
          <p class="text-sm font-medium text-gray-500 truncate">{stat.name}</p>
          <p class="mt-1 text-3xl font-semibold tracking-tight text-gray-900">{stat.value}</p>
        </div>
      </div>
    {/each}
  </div>

  <div class="grid grid-cols-1 lg:grid-cols-2 gap-8">
    <div class="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
      <div class="flex items-center justify-between mb-6">
        <h2 class="text-lg font-semibold text-gray-900">Recent Workspaces</h2>
        <a href="/workspaces" class="text-sm font-medium text-brand hover:text-brand/80 flex items-center gap-1">
          View all <ArrowRight class="w-4 h-4" />
        </a>
      </div>
      <div class="space-y-4">
        {#each mockWorkspaces.slice(0, 3) as workspace}
          <a href="/workspaces/{workspace.id}" class="group block p-4 rounded-xl border border-gray-100 hover:border-brand/30 hover:bg-brand/5 transition-all">
            <div class="flex items-center gap-4">
              <div class="w-12 h-12 rounded-lg bg-gray-100 overflow-hidden shrink-0">
                <img src={workspace.image} alt={workspace.name} class="w-full h-full object-cover group-hover:scale-110 transition-transform duration-500" />
              </div>
              <div class="flex-1 min-w-0">
                <p class="text-sm font-semibold text-gray-900 truncate group-hover:text-brand transition-colors">{workspace.name}</p>
                <p class="text-xs text-gray-500 truncate mt-0.5">{workspace.description}</p>
              </div>
            </div>
          </a>
        {/each}
      </div>
    </div>

    <div class="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 flex flex-col">
      <h2 class="text-lg font-semibold text-gray-900 mb-2">Getting Started</h2>
      <p class="text-sm text-gray-500 mb-6">Follow these steps to deploy your first agent.</p>
      
      <div class="space-y-6 flex-1">
        <div class="flex gap-4">
          <div class="flex flex-col items-center">
            <div class="w-8 h-8 rounded-full bg-brand/10 text-brand flex items-center justify-center font-bold text-sm">1</div>
            <div class="w-0.5 h-full bg-gray-100 mt-2"></div>
          </div>
          <div class="pb-6">
            <h3 class="text-sm font-medium text-gray-900">Create a Workspace</h3>
            <p class="mt-1 text-sm text-gray-500">Initialize a new repository in Gitea to host your agent's knowledge and code.</p>
          </div>
        </div>
        
        <div class="flex gap-4">
          <div class="flex flex-col items-center">
            <div class="w-8 h-8 rounded-full bg-brand/10 text-brand flex items-center justify-center font-bold text-sm">2</div>
            <div class="w-0.5 h-full bg-gray-100 mt-2"></div>
          </div>
          <div class="pb-6">
            <h3 class="text-sm font-medium text-gray-900">Configure a Channel</h3>
            <p class="mt-1 text-sm text-gray-500">Add a Discord or Feishu bot token so your agent can communicate.</p>
          </div>
        </div>

        <div class="flex gap-4">
          <div class="flex flex-col items-center">
            <div class="w-8 h-8 rounded-full bg-gray-100 text-gray-400 flex items-center justify-center font-bold text-sm">3</div>
          </div>
          <div>
            <h3 class="text-sm font-medium text-gray-900">Start a Session</h3>
            <p class="mt-1 text-sm text-gray-500">Launch a runtime from your workspace and bind it to your channel.</p>
          </div>
        </div>
      </div>
    </div>
  </div>
</div>
