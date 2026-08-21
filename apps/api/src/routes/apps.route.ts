import { Hono, type Context } from "hono";
import { and, desc, eq, inArray, ne, sql } from "drizzle-orm";
import { spaces, apps, appPromotions, appPromotionStatsHourly, appVersions, appViewerGrants, appViewStatsHourly, userProfiles } from "@cohub/db";
import { createAppAssetPublicUrl, deleteAppAssetsByObjectKey, isConfiguredAppAssetPublicUrl } from "../app-asset-storage.js";
import { publishAppAssetInWorker, type WorkPublishAssetJobResult } from "../app-publish-asset-queue.js";
import type { Permission } from "@cohub/core/permissions";
import { materializeHtmlPageMeta, mergeAppPageMeta } from "@cohub/core/apps";
import { db } from "../db/index.js";
import { isPostgresUniqueViolation } from "../db/postgres-error.js";
import {
  authzDenied,
  getOptionalAuth,
  getSpacePublicProfile,
  getAppSessionPrincipal,
  requireValidId,
  useAuth,
  type AuthUser,
} from "../lib/middleware.js";
import { hasPermission } from "../permissions.js";
import { createAppSessionToken, APP_SESSION_TTL_SECONDS } from "../app-sessions.js";
import { getSandboxPublicEndpoints } from "../sandbox-public-network.js";
import type { AppArtifactDescriptor, AppContentKind } from "@cohub/protocol";
import { SANDBOX_PUBLIC_PORTS } from "@cohub/protocol/ports";
import { config, isHostAllowedBySuffix } from "../config.js";
import type { RealtimeAppRecord, RealtimeAppVersionRecord } from "@cohub/protocol/realtime";
import { createLogger } from "@cohub/infra/logging";
import { billingOperations, COHUB_BILLING_FEATURES } from "@cohub/billing";
import { featureGateResponse } from "../lib/feature-gate.js";
import { createAppPublicUrl } from "../lib/app-public-url.js";
import { applyRequestSourceToMeta, getRequestSource } from "../lib/request-source.js";
import { dispatchAppVersionPublished } from "../app-events.js";
import { ensureUserProfileByUuid } from "../user-profiles.js";
import {
  getAppViewStats,
  recordAppViewStatsHourly,
  resolveAppViewSource,
  type AppViewSource,
} from "../app-view-stats.js";
import {
  createAppRoom,
  createAppRoomAdmission,
  getAppRoomByCode,
  AppRoomError,
} from "../app-realtime-rooms.js";

const logger = createLogger({ serviceName: "cohub-api" });
const router = new Hono();

const WORK_STATUSES = new Set(["published", "disabled"]);
const WORK_VISIBILITIES = new Set(["public", "space"]);
const TARGET_TYPES = new Set(["file", "directory", "port"]);
const SLUG_RE = /^[a-z0-9](?:[a-z0-9_-]{0,78}[a-z0-9])?$/;
/** Public work payloads are safe to edge/browser cache briefly. */
const PUBLIC_WORK_HTTP_CACHE = "public, max-age=60, stale-while-revalidate=300";
const PRIVATE_WORK_HTTP_CACHE = "private, no-store";
const SANDBOX_PUBLIC_PORT_SET = new Set<number>(SANDBOX_PUBLIC_PORTS as readonly number[]);
const ALLOWED_APP_SCOPES = new Set<Permission>(["space.view", "session.view", "file.view", "taskrun.view"]);
const ALLOWED_VIEWER_SCOPES = new Set<Permission>([
  "taskrun.view",
  "session.prompt.readonly",
  "session.prompt.fullaccess",
  "generation.create",
  "user.space.list",
  "user.session.list",
  "user.usage.read",
]);


const normalizeScopes = (value: unknown, allowed: Set<Permission>): Permission[] => {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(value.filter((item): item is Permission => typeof item === "string" && allowed.has(item as Permission))));
};

type AppMeta = Record<string, unknown>;

const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === "object" && !Array.isArray(value));

const getAppMeta = (value: unknown): AppMeta | null => isRecord(value) ? value : null;

const getHideCohubBar = (meta: AppMeta | null | undefined): boolean => {
  const presentation = isRecord(meta?.presentation) ? meta.presentation : null;
  return presentation?.hideCohubBar === true;
};

async function canHideCohubBar(userId: string) {
  try {
    const entitlement = await billingOperations.getFeatureEntitlement({
      userId,
      featureKey: COHUB_BILLING_FEATURES.workPublishHideCohubBar,
    });
    return Boolean(entitlement?.enabled);
  } catch (error) {
    logger.warn("[apps] failed to check hide Cohub bar entitlement", { userId, error });
    return false;
  }
}

async function ensureWorkPresentationAllowed(c: Context, input: { userId: string; meta: AppMeta | null | undefined }) {
  if (!getHideCohubBar(input.meta)) return null;
  if (await canHideCohubBar(input.userId)) return null;
  return appHideCohubBarRequiredResponse(c);
}

const isSubset = (requested: Permission[], allowed: string[]) => requested.every((scope) => allowed.includes(scope));

