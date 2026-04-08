import type { RuntimeListItem, SessionRecord } from "$lib/api";

const STORAGE_KEY = "cohub:sidebar_cache";
const CACHE_VERSION = 1;

// Max cached sessions entries (oldest by last access are evicted)
const MAX_RUNTIME_ENTRIES = 50;

interface SidebarCacheData {
  userUuid: string | null;
  version: number;
  runtimes: RuntimeListItem[] | null;
  sessionsByRuntime: Record<string, SessionRecord[]>;
}

class SidebarCache {
  private data: SidebarCacheData = {
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
          this.data = parsed;
        }
      }
    } catch {
      // ignore corrupted data
    }
  }

  private persist() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.data));
    } catch {
      // storage full — silently ignore
    }
  }

  // ─── Public API ───

  setUserUuid(uuid: string) {
    if (this.data.userUuid && this.data.userUuid !== uuid) {
      // user switched — wipe cache
      this.data = {
        userUuid: uuid,
        version: CACHE_VERSION,
        runtimes: null,
        sessionsByRuntime: {},
      };
      this.persist();
      return;
    }
    if (!this.data.userUuid) {
      this.data.userUuid = uuid;
      this.persist();
    }
  }

  getRuntimes(): RuntimeListItem[] | null {
    return this.data.runtimes;
  }

  setRuntimes(data: RuntimeListItem[]) {
    this.data.runtimes = data;
    this.persist();
  }

  getSessions(runtimeId: string): SessionRecord[] | null {
    return this.data.sessionsByRuntime[runtimeId] ?? null;
  }

  setSessions(runtimeId: string, sessions: SessionRecord[]) {
    this.data.sessionsByRuntime[runtimeId] = sessions;
    this.trim();
    this.persist();
  }

  invalidateAll() {
    this.data = {
      userUuid: null,
      version: CACHE_VERSION,
      runtimes: null,
      sessionsByRuntime: {},
    };
    localStorage.removeItem(STORAGE_KEY);
  }

  // ─── Private ───

  /** Evict oldest entries when exceeding the limit */
  private trim() {
    const keys = Object.keys(this.data.sessionsByRuntime);
    if (keys.length <= MAX_RUNTIME_ENTRIES) return;
    // Keep the most recently set entries (last N keys in insertion order)
    const toRemove = keys.slice(0, keys.length - MAX_RUNTIME_ENTRIES);
    for (const key of toRemove) {
      delete this.data.sessionsByRuntime[key];
    }
    this.persist();
  }
}

export const sidebarCache = new SidebarCache();
