import type {
  RuntimeListItem,
  RuntimeRecord,
  RuntimeChannelRecord,
  SessionRecord,
  ResourcePermissionLevel,
} from "$lib/api";

const RUNTIME_LIST_REFRESH_MS = 60_000;
const SESSION_LIST_REFRESH_MS = 30_000;

type PermissionMap = Record<string, Map<string, ResourcePermissionLevel>>;

function mergeRuntimeList(existing: RuntimeListItem[], incoming: RuntimeListItem[]) {
  const byId = new Map(existing.map((item) => [item.id, item]));
  for (const item of incoming) {
    byId.set(item.id, {
      ...byId.get(item.id),
      ...item,
    });
  }
  return Array.from(byId.values()).sort((a, b) => {
    const aTime = new Date(a.createdAt).getTime();
    const bTime = new Date(b.createdAt).getTime();
    return bTime - aTime;
  });
}

class RuntimeStore {
  runtimeList = $state<RuntimeListItem[]>([]);
  runtimeDetailsById = $state<Record<string, RuntimeRecord>>({});
  runtimeChannelsById = $state<Record<string, RuntimeChannelRecord[]>>({});
  sessionsByRuntime = $state<Record<string, SessionRecord[]>>({});
  permissionsByRuntime = $state<PermissionMap>({});
  loadedSessionRuntimeIds = $state(new Set<string>());
  loadedChannelRuntimeIds = $state(new Set<string>());
  loadedPermissionRuntimeIds = $state(new Set<string>());
  lastRuntimeListFetchedAt = $state(0);
  lastSessionListFetchedAt = $state<Record<string, number>>({});
  loadingSessionsByRuntime = $state<Record<string, boolean>>({});

  private addLoadedSessionRuntime(runtimeId: string) {
    const next = new Set(this.loadedSessionRuntimeIds);
    next.add(runtimeId);
    this.loadedSessionRuntimeIds = next;
  }

  private deleteLoadedSessionRuntime(runtimeId: string) {
    const next = new Set(this.loadedSessionRuntimeIds);
    next.delete(runtimeId);
    this.loadedSessionRuntimeIds = next;
  }

  private addLoadedChannelRuntime(runtimeId: string) {
    const next = new Set(this.loadedChannelRuntimeIds);
    next.add(runtimeId);
    this.loadedChannelRuntimeIds = next;
  }

  private deleteLoadedChannelRuntime(runtimeId: string) {
    const next = new Set(this.loadedChannelRuntimeIds);
    next.delete(runtimeId);
    this.loadedChannelRuntimeIds = next;
  }

  private addLoadedPermissionRuntime(runtimeId: string) {
    const next = new Set(this.loadedPermissionRuntimeIds);
    next.add(runtimeId);
    this.loadedPermissionRuntimeIds = next;
  }

  private deleteLoadedPermissionRuntime(runtimeId: string) {
    const next = new Set(this.loadedPermissionRuntimeIds);
    next.delete(runtimeId);
    this.loadedPermissionRuntimeIds = next;
  }

  shouldRefreshRuntimeList() {
    return Date.now() - this.lastRuntimeListFetchedAt > RUNTIME_LIST_REFRESH_MS;
  }

  shouldRefreshSessions(runtimeId: string) {
    const last = this.lastSessionListFetchedAt[runtimeId] ?? 0;
    return Date.now() - last > SESSION_LIST_REFRESH_MS;
  }

  setRuntimeList(items: RuntimeListItem[]) {
    this.runtimeList = mergeRuntimeList(this.runtimeList, items);
    this.lastRuntimeListFetchedAt = Date.now();
    for (const item of items) {
      this.runtimeDetailsById[item.id] = item;
    }
  }

  replaceRuntimeList(items: RuntimeListItem[]) {
    this.runtimeList = items;
    this.lastRuntimeListFetchedAt = Date.now();
    for (const item of items) {
      this.runtimeDetailsById[item.id] = item;
    }
  }

  upsertRuntime(runtime: RuntimeRecord | RuntimeListItem) {
    this.runtimeDetailsById[runtime.id] = runtime as RuntimeRecord;
    const index = this.runtimeList.findIndex((item) => item.id === runtime.id);
    if (index >= 0) {
      const next = [...this.runtimeList];
      next[index] = { ...next[index], ...runtime } as RuntimeListItem;
      this.runtimeList = next;
    } else {
      this.runtimeList = [{ ...(runtime as RuntimeListItem) }, ...this.runtimeList];
    }
  }