const isAppSlugConflict = (error: unknown) => isPostgresUniqueViolation(error, "v2_uq_apps_space_slug");
const invalidAppStatusResponse = (c: Context) => c.json({ message: "status must be one of: published, disabled" }, 400);
const invalidAppVisibilityResponse = (c: Context) => c.json({ message: "visibility must be one of: public, space" }, 400);
const requiresSpaceAppAccess = (app: Pick<typeof apps.$inferSelect, "visibility">) => (app.visibility ?? "public") === "space";
const appHideCohubBarRequiredResponse = (c: Context) =>
  featureGateResponse(c, {
    source: "work_hide_cohub_bar",
    message: "This option is available on Pro and Max.",
    title: "Upgrade to hide the Cohub bar",
    conversionMessage: "Hiding the Cohub bar is available on Pro and Max.",
  });
async function getAppPublicIdentity(spaceId: string) {
  const [row] = await db
    .select({
      ownerUserUuid: spaces.userUuid,
      spaceSlug: spaces.slug,
      ownerUsername: userProfiles.username,
    })
    .from(spaces)
    .leftJoin(userProfiles, eq(userProfiles.userUuid, spaces.userUuid))
    .where(eq(spaces.id, spaceId))
    .limit(1);
  return {
    ownerUserUuid: row?.ownerUserUuid ?? null,
    ownerUsername: row?.ownerUsername?.trim() || null,
    spaceSlug: row?.spaceSlug?.trim() || null,
  };
}

async function ensureAppPublicIdentity(c: Context, spaceId: string, actor: AuthUser) {
  let identity = await getAppPublicIdentity(spaceId);
  if (!identity.ownerUsername && identity.ownerUserUuid) {
    await ensureUserProfileByUuid(identity.ownerUserUuid, actor);
    identity = await getAppPublicIdentity(spaceId);
  }
  const missingOwner = !identity.ownerUsername;
  const missingSpaceSlug = !identity.spaceSlug;
  if (!missingOwner && !missingSpaceSlug) return null;
  if (missingOwner && missingSpaceSlug) {
    return c.json({ message: "apps require an owner username and a space slug" }, 400);
  }
  if (missingOwner) return c.json({ message: "apps require an owner username" }, 400);
  return c.json({ message: "apps require a space slug" }, 400);
}

const ensureUniqueAppSlug = async (input: { spaceId: string; slug: string; excludeId?: string }) => {
  const conditions = [eq(apps.spaceId, input.spaceId), eq(apps.slug, input.slug)];
  if (input.excludeId) conditions.push(ne(apps.id, input.excludeId));
  const [existingApp] = await db
    .select({ id: apps.id })
    .from(apps)
    .where(and(...conditions))
    .limit(1);
  return !existingApp;
};

const normalizePortRef = (value: string) => {
  if (!/^\d{2,5}$/.test(value)) return null;
  const port = Number(value);
  if (!Number.isInteger(port) || !SANDBOX_PUBLIC_PORT_SET.has(port)) return null;
  return String(port);
};

const isAllowedAppContentUrl = (url: string, kind: "asset" | "port") => {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:") return false;
    if (kind === "asset") return isConfiguredAppAssetPublicUrl(url);
    return isHostAllowedBySuffix(parsed.hostname, config.allowedAppContentHostSuffixes);
  } catch {
    return false;
  }
};

const serializeApp = (app: typeof apps.$inferSelect): RealtimeAppRecord => ({
  id: app.id,
  spaceId: app.spaceId,
  userUuid: app.userUuid,
  slug: app.slug,
  status: app.status as RealtimeAppRecord["status"],
  visibility: (app.visibility ?? "public") as RealtimeAppRecord["visibility"],
  targetType: app.targetType as RealtimeAppRecord["targetType"],
  targetRef: app.targetRef,
  assetKey: app.assetKey,
  currentVersionId: app.currentVersionId,
  latestVersion: app.latestVersion ?? 0,
  publishedAt: app.publishedAt?.toISOString() ?? null,
  // `workScopes` is the frozen works REST field name; the storage column is app_scopes.
  workScopes: app.appScopes ?? [],
  allowedViewerScopes: app.allowedViewerScopes ?? [],
  meta: getAppMeta(app.meta),
  createdAt: app.createdAt?.toISOString() ?? null,
  updatedAt: app.updatedAt?.toISOString() ?? null,
});

const serializeAppVersion = (version: typeof appVersions.$inferSelect): RealtimeAppVersionRecord => ({
  id: version.id,
  // `workId` is the frozen works REST field name; the storage column is app_id.
  workId: version.appId,
  version: version.version,
  targetType: version.targetType as RealtimeAppVersionRecord["targetType"],
  targetRef: version.targetRef,
  assetKey: version.assetKey,
  contentKind: version.contentKind as AppContentKind,
  artifact: isRecord(version.artifact) ? version.artifact as AppArtifactDescriptor : null,
  meta: getAppMeta(version.meta),
  createdAt: version.createdAt?.toISOString() ?? null,
});

async function getAppById(id: string) {
  const [app] = await db.select().from(apps).where(eq(apps.id, id)).limit(1);
  return app ?? null;
}

let lastAppViewRecordWarningAt = 0;

function recordResolvedAppView(
  c: Context,
  app: typeof apps.$inferSelect,
  fallbackSource: AppViewSource,
) {
  if (app.status !== "published" || !app.currentVersionId) return;
  void recordAppViewStatsHourly({
    appId: app.id,
    appVersionId: app.currentVersionId,
    source: resolveAppViewSource(getRequestSource(c), fallbackSource),
  }).catch((error) => {
    const now = Date.now();
    if (now - lastAppViewRecordWarningAt < 60_000) return;
    lastAppViewRecordWarningAt = now;
    logger.warn("[apps] failed to buffer view", { appId: app.id, error });
  });
}

