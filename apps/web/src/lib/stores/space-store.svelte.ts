import {
  getSpaces,
  getSpace,
  getSpaceSessions,
  type SpaceListItem,
  type SpaceRecord,
  type SessionRecord,
} from "$lib/api";
import { sidebarCache } from "$lib/stores/sidebar-cache";

const SPACE_LIST_REFRESH_MS = 60_000;
const SESSION_LIST_REFRESH_MS = 30_000;

function mergeSpaceList(existing: SpaceListItem[], incoming: SpaceListItem[]) {
  const byId = new Map(existing.map((item) => [item.id, item]));
  for (const item of incoming) {
    byId.set(item.id, {
      ...byId.get(item.id),
      ...item,
    });
  }
  return Array.from(byId.values()).sort((a, b) => {
    const aDate = a.updatedAt ?? a.createdAt;
    const bDate = b.updatedAt ?? b.createdAt;
    const aTime = aDate ? new Date(aDate).getTime() : 0;
    const bTime = bDate ? new Date(bDate).getTime() : 0;
    return bTime - aTime;
  });
}

class SpaceStore {
  spaceList = $state<SpaceListItem[]>([]);
  spaceDetailsById = $state<Record<string, SpaceRecord>>({});
  sessionsBySpace = $state<Record<string, SessionRecord[]>>({});
  loadedSessionSpaceIds = $state(new Set<string>());
  lastSpaceListFetchedAt = $state(0);
  lastSessionListFetchedAt = $state<Record<string, number>>({});
  loadingSpaceList = $state(false);
  loadingSessionsBySpace = $state<Record<string, boolean>>({});

  // Track shared spaces injected by the space page (non-owner viewing)
  // so they survive space list refreshes.
  private injectedSharedSpaceIds = $state(new Set<string>());

  private spaceListPromise: Promise<SpaceListItem[]> | null = null;
  private sessionPromises = new Map<string, Promise<SessionRecord[]>>();
  private spaceDetailPromises = new Map<string, Promise<SpaceRecord>>();

  private addLoadedSessionSpace(spaceId: string) {
    const next = new Set(this.loadedSessionSpaceIds);
    next.add(spaceId);
    this.loadedSessionSpaceIds = next;
  }

  private deleteLoadedSessionSpace(spaceId: string) {
    const next = new Set(this.loadedSessionSpaceIds);
    next.delete(spaceId);
    this.loadedSessionSpaceIds = next;
  }

  shouldRefreshSpaceList() {
    return Date.now() - this.lastSpaceListFetchedAt > SPACE_LIST_REFRESH_MS;
  }

  async ensureSpaceList(options?: { force?: boolean }) {
    const force = options?.force ?? false;

    if (this.spaceList.length === 0) {
      const cached = sidebarCache.getSpaces();
      if (cached?.length) {
        this.setSpaceList(cached);
      }
    }

    if (!force && !this.shouldRefreshSpaceList() && this.spaceList.length > 0) {
      return this.spaceList;
    }

    if (this.spaceListPromise && !force) {
      return this.spaceListPromise;
    }

    this.loadingSpaceList = true;
    const request = (async () => {
      const data = await getSpaces();
      this.replaceSpaceList(data);
      sidebarCache.setSpaces(data);
      return data;
    })();

    this.spaceListPromise = request;
    try {
      return await request;
    } finally {
      if (this.spaceListPromise === request) {
        this.spaceListPromise = null;
      }
      this.loadingSpaceList = false;
    }
  }

  shouldRefreshSessions(spaceId: string) {
    const last = this.lastSessionListFetchedAt[spaceId] ?? 0;
    return Date.now() - last > SESSION_LIST_REFRESH_MS;
  }

  async ensureSpaceSessions(spaceId: string, options?: { force?: boolean }) {
    const force = options?.force ?? false;

    if (!this.sessionsBySpace[spaceId]) {
      const cached = sidebarCache.getSessions(spaceId);
      if (cached?.length) {
        this.setSessions(spaceId, cached);
      }
    }

    if (!force && this.hasLoadedSessions(spaceId) && !this.shouldRefreshSessions(spaceId)) {
      return this.getSessions(spaceId) ?? [];
    }

    const existing = this.sessionPromises.get(spaceId);
    if (existing && !force) {
      return existing;
    }

    this.setLoadingSessions(spaceId, true);
    const request = (async () => {
      const result = await getSpaceSessions(spaceId);
      const sessions = result.sessions ?? [];
      this.setSessions(spaceId, sessions);
      sidebarCache.setSessions(spaceId, sessions);
      return sessions;
    })();

    this.sessionPromises.set(spaceId, request);
    try {
      return await request;
    } finally {
      if (this.sessionPromises.get(spaceId) === request) {
        this.sessionPromises.delete(spaceId);
      }
      this.setLoadingSessions(spaceId, false);
    }
  }

