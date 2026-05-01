export type CacheSource = "memory" | "indexeddb" | "network";

export type CacheSnapshot<T> = {
	data: T;
	source: CacheSource;
	updatedAt: number;
	stale: boolean;
};

export type SessionListPageInfo = {
	hasMore: boolean;
	nextCursor: string | null;
};

export const DEFAULT_SESSION_LIST_PAGE_INFO: SessionListPageInfo = {
	hasMore: false,
	nextCursor: null,
};