class AppAssetPublishError extends Error {
  constructor(public result: Extract<WorkPublishAssetJobResult, { ok: false }>) {
    super(result.message);
  }
}

type WrittenAppAsset = {
  assetKey: string;
  artifact: AppArtifactDescriptor;
  extracted: ReturnType<typeof materializeHtmlPageMeta> | null;
};

async function writeAppAsset(input: {
  spaceId: string;
  slug: string;
  targetType: string;
  targetRef: string;
  status: string;
}): Promise<WrittenAppAsset | null> {
  const { spaceId, slug, targetType, targetRef, status } = input;
  if (status !== "published" || (targetType !== "file" && targetType !== "directory")) return null;
  const result = await publishAppAssetInWorker({ spaceId, slug, targetType, targetRef });
  if (!result.ok) throw new AppAssetPublishError(result);
  const extracted = result.extracted
    ? materializeHtmlPageMeta(
        {
          title: result.extracted.title,
          description: result.extracted.description,
          icon: result.extracted.icon,
          image: result.extracted.image,
          lang: result.extracted.lang ?? null,
          themeColor: result.extracted.themeColor ?? null,
          sourcePath: result.extracted.sourcePath,
        },
        result.assetKey,
        createAppAssetPublicUrl,
      )
    : null;
  return {
    assetKey: result.assetKey,
    // An older worker returns no descriptor; every publish it can perform is an
    // HTML page or site, so `web` reconstructs it faithfully.
    artifact: result.artifact ?? {
      kind: "web",
      mimeType: "text/html",
      sizeBytes: result.sizeBytes,
      fileCount: result.fileCount ?? 1,
    },
    extracted,
  };
}

function withPublishedPageMeta(input: {
  baseMeta: AppMeta | null | undefined;
  extracted: WrittenAppAsset["extracted"];
}) {
  return mergeAppPageMeta(input.baseMeta, input.extracted ?? undefined);
}

function appAssetErrorResponse(c: Context, error: unknown, context: { spaceId: string; targetType: string; targetRef: string }) {
  if (error instanceof AppAssetPublishError) {
    return c.json({ message: error.result.message.toLowerCase().replace(/\.$/, ""), code: error.result.code }, error.result.status as never);
  }
  logger.warn("[apps] failed to write work asset", { ...context, error });
  return c.json({ message: "work asset storage failed" }, 502);
}

async function cleanupAppAssets(assetKey: string | null | undefined, context: { appId: string; spaceId: string; reason: string }) {
  if (!assetKey) return;
  try {
    await deleteAppAssetsByObjectKey(assetKey);
  } catch (error) {
    logger.warn("[apps] failed to delete stale work asset", { ...context, assetKey, error });
  }
}

const getAppContent = (input: {
  spaceId: string;
  targetType: string;
  targetRef: string;
  assetKey: string | null;
  contentKind: string;
  artifact: Record<string, unknown> | null;
}) => {
  if (input.targetType === "port") {
    const portRef = normalizePortRef(input.targetRef);
    if (!portRef) return null;
    const url = getSandboxPublicEndpoints(input.spaceId)[portRef]?.url;
    if (!url || !isAllowedAppContentUrl(url, "port")) return null;
    return { kind: "port" as const, url, targetType: "port" as const, port: portRef };
  }
  if (!input.assetKey) return null;
  const url = createAppAssetPublicUrl(input.assetKey);
  if (!isAllowedAppContentUrl(url, "asset")) return null;
  if (input.contentKind === "board" && input.artifact?.kind === "board") {
    return {
      kind: "board" as const,
      url,
      targetType: "file" as const,
      path: input.targetRef,
      boardId: String(input.artifact.boardId),
      boardVersion: Number(input.artifact.boardVersion),
    };
  }
  const rawDownload = isRecord(input.artifact?.download) ? input.artifact.download : null;
  const manifestKey = typeof rawDownload?.manifestKey === "string" ? rawDownload.manifestKey : null;
  const manifestSha256 = typeof rawDownload?.manifestSha256 === "string" ? rawDownload.manifestSha256 : null;
  const manifestUrl = manifestKey ? createAppAssetPublicUrl(manifestKey) : null;
  const download = manifestUrl && manifestSha256 && isAllowedAppContentUrl(manifestUrl, "asset")
    ? { manifestUrl, manifestSha256 }
    : null;
  if (input.contentKind === "file" && input.artifact?.kind === "file") {
    return {
      kind: "file" as const,
      url,
      targetType: "file" as const,
      path: input.targetRef,
      name: String(input.artifact.name),
      mimeType: typeof input.artifact.mimeType === "string" ? input.artifact.mimeType : null,
      sizeBytes: Number(input.artifact.sizeBytes),
      sha256: String(input.artifact.sha256),
      ...(download ? { download } : {}),
    };
  }
  return {
    kind: "web" as const,
    url,
    targetType: input.targetType as "file" | "directory",
    path: input.targetRef,
    ...(download ? { download } : {}),
  };
};

