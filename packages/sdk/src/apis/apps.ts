import type { HttpTransport } from "../transport.js";
import type { RequestSource } from "@cohub/protocol/provenance";
import type { AppArtifactDescriptor, AppContentKind, AppPromotionEventKey } from "@cohub/protocol";
import type { Permission, SpacePublicProfile } from "../types.js";

export type AppTargetType = "file" | "directory" | "port";
export type AppStatus = "published" | "disabled";
export type AppVisibility = "public" | "space";

export type AppPresentationMeta = {
  hideCohubBar?: boolean;
};

/** Snapshot of fields extracted from the published page head. */
export type AppExtractedPageMeta = {
  title?: string | null;
  description?: string | null;
  icon?: string | null;
  image?: string | null;
  lang?: string | null;
  themeColor?: string | null;
  sourcePath?: string | null;
  extractedAt?: string | null;
};

/**
 * App presentation metadata.
 * `title` / `description` / `icon` / `image` / `lang` / `themeColor`
 * power public page head, share cards, and lists.
 */
export type AppMeta = Record<string, unknown> & {
  title?: string;
  /** @deprecated Prefer `title`. Kept for older clients. */
  name?: string;
  description?: string;
  icon?: string;
  image?: string;
  /** BCP 47 language tag from the published page (e.g. zh-CN). */
  lang?: string;
  /** CSS color from meta theme-color. */
  themeColor?: string;
  presentation?: AppPresentationMeta;
  extracted?: AppExtractedPageMeta;
  source?: RequestSource;
};

export type AppRecord = {
  id: string;
  spaceId: string;
  userUuid: string;
  slug: string;
  status: AppStatus;
  visibility: AppVisibility;
  targetType: AppTargetType;
  targetRef: string;
  assetKey: string | null;
  currentVersionId: string | null;
  latestVersion: number;
  publishedAt: string | null;
  workScopes: Permission[];
  allowedViewerScopes: Permission[];
  meta: AppMeta | null;
  createdAt: string | null;
  updatedAt: string | null;
};

export type AppCreateInput = {
  spaceId: string;
  slug: string;
  status?: AppStatus;
  visibility?: AppVisibility;
  targetType: AppTargetType;
  targetRef: string;
  assetKey?: string | null;
  workScopes?: Permission[];
  allowedViewerScopes?: Permission[];
  meta?: AppMeta | null;
};

export type AppUpdateInput = Partial<{
  slug: string;
  status: AppStatus;
  visibility: AppVisibility;
  targetType: AppTargetType;
  targetRef: string;
  workScopes: Permission[];
  allowedViewerScopes: Permission[];
  meta: AppMeta | null;
}>;

export type AppVersionRecord = {
  id: string;
  /** Frozen works REST field name; the storage column is app_id. */
  workId: string;
  version: number;
  targetType: AppTargetType;
  targetRef: string;
  assetKey: string | null;
  contentKind: AppContentKind;
  artifact: AppArtifactDescriptor | null;
  meta: AppMeta | null;
  createdAt: string | null;
};

export type AppContentDownload = {
  manifestUrl: string;
  manifestSha256: string;
};

export type AppContent =
  | { kind: "port"; url: string; targetType: "port"; port: string }
  | ((
      | { kind: "web"; url: string; targetType: "file" | "directory"; path: string }
      | {
          kind: "file";
          url: string;
          targetType: "file";
          path: string;
          name: string;
          mimeType: string | null;
          sizeBytes: number;
          sha256: string;
        }
    ) & {
      download?: AppContentDownload;
    })
  | {
      kind: "board";
      url: string;
      targetType: "file";
      path: string;
      boardId: string;
      boardVersion: number;
    };

export type AppPublicSpaceRecord = {
  id: string;
  slug: string;
  name: string | null;
  userUuid: string;
  publicProfile?: SpacePublicProfile | null;
};

export type AppPublicOwnerRecord = {
  userUuid: string;
  username: string;
  displayName: string;
  avatarUrl?: string | null;
};

export type AppDetailResponse = {
  work: AppRecord;
  space: AppPublicSpaceRecord;
  owner: AppPublicOwnerRecord;
  publicUrl: string | null;
  content: AppContent | null;
};

export type AppGetResponse = AppDetailResponse;

export type AppResolveResponse = AppDetailResponse;

export type AppViewSource = "web" | "cli" | "api";

