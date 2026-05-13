import type {
  CreateGenerationRequest,
  Generation,
} from "@neta-art/cohub-protocol";
import type { HttpTransport } from "../transport.js";

export class GenerationsApi {
  constructor(private readonly transport: HttpTransport) {}

  async create(request: CreateGenerationRequest): Promise<Generation> {
    return this.transport.request<Generation>("/api/generations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
    });
  }
}