async function getPublishedAppContent(app: typeof apps.$inferSelect) {
  if (app.status !== "published" || !app.currentVersionId) return null;
  const [version] = await db.select().from(appVersions).where(eq(appVersions.id, app.currentVersionId)).limit(1);
  if (!version) return null;
  return getAppContent({
    spaceId: app.spaceId,
    targetType: version.targetType,
    targetRef: version.targetRef,
    assetKey: version.assetKey,
    contentKind: version.contentKind,
    artifact: version.artifact,
  });
}

router.get("/by-slug/:username/:spaceSlug/:appSlug", async (c) => {
  const user = getOptionalAuth(c);
  const username = c.req.param("username");
  const spaceSlug = c.req.param("spaceSlug");
  const appSlug = c.req.param("appSlug");
  if (!username || !SLUG_RE.test(spaceSlug) || !SLUG_RE.test(appSlug)) return c.json({ message: "work not found" }, 404);

  const [row] = await db
    .select({
      owner: { userUuid: userProfiles.userUuid, username: userProfiles.username, displayName: userProfiles.displayName, avatarUrl: userProfiles.avatarUrl },
      space: spaces,
      app: apps,
    })
    .from(userProfiles)
    .innerJoin(spaces, and(eq(spaces.userUuid, userProfiles.userUuid), eq(spaces.slug, spaceSlug)))
    .innerJoin(apps, and(eq(apps.spaceId, spaces.id), eq(apps.slug, appSlug), eq(apps.status, "published")))
    .where(eq(userProfiles.username, username))
    .limit(1);
  if (!row) return c.json({ message: "work not found" }, 404);
  if (!row.owner.username || !row.space.slug) return c.json({ message: "work public identity is incomplete" }, 409);
  if (requiresSpaceAppAccess(row.app) && !(await hasPermission(user, "space.view", { spaceId: row.space.id }))) return authzDenied(c);

  recordResolvedAppView(c, row.app, "web");
  const content = await getPublishedAppContent(row.app);

  // Public apps are anonymous-readable; space apps depend on the caller.
  c.header(
    "Cache-Control",
    requiresSpaceAppAccess(row.app) ? PRIVATE_WORK_HTTP_CACHE : PUBLIC_WORK_HTTP_CACHE,
  );
  return c.json({
    work: serializeApp(row.app),
    space: { id: row.space.id, slug: row.space.slug, name: row.space.name, userUuid: row.space.userUuid, publicProfile: getSpacePublicProfile(row.space) },
    owner: { ...row.owner, username: row.owner.username },
    publicUrl: createAppPublicUrl({ ownerUsername: row.owner.username, spaceSlug: row.space.slug, appSlug: row.app.slug, status: row.app.status }),
    content,
  });
});


router.get("/space/:spaceId", async (c) => {
  const user = useAuth(c);
  if (user instanceof Response) return user;
  const spaceId = c.req.param("spaceId");
  if (!requireValidId(spaceId)) return c.json({ message: "space not found" }, 404);
  if (!(await hasPermission(user, "space.view", { spaceId }))) return authzDenied(c);
  const rows = await db.select().from(apps).where(eq(apps.spaceId, spaceId));
  return c.json({ apps: rows.map(serializeApp) });
});

router.get("/:id/public", async (c) => {
  // Public endpoint used by the standalone work auth broker page to load work
  // metadata + owner info by appId. Mirrors the by-slug access model: only
  // space-visibility apps require space.view; public apps are open.
  const user = getOptionalAuth(c);
  const id = c.req.param("id");
  if (!requireValidId(id)) return c.json({ message: "work not found" }, 404);
  const app = await getAppById(id);
  if (app?.status !== "published") return c.json({ message: "work not found" }, 404);
  if (requiresSpaceAppAccess(app) && !(await hasPermission(user, "space.view", { spaceId: app.spaceId }))) return authzDenied(c);
  const [row] = await db
    .select({
      owner: { userUuid: userProfiles.userUuid, username: userProfiles.username, displayName: userProfiles.displayName, avatarUrl: userProfiles.avatarUrl },
      space: spaces,
    })
    .from(spaces)
    .innerJoin(userProfiles, eq(userProfiles.userUuid, spaces.userUuid))
    .where(eq(spaces.id, app.spaceId))
    .limit(1);
  if (!row) return c.json({ message: "work not found" }, 404);
  if (!row.owner.username || !row.space.slug) return c.json({ message: "work public identity is incomplete" }, 409);
  const space = { id: row.space.id, slug: row.space.slug, name: row.space.name, userUuid: row.space.userUuid, publicProfile: getSpacePublicProfile(row.space) };
  // Content matches what the by-slug page already serves for the same access
  // model, so an in-workspace preview can render a Work reached by public url.
  const content = await getPublishedAppContent(app);
  return c.json({
    work: serializeApp(app),
    space,
    owner: { ...row.owner, username: row.owner.username },
    content,
  });
});

router.get("/:id/stats", async (c) => {
  const user = useAuth(c);
  if (user instanceof Response) return user;
  const id = c.req.param("id");
  if (!requireValidId(id)) return c.json({ message: "work not found" }, 404);
  const app = await getAppById(id);
  if (!app) return c.json({ message: "work not found" }, 404);
  if (!(await hasPermission(user, "space.edit", { spaceId: app.spaceId }))) return authzDenied(c);
  return c.json(await getAppViewStats(app.id));
});

