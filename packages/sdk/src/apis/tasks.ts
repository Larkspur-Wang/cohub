import type { HttpTransport } from "../transport.js";
import type { TaskRunDetailResponse, TaskRunRecord } from "../types.js";

export class TasksApi {
  constructor(private readonly transport: HttpTransport) {}

  get(taskRunId: string) {
    return this.transport.request<TaskRunDetailResponse>(`/api/tasks/${taskRunId}`);
  }

  list(filters?: { cronJobId?: string; spaceId?: string; sessionId?: string; taskType?: string; status?: "active" | TaskRunRecord["status"]; limit?: number; cursor?: string }) {
    const params = new URLSearchParams();
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

