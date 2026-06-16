import type { HttpTransport } from "../transport.js";
import type { BatchUserProfilesResponse } from "../types.js";

const MAX_BATCH_USER_PROFILES = 100;

export class UsersApi {
  constructor(private readonly transport: HttpTransport) {}

  getProfiles(input: { userUuids: string[] }) {
    const uniqueUserUuidCount = new Set(input.userUuids.map((userUuid) => userUuid.trim())).size;
    if (uniqueUserUuidCount > MAX_BATCH_USER_PROFILES) {
      throw new Error(`userUuids must contain at most ${MAX_BATCH_USER_PROFILES} unique items`);
    }

    return this.transport.request<BatchUserProfilesResponse>("/api/users/profiles/batch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
  }
}