export type AppViewStatsResponse = {
  summary: {
    totalViews: number;
    views24h: number;
    views7d: number;
    views30d: number;
  };
  daily: Array<{ date: string; views: number }>;
  sources: Array<{ source: AppViewSource; views: number }>;
};

export type AppPromotionProvider = "generic" | "meta";

export type AppPromotionRecord = {
  id: string;
  appId: string;
  name: string;
  provider: AppPromotionProvider | string;
  parameters: Record<string, string>;
  createdBy: string;
  createdAt: string;
};

export type AppPromotionProviderStatus = {
  key: AppPromotionProvider | string;
  configured: boolean;
};

export type AppPromotionCreateInput = {
  name: string;
  provider: AppPromotionProvider | string;
  parameters: Record<string, string>;
};

export type AppPromotionStatsResponse = {
  promotion: AppPromotionRecord;
  summary: {
    landing: number;
    ready: number;
    registrationCompleted: number;
    paywallViewed: number;
    checkoutStarted: number;
    readyRate: number;
  };
  daily: Array<{
    date: string;
    landing: number;
    ready: number;
    registrationCompleted: number;
    paywallViewed: number;
    checkoutStarted: number;
  }>;
};

export type AppPromotionEventResponse = {
  ok: true;
  eventId: string;
  browser:
    | { provider: "generic" }
    | { provider: "meta"; pixelId: string }
    | null;
};

export type AppSessionResponse = {
  token: string;
  expiresIn: number;
  work: AppRecord;
};

export type AppAuthorizeResponse = {
  token: string;
  expiresIn: number;
  grant: {
    id: string;
    scopes: Permission[];
    expiresAt: string;
  };
};

export class AppsApi {
  constructor(private readonly transport: HttpTransport) {}

  listBySpace(spaceId: string) {
    return this.transport.request<{ works: AppRecord[] }>(`/api/works/space/${spaceId}`);
  }

  get(id: string) {
    return this.transport.request<AppGetResponse>(`/api/works/${id}`);
  }

  /**
   * Loads a published app's metadata + owner info by id (public access model).
   * Used by the standalone app auth broker page.
   */
  getPublicById(id: string) {
    return this.transport.request<AppResolveResponse>(`/api/works/${id}/public`);
  }

  getBySlug(
    username: string,
    spaceSlug: string,
    appSlug: string,
    options?: { signal?: AbortSignal },
  ) {
    return this.transport.request<AppResolveResponse>(
      `/api/works/by-slug/${encodeURIComponent(username)}/${encodeURIComponent(spaceSlug)}/${encodeURIComponent(appSlug)}`,
      options?.signal ? { signal: options.signal } : undefined,
    );
  }

