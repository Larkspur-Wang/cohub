import { sidebarCache } from "$lib/stores/sidebar-cache";
import { runtimeStore } from "$lib/stores/runtime-store.svelte";

export function hydrateRuntimeStoreFromSidebarCache() {
  const runtimes = sidebarCache.getRuntimes();
  if (runtimes?.length) {
    runtimeStore.setRuntimeList(runtimes);
  }
}

export function hydrateSessionCacheToRuntimeStore(runtimeId: string) {
  const sessions = sidebarCache.getSessions(runtimeId);
  if (sessions?.length) {
    runtimeStore.setSessions(runtimeId, sessions);
  }
}
