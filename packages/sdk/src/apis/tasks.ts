import type { HttpTransport } from "../transport.js";
import type { CreateScheduledTaskInput, TaskRunDetailResponse, TaskRunRecord } from "../types.js";

export class TasksApi {
  constructor(private readonly transport: HttpTransport) {}

  get(taskRunId: string) {
    return this.transport.request<TaskRunDetailResponse>(`/api/tasks/${taskRunId}`);
  }

  list(filters?: { cronJobId?: string; spaceId?: string }) {
    const params = new URLSearchParams();
    if (filters?.cronJobId) params.set("cronJobId", filters.cronJobId);
    if (filters?.spaceId) params.set("spaceId", filters.spaceId);
    const query = params.toString();
    return this.transport.request<{ runs: TaskRunRecord[] }>(
      `/api/tasks${query ? `?${query}` : ""}`,
    );
  }

  createScheduled(data: CreateScheduledTaskInput) {
    return this.transport.request<{ ok: true; taskRunId: string; scheduledAt: string }>(
      "/api/tasks",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      },
    );
  }
}