  create(input: AppCreateInput) {
    return this.transport.request<{ work: AppRecord }>("/api/works", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
  }

  update(id: string, input: AppUpdateInput) {
    return this.transport.request<{ work: AppRecord }>(`/api/works/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
  }

  delete(id: string) {
    return this.transport.request<{ ok: true }>(`/api/works/${id}`, {
      method: "DELETE",
    });
  }

  getStats(appId: string) {
    return this.transport.request<AppViewStatsResponse>(`/api/works/${appId}/stats`);
  }

  listPromotions(appId: string) {
    return this.transport.request<{
      promotions: AppPromotionRecord[];
      providers: AppPromotionProviderStatus[];
    }>(`/api/works/${appId}/promotions`);
  }

  createPromotion(appId: string, input: AppPromotionCreateInput) {
    return this.transport.request<{ promotion: AppPromotionRecord }>(
      `/api/works/${appId}/promotions`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      },
    );
  }

  getPromotionStats(appId: string, promotionId: string) {
    return this.transport.request<AppPromotionStatsResponse>(
      `/api/works/${appId}/promotions/${promotionId}/stats`,
    );
  }

  recordPromotionEvent(
    appId: string,
    promotionId: string,
    input: {
      eventKey: AppPromotionEventKey;
      eventId?: string;
      sourceUrl?: string;
      fbp?: string;
      fbc?: string;
      productKey?: string;
    },
  ) {
    return this.transport.request<AppPromotionEventResponse>(
      `/api/works/${appId}/promotions/${promotionId}/events`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      },
    );
  }

  recordPromotionRegistration(
    appId: string,
    promotionId: string,
    input?: { sourceUrl?: string; fbp?: string; fbc?: string },
  ) {
    return this.transport.request<{
      reported: boolean;
      eventId: string | null;
      browser: AppPromotionEventResponse["browser"];
    }>(
      `/api/works/${appId}/promotions/${promotionId}/registration`,
      {
        method: "POST",
        headers: input ? { "Content-Type": "application/json" } : undefined,
        body: input ? JSON.stringify(input) : undefined,
      },
    );
  }

  listVersions(appId: string) {
    return this.transport.request<{ versions: AppVersionRecord[] }>(`/api/works/${appId}/versions`);
  }

  publishVersion(appId: string, input?: { meta?: AppMeta | null }) {
    return this.transport.request<{ work: AppRecord; version: AppVersionRecord }>(`/api/works/${appId}/versions`, {
      method: "POST",
      headers: input ? { "Content-Type": "application/json" } : undefined,
      body: input ? JSON.stringify(input) : undefined,
    });
  }

  createSession(appId: string) {
    return this.transport.request<AppSessionResponse>(`/api/works/${appId}/session`, {
      method: "POST",
    });
  }

  authorize(appId: string, input: { scopes: Permission[]; reason?: string }) {
    return this.transport.request<AppAuthorizeResponse>(`/api/works/${appId}/authorize`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
  }
}

// ── Legacy aliases ────────────────────────────────────────────────────────────
// The works REST paths and payload field names are frozen for existing API
// consumers (see AppRecord); these type aliases keep the work-era names
// compiling until the next breaking SDK version.

/** @deprecated Use `AppTargetType`. */
export type WorkTargetType = AppTargetType;
/** @deprecated Use `AppStatus`. */
export type WorkStatus = AppStatus;
/** @deprecated Use `AppVisibility`. */
export type WorkVisibility = AppVisibility;
/** @deprecated Use `AppPresentationMeta`. */
export type WorkPresentationMeta = AppPresentationMeta;
/** @deprecated Use `AppExtractedPageMeta`. */
export type WorkExtractedPageMeta = AppExtractedPageMeta;
/** @deprecated Use `AppMeta`. */
export type WorkMeta = AppMeta;
/** @deprecated Use `AppRecord`. */
export type WorkRecord = AppRecord;
/** @deprecated Use `AppCreateInput`. */
export type WorkCreateInput = AppCreateInput;
/** @deprecated Use `AppUpdateInput`. */
export type WorkUpdateInput = AppUpdateInput;
/** @deprecated Use `AppVersionRecord`. */
export type WorkVersionRecord = AppVersionRecord;
/** @deprecated Use `AppContentDownload`. */
export type WorkContentDownload = AppContentDownload;
/** @deprecated Use `AppContent`. */
export type WorkContent = AppContent;
/** @deprecated Use `AppPublicSpaceRecord`. */
export type WorkPublicSpaceRecord = AppPublicSpaceRecord;
/** @deprecated Use `AppPublicOwnerRecord`. */
export type WorkPublicOwnerRecord = AppPublicOwnerRecord;
/** @deprecated Use `AppDetailResponse`. */
export type WorkDetailResponse = AppDetailResponse;
/** @deprecated Use `AppGetResponse`. */
export type WorkGetResponse = AppGetResponse;
/** @deprecated Use `AppResolveResponse`. */
export type WorkResolveResponse = AppResolveResponse;
/** @deprecated Use `AppViewSource`. */
export type WorkViewSource = AppViewSource;
/** @deprecated Use `AppViewStatsResponse`. */
export type WorkViewStatsResponse = AppViewStatsResponse;
/** @deprecated Use `AppPromotionProvider`. */
export type WorkPromotionProvider = AppPromotionProvider;
/** @deprecated Use `AppPromotionRecord`. */
export type WorkPromotionRecord = AppPromotionRecord;
/** @deprecated Use `AppPromotionProviderStatus`. */
export type WorkPromotionProviderStatus = AppPromotionProviderStatus;
/** @deprecated Use `AppPromotionCreateInput`. */
export type WorkPromotionCreateInput = AppPromotionCreateInput;
/** @deprecated Use `AppPromotionStatsResponse`. */
export type WorkPromotionStatsResponse = AppPromotionStatsResponse;
/** @deprecated Use `AppPromotionEventResponse`. */
export type WorkPromotionEventResponse = AppPromotionEventResponse;
/** @deprecated Use `AppSessionResponse`. */
export type WorkSessionResponse = AppSessionResponse;
/** @deprecated Use `AppAuthorizeResponse`. */
export type WorkAuthorizeResponse = AppAuthorizeResponse;
