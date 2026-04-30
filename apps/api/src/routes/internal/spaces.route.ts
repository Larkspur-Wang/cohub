import { Hono } from "hono";
import { attachSandboxPublicEndpoints } from "../../sandbox-public-network.js";
import type {
  PersistMessageInput,
  UpdateSessionInfoInput,
  RegisterSessionInput,
} from "@neta-art/cohub-protocol/model";
import type { ContentBlock } from "@neta-art/cohub-protocol/core";
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
import { interruptSessionTurn } from "../../session-turns.js";
import { getSpaceSandboxBySpaceId, updateSpaceSandbox } from "../../space-sandboxes.js";
import { db } from "../../db/index.js";
import { spaceSessionBindings, spaceChannels, userChannels } from "../../db/schema-v2.js";
import { isSandboxReportTokenValid } from "../../crypto.js";
import { and, eq } from "drizzle-orm";
import {
  ensureInternalRequest,
  getRequestRemoteAddress,
  isPrivateNetworkAddress,
  requireValidId,
} from "../../lib/middleware.js";

const ALLOWED_SANDBOX_META_KEYS = new Set([
  "workspaceDir",
  "sandboxId",
  "lastProvisionedAt",
  "lastStatus",
  "lastError",
  "podName",
  "podIp",
  "hostname",
  "imageVersion",
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
const MAX_FEISHU_DOCUMENT_CHARS = 24_000;
const FEISHU_OPEN_API_BASE_URL = "https://open.feishu.cn";
const LARK_OPEN_API_BASE_URL = "https://open.larksuite.com";

type FeishuDocumentRef = {
  url?: string | null;
  type: "docx" | "wiki";
  token: string;
};

class FeishuDocumentInputError extends Error {
  readonly status = 400 as const;
}

class FeishuUpstreamError extends Error {
  readonly status = 502 as const;
}

function extractFeishuDocumentRef(input: string): FeishuDocumentRef {
  const value = input.trim();
  let url: URL | null = null;
  try {
    url = new URL(value);
  } catch {
    url = null;
  }

  if (url) {
    if (!/(^|\.)(feishu\.cn|larksuite\.com|larkoffice\.com)$/.test(url.hostname)) {
      throw new FeishuDocumentInputError("doc_id must be a Feishu/Lark document URL or token");
    }
    const pathMatch = url.pathname.match(/\/(docx|wiki|docs)\/([A-Za-z0-9]+)/);
    if (!pathMatch?.[1] || !pathMatch[2]) {
      throw new FeishuDocumentInputError("unsupported Feishu document URL; expected /docx/ or /wiki/; legacy /docs/ URLs are not supported");
    }
    if (pathMatch[1] === "docs") {
      throw new FeishuDocumentInputError("legacy Feishu /docs/ URLs are not supported by feishu_fetch_doc; use a /docx/ or /wiki/ URL");
    }
    return {
      url: value,
      type: pathMatch[1] as "docx" | "wiki",
      token: pathMatch[2],
    };
  }

  if (!/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new FeishuDocumentInputError("doc_id must be a Feishu/Lark document URL or token");
  }
  return { type: value.startsWith("wiki") ? "wiki" : "docx", token: value };
}

async function resolveFeishuCredentialsForSession(input: { spaceId: string; sessionId: string }) {
  const [row] = await db
    .select({ credentials: userChannels.credentials })
    .from(spaceSessionBindings)
    .innerJoin(spaceChannels, eq(spaceChannels.id, spaceSessionBindings.spaceChannelId))
    .innerJoin(userChannels, eq(userChannels.id, spaceChannels.channelId))
    .where(and(
      eq(spaceSessionBindings.spaceId, input.spaceId),
      eq(spaceSessionBindings.spaceSessionId, input.sessionId),
      eq(spaceSessionBindings.provider, "feishu"),
      eq(spaceSessionBindings.status, "active"),
      eq(userChannels.provider, "feishu"),
      eq(userChannels.status, "active"),
    ))
    .limit(1);

  const credentials = row?.credentials as Record<string, unknown> | undefined;
  const appId = typeof credentials?.appId === "string" ? credentials.appId.trim() : "";
  const appSecret = typeof credentials?.appSecret === "string" ? credentials.appSecret.trim() : "";
  const brand: "feishu" | "lark" = credentials?.brand === "lark" ? "lark" : "feishu";
  if (!appId || !appSecret) return null;
  return { appId, appSecret, brand };
}

function getFeishuOpenApiBaseUrl(brand: "feishu" | "lark") {
  return brand === "lark" ? LARK_OPEN_API_BASE_URL : FEISHU_OPEN_API_BASE_URL;
}

async function requestFeishuJson(input: {
  brand: "feishu" | "lark";
  path: string;
  method?: "GET" | "POST";
  token?: string;
  body?: Record<string, unknown>;
  query?: Record<string, string>;
}) {
  const baseUrl = getFeishuOpenApiBaseUrl(input.brand);
  const url = new URL(input.path, baseUrl);
  for (const [key, value] of Object.entries(input.query ?? {})) {
    url.searchParams.set(key, value);
  }

  const response = await fetch(url, {
    method: input.method ?? "GET",
    headers: {
      "content-type": "application/json",
      ...(input.token ? { authorization: `Bearer ${input.token}` } : {}),
    },
    body: input.body ? JSON.stringify(input.body) : undefined,
  });
  const data = await response.json().catch(() => null) as Record<string, unknown> | null;
  const code = typeof data?.code === "number" ? data.code : 0;
  if (!response.ok || code !== 0) {
    const message = typeof data?.msg === "string" ? data.msg : response.statusText;
    throw new FeishuUpstreamError(`Feishu API ${input.path} failed: ${message || response.status}`);
  }
  return data;
}

async function getFeishuTenantAccessToken(credentials: { appId: string; appSecret: string; brand: "feishu" | "lark" }) {
  const data = await requestFeishuJson({
    brand: credentials.brand,
    path: "/open-apis/auth/v3/tenant_access_token/internal",
    method: "POST",
    body: { app_id: credentials.appId, app_secret: credentials.appSecret },
  });
  const token = typeof data?.tenant_access_token === "string" ? data.tenant_access_token : "";
  if (!token) throw new FeishuUpstreamError("Feishu API did not return tenant_access_token");
  return token;
}

async function resolveFeishuWikiRef(credentials: { brand: "feishu" | "lark" }, token: string, ref: FeishuDocumentRef): Promise<FeishuDocumentRef> {
  if (ref.type !== "wiki") return ref;
  const res = await requestFeishuJson({
    brand: credentials.brand,
    token,
    path: "/open-apis/wiki/v2/spaces/get_node",
    query: { token: ref.token },
  });
  const data = res?.data as Record<string, unknown> | undefined;
  const node = data?.node as Record<string, unknown> | undefined;
  const objToken = typeof node?.obj_token === "string" ? node.obj_token : "";
  const objType = typeof node?.obj_type === "string" ? node.obj_type : "";
  if (!objToken) throw new FeishuUpstreamError("failed to resolve wiki token");
  if (objType !== "docx") throw new FeishuDocumentInputError(`wiki object type ${objType || "unknown"} is not supported by feishu_fetch_doc`);
  return { ...ref, type: "docx", token: objToken };
}

// GET /internal/spaces/:id
router.get("/:id", async (c) => {
  const forbidden = ensureInternalRequest(c);
  if (forbidden) return forbidden;

  const spaceId = c.req.param("id");
  if (!requireValidId(spaceId)) return c.json({ message: "space not found" }, 404);
  const space = await getSpaceById(spaceId);
  if (!space) return c.json({ message: "space not found" }, 404);

  return c.json({
    space: {
      id: space.id,
      userUuid: space.userUuid,
      name: space.name,
    },
  });
});

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
  const remoteAddress = getRequestRemoteAddress(c);
  if (!isPrivateNetworkAddress(remoteAddress)) return c.json({ message: "forbidden" }, 403);

  const spaceId = c.req.param("id");
  if (!requireValidId(spaceId)) return c.json({ message: "space not found" }, 404);
  const space = await getSpaceById(spaceId);
  if (!space) return c.json({ message: "space not found" }, 404);

  const body = await c
    .req.json<{
      status?: string;
      podName?: string;
      sandboxId?: string;
      meta?: Record<string, unknown> | null;
    }>()
    .catch(() => null);
  if (!body?.status) return c.json({ message: "status is required" }, 400);

  const sandboxReportToken = c.req.header("x-sandbox-report-token")?.trim();
  if (!sandboxReportToken) return c.json({ message: "forbidden" }, 403);

  const sandbox = await getSpaceSandboxBySpaceId(spaceId);
  const sandboxMeta = (sandbox?.meta as Record<string, unknown> | null) ?? null;
  const expectedTokenHash = typeof sandboxMeta?.reportTokenHash === "string" ? sandboxMeta.reportTokenHash : null;
  if (!sandbox || !expectedTokenHash || !isSandboxReportTokenValid(sandboxReportToken, expectedTokenHash)) {
    return c.json({ message: "forbidden" }, 403);
  }

  const safeMeta = sanitizeSandboxMeta({
    ...(body.meta ?? {}),
    podName: body.podName?.trim() || sandbox.podName || null,
    sandboxId: body.sandboxId?.trim() || null,
  });
  const reportedImageVersion = typeof safeMeta?.imageVersion === "string"
    ? safeMeta.imageVersion.trim() || null
    : null;

  await updateSpaceSandbox({
    spaceId,
    status:
      body.status === "ready"
        ? "ready"
        : body.status === "error"
          ? "error"
          : "provisioning",
    podName: body.podName?.trim() || sandbox.podName || `sandbox-${spaceId}`,
    reportedImageVersion,
    reportedAt: reportedImageVersion ? new Date() : undefined,
    lastHeartbeatAt: new Date(),
    meta: {
      ...(sandboxMeta ?? {}),
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
  return c.json({ sandbox: attachSandboxPublicEndpoints(sandbox) });
});

// GET /internal/spaces/:id/capabilities
router.get("/:id/capabilities", async (c) => {
  const forbidden = ensureInternalRequest(c);
  if (forbidden) return forbidden;

  const spaceId = c.req.param("id");
  if (!requireValidId(spaceId)) return c.json({ message: "space not found" }, 404);
  const space = await getSpaceById(spaceId);
  if (!space) return c.json({ message: "space not found" }, 404);

  const [feishuChannel] = await db
    .select({ id: spaceChannels.id })
    .from(spaceChannels)
    .innerJoin(userChannels, eq(userChannels.id, spaceChannels.channelId))
    .where(and(
      eq(spaceChannels.spaceId, spaceId),
      eq(userChannels.provider, "feishu"),
      eq(userChannels.status, "active"),
    ))
    .limit(1);

  return c.json({
    capabilities: {
      feishu: Boolean(feishuChannel),
    },
  });
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
      userId?: string | null;
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
    userId: body.userId ?? null,
    idempotencyKey: body.idempotencyKey,
    message: {
      ...(body.message as PersistMessageInput["message"]),
      id: body.message.id ?? undefined,
      content: body.message.content as never,
    } as PersistMessageInput["message"] & { id?: string },
  });

  return c.json({ ok: true, message: messageNode });
});

// POST /internal/spaces/:spaceId/sessions/:sessionId/turns/:turnId/interrupt
router.post("/:spaceId/sessions/:sessionId/turns/:turnId/interrupt", async (c) => {
  const forbidden = ensureInternalRequest(c);
  if (forbidden) return forbidden;

  const spaceId = c.req.param("spaceId");
  const sessionId = c.req.param("sessionId");
  const turnId = c.req.param("turnId");
  if (!requireValidId(spaceId) || !requireValidId(sessionId) || !requireValidId(turnId)) return c.json({ message: "turn not found" }, 404);

  const session = await getSpaceSessionById(sessionId);
  if (!session || session.spaceId !== spaceId) return c.json({ message: "session not found" }, 404);

  const body = await c.req.json<{ interruptedByTurnId?: string | null }>().catch(() => null);
  const interruptedByTurnId = body?.interruptedByTurnId?.trim();
  if (!interruptedByTurnId || !requireValidId(interruptedByTurnId)) return c.json({ message: "interruptedByTurnId is required" }, 400);

  const turn = await interruptSessionTurn({ spaceId, sessionId, turnId, interruptedByTurnId });
  return c.json({ ok: true, turn });
});

// POST /internal/spaces/:spaceId/sessions/:sessionId/tools/feishu-fetch-doc
router.post("/:spaceId/sessions/:sessionId/tools/feishu-fetch-doc", async (c) => {
  const forbidden = ensureInternalRequest(c);
  if (forbidden) return forbidden;

  const spaceId = c.req.param("spaceId");
  const sessionId = c.req.param("sessionId");
  if (!requireValidId(spaceId) || !requireValidId(sessionId)) return c.json({ message: "session not found" }, 404);

  const session = await getSpaceSessionById(sessionId);
  if (!session || session.spaceId !== spaceId) return c.json({ message: "session not found" }, 404);

  const credentials = await resolveFeishuCredentialsForSession({ spaceId, sessionId });
  if (!credentials) return c.json({ message: "feishu_fetch_doc is only available for sessions bound to a Feishu channel" }, 403);

  const body = await c.req.json<{ doc_id?: string; offset?: number; limit?: number }>().catch(() => null);
  const docId = body?.doc_id?.trim();
  if (!docId) return c.json({ message: "doc_id is required" }, 400);

  const offset = Number.isInteger(body?.offset) && (body?.offset ?? 0) > 0 ? body?.offset ?? 0 : 0;
  const limit = Number.isInteger(body?.limit) && (body?.limit ?? 0) > 0
    ? Math.min(body?.limit ?? MAX_FEISHU_DOCUMENT_CHARS, MAX_FEISHU_DOCUMENT_CHARS)
    : MAX_FEISHU_DOCUMENT_CHARS;

  try {
    const rawRef = extractFeishuDocumentRef(docId);
    const tenantAccessToken = await getFeishuTenantAccessToken(credentials);
    const ref = await resolveFeishuWikiRef(credentials, tenantAccessToken, rawRef);
    if (ref.type !== "docx") return c.json({ message: `document type ${ref.type} is not supported by feishu_fetch_doc` }, 400);

    const res = await requestFeishuJson({
      brand: credentials.brand,
      token: tenantAccessToken,
      path: `/open-apis/docx/v1/documents/${ref.token}/raw_content`,
    });
    const data = res?.data as Record<string, unknown> | undefined;
    const content = typeof data?.content === "string" ? data.content : "";
    const safeOffset = Math.min(offset, content.length);
    const page = content.slice(safeOffset, safeOffset + limit);

    return c.json({
      ok: true,
      document: {
        type: ref.type,
        token: ref.token,
        url: rawRef.url ?? null,
        content: page,
        offset: safeOffset,
        limit,
        totalLength: content.length,
        hasMore: safeOffset + limit < content.length,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const status: 400 | 502 = error instanceof FeishuDocumentInputError
      ? error.status
      : error instanceof FeishuUpstreamError
        ? error.status
        : 502;
    return c.json({ message }, status);
  }
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
