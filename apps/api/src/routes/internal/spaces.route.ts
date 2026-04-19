import { Hono } from "hono";
import type {
  PersistMessageInput,
  UpdateSessionInfoInput,
  RegisterSessionInput,
  ContentBlock,
} from "@cohub/protocol";
import {
  getSpaceById,
  getSpaceSessionBootstrap,
  getSpaceSessionById,
  persistMessageNode,
  registerSpaceSession,
  updateSpaceSessionInfo,
  enqueueSpacePrompt,
  updateSpaceStatus,
  SandboxNotReadyError,
} from "../../space-sessions.js";
import {
  getSandboxPodByIp,
  getSpaceSandboxBySpaceId,
  updateSpaceSandbox,
} from "../../space-sandboxes.js";
import {
  ensureInternalRequest,
  getRequestRemoteAddress,
  requireValidId,
} from "../../lib/middleware.js";

const ALLOWED_SANDBOX_META_KEYS = new Set([
  "workspaceDir",
  "repoCloned",
  "configApplied",
  "preparedAt",
  "sandboxId",
  "lastProvisionedAt",
  "lastStatus",
  "lastError",
  "podIp",
  "podName",
  "hostname",
  "imageVersion",
  "prepareStatus",
  "prepareError",
  "startedAt",
]);

function sanitizeSandboxMeta(input: Record<string, unknown> | null | undefined) {
  if (!input) return null;
  const output: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    if (!ALLOWED_SANDBOX_META_KEYS.has(key)) continue;
    if (
      value === null ||
      typeof value === "string" ||
      typeof value === "number" ||
      typeof value === "boolean"
    ) {
      output[key] = value;
    }
  }
  return Object.keys(output).length > 0 ? output : null;
}

const router = new Hono();

// POST /internal/spaces/:id/status
router.post("/:id/status", async (c) => {
  const forbidden = ensureInternalRequest(c);
  if (forbidden) return forbidden;

  const spaceId = c.req.param("id");
  if (!requireValidId(spaceId)) return c.json({ message: "space not found" }, 404);
  const space = await getSpaceById(spaceId);
  if (!space) return c.json({ message: "space not found" }, 404);

  const body = await c.req.json<{ status?: string; meta?: Record<string, unknown> | null }>().catch(() => null);
  if (!body?.status) return c.json({ message: "status is required" }, 400);

  await updateSpaceStatus(spaceId, body.status);

  const safeMeta = sanitizeSandboxMeta(body.meta);
  if (safeMeta) {
    try {
      const sandbox = await getSpaceSandboxBySpaceId(spaceId);
      await updateSpaceSandbox({
        spaceId,
        meta: {
          ...((sandbox?.meta as Record<string, unknown> | null) ?? {}),
          ...safeMeta,
        },
        lastHeartbeatAt: new Date(),
      });
    } catch (error) {
      console.warn("[SandboxStatus] Failed to persist sandbox meta:", error);
    }
  }

  return c.json({ ok: true });
});

// POST /internal/spaces/:id/sandbox-report
router.post("/:id/sandbox-report", async (c) => {
  const spaceId = c.req.param("id");
  if (!requireValidId(spaceId)) return c.json({ message: "space not found" }, 404);
  const space = await getSpaceById(spaceId);
  if (!space) return c.json({ message: "space not found" }, 404);

  const body = await c
    .req.json<{
      status?: string;
      podIp?: string;
      podName?: string;
      sandboxId?: string;
      meta?: Record<string, unknown> | null;
    }>()
    .catch(() => null);
  if (!body?.status) return c.json({ message: "status is required" }, 400);
  if (!body?.podIp?.trim()) return c.json({ message: "podIp is required" }, 400);

  const remoteAddress = getRequestRemoteAddress(c);
  if (!remoteAddress || remoteAddress !== body.podIp.trim()) {
    return c.json({ message: "forbidden" }, 403);
  }

  const pod = await getSandboxPodByIp(body.podIp.trim()).catch(() => null);
  if (!pod) return c.json({ message: "forbidden" }, 403);
  if (pod.metadata?.labels?.app !== "agent-sandbox") return c.json({ message: "forbidden" }, 403);
  if (pod.metadata?.labels?.["space-id"] !== spaceId) return c.json({ message: "forbidden" }, 403);
  if (body.podName?.trim() && pod.metadata?.name !== body.podName.trim()) {
    return c.json({ message: "forbidden" }, 403);
  }

  const safeMeta = sanitizeSandboxMeta({
    ...(body.meta ?? {}),
    podIp: body.podIp.trim(),
    podName: body.podName?.trim() || pod.metadata?.name || null,
    sandboxId: body.sandboxId?.trim() || null,
  });
  const sandbox = await getSpaceSandboxBySpaceId(spaceId);

  await updateSpaceSandbox({
    spaceId,
    status:
      body.status === "ready"
        ? "ready"
        : body.status === "error"
          ? "error"
          : "provisioning",
    podName: body.podName?.trim() || pod.metadata?.name || `sandbox-${spaceId}`,
    lastHeartbeatAt: new Date(),
    meta: {
      ...((sandbox?.meta as Record<string, unknown> | null) ?? {}),
      ...(safeMeta ?? {}),
    },
  });

  return c.json({ ok: true });
});

