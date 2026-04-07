<script lang="ts">
import { page } from "$app/state";
import { goto } from "$app/navigation";
import { FolderKanban, Cpu, Network, Home } from "lucide-svelte";

type TabItem = {
  href: string;
  label: string;
  icon: typeof Home;
};

const tabs: TabItem[] = [
  { href: "/", label: "Overview", icon: Home },
  { href: "/workspaces", label: "Workspaces", icon: FolderKanban },
  { href: "/runtimes", label: "Runtimes", icon: Cpu },
  { href: "/channels", label: "Channels", icon: Network },
];

const currentPath = $derived(page.url.pathname);

function isActive(href: string): boolean {
  if (href === "/") return currentPath === "/";
  return currentPath.startsWith(href);
}

async function navigate(href: string) {
  await goto(href);
}
</script>

<!-- Bottom tab bar — visible only below lg breakpoint -->
<nav
  class="lg:hidden fixed bottom-0 left-0 right-0 z-40 flex items-stretch bg-bg-primary border-t border-border-subtle safe-bottom"
  aria-label="Main navigation"
>
  {#each tabs as tab}
    {@const Icon = tab.icon}
    <button
      type="button"
      class="flex-1 flex flex-col items-center justify-center gap-0.5 py-2 min-h-[48px] text-text-tertiary transition-colors {isActive(tab.href) ? 'text-brand' : 'hover:text-text-secondary'}"
      onclick={() => navigate(tab.href)}
    >
      <Icon class="w-5 h-5" />
      <span class="text-[10px] font-medium">{tab.label}</span>
    </button>
  {/each}
</nav>
