import type { HttpTransport } from "../transport.js";
import type {
  SpaceInvitation,
  SpaceRole,
  CreateInvitationInput,
  CreateInvitationResponse,
  InvitationDetail,
  AcceptInvitationResponse,
} from "../types.js";

export class SpaceInvitationsApi {
  constructor(
    private readonly transport: HttpTransport,
    private readonly spaceId: string,
  ) {}

  list() {
    return this.transport.request<{ items: SpaceInvitation[] }>(
      `/api/spaces/${this.spaceId}/invitations`,
    );
  }

  create(input?: CreateInvitationInput) {
    return this.transport.request<CreateInvitationResponse>(
      `/api/spaces/${this.spaceId}/invitations`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input ?? {}),
      },
    );
  }

  revoke(token: string) {
    return this.transport.request<{ ok: true }>(
      `/api/spaces/${this.spaceId}/invitations/${token}`,
      { method: "DELETE" },
    );
  }
}

// Public invite API (no auth required for viewing)
export class PublicInviteApi {
  constructor(private readonly transport: HttpTransport) {}

  get(token: string) {
    return this.transport.request<InvitationDetail>(
      `/api/invite/${token}`,
    );
  }

  accept(token: string) {
    return this.transport.request<AcceptInvitationResponse>(
      `/api/invite/${token}/accept`,
      {
        method: "POST",
      },
    );
  }
}
