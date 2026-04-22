import type { HttpTransport } from "../transport.js";
import type { CreateCronJobInput, CronJobRecord, TaskRunRecord } from "../types.js";

export class CronJobsApi {
  constructor(private readonly transport: HttpTransport) {}

  list(spaceId?: string) {
    const query = spaceId ? `?spaceId=${encodeURIComponent(spaceId)}` : "";
    return this.transport.request<{ jobs: CronJobRecord[] }>(`/api/cron-jobs${query}`);
  }

  create(data: CreateCronJobInput) {
    return this.transport.request<CronJobRecord>("/api/cron-jobs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
  }

  delete(id: string) {
    return this.transport.request<{ ok: true }>(`/api/cron-jobs/${id}`, {
      method: "DELETE",
    });
  }

  toggle(id: string, enabled: boolean) {
    return this.transport.request<{ ok: true }>(`/api/cron-jobs/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled }),
    });
  }

  runs(cronJobId: string) {
    return this.transport.request<{ runs: TaskRunRecord[] }>(
      `/api/cron-jobs/${cronJobId}/runs`,
    );
  }
}
