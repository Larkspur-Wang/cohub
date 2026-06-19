import type { HttpTransport } from "../transport.js";
import type { Permission, SpacePublicProfile } from "../types.js";

export type WorkTargetType = "file" | "directory" | "port";
export type WorkStatus = "draft" | "published" | "disabled";

export type WorkRecord = {
  id: string;
  spaceId: string;
  userUuid: string;
  slug: string;
  status: WorkStatus;
  targetType: WorkTargetType;
  targetRef: string;
  assetKey: string | null;
  currentVersionId: string | null;
  latestVersion: number;
  publishedAt: string | null;
  workScopes: Permission[];
  allowedViewerScopes: Permission[];
  meta: Record<string, unknown> | null;
  createdAt: string | null;
  updatedAt: string | null;
};

export type WorkCreateInput = {
  spaceId: string;
  slug: string;
  status?: WorkStatus;
  targetType: WorkTargetType;
  targetRef: string;
  assetKey?: string | null;
  workScopes?: Permission[];
  allowedViewerScopes?: Permission[];
  meta?: Record<string, unknown> | null;
};

export type WorkUpdateInput = Partial<{
  slug: string;
  status: WorkStatus;
  targetType: WorkTargetType;
  targetRef: string;
  publishVersion: boolean;
  workScopes: Permission[];
  allowedViewerScopes: Permission[];
  meta: Record<string, unknown> | null;
}>;

export type WorkVersionRecord = {
  id: string;
  workId: string;
  spaceId: string;
  version: number;
  status: WorkStatus;
  targetType: WorkTargetType;
  targetRef: string;
  assetKey: string | null;
  meta: Record<string, unknown> | null;
  createdAt: string | null;
  publishedAt: string | null;
};

export type WorkContent =
  | { url: string; targetType: "port"; port: string }
  | { url: string; targetType: WorkTargetType; path: string };

export type WorkSessionResponse = {
  token: string;
  expiresIn: number;
  work: WorkRecord;
};

export type WorkAuthorizeResponse = {
  token: string;
  expiresIn: number;
  grant: {
    id: string;
    scopes: Permission[];
    expiresAt: string;
  };
};

export class WorksApi {
  constructor(private readonly transport: HttpTransport) {}

  listBySpace(spaceId: string) {
    return this.transport.request<{ works: WorkRecord[] }>(`/api/works/space/${spaceId}`);
  }

  get(id: string) {
    return this.transport.request<{ work: WorkRecord }>(`/api/works/${id}`);
  }

  getBySlug(username: string, spaceSlug: string, workSlug: string) {
    return this.transport.request<{
      work: WorkRecord;
      space: { id: string; slug: string | null; name: string | null; userUuid: string; publicProfile?: SpacePublicProfile | null };
      owner: { userUuid: string; username: string | null; displayName: string; avatarUrl?: string | null };
      content?: WorkContent | null;
    }>(
      `/api/works/by-slug/${encodeURIComponent(username)}/${encodeURIComponent(spaceSlug)}/${encodeURIComponent(workSlug)}`,
    );
  }

  create(input: WorkCreateInput) {
    return this.transport.request<{ work: WorkRecord }>("/api/works", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
  }

  update(id: string, input: WorkUpdateInput) {
    return this.transport.request<{ work: WorkRecord }>(`/api/works/${id}`, {
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

  listVersions(workId: string) {
    return this.transport.request<{ versions: WorkVersionRecord[] }>(`/api/works/${workId}/versions`);
  }

  createSession(workId: string) {
    return this.transport.request<WorkSessionResponse>(`/api/works/${workId}/session`, {
      method: "POST",
    });
  }

  authorize(workId: string, input: { scopes: Permission[]; reason?: string }) {
    return this.transport.request<WorkAuthorizeResponse>(`/api/works/${workId}/authorize`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
  }
}
