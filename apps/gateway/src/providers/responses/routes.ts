import { streamSSE } from "hono/streaming";
import type { Hono } from "hono";
import type { Context, MiddlewareHandler } from "hono";
import type { OpenAIResponsesCreateRequest } from "@cohub/protocol";
import { gatewayConfig, OpenAIResponsesCreateRequestSchema } from "../../config.js";
import { authorizeSessionAccess } from "../../api-client.js";
import {
  buildResponseObject,
  buildStreamEvents,
  createSessionResponse,
  normalizeSessionResponseRequest,
} from "../../interaction/index.js";

export type SessionResponseVariables = {
  token: string;
  authUser: { uuid: string };
};

const parseBearer = (value?: string | null) => {
  if (!value) return null;
  const [scheme, token] = value.split(" ");
  if (scheme?.toLowerCase() !== "bearer" || !token) return null;
  return token;
};

const isUuid = (value: string) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);

const requireSessionAccess: MiddlewareHandler<{ Variables: SessionResponseVariables }> = async (c, next) => {
  const token = parseBearer(c.req.header("authorization"));
  if (!token) return c.json({ error: { message: "Unauthorized", type: "invalid_request_error" } }, 401);

  const runtimeId = c.req.param("runtimeId") || "";
  const sessionId = c.req.param("sessionId") || "";
  if (!isUuid(runtimeId) || !isUuid(sessionId)) {
    return c.json({ error: { message: "Invalid runtime or session id", type: "invalid_request_error" } }, 400);
  }

  const authzResult = await authorizeSessionAccess({ token, runtimeId, sessionId }).catch((error: unknown) => error);
  const authz = authzResult as Awaited<ReturnType<typeof authorizeSessionAccess>> | Error;
  if (authz instanceof Error) {
    return c.json({ error: { message: authz.message, type: "server_error" } }, 500);
  }

  if (!authz.ok) {
    return c.json({ error: authz.error }, authz.status);
  }

  c.set("token", token);
  c.set("authUser", { uuid: authz.user.uuid });
  await next();
};

const parseRequestBody = async (c: Context): Promise<OpenAIResponsesCreateRequest | null> => {
  const raw = await c.req.json().catch(() => null);
  if (!raw) return null;
  const parsed = OpenAIResponsesCreateRequestSchema.safeParse(raw);
  if (!parsed.success) return null;
  return parsed.data;
};

export const registerResponsesProviderRoutes = (app: Hono<{ Variables: SessionResponseVariables }>) => {
  app.get("/healthz", (c) => c.json({ ok: true, apiBaseUrl: gatewayConfig.apiBaseUrl }));
  app.get("/readyz", (c) => c.json({ ok: true }));

  app.post(
    "/v1/runtimes/:runtimeId/sessions/:sessionId/responses",
    requireSessionAccess,
    async (c) => {
      const runtimeId = c.req.param("runtimeId") || "";
      const sessionId = c.req.param("sessionId") || "";
      const body = await parseRequestBody(c);
      if (!body) {
        return c.json({ error: { message: "Invalid request body", type: "invalid_request_error" } }, 400);
      }

      const request = normalizeSessionResponseRequest({ runtimeId, sessionId, body });
      if (!request.inputText.trim()) {
        return c.json({ error: { message: "input is required", type: "invalid_request_error" } }, 400);
      }

      const token = c.get("token");
      const authUser = c.get("authUser");

      if (request.stream) {
        return streamSSE(c, async (stream) => {
          try {
            const result = await createSessionResponse({
              token,
              actorUserId: authUser.uuid,
              source: "responses",
              request,
              signal: c.req.raw.signal,
            });

            for (const event of buildStreamEvents(result)) {
              await stream.writeSSE({ data: JSON.stringify(event) });
            }
            await stream.writeSSE({ data: "[DONE]" });
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            await stream.writeSSE({
              data: JSON.stringify({
                type: "response.failed",
                response: {
                  id: `resp_error_${Date.now()}`,
                  object: "response",
                  created_at: Math.floor(Date.now() / 1000),
                  status: "failed",
                  model: request.model ?? "cohub-agent",
                  error: {
                    message,
                    type: "server_error",
                  },
                },
              }),
            });
            await stream.writeSSE({ data: "[DONE]" });
          }
        });
      }

      try {
        const result = await createSessionResponse({
          token,
          actorUserId: authUser.uuid,
          source: "responses",
          request,
          signal: c.req.raw.signal,
        });
        return c.json(buildResponseObject(result));
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return c.json({ error: { message, type: "server_error" } }, 500);
      }
    },
  );
};
