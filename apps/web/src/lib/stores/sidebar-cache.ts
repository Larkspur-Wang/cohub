import type { RuntimeListItem, SessionRecord } from "$lib/api";

const STORAGE_KEY = "cohub:sidebar_cache";
const CACHE_VERSION = 1;

interface CachedRuntimes {
  data: RuntimeListItem[];
  cachedAt: number;
}

interface CachedSessions {
  data: SessionRecord[];
  cachedAt: number;
}

interface SidebarCacheData {
  userUuid: string | null;
  version: number;
  runtimes: CachedRuntimes | null;
  sessionsByRuntime: Record<string, CachedSessions>;
}

// TTL constants (ms)
// Note: these TTLs control how long we serve cached data *before* hitting the API.
// On page load we always trigger a background refresh regardless, so stale cache is fine
// — the user sees content immediately and gets corrected data moments later.
const RUNTIMES_TTL = 300_000; // 5min — status changes infrequently, background refresh corrects it
const SESSIONS_TTL_ACTIVE = 1_800_000; // 30min — stable enough, SSE/BroadcastChannel keeps it fresh
const SESSIONS_TTL_HIBERNATED = 7_200_000; // 2h — hibernated sessions don't change
const SESSIONS_TTL_DELETED = 7_200_000; // 2h — dead data

class SidebarCache {
  private userUuid: string | null = null;

  private raw: SidebarCacheData = {
    userUuid: null,
    version: CACHE_VERSION,
    runtimes: null,
    sessionsByRuntime: {},
  };

  constructor() {
    this.restore();
  }

  private restore() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as SidebarCacheData;
        if (parsed.version === CACHE_VERSION) {
          this.raw = parsed;
          this.userUuid = parsed.userUuid;
        }
      }
    } catch {
      // ignore corrupted cache
    }
  }

  private persist() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.raw));
    } catch {
      // storage full — ignore
    }
  }

  // ─── Public API ───

  setUserUuid(uuid: string) {
    if (this.userUuid && this.userUuid !== uuid) {
      // User switched — clear all cache
      this.raw = {
        userUuid: uuid,
        version: CACHE_VERSION,
        runtimes: null,
        sessionsByRuntime: {},
      };
      this.userUuid = uuid;
      this.persist();
      return;
    }
    if (!this.userUuid) {
      this.userUuid = uuid;
      this.raw.userUuid = uuid;
      this.persist();
    }
  }

  // Runtimes

  /**
   * Always return cached runtimes if available, regardless of staleness.
   * Stale data is better than a blank screen — background refresh will correct it.
   */
  getRuntimes(): RuntimeListItem[] | null {
    return this.raw.runtimes?.data ?? null;
  }

  setRuntimes(data: RuntimeListItem[]) {
    this.raw.runtimes = { data, cachedAt: Date.now() };
    this.persist();
  }

  isRuntimesStale(): boolean {
    if (!this.raw.runtimes) return true;
    return this.isEntryStale(this.raw.runtimes, RUNTIMES_TTL);
  }

  // Sessions

  /**
   * Always return cached sessions if available, regardless of staleness.
   */
  getSessions(runtimeId: string): SessionRecord[] | null {
    const entry = this.raw.sessionsByRuntime[runtimeId];
    return entry?.data ?? null;
  }

  setSessions(runtimeId: string, data: SessionRecord[]) {
    this.raw.sessionsByRuntime[runtimeId] = { data, cachedAt: Date.now() };
    this.persist();
  }

  isSessionsStale(runtimeId: string): boolean {
    const entry = this.raw.sessionsByRuntime[runtimeId];
    if (!entry) return true;
    const runtime = this.raw.runtimes?.data.find((r) => r.id === runtimeId);
    const ttl = this.ttlForRuntimeStatus(runtime?.status ?? "running");
    return this.isEntryStale(entry, ttl);
  }

  // Cleanup

  invalidateRuntime(runtimeId: string) {
    delete this.raw.sessionsByRuntime[runtimeId];
    this.raw.runtimes = null;
    this.persist();
  }

  invalidateAll() {
    this.raw = {
      userUuid: null,
      version: CACHE_VERSION,
      runtimes: null,
      sessionsByRuntime: {},
    };
    this.userUuid = null;
    localStorage.removeItem(STORAGE_KEY);
  }

  // ─── Private helpers ───

  private isEntryStale(entry: { cachedAt: number }, ttl: number): boolean {
    return Date.now() - entry.cachedAt > ttl;
  }

  private ttlForRuntimeStatus(status: string): number {
    switch (status) {
      case "hibernated":
        return SESSIONS_TTL_HIBERNATED;
      case "deleted":
      case "error":
        return SESSIONS_TTL_DELETED;
      default:
        return SESSIONS_TTL_ACTIVE;
    }
  }
}

export const sidebarCache = new SidebarCache();
