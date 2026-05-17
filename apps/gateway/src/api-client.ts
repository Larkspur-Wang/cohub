import type { AuthUserProfile } from "@cohub/identity";
import { AuthorizationError, verifyUserAccessToken } from "@cohub/identity";
import type { ContentBlock } from "@cohub/protocol/core";
import type { GatewayAuthUser } from "./config.js";
import { gatewayConfig } from "./config.js";

const parseJson = async <T>(response: Response): Promise<T | null> => {
  return response.json().catch(() => null) as Promise<T | null>;
};

export type RealtimeAuthResult =
  | {
      ok: true;
      user: GatewayAuthUser & { uuid: string };
    }
  | {
      ok: false;
      status: 401 | 403;
      error: {
        message: string;
        type: "authentication_error";
      };
    };

export type SessionAuthorizationResult =
  | {
      ok: true;
      user: GatewayAuthUser & { uuid: string };
      spaceId: string;
      sessionId: string;
    }
  | {
      ok: false;
      status: 401 | 403 | 404;
      error: {
        message: string;
        type: "authentication_error" | "invalid_request_error";
      };
    };

export const authenticateRealtimeToken = async (input: { token: string }): Promise<RealtimeAuthResult> => {
  let user: AuthUserProfile;
  try {
    user = await verifyUserAccessToken({ token: input.token, logtoEndpoint: gatewayConfig.logtoEndpoint });
  } catch (error) {
    const status = error instanceof AuthorizationError ? error.status : 401;
    return {
      ok: false,
      status,
      error: {
        message: status === 403 ? "Forbidden" : "Unauthorized",
        type: "authentication_error",
      },
    };
  }

  return {
    ok: true,
    user,
  };
};

export const submitInternalSessionPrompt = async (input: {
  spaceId: string;
  sessionId: string;
  userId: string;
  clientMessageId: string;
  content: ContentBlock[];
  source: string;
  model?: string | null;
  provider?: string | null;
  context?: Record<string, unknown> | null;
}): Promise<{ ok: true; turnId: string; userMessageId: string }> => {
  const response = await fetch(`${gatewayConfig.apiBaseUrl}/internal/spaces/${input.spaceId}/sessions/${input.sessionId}/prompt`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-worker-secret": gatewayConfig.workerSecret,
    },
    body: JSON.stringify({
      content: input.content,
      userId: input.userId,
      clientMessageId: input.clientMessageId,
      source: input.source,
      model: input.model ?? null,
      provider: input.provider ?? null,
      context: input.context ?? null,
    }),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`Internal prompt submit failed ${response.status}: ${text}`);
  }
  const data = await parseJson<{ ok?: boolean; turnId?: string; userMessageId?: string }>(response);
  if (!data?.ok || !data.turnId || !data.userMessageId) {
    throw new Error("Internal prompt submit returned an invalid response");
  }
  return { ok: true, turnId: data.turnId, userMessageId: data.userMessageId };
};

export const authorizeSessionAccess = async (input: {
  token: string;
  spaceId: string;
  sessionId: string;
}): Promise<SessionAuthorizationResult> => {
  const sessionResponse = await fetch(`${gatewayConfig.apiBaseUrl}/api/sessions/${input.sessionId}`, {
    headers: {
      authorization: `Bearer ${input.token}`,
    },
  });

  if (sessionResponse.status === 401 || sessionResponse.status === 403) {
    return {
      ok: false,
      status: sessionResponse.status,
      error: {
        message: sessionResponse.status === 403 ? "Forbidden" : "Unauthorized",
        type: "authentication_error",
      },
    };
  }

  if (sessionResponse.status === 404) {
    return {
      ok: false,
      status: 404,
      error: {
        message: "Session not found",
        type: "invalid_request_error",
      },
    };
  }

  if (!sessionResponse.ok) {
    const text = await sessionResponse.text().catch(() => "");
    throw new Error(`Session authorization failed ${sessionResponse.status}: ${text}`);
  }

  const data = await parseJson<{
    space?: { id?: string };
    session?: { id?: string };
    user?: GatewayAuthUser;
  }>(sessionResponse);

  if (!data?.space?.id || !data?.session?.id) {
    return {
      ok: false,
      status: 404,
      error: {
        message: "Session not found",
        type: "invalid_request_error",
      },
    };
  }

  if (data.space.id !== input.spaceId || data.session.id !== input.sessionId) {
    return {
      ok: false,
      status: 404,
      error: {
        message: "Session does not belong to space",
        type: "invalid_request_error",
      },
    };
  }

  const user = data.user;
  if (!user?.uuid) {
    return {
      ok: false,
      status: 401,
      error: {
        message: "Unauthorized",
        type: "authentication_error",
      },
    };
  }

  return {
    ok: true,
    user: user as GatewayAuthUser & { uuid: string },
    spaceId: data.space.id,
    sessionId: data.session.id,
  };
};
