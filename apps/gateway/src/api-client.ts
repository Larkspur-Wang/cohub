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
  const response = await fetch(`${gatewayConfig.apiBaseUrl}/api/me`, {
    headers: {
      authorization: `Bearer ${input.token}`,
    },
  });

  if (response.status === 401 || response.status === 403) {
    return {
      ok: false,
      status: response.status,
      error: {
        message: response.status === 403 ? "Forbidden" : "Unauthorized",
        type: "authentication_error",
      },
    };
  }

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`Realtime auth failed ${response.status}: ${text}`);
  }

  const user = await parseJson<GatewayAuthUser>(response);
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
  };
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
