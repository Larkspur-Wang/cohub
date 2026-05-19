import type { ExploreSpacesResponse } from "../types.js";
import type { HttpTransport } from "../transport.js";

export class ExploreApi {
  constructor(private readonly transport: HttpTransport) {}

  spaces() {
    return this.transport.request<ExploreSpacesResponse>(
      "/api/explore/spaces",
    );
  }
}