// GET /internal/spaces/:id/sandbox
router.get("/:id/sandbox", async (c) => {
  const forbidden = ensureInternalRequest(c);
  if (forbidden) return forbidden;

  const spaceId = c.req.param("id");
  if (!requireValidId(spaceId)) return c.json({ message: "space not found" }, 404);
  const space = await getSpaceById(spaceId);
  if (!space) return c.json({ message: "space not found" }, 404);

  const sandbox = await getSpaceSandboxBySpaceId(spaceId);
  return c.json({ sandbox: sandbox ?? null });
});

// POST /internal/spaces/:id/sessions
router.post("/:id/sessions", async (c) => {
  const forbidden = ensureInternalRequest(c);
  if (forbidden) return forbidden;

  const spaceId = c.req.param("id");
  if (!requireValidId(spaceId)) return c.json({ message: "space not found" }, 404);
  const space = await getSpaceById(spaceId);
  if (!space) return c.json({ message: "space not found" }, 404);

  const body = await c.req.json<RegisterSessionInput>().catch(() => null);
  if (!body?.sessionId) return c.json({ message: "sessionId is required" }, 400);

  const existing = await getSpaceSessionById(body.sessionId);
  if (existing) {
    const bootstrap = await getSpaceSessionBootstrap(existing.id);
    return c.json({ ok: true, session: existing, bootstrap });
  }

  const session = await registerSpaceSession({
    spaceId,
    sessionId: body.sessionId,
    title: body.title,
    externalSessionId: body.externalSessionId,
    meta: body.meta,
  });
  const bootstrap = await getSpaceSessionBootstrap(session.id);
  return c.json({ ok: true, session, bootstrap });
});

// POST /internal/spaces/:spaceId/sessions/:sessionId/info
router.post("/:spaceId/sessions/:sessionId/info", async (c) => {
  const forbidden = ensureInternalRequest(c);
  if (forbidden) return forbidden;

  const spaceId = c.req.param("spaceId");
  const sessionId = c.req.param("sessionId");
  if (!requireValidId(spaceId) || !requireValidId(sessionId)) return c.json({ message: "session not found" }, 404);

  const session = await getSpaceSessionById(sessionId);
  if (!session || session.spaceId !== spaceId) return c.json({ message: "session not found" }, 404);

  const body = await c.req.json<UpdateSessionInfoInput>().catch(() => null);
  if (!body) return c.json({ message: "invalid body" }, 400);

  await updateSpaceSessionInfo({
    spaceId,
    sessionId,
    title: body.title,
    updatedAt: body.updatedAt,
    meta: body.meta,
  });

  return c.json({ ok: true });
});

// POST /internal/spaces/:spaceId/sessions/:sessionId/messages
router.post("/:spaceId/sessions/:sessionId/messages", async (c) => {
  const forbidden = ensureInternalRequest(c);
  if (forbidden) return forbidden;

  const spaceId = c.req.param("spaceId");
  const sessionId = c.req.param("sessionId");
  if (!requireValidId(spaceId) || !requireValidId(sessionId)) return c.json({ message: "session not found" }, 404);

  const session = await getSpaceSessionById(sessionId);
  if (!session || session.spaceId !== spaceId) return c.json({ message: "session not found" }, 404);

  const body = await c
    .req.json<{
      previousMessageId?: string | null;
      anchorUserMessageId?: string | null;
      idempotencyKey?: string;
      message?: PersistMessageInput["message"] & { id?: string | null };
    }>()
    .catch(() => null);
  if (!body?.idempotencyKey?.trim()) return c.json({ message: "idempotencyKey is required" }, 400);
  if (!body.message || !Array.isArray(body.message.content)) return c.json({ message: "message.content is required" }, 400);

  const messageNode = await persistMessageNode({
    spaceId,
    sessionId,
    previousMessageId: body.previousMessageId ?? null,
    anchorUserMessageId: body.anchorUserMessageId ?? null,
    idempotencyKey: body.idempotencyKey,
    message: {
      ...(body.message as PersistMessageInput["message"]),
      id: body.message.id ?? undefined,
      content: body.message.content as never,
    } as PersistMessageInput["message"] & { id?: string },
  });

  return c.json({ ok: true, message: messageNode });
});

// POST /internal/spaces/:spaceId/sessions/:sessionId/prompt
router.post("/:spaceId/sessions/:sessionId/prompt", async (c) => {
  const forbidden = ensureInternalRequest(c);
  if (forbidden) return forbidden;

  const spaceId = c.req.param("spaceId");
  const sessionId = c.req.param("sessionId");
  if (!requireValidId(spaceId) || !requireValidId(sessionId)) return c.json({ message: "session not found" }, 404);

  const session = await getSpaceSessionById(sessionId);
  if (!session || session.spaceId !== spaceId) return c.json({ message: "session not found" }, 404);

  const body = await c
    .req.json<{ content: ContentBlock[]; userMessageId?: string | null; meta?: Record<string, unknown> | null }>()
    .catch(() => null);
  if (!body || !Array.isArray(body.content) || body.content.length === 0) {
    return c.json({ message: "content is required" }, 400);
  }

  const userMessageId = body.userMessageId?.trim() || crypto.randomUUID();
  try {
    await enqueueSpacePrompt({
      spaceId,
      sessionId,
      userMessageId,
      content: body.content,
      meta: body.meta ?? null,
    });
  } catch (error) {
    if (error instanceof SandboxNotReadyError) return c.json({ message: error.message }, 409);
    throw error as Error;
  }

  return c.json({ ok: true, userMessageId });
});

export default router;