router.get("/:id", async (c) => {
  const user = useAuth(c);
  if (user instanceof Response) return user;
  const id = c.req.param("id");
  if (!requireValidId(id)) return c.json({ message: "work not found" }, 404);
  const app = await getAppById(id);
  if (!app) return c.json({ message: "work not found" }, 404);
  if (!(await hasPermission(user, "space.view", { spaceId: app.spaceId }))) return authzDenied(c);
  const [row] = await db
    .select({
      owner: { userUuid: userProfiles.userUuid, username: userProfiles.username, displayName: userProfiles.displayName, avatarUrl: userProfiles.avatarUrl },
      space: spaces,
    })
    .from(spaces)
    .innerJoin(userProfiles, eq(userProfiles.userUuid, spaces.userUuid))
    .where(eq(spaces.id, app.spaceId))
    .limit(1);
  if (!row) return c.json({ message: "work not found" }, 404);
  if (!row.owner.username || !row.space.slug) return c.json({ message: "work public identity is incomplete" }, 409);
  const space = { id: row.space.id, slug: row.space.slug, name: row.space.name, userUuid: row.space.userUuid, publicProfile: getSpacePublicProfile(row.space) };
  const shouldRecordCliView = getRequestSource(c)?.via === "cli";
  if (shouldRecordCliView) recordResolvedAppView(c, app, "cli");
  const content = await getPublishedAppContent(app);
  return c.json({
    work: serializeApp(app),
    space,
    owner: { ...row.owner, username: row.owner.username },
    publicUrl: createAppPublicUrl({ ownerUsername: row.owner.username, spaceSlug: row.space.slug, appSlug: app.slug, status: app.status }),
    content,
  });
});

router.post("/", async (c) => {
  const user = useAuth(c);
  if (user instanceof Response) return user;
  const body = await c.req.json().catch(() => null) as Record<string, unknown> | null;
  const spaceId = typeof body?.spaceId === "string" ? body.spaceId : "";
  if (!requireValidId(spaceId)) return c.json({ message: "space not found" }, 404);
  if (!(await hasPermission(user, "space.edit", { spaceId }))) return authzDenied(c);

  const slug = typeof body?.slug === "string" ? body.slug.trim().toLowerCase() : "";
  if (!SLUG_RE.test(slug)) return c.json({ message: "slug must use lowercase letters, numbers, hyphens, or underscores" }, 400);
  const targetType = typeof body?.targetType === "string" ? body.targetType : "";
  let targetRef = typeof body?.targetRef === "string" ? body.targetRef.trim() : "";
  if (!TARGET_TYPES.has(targetType) || !targetRef) return c.json({ message: "target is invalid" }, 400);
  if (targetType === "port") {
    const portRef = normalizePortRef(targetRef);
    if (!portRef) return c.json({ message: "port is invalid" }, 400);
    targetRef = portRef;
  }
  if (body?.status !== undefined && (typeof body.status !== "string" || !WORK_STATUSES.has(body.status))) {
    return invalidAppStatusResponse(c);
  }
  if (body?.visibility !== undefined && (typeof body.visibility !== "string" || !WORK_VISIBILITIES.has(body.visibility))) {
    return invalidAppVisibilityResponse(c);
  }
  const status = typeof body?.status === "string" ? body.status : "published";
  const visibility = typeof body?.visibility === "string" ? body.visibility : "public";
  const identityError = await ensureAppPublicIdentity(c, spaceId, user);
  if (identityError) return identityError;
  const meta = getAppMeta(body?.meta);
  const presentationError = await ensureWorkPresentationAllowed(c, { userId: user.uuid, meta });
  if (presentationError) return presentationError;
  const now = new Date();

  const [existingApp] = await db.select().from(apps).where(and(eq(apps.spaceId, spaceId), eq(apps.slug, slug))).limit(1);
  if (existingApp) return c.json({ message: "slug already exists" }, 409);

  let written: WrittenAppAsset | null = null;
  try {
    written = await writeAppAsset({ spaceId, slug, targetType, targetRef, status });
  } catch (error) {
    return appAssetErrorResponse(c, error, { spaceId, targetType, targetRef });
  }
  const assetKey = written?.assetKey ?? null;
  const pageMeta = withPublishedPageMeta({ baseMeta: meta, extracted: written?.extracted ?? null });
  const versionMeta = withPublishedPageMeta({
    baseMeta: applyRequestSourceToMeta(c, null),
    extracted: written?.extracted ?? null,
  });

  try {
    const result = await db.transaction(async (tx) => {
      const [createdApp] = await tx.insert(apps).values({
        spaceId,
        userUuid: user.uuid,
        slug,
        status,
        visibility,
        targetType,
        targetRef,
        assetKey,
        latestVersion: status === "published" ? 1 : 0,
        publishedAt: status === "published" ? now : null,
        appScopes: normalizeScopes(body?.workScopes, ALLOWED_APP_SCOPES),
        allowedViewerScopes: normalizeScopes(body?.allowedViewerScopes, ALLOWED_VIEWER_SCOPES),
        meta: pageMeta,
      }).returning();
      if (!createdApp) return null;
      if (status !== "published") return { app: createdApp, version: null };
      const [version] = await tx.insert(appVersions).values({
        appId: createdApp.id,
        version: 1,
        targetType,
        targetRef,
        assetKey,
        contentKind: written?.artifact.kind ?? "web",
        artifact: written?.artifact ?? null,
        meta: versionMeta,
        createdAt: now,
      }).returning();
      if (!version) throw new Error("failed to create app version");
      const [updatedApp] = await tx.update(apps).set({ currentVersionId: version.id }).where(eq(apps.id, createdApp.id)).returning();
      return { app: updatedApp ?? createdApp, version };
    }).catch((error: unknown) => {
      if (isAppSlugConflict(error)) return null;
      throw error;
    });
    if (!result) {
      await cleanupAppAssets(assetKey, { appId: "new", spaceId, reason: "create_slug_conflict" });
      return c.json({ message: "slug already exists" }, 409);
    }
    const serializedApp = serializeApp(result.app);
    if (result.version) {
      const serializedVersion = serializeAppVersion(result.version);
      await dispatchAppVersionPublished({
        app: serializedApp,
        version: serializedVersion,
        previousVersionId: null,
        actorUserId: user.uuid,
        source: getRequestSource(c),
      }).catch((error) => {
        logger.warn("[apps] failed to dispatch app.version.published", {
          appId: result.app.id,
          version: result.version?.version,
          error,
        });
      });
    }
    return c.json({ work: serializedApp }, 201);
  } catch (error) {
    await cleanupAppAssets(assetKey, { appId: "new", spaceId, reason: "create_failed" });
    throw error;
  }
});