  async ensureSpaceDetail(spaceId: string, options?: { force?: boolean }) {
    const force = options?.force ?? false;
    if (!force) {
      const existingSpace = this.getSpace(spaceId);
      if (existingSpace && !this.shouldRefreshSpaceList()) {
        return existingSpace as SpaceRecord;
      }
    }

    const existing = this.spaceDetailPromises.get(spaceId);
    if (existing && !force) return existing;

    const request = (async () => {
      const space = await getSpace(spaceId);
      this.upsertSpace(space);
      return space;
    })();
    this.spaceDetailPromises.set(spaceId, request);
    try {
      return await request;
    } finally {
      if (this.spaceDetailPromises.get(spaceId) === request) {
        this.spaceDetailPromises.delete(spaceId);
      }
    }
  }

  setSpaceList(items: SpaceListItem[]) {
    this.spaceList = mergeSpaceList(this.spaceList, items);
    this.lastSpaceListFetchedAt = Date.now();
    for (const item of items) {
      this.spaceDetailsById[item.id] = item;
    }
  }

  replaceSpaceList(items: SpaceListItem[]) {
    const sharedToPreserve = [...this.injectedSharedSpaceIds]
      .map((id) => this.spaceDetailsById[id])
      .filter((space) => space && !items.some((item) => item.id === space.id));
    this.spaceList = [...sharedToPreserve, ...items];
    this.lastSpaceListFetchedAt = Date.now();
    for (const item of items) {
      this.spaceDetailsById[item.id] = item;
    }
  }

  injectSharedSpace(space: SpaceRecord | SpaceListItem) {
    this.injectedSharedSpaceIds = new Set(this.injectedSharedSpaceIds).add(space.id);
    this.spaceDetailsById[space.id] = space as SpaceRecord;
    if (!this.spaceList.some((item) => item.id === space.id)) {
      this.spaceList = [{ ...(space as SpaceListItem) }, ...this.spaceList];
    }
  }

  upsertSpace(space: SpaceRecord | SpaceListItem) {
    this.spaceDetailsById[space.id] = space as SpaceRecord;
    const index = this.spaceList.findIndex((item) => item.id === space.id);
    if (index >= 0) {
      const next = [...this.spaceList];
      next[index] = { ...next[index], ...space } as SpaceListItem;
      this.spaceList = next;
    } else {
      this.spaceList = [{ ...(space as SpaceListItem) }, ...this.spaceList];
    }
  }

  removeSpace(spaceId: string) {
    this.spaceList = this.spaceList.filter((item) => item.id !== spaceId);
    delete this.spaceDetailsById[spaceId];
    delete this.sessionsBySpace[spaceId];
    delete this.lastSessionListFetchedAt[spaceId];
    delete this.loadingSessionsBySpace[spaceId];
    this.lastSessionListFetchedAt = { ...this.lastSessionListFetchedAt };
    this.loadingSessionsBySpace = { ...this.loadingSessionsBySpace };
    this.deleteLoadedSessionSpace(spaceId);
  }

  getSpace(spaceId: string) {
    return this.spaceDetailsById[spaceId] ?? this.spaceList.find((item) => item.id === spaceId) ?? null;
  }

  setSessions(spaceId: string, sessions: SessionRecord[]) {
    this.sessionsBySpace[spaceId] = sessions;
    this.addLoadedSessionSpace(spaceId);
    this.lastSessionListFetchedAt = {
      ...this.lastSessionListFetchedAt,
      [spaceId]: Date.now(),
    };
  }

  patchSession(spaceId: string, session: SessionRecord) {
    const existing = this.sessionsBySpace[spaceId] ?? [];
    const index = existing.findIndex((item) => item.id === session.id);
    const next = [...existing];
    if (index >= 0) {
      next[index] = { ...next[index], ...session };
    } else {
      next.push(session);
    }
    next.sort((a, b) => {
      const aTime = new Date(a.updatedAt ?? a.createdAt).getTime();
      const bTime = new Date(b.updatedAt ?? b.createdAt).getTime();
      return bTime - aTime;
    });
    this.setSessions(spaceId, next);
  }

  getSessions(spaceId: string) {
    return this.sessionsBySpace[spaceId] ?? null;
  }

  hasLoadedSessions(spaceId: string) {
    return this.loadedSessionSpaceIds.has(spaceId);
  }

  setLoadingSessions(spaceId: string, loading: boolean) {
    this.loadingSessionsBySpace = {
      ...this.loadingSessionsBySpace,
      [spaceId]: loading,
    };
  }

  isLoadingSessions(spaceId: string) {
    return this.loadingSessionsBySpace[spaceId] ?? false;
  }
}

export const spaceStore = new SpaceStore();