  removeRuntime(runtimeId: string) {
    this.runtimeList = this.runtimeList.filter((item) => item.id !== runtimeId);
    delete this.runtimeDetailsById[runtimeId];
    delete this.runtimeChannelsById[runtimeId];
    delete this.sessionsByRuntime[runtimeId];
    delete this.permissionsByRuntime[runtimeId];
    delete this.lastSessionListFetchedAt[runtimeId];
    delete this.loadingSessionsByRuntime[runtimeId];
    this.lastSessionListFetchedAt = { ...this.lastSessionListFetchedAt };
    this.loadingSessionsByRuntime = { ...this.loadingSessionsByRuntime };
    this.deleteLoadedSessionRuntime(runtimeId);
    this.deleteLoadedChannelRuntime(runtimeId);
    this.deleteLoadedPermissionRuntime(runtimeId);
  }

  getRuntime(runtimeId: string) {
    return this.runtimeDetailsById[runtimeId] ?? this.runtimeList.find((item) => item.id === runtimeId) ?? null;
  }

  setRuntimeChannels(runtimeId: string, channels: RuntimeChannelRecord[]) {
    this.runtimeChannelsById[runtimeId] = channels;
    this.addLoadedChannelRuntime(runtimeId);
  }

  getRuntimeChannels(runtimeId: string) {
    return this.runtimeChannelsById[runtimeId] ?? null;
  }

  setSessions(runtimeId: string, sessions: SessionRecord[]) {
    const permMap = this.permissionsByRuntime[runtimeId];
    this.sessionsByRuntime[runtimeId] = sessions.map((session) => ({
      ...session,
      shareLevel: session.shareLevel ?? permMap?.get(session.id) ?? null,
    }));
    this.addLoadedSessionRuntime(runtimeId);
    this.lastSessionListFetchedAt = {
      ...this.lastSessionListFetchedAt,
      [runtimeId]: Date.now(),
    };
  }

  patchSession(runtimeId: string, session: SessionRecord) {
    const existing = this.sessionsByRuntime[runtimeId] ?? [];
    const index = existing.findIndex((item) => item.id === session.id);
    const next = [...existing];
    const permMap = this.permissionsByRuntime[runtimeId];
    const hydrated = {
      ...session,
      shareLevel: session.shareLevel ?? permMap?.get(session.id) ?? null,
    };
    if (index >= 0) {
      next[index] = { ...next[index], ...hydrated };
    } else {
      next.push(hydrated);
    }
    next.sort((a, b) => {
      const aTime = new Date(a.updatedAt ?? a.createdAt).getTime();
      const bTime = new Date(b.updatedAt ?? b.createdAt).getTime();
      return aTime - bTime;
    });
    this.setSessions(runtimeId, next);
  }

  setPermissions(runtimeId: string, levels: Map<string, ResourcePermissionLevel>) {
    this.permissionsByRuntime = {
      ...this.permissionsByRuntime,
      [runtimeId]: levels,
    };
    this.addLoadedPermissionRuntime(runtimeId);

    const sessions = this.sessionsByRuntime[runtimeId];
    if (sessions) {
      this.sessionsByRuntime = {
        ...this.sessionsByRuntime,
        [runtimeId]: sessions.map((session) => ({
          ...session,
          shareLevel: levels.get(session.id) ?? null,
        })),
      };
    }
  }

  getPermissions(runtimeId: string) {
    return this.permissionsByRuntime[runtimeId] ?? null;
  }

  hasLoadedPermissions(runtimeId: string) {
    return this.loadedPermissionRuntimeIds.has(runtimeId);
  }

  getSessions(runtimeId: string) {
    return this.sessionsByRuntime[runtimeId] ?? null;
  }

  hasLoadedSessions(runtimeId: string) {
    return this.loadedSessionRuntimeIds.has(runtimeId);
  }

  hasLoadedChannels(runtimeId: string) {
    return this.loadedChannelRuntimeIds.has(runtimeId);
  }

  setLoadingSessions(runtimeId: string, loading: boolean) {
    this.loadingSessionsByRuntime = {
      ...this.loadingSessionsByRuntime,
      [runtimeId]: loading,
    };
  }

  isLoadingSessions(runtimeId: string) {
    return this.loadingSessionsByRuntime[runtimeId] ?? false;
  }
}

export const runtimeStore = new RuntimeStore();