async function updateWork(
  c: Context,
  current: typeof apps.$inferSelect,
  body: Record<string, unknown> | null,
  actor: AuthUser,
) {
  const nextSlug = typeof body?.slug === "string" ? body.slug.trim().toLowerCase() : current.slug;
  if (!SLUG_RE.test(nextSlug)) return c.json({ message: "slug must use lowercase letters, numbers, hyphens, or underscores" }, 400);
  if (nextSlug !== current.slug && !(await ensureUniqueAppSlug({ spaceId: current.spaceId, slug: nextSlug, excludeId: current.id }))) {
    return c.json({ message: "slug already exists" }, 409);
  }

  const nextTargetType = typeof body?.targetType === "string" ? body.targetType : current.targetType;
  let nextTargetRef = typeof body?.targetRef === "string" ? body.targetRef.trim() : current.targetRef;
  if (!TARGET_TYPES.has(nextTargetType) || !nextTargetRef) return c.json({ message: "target is invalid" }, 400);
  if (nextTargetType === "port") {
    const portRef = normalizePortRef(nextTargetRef);
    if (!portRef) return c.json({ message: "port is invalid" }, 400);
    nextTargetRef = portRef;
  }
  if (body && "status" in body && (typeof body.status !== "string" || !WORK_STATUSES.has(body.status))) {
    return invalidAppStatusResponse(c);
  }
  if (body && "visibility" in body && (typeof body.visibility !== "string" || !WORK_VISIBILITIES.has(body.visibility))) {
    return invalidAppVisibilityResponse(c);
  }
  const nextStatus = typeof body?.status === "string" ? body.status : current.status;
  if (nextStatus === "published" && current.status !== "published") {
    return c.json({ message: "publish a version to publish this work" }, 409);
  }
  const nextVisibility = typeof body?.visibility === "string" ? body.visibility : (current.visibility ?? "public");
  const identityError = await ensureAppPublicIdentity(c, current.spaceId, actor);
  if (identityError) return identityError;
  const nextMeta = "meta" in (body ?? {}) ? getAppMeta(body?.meta) : getAppMeta(current.meta);
  const presentationError = await ensureWorkPresentationAllowed(c, { userId: actor.uuid, meta: nextMeta });
  if (presentationError) return presentationError;

  const assetKey = nextStatus === "published" ? current.assetKey : null;

  const now = new Date();
  const app = await db.transaction(async (tx) => {
    const [updatedApp] = await tx.update(apps).set({
      slug: nextSlug,
      status: nextStatus,
      visibility: nextVisibility,
      targetType: nextTargetType,
      targetRef: nextTargetRef,
      assetKey,
      currentVersionId: current.currentVersionId,
      latestVersion: current.latestVersion,
      publishedAt: nextStatus === "published" ? (current.publishedAt ?? now) : null,
      appScopes: "workScopes" in (body ?? {}) ? normalizeScopes(body?.workScopes, ALLOWED_APP_SCOPES) : current.appScopes,
      allowedViewerScopes: "allowedViewerScopes" in (body ?? {}) ? normalizeScopes(body?.allowedViewerScopes, ALLOWED_VIEWER_SCOPES) : current.allowedViewerScopes,
      meta: nextMeta,
      updatedAt: now,
    }).where(eq(apps.id, current.id)).returning();
    return updatedApp ?? null;
  }).catch((error: unknown) => {
    if (isAppSlugConflict(error)) return null;
    throw error;
  });
  if (!app) return c.json({ message: "slug already exists" }, 409);
  return c.json({ work: serializeApp(app) });
}

