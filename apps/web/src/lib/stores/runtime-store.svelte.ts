import {
  getRuntimes,
  getRuntime,
  getRuntimeChannels,
  getRuntimeSessions,
  listRuntimePermissions,
  type RuntimeListItem,
  type RuntimeRecord,
  type RuntimeChannelRecord,
  type SessionRecord,
  type ResourcePermission,
  type ResourcePermissionLevel,
} from "$lib/api";
import { sidebarCache } from "$lib/stores/sidebar-cache";
import { authStore } from "$lib/stores/auth.svelte";

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
  permissionRecordsByRuntime = $state<Record<string, ResourcePermission[]>>({});
  loadedSessionRuntimeIds = $state(new Set<string>());
  loadedChannelRuntimeIds = $state(new Set<string>());
  loadedPermissionRuntimeIds = $state(new Set<string>());
  lastRuntimeListFetchedAt = $state(0);
  lastSessionListFetchedAt = $state<Record<string, number>>({});
  loadingRuntimeList = $state(false);
  loadingSessionsByRuntime = $state<Record<string, boolean>>({});

  // Track shared runtimes injected by the runtime page (non-owner viewing)
  // so they survive runtime list refreshes
  private injectedSharedRuntimeIds = $state(new Set<string>());

  private runtimeListPromise: Promise<RuntimeListItem[]> | null = null;
  private sessionPromises = new Map<string, Promise<SessionRecord[]>>();
  private permissionPromises = new Map<string, Promise<Map<string, ResourcePermissionLevel>>>();
  private runtimeDetailPromises = new Map<string, Promise<RuntimeRecord>>();
  private runtimeChannelPromises = new Map<string, Promise<RuntimeChannelRecord[]>>();
  private permissionRecordPromises = new Map<string, Promise<ResourcePermission[]>>();

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

  async ensureRuntimeList(options?: { force?: boolean }) {
    const force = options?.force ?? false;

    if (this.runtimeList.length === 0) {
      const cached = sidebarCache.getRuntimes();
      if (cached?.length) {
        this.setRuntimeList(cached);
      }
    }

    if (!force && !this.shouldRefreshRuntimeList() && this.runtimeList.length > 0) {
      return this.runtimeList;
    }

    if (this.runtimeListPromise && !force) {
      return this.runtimeListPromise;
    }

    this.loadingRuntimeList = true;
    const request = (async () => {
      const data = await getRuntimes();
      this.replaceRuntimeList(data);
      sidebarCache.setRuntimes(data);
      return data;
    })();

    this.runtimeListPromise = request;
    try {
      return await request;
    } finally {
      if (this.runtimeListPromise === request) {
        this.runtimeListPromise = null;
      }
      this.loadingRuntimeList = false;
    }
  }

  shouldRefreshSessions(runtimeId: string) {
    const last = this.lastSessionListFetchedAt[runtimeId] ?? 0;
    return Date.now() - last > SESSION_LIST_REFRESH_MS;
  }

  async ensureRuntimeSessions(runtimeId: string, options?: { force?: boolean }) {
    const force = options?.force ?? false;

    if (!this.sessionsByRuntime[runtimeId]) {
      const cached = sidebarCache.getSessions(runtimeId);
      if (cached?.length) {
        this.setSessions(runtimeId, cached);
      }
    }

    if (!force && this.hasLoadedSessions(runtimeId) && !this.shouldRefreshSessions(runtimeId)) {
      return this.getSessions(runtimeId) ?? [];
    }

    const existing = this.sessionPromises.get(runtimeId);
    if (existing && !force) {
      return existing;
    }

    this.setLoadingSessions(runtimeId, true);
    const request = (async () => {
      const result = await getRuntimeSessions(runtimeId);
      const sessions = result.sessions ?? [];
      this.setSessions(runtimeId, sessions);
      sidebarCache.setSessions(runtimeId, sessions);
      return sessions;
    })();

    this.sessionPromises.set(runtimeId, request);
    try {
      return await request;
    } finally {
      if (this.sessionPromises.get(runtimeId) === request) {
        this.sessionPromises.delete(runtimeId);
      }
      this.setLoadingSessions(runtimeId, false);
    }
  }

  async ensureRuntimePermissions(runtimeId: string, options?: { force?: boolean }) {
    const force = options?.force ?? false;
    if (!authStore.userUuid) return null;

    if (!force && this.hasLoadedPermissions(runtimeId)) {
      return this.getPermissions(runtimeId) ?? new Map<string, ResourcePermissionLevel>();
    }

    const existing = this.permissionPromises.get(runtimeId);
    if (existing && !force) {
      return existing;
    }

    const request = (async () => {
      const perms = await listRuntimePermissions(runtimeId);
      this.permissionRecordsByRuntime = {
        ...this.permissionRecordsByRuntime,
        [runtimeId]: perms,
      };
      const levels = new Map<string, ResourcePermissionLevel>();
      for (const perm of perms) {
        if (perm.resourceType === "session") {
          levels.set(perm.resourceId, perm.level);
        }
      }
      this.setPermissions(runtimeId, levels);
      return levels;
    })();

    this.permissionPromises.set(runtimeId, request);
    try {
      return await request;
    } finally {
      if (this.permissionPromises.get(runtimeId) === request) {
        this.permissionPromises.delete(runtimeId);
      }
    }
  }

  async ensureRuntimeDetail(runtimeId: string, options?: { force?: boolean }) {
    const force = options?.force ?? false;
    if (!force) {
      const existingRuntime = this.getRuntime(runtimeId);
      if (existingRuntime && !this.shouldRefreshRuntimeList()) {
        return existingRuntime as RuntimeRecord;
      }
    }

    const existing = this.runtimeDetailPromises.get(runtimeId);
    if (existing && !force) return existing;

    const request = (async () => {
      const runtime = await getRuntime(runtimeId);
      this.upsertRuntime(runtime);
      return runtime;
    })();
    this.runtimeDetailPromises.set(runtimeId, request);
    try {
      return await request;
    } finally {
      if (this.runtimeDetailPromises.get(runtimeId) === request) {
        this.runtimeDetailPromises.delete(runtimeId);
      }
    }
  }

  async ensureRuntimeChannels(runtimeId: string, options?: { force?: boolean }) {
    const force = options?.force ?? false;
    if (!force && this.hasLoadedChannels(runtimeId)) {
      return this.getRuntimeChannels(runtimeId) ?? [];
    }

    const existing = this.runtimeChannelPromises.get(runtimeId);
    if (existing && !force) return existing;

    const request = (async () => {
      const channels = await getRuntimeChannels(runtimeId);
      this.setRuntimeChannels(runtimeId, channels);
      return channels;
    })();
    this.runtimeChannelPromises.set(runtimeId, request);
    try {
      return await request;
    } finally {
      if (this.runtimeChannelPromises.get(runtimeId) === request) {
        this.runtimeChannelPromises.delete(runtimeId);
      }
    }
  }

  async ensureRuntimePermissionRecords(runtimeId: string, options?: { force?: boolean }) {
    const force = options?.force ?? false;
    if (!authStore.userUuid) return [];
    if (!force && this.permissionRecordsByRuntime[runtimeId]) {
      return this.permissionRecordsByRuntime[runtimeId];
    }

    const existing = this.permissionRecordPromises.get(runtimeId);
    if (existing && !force) return existing;

    const request = (async () => {
      const perms = await listRuntimePermissions(runtimeId);
      this.permissionRecordsByRuntime = {
        ...this.permissionRecordsByRuntime,
        [runtimeId]: perms,
      };
      const levels = new Map<string, ResourcePermissionLevel>();
      for (const perm of perms) {
        if (perm.resourceType === "session") {
          levels.set(perm.resourceId, perm.level);
        }
      }
      this.setPermissions(runtimeId, levels);
      return perms;
    })();
    this.permissionRecordPromises.set(runtimeId, request);
    try {
      return await request;
    } finally {
      if (this.permissionRecordPromises.get(runtimeId) === request) {
        this.permissionRecordPromises.delete(runtimeId);
      }
    }
  }

  setRuntimeList(items: RuntimeListItem[]) {
    this.runtimeList = mergeRuntimeList(this.runtimeList, items);
    this.lastRuntimeListFetchedAt = Date.now();
    for (const item of items) {
      this.runtimeDetailsById[item.id] = item;
    }
  }

  replaceRuntimeList(items: RuntimeListItem[]) {
    // Preserve injected shared runtimes that aren't in the new list
    const sharedToPreserve = [...this.injectedSharedRuntimeIds]
      .map((id) => this.runtimeDetailsById[id])
      .filter((r) => r && !items.some((item) => item.id === r.id));
    this.runtimeList = [...sharedToPreserve, ...items];
    this.lastRuntimeListFetchedAt = Date.now();
    for (const item of items) {
      this.runtimeDetailsById[item.id] = item;
    }
  }

  /** Inject a shared runtime (non-owned) into the runtime list at the front */
  injectSharedRuntime(runtime: RuntimeRecord | RuntimeListItem) {
    this.injectedSharedRuntimeIds = new Set(this.injectedSharedRuntimeIds).add(runtime.id);
    this.runtimeDetailsById[runtime.id] = runtime as RuntimeRecord;
    // Only add if not already in the list
    if (!this.runtimeList.some((item) => item.id === runtime.id)) {
      this.runtimeList = [{ ...(runtime as RuntimeListItem) }, ...this.runtimeList];
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
    delete this.permissionRecordsByRuntime[runtimeId];
    delete this.lastSessionListFetchedAt[runtimeId];
    delete this.loadingSessionsByRuntime[runtimeId];
    this.lastSessionListFetchedAt = { ...this.lastSessionListFetchedAt };
    this.loadingSessionsByRuntime = { ...this.loadingSessionsByRuntime };
    this.permissionRecordsByRuntime = { ...this.permissionRecordsByRuntime };
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
