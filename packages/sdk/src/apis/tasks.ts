import type { HttpTransport } from "../transport.js";
import type { TaskRunDetailResponse, TaskRunRecord } from "../types.js";

export class TasksApi {
  constructor(private readonly transport: HttpTransport) {}

  get(taskRunId: string) {
    return this.transport.request<TaskRunDetailResponse>(`/api/tasks/${taskRunId}`);
  }

  getMany(taskRunIds: string[], options?: { spaceId?: string }) {
    const ids = [...new Set(taskRunIds.filter(Boolean))];
    if (ids.length === 0) {
      return Promise.resolve({ runs: [] as TaskRunRecord[] });
    }
    if (ids.length > 100) throw new Error("At most 100 task runs can be fetched at once");
    return this.list({
      ids,
      spaceId: options?.spaceId,
      limit: ids.length,
    }).then(({ runs }) => ({ runs }));
  }

  list(filters?: { ids?: string[]; cronJobId?: string; spaceId?: string; sessionId?: string; taskType?: string; status?: "active" | TaskRunRecord["status"]; limit?: number; cursor?: string }) {
    const params = new URLSearchParams();
    if (filters?.ids?.length) params.set("ids", [...new Set(filters.ids)].join(","));
    if (filters?.cronJobId) params.set("cronJobId", filters.cronJobId);
    if (filters?.spaceId) params.set("spaceId", filters.spaceId);
    if (filters?.sessionId) params.set("sessionId", filters.sessionId);
    if (filters?.taskType) params.set("taskType", filters.taskType);
    if (filters?.status) params.set("status", filters.status);
    if (filters?.limit) params.set("limit", String(filters.limit));
    if (filters?.cursor) params.set("cursor", filters.cursor);
    const query = params.toString();
    return this.transport.request<{ runs: TaskRunRecord[]; pageInfo?: { hasMore: boolean; nextCursor: string | null } }>(
      `/api/tasks${query ? `?${query}` : ""}`,
    );
  }
}