async function publishWorkVersion(
  c: Context,
  current: typeof apps.$inferSelect,
  options: { actor: AuthUser; meta?: AppMeta | null },
) {
  const identityError = await ensureAppPublicIdentity(c, current.spaceId, options.actor);
  if (identityError) return identityError;
  let written: WrittenAppAsset | null = null;
  try {
    written = await writeAppAsset({
      spaceId: current.spaceId,
      slug: current.slug,
      targetType: current.targetType,
      targetRef: current.targetRef,
      status: "published",
    });
  } catch (error) {
    return appAssetErrorResponse(c, error, { spaceId: current.spaceId, targetType: current.targetType, targetRef: current.targetRef });
  }
  const assetKey = written?.assetKey ?? null;
  const versionMeta = withPublishedPageMeta({
    baseMeta: options?.meta ?? null,
    extracted: written?.extracted ?? null,
  });
  const workMeta = withPublishedPageMeta({
    baseMeta: getAppMeta(current.meta),
    extracted: written?.extracted ?? null,
  });

  try {
    const result = await db.transaction(async (tx) => {
      const now = new Date();
      const [versionedWork] = await tx.update(apps).set({
        latestVersion: sql`${apps.latestVersion} + 1`,
        updatedAt: now,
      }).where(eq(apps.id, current.id)).returning({
        latestVersion: apps.latestVersion,
        previousVersionId: apps.currentVersionId,
      });
      if (!versionedWork) throw new Error("failed to reserve work version");
      const [version] = await tx.insert(appVersions).values({
        appId: current.id,
        version: versionedWork.latestVersion,
        targetType: current.targetType,
        targetRef: current.targetRef,
        assetKey,
        contentKind: written?.artifact.kind ?? "web",
        artifact: written?.artifact ?? null,
        meta: versionMeta,
        createdAt: now,
      }).returning();
      if (!version) throw new Error("failed to create app version");
      const [app] = await tx.update(apps).set({
        status: "published",
        assetKey,
        currentVersionId: version.id,
        latestVersion: versionedWork.latestVersion,
        publishedAt: current.publishedAt ?? now,
        meta: workMeta,
        updatedAt: now,
      }).where(eq(apps.id, current.id)).returning();
      if (!app) throw new Error("failed to publish app version");
      return { app, version, previousVersionId: versionedWork.previousVersionId };
    });
    const serializedApp = serializeApp(result.app);
    const serializedVersion = serializeAppVersion(result.version);
    await dispatchAppVersionPublished({
      app: serializedApp,
      version: serializedVersion,
      previousVersionId: result.previousVersionId,
      actorUserId: options.actor.uuid,
      source: getRequestSource(c),
    }).catch((error) => {
      logger.warn("[apps] failed to dispatch app.version.published", {
        appId: result.app.id,
        version: result.version.version,
        error,
      });
    });
    return c.json({ work: serializedApp, version: serializedVersion });
  } catch (error) {
    try {
      await cleanupAppAssets(assetKey, { appId: current.id, spaceId: current.spaceId, reason: "publish_failed" });
    } catch (cleanupError) {
      logger.warn("[apps] failed to run publish cleanup", { appId: current.id, spaceId: current.spaceId, cleanupError });
    }
    throw error;
  }
}

router.patch("/:id", async (c) => {
  const user = useAuth(c);
  if (user instanceof Response) return user;
  const id = c.req.param("id");
  if (!requireValidId(id)) return c.json({ message: "work not found" }, 404);
  const current = await getAppById(id);
  if (!current) return c.json({ message: "work not found" }, 404);
  if (!(await hasPermission(user, "space.edit", { spaceId: current.spaceId }))) return authzDenied(c);

  const body = await c.req.json().catch(() => null) as Record<string, unknown> | null;
  return updateWork(c, current, body, user);
});

router.get("/:id/versions", async (c) => {
  const user = useAuth(c);
  if (user instanceof Response) return user;
  const id = c.req.param("id");
  if (!requireValidId(id)) return c.json({ message: "work not found" }, 404);
  const app = await getAppById(id);
  if (!app) return c.json({ message: "work not found" }, 404);
  if (!(await hasPermission(user, "space.view", { spaceId: app.spaceId }))) return authzDenied(c);
  const rows = await db.select().from(appVersions).where(eq(appVersions.appId, id)).orderBy(desc(appVersions.version));
  return c.json({ versions: rows.map(serializeAppVersion) });
});

router.post("/:id/versions", async (c) => {
  const user = useAuth(c);
  if (user instanceof Response) return user;
  const id = c.req.param("id");
  if (!requireValidId(id)) return c.json({ message: "work not found" }, 404);
  const app = await getAppById(id);
  if (!app) return c.json({ message: "work not found" }, 404);
  if (!(await hasPermission(user, "space.edit", { spaceId: app.spaceId }))) return authzDenied(c);
  const meta = applyRequestSourceToMeta(c, null);
  return publishWorkVersion(c, app, { actor: user, meta });
});

router.delete("/:id", async (c) => {
  const user = useAuth(c);
  if (user instanceof Response) return user;
  const id = c.req.param("id");
  if (!requireValidId(id)) return c.json({ message: "work not found" }, 404);
  const app = await getAppById(id);
  if (!app) return c.json({ message: "work not found" }, 404);
  if (!(await hasPermission(user, "space.edit", { spaceId: app.spaceId }))) return authzDenied(c);
  await db.transaction(async (tx) => {
    const promotions = await tx
      .select({ id: appPromotions.id })
      .from(appPromotions)
      .where(eq(appPromotions.appId, app.id));
    if (promotions.length > 0) {
      await tx.delete(appPromotionStatsHourly).where(
        inArray(appPromotionStatsHourly.promotionId, promotions.map((promotion) => promotion.id)),
      );
    }
    await tx.delete(appPromotions).where(eq(appPromotions.appId, app.id));
    await tx.delete(appViewerGrants).where(eq(appViewerGrants.appId, app.id));
    await tx.delete(appViewStatsHourly).where(eq(appViewStatsHourly.appId, app.id));
    await tx.delete(appVersions).where(eq(appVersions.appId, app.id));
    await tx.delete(apps).where(eq(apps.id, app.id));
  });
  return c.json({ ok: true });
});

const appRoomErrorResponse = (c: Context, error: unknown) => {
  if (!(error instanceof AppRoomError)) return c.json({ message: "failed to create realtime room" }, 503);
  if (error.code === "ROOM_QUOTA_EXCEEDED") return c.json({ code: error.code, message: error.message }, 429);
  const status = error.code === "ROOM_CODE_TAKEN" ? 409 : 400;
  return c.json({ code: error.code, message: error.message }, status);
};

const getPublishedAppForRoom = async (c: Context, appId: string) => {
  const principal = getAppSessionPrincipal(c);
  if (!principal || principal.appId !== appId) return null;
  const app = await getAppById(appId);
  if (app?.status !== "published" || app.spaceId !== principal.spaceId) return null;
  return { principal, app };
};

router.post("/:id/realtime/rooms", async (c) => {
  const id = c.req.param("id");
  if (!requireValidId(id)) return c.json({ message: "work not found" }, 404);
  const context = await getPublishedAppForRoom(c, id);
  if (!context) return authzDenied(c);
  const body = await c.req.json().catch(() => null) as {
    code?: unknown;
    expiresInSeconds?: unknown;
    maxParticipants?: unknown;
    seatPerUser?: unknown;
  } | null;
  try {
    const room = await createAppRoom({
      appId: id,
      code: body?.code,
      expiresInSeconds: body?.expiresInSeconds,
      maxParticipants: body?.maxParticipants,
      seatPerUser: body?.seatPerUser,
    });
    return c.json(createAppRoomAdmission({
      appId: id,
      userUuid: context.principal.userUuid,
      room,
    }));
  } catch (error) {
    return appRoomErrorResponse(c, error);
  }
});

router.post("/:id/realtime/rooms/join", async (c) => {
  const id = c.req.param("id");
  if (!requireValidId(id)) return c.json({ message: "work not found" }, 404);
  const context = await getPublishedAppForRoom(c, id);
  if (!context) return authzDenied(c);
  const body = await c.req.json().catch(() => null) as { code?: unknown } | null;
  const room = await getAppRoomByCode(id, body?.code);
  if (!room || room.appId !== id) return c.json({ code: "ROOM_NOT_FOUND", message: "room not found" }, 404);
  try {
    return c.json(createAppRoomAdmission({
      appId: id,
      userUuid: context.principal.userUuid,
      room,
    }));
  } catch (error) {
    return appRoomErrorResponse(c, error);
  }
});

router.post("/:id/session", async (c) => {
  const user = useAuth(c);
  if (user instanceof Response) return user;
  const id = c.req.param("id");
  if (!requireValidId(id)) return c.json({ message: "work not found" }, 404);
  const app = await getAppById(id);
  if (app?.status !== "published") return c.json({ message: "work not found" }, 404);
  if (requiresSpaceAppAccess(app) && !(await hasPermission(user, "space.view", { spaceId: app.spaceId }))) return authzDenied(c);
  const token = createAppSessionToken({
    userUuid: user.uuid,
    appId: app.id,
    spaceId: app.spaceId,
    appScopes: app.appScopes as Permission[],
  });
  return c.json({ token, expiresIn: APP_SESSION_TTL_SECONDS, work: serializeApp(app) });
});

router.post("/:id/authorize", async (c) => {
  const user = useAuth(c);
  if (user instanceof Response) return user;
  const id = c.req.param("id");
  if (!requireValidId(id)) return c.json({ message: "work not found" }, 404);
  const app = await getAppById(id);
  if (app?.status !== "published") return c.json({ message: "work not found" }, 404);
  if (requiresSpaceAppAccess(app) && !(await hasPermission(user, "space.view", { spaceId: app.spaceId }))) return authzDenied(c);
  const body = await c.req.json().catch(() => null) as { scopes?: unknown } | null;
  const requested = normalizeScopes(body?.scopes, ALLOWED_VIEWER_SCOPES);
  if (requested.length === 0) return c.json({ message: "no valid scopes requested" }, 400);
  if (!isSubset(requested, app.allowedViewerScopes ?? [])) return c.json({ message: "scope not allowed for this work" }, 403);

  const expiresAt = new Date(Date.now() + APP_SESSION_TTL_SECONDS * 1000);
  const [grant] = await db.insert(appViewerGrants).values({
    appId: app.id,
    spaceId: app.spaceId,
    viewerUserUuid: user.uuid,
    scopes: requested,
    expiresAt,
  }).onConflictDoUpdate({
    target: [appViewerGrants.appId, appViewerGrants.viewerUserUuid],
    set: { scopes: requested, expiresAt, revokedAt: null, updatedAt: new Date() },
  }).returning();
  if (!grant) return c.json({ message: "failed to create grant" }, 500);

  const token = createAppSessionToken({
    userUuid: user.uuid,
    appId: app.id,
    spaceId: app.spaceId,
    appScopes: app.appScopes as Permission[],
    viewerScopes: requested,
    appViewerGrantId: grant.id,
  });
  return c.json({ token, expiresIn: APP_SESSION_TTL_SECONDS, grant: { id: grant.id, scopes: requested, expiresAt: expiresAt.toISOString() } });
});

export default router;
