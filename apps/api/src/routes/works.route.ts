import { Hono, type Context } from "hono";
import { and, desc, eq, ne, sql } from "drizzle-orm";
import { spaces, works, workVersions, workViewerGrants, userProfiles } from "@cohub/db";
import { readSpaceDirectoryFiles, readSpaceFile, SpaceFsError, spaceFsJsonError } from "../space-fs.js";
import { createWorkAssetPublicUrl, deleteWorkAssetsByObjectKey, isConfiguredWorkAssetPublicUrl, writeWorkHtmlAsset, writeWorkSiteAssets } from "../work-asset-storage.js";
import type { Permission } from "@cohub/core/permissions";
import { db } from "../db/index.js";
import { authzDenied, getSpacePublicProfile, requireValidId, useAuth } from "../lib/middleware.js";
import { hasPermission } from "../permissions.js";
import { createWorkSessionToken, WORK_SESSION_TTL_SECONDS } from "../work-sessions.js";
import { getSandboxPublicEndpoints } from "../sandbox-public-network.js";
import { SANDBOX_PUBLIC_PORTS } from "@cohub/protocol/ports";
import { createLogger } from "@cohub/infra/logging";

const logger = createLogger({ serviceName: "cohub-api" });
const router = new Hono();

const WORK_STATUSES = new Set(["draft", "published", "disabled"]);
const TARGET_TYPES = new Set(["file", "directory", "port"]);
const SLUG_RE = /^[a-z0-9](?:[a-z0-9_-]{0,78}[a-z0-9])?$/;
const SANDBOX_PUBLIC_PORT_SET = new Set<number>(SANDBOX_PUBLIC_PORTS as readonly number[]);
const ALLOWED_WORK_SCOPES = new Set<Permission>(["space.view", "session.view", "file.view", "taskrun.view"]);
const ALLOWED_VIEWER_SCOPES = new Set<Permission>([
  "session.prompt.readonly",
  "session.prompt.fullaccess",
  "generation.create",
]);


const normalizeScopes = (value: unknown, allowed: Set<Permission>): Permission[] => {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(value.filter((item): item is Permission => typeof item === "string" && allowed.has(item as Permission))));
};

const isSubset = (requested: Permission[], allowed: string[]) => requested.every((scope) => allowed.includes(scope));

const pgErrorCode = (error: unknown) => typeof error === "object" && error !== null && "code" in error ? String((error as { code?: unknown }).code) : null;
const pgErrorConstraint = (error: unknown) => typeof error === "object" && error !== null && "constraint" in error ? String((error as { constraint?: unknown }).constraint) : null;
const isWorkSlugConflict = (error: unknown) => pgErrorCode(error) === "23505" && pgErrorConstraint(error) === "v2_uq_works_space_slug";

const ensureUniqueWorkSlug = async (input: { spaceId: string; slug: string; excludeId?: string }) => {
  const conditions = [eq(works.spaceId, input.spaceId), eq(works.slug, input.slug)];
  if (input.excludeId) conditions.push(ne(works.id, input.excludeId));
  const [existingWork] = await db
    .select({ id: works.id })
    .from(works)
    .where(and(...conditions))
    .limit(1);
  return !existingWork;
};

const normalizePortRef = (value: string) => {
  if (!/^\d{2,5}$/.test(value)) return null;
  const port = Number(value);
  if (!Number.isInteger(port) || !SANDBOX_PUBLIC_PORT_SET.has(port)) return null;
  return String(port);
};

const isAllowedWorkContentUrl = (url: string, kind: "asset" | "port") => {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:") return false;
    if (kind === "asset") return isConfiguredWorkAssetPublicUrl(url);
    return parsed.hostname === "cohub.run" || parsed.hostname.endsWith(".cohub.run");
  } catch {
    return false;
  }
};

const serializeWork = (work: typeof works.$inferSelect) => ({
  id: work.id,
  spaceId: work.spaceId,
  userUuid: work.userUuid,
  slug: work.slug,
  status: work.status,
  targetType: work.targetType,
  targetRef: work.targetRef,
  assetKey: work.assetKey,
  currentVersionId: work.currentVersionId,
  latestVersion: work.latestVersion ?? 0,
  publishedAt: work.publishedAt?.toISOString() ?? null,
  workScopes: work.workScopes ?? [],
  allowedViewerScopes: work.allowedViewerScopes ?? [],
  meta: work.meta ?? null,
  createdAt: work.createdAt?.toISOString() ?? null,
  updatedAt: work.updatedAt?.toISOString() ?? null,
});

const serializeWorkVersion = (version: typeof workVersions.$inferSelect) => ({
  id: version.id,
  workId: version.workId,
  spaceId: version.spaceId,
  version: version.version,
  status: version.status,
  targetType: version.targetType,
  targetRef: version.targetRef,
  assetKey: version.assetKey,
  meta: version.meta ?? null,
  createdAt: version.createdAt?.toISOString() ?? null,
  publishedAt: version.publishedAt?.toISOString() ?? null,
});

async function getWorkById(id: string) {
  const [work] = await db.select().from(works).where(eq(works.id, id)).limit(1);
  return work ?? null;
}

async function writeWorkAsset(input: { spaceId: string; slug: string; targetType: string; targetRef: string; status: string }) {
  const { spaceId, slug, targetType, targetRef, status } = input;
  if (status !== "published" || (targetType !== "file" && targetType !== "directory")) return null;
  if (targetType === "directory") {
    const result = await readSpaceDirectoryFiles(spaceId, targetRef, { visibility: "full" });
    const written = await writeWorkSiteAssets({ spaceId, workSlug: slug, files: result.files });
    return written.objectKey;
  }
  const result = await readSpaceFile(spaceId, targetRef, { visibility: "full" });
  if (!("content" in result)) throw new Error("file is still preparing");
  const written = await writeWorkHtmlAsset({ spaceId, workSlug: slug, html: result.content });
  return written.objectKey;
}

function workAssetErrorResponse(c: Context, error: unknown, context: { spaceId: string; targetType: string; targetRef: string }) {
  if (error instanceof Error && (
    error.message === "work asset must be 1 byte to 5MB" ||
    error.message === "work site must contain index.html" ||
    error.message === "work site must be 1 byte to 100MB" ||
    error.message === "file is still preparing" ||
    error.message.startsWith("work site must contain 1 to ")
  )) {
    return c.json({ message: error.message }, error.message === "file is still preparing" ? 409 : 400);
  }
  if (error instanceof Error && error.message === "work asset storage is not configured") {
    return c.json({ message: error.message }, 500);
  }
  if (!(error instanceof SpaceFsError)) {
    logger.warn("[works] failed to write work asset", { ...context, error });
    return c.json({ message: "work asset storage failed" }, 502);
  }
  const { status: errorStatus, body: errorBody } = spaceFsJsonError(error);
  return c.json(errorBody, errorStatus as never);
}

async function cleanupWorkAssets(assetKey: string | null | undefined, context: { workId: string; spaceId: string; reason: string }) {
  if (!assetKey) return;
  try {
    await deleteWorkAssetsByObjectKey(assetKey);
  } catch (error) {
    logger.warn("[works] failed to delete stale work asset", { ...context, assetKey, error });
  }
}

const getWorkContent = (work: typeof works.$inferSelect) => {
  if (work.targetType === "port") {
    const portRef = normalizePortRef(work.targetRef);
    if (!portRef) return null;
    const url = getSandboxPublicEndpoints(work.spaceId)[portRef]?.url;
    if (!url || !isAllowedWorkContentUrl(url, "port")) return null;
    return { url, targetType: "port" as const, port: portRef };
  }
  if (!work.assetKey) return null;
  const url = createWorkAssetPublicUrl(work.assetKey);
  if (!isAllowedWorkContentUrl(url, "asset")) return null;
  return { url, targetType: work.targetType, path: work.targetRef };
};

router.get("/by-slug/:username/:spaceSlug/:workSlug", async (c) => {
  const username = c.req.param("username");
  const spaceSlug = c.req.param("spaceSlug");
  const workSlug = c.req.param("workSlug");
  if (!username || !SLUG_RE.test(spaceSlug) || !SLUG_RE.test(workSlug)) return c.json({ message: "work not found" }, 404);

  const [row] = await db
    .select({
      owner: { userUuid: userProfiles.userUuid, username: userProfiles.username, displayName: userProfiles.displayName, avatarUrl: userProfiles.avatarUrl },
      space: spaces,
      work: works,
    })
    .from(userProfiles)
    .innerJoin(spaces, and(eq(spaces.userUuid, userProfiles.userUuid), eq(spaces.slug, spaceSlug)))
    .innerJoin(works, and(eq(works.spaceId, spaces.id), eq(works.slug, workSlug), eq(works.status, "published")))
    .where(eq(userProfiles.username, username))
    .limit(1);
  if (!row) return c.json({ message: "work not found" }, 404);

  return c.json({
    work: serializeWork(row.work),
    space: { id: row.space.id, slug: row.space.slug, name: row.space.name, userUuid: row.space.userUuid, publicProfile: getSpacePublicProfile(row.space) },
    owner: row.owner,
    content: getWorkContent(row.work),
  });
});

router.get("/space/:spaceId", async (c) => {
  const user = useAuth(c);
  const spaceId = c.req.param("spaceId");
  if (!requireValidId(spaceId)) return c.json({ message: "space not found" }, 404);
  if (!(await hasPermission(user, "space.view", { spaceId }))) return authzDenied(c);
  const rows = await db.select().from(works).where(eq(works.spaceId, spaceId));
  return c.json({ works: rows.map(serializeWork) });
});

router.get("/:id", async (c) => {
  const user = useAuth(c);
  const id = c.req.param("id");
  if (!requireValidId(id)) return c.json({ message: "work not found" }, 404);
  const work = await getWorkById(id);
  if (!work) return c.json({ message: "work not found" }, 404);
  if (!(await hasPermission(user, "space.view", { spaceId: work.spaceId }))) return authzDenied(c);
  return c.json({ work: serializeWork(work) });
});

router.post("/", async (c) => {
  const user = useAuth(c);
  const body = await c.req.json().catch(() => null) as Record<string, unknown> | null;
  const spaceId = typeof body?.spaceId === "string" ? body.spaceId : "";
  if (!requireValidId(spaceId)) return c.json({ message: "space not found" }, 404);
  if (!(await hasPermission(user, "space.edit", { spaceId }))) return authzDenied(c);

  const slug = typeof body?.slug === "string" ? body.slug.trim().toLowerCase() : "";
  if (!SLUG_RE.test(slug)) return c.json({ message: "slug must use lowercase letters, numbers, hyphens, or underscores" }, 400);
  const targetType = typeof body?.targetType === "string" ? body.targetType : "";
  let targetRef = typeof body?.targetRef === "string" ? body.targetRef.trim() : "";
  if (!TARGET_TYPES.has(targetType) || !targetRef) return c.json({ message: "target is invalid" }, 400);
  if (targetType === "file" && !/\.html?$/i.test(targetRef)) {
    return c.json({ message: "only HTML files can be published as work" }, 400);
  }
  if (targetType === "port") {
    const portRef = normalizePortRef(targetRef);
    if (!portRef) return c.json({ message: "port is invalid" }, 400);
    targetRef = portRef;
  }
  const status = typeof body?.status === "string" && WORK_STATUSES.has(body.status) ? body.status : "published";
  const now = new Date();

  const [existingWork] = await db.select().from(works).where(and(eq(works.spaceId, spaceId), eq(works.slug, slug))).limit(1);
  if (existingWork) {
    return updateWorkWithVersion(c, existingWork, body, { targetType, targetRef, status, publishVersion: status === "published" });
  }

  let assetKey: string | null = null;
  try {
    assetKey = await writeWorkAsset({ spaceId, slug, targetType, targetRef, status });
  } catch (error) {
    return workAssetErrorResponse(c, error, { spaceId, targetType, targetRef });
  }

  try {
    const work = await db.transaction(async (tx) => {
      const [createdWork] = await tx.insert(works).values({
        spaceId,
        userUuid: user.uuid,
        slug,
        status,
        targetType,
        targetRef,
        assetKey,
        latestVersion: status === "published" ? 1 : 0,
        publishedAt: status === "published" ? now : null,
        workScopes: normalizeScopes(body?.workScopes, ALLOWED_WORK_SCOPES),
        allowedViewerScopes: normalizeScopes(body?.allowedViewerScopes, ALLOWED_VIEWER_SCOPES),
        meta: body?.meta && typeof body.meta === "object" ? body.meta as Record<string, unknown> : null,
      }).returning();
      if (!createdWork) return null;
      if (status !== "published") return createdWork;
      const [version] = await tx.insert(workVersions).values({
        workId: createdWork.id,
        spaceId,
        version: 1,
        status,
        targetType,
        targetRef,
        assetKey,
        meta: { reason: "create" },
        publishedAt: now,
      }).returning();
      if (!version) throw new Error("failed to create work version");
      const [updatedWork] = await tx.update(works).set({ currentVersionId: version.id }).where(eq(works.id, createdWork.id)).returning();
      return updatedWork ?? createdWork;
    }).catch((error: unknown) => {
      if (isWorkSlugConflict(error)) return null;
      throw error;
    });
    if (!work) {
      await cleanupWorkAssets(assetKey, { workId: "new", spaceId, reason: "create_slug_conflict" });
      return c.json({ message: "slug already exists" }, 409);
    }
    return c.json({ work: serializeWork(work) }, 201);
  } catch (error) {
    await cleanupWorkAssets(assetKey, { workId: "new", spaceId, reason: "create_failed" });
    throw error;
  }
});

async function updateWorkWithVersion(
  c: Context,
  current: typeof works.$inferSelect,
  body: Record<string, unknown> | null,
  overrides?: { targetType?: string; targetRef?: string; status?: string; publishVersion?: boolean },
) {
  const nextSlug = typeof body?.slug === "string" ? body.slug.trim().toLowerCase() : current.slug;
  if (!SLUG_RE.test(nextSlug)) return c.json({ message: "slug must use lowercase letters, numbers, hyphens, or underscores" }, 400);
  if (nextSlug !== current.slug && !(await ensureUniqueWorkSlug({ spaceId: current.spaceId, slug: nextSlug, excludeId: current.id }))) {
    return c.json({ message: "slug already exists" }, 409);
  }

  const nextTargetType = overrides?.targetType ?? (typeof body?.targetType === "string" ? body.targetType : current.targetType);
  let nextTargetRef = overrides?.targetRef ?? (typeof body?.targetRef === "string" ? body.targetRef.trim() : current.targetRef);
  if (!TARGET_TYPES.has(nextTargetType) || !nextTargetRef) return c.json({ message: "target is invalid" }, 400);
  if (nextTargetType === "file" && !/\.html?$/i.test(nextTargetRef)) {
    return c.json({ message: "only HTML files can be published as work" }, 400);
  }
  if (nextTargetType === "port") {
    const portRef = normalizePortRef(nextTargetRef);
    if (!portRef) return c.json({ message: "port is invalid" }, 400);
    nextTargetRef = portRef;
  }
  const nextStatus = overrides?.status ?? (typeof body?.status === "string" && WORK_STATUSES.has(body.status) ? body.status : current.status);
  const publishVersion = overrides?.publishVersion ?? body?.publishVersion === true;

  let assetKey = current.assetKey;
  let newAssetKey: string | null = null;
  const needsAssetRefresh = nextStatus === "published" && (
    publishVersion ||
    current.status !== "published" ||
    nextSlug !== current.slug ||
    nextTargetType !== current.targetType ||
    nextTargetRef !== current.targetRef
  );
  if (nextStatus !== "published") assetKey = null;
  else if (nextTargetType === "port") assetKey = null;
  else if (needsAssetRefresh) {
    try {
      newAssetKey = await writeWorkAsset({ spaceId: current.spaceId, slug: nextSlug, targetType: nextTargetType, targetRef: nextTargetRef, status: nextStatus });
      assetKey = newAssetKey;
    } catch (error) {
      return workAssetErrorResponse(c, error, { spaceId: current.spaceId, targetType: nextTargetType, targetRef: nextTargetRef });
    }
  }

  try {
    const work = await db.transaction(async (tx) => {
      const now = new Date();
      let currentVersionId = current.currentVersionId;
      let latestVersion = current.latestVersion ?? 0;
      if (nextStatus === "published" && needsAssetRefresh) {
        const [versionedWork] = await tx.update(works).set({
          latestVersion: sql`${works.latestVersion} + 1`,
          updatedAt: now,
        }).where(eq(works.id, current.id)).returning({ latestVersion: works.latestVersion });
        if (!versionedWork) throw new Error("failed to reserve work version");
        latestVersion = versionedWork.latestVersion;
        const [version] = await tx.insert(workVersions).values({
          workId: current.id,
          spaceId: current.spaceId,
          version: latestVersion,
          status: nextStatus,
          targetType: nextTargetType,
          targetRef: nextTargetRef,
          assetKey,
          meta: { reason: publishVersion ? "publish" : "update" },
          publishedAt: now,
        }).returning();
        if (!version) throw new Error("failed to create work version");
        currentVersionId = version.id;
      }
      const [updatedWork] = await tx.update(works).set({
        slug: nextSlug,
        status: nextStatus,
        targetType: nextTargetType,
        targetRef: nextTargetRef,
        assetKey,
        currentVersionId: nextStatus === "published" ? currentVersionId : null,
        latestVersion,
        publishedAt: nextStatus === "published" ? (current.publishedAt ?? now) : null,
        workScopes: "workScopes" in (body ?? {}) ? normalizeScopes(body?.workScopes, ALLOWED_WORK_SCOPES) : current.workScopes,
        allowedViewerScopes: "allowedViewerScopes" in (body ?? {}) ? normalizeScopes(body?.allowedViewerScopes, ALLOWED_VIEWER_SCOPES) : current.allowedViewerScopes,
        meta: "meta" in (body ?? {}) ? (body?.meta && typeof body.meta === "object" ? body.meta as Record<string, unknown> : null) : current.meta,
        updatedAt: new Date(),
      }).where(eq(works.id, current.id)).returning();
      return updatedWork ?? null;
    }).catch((error: unknown) => {
      if (isWorkSlugConflict(error)) return null;
      throw error;
    });
    if (!work) {
      await cleanupWorkAssets(newAssetKey, { workId: current.id, spaceId: current.spaceId, reason: "update_slug_conflict" });
      return c.json({ message: "slug already exists" }, 409);
    }
    return c.json({ work: serializeWork(work) });
  } catch (error) {
    await cleanupWorkAssets(newAssetKey, { workId: current.id, spaceId: current.spaceId, reason: "update_failed" });
    throw error;
  }
}

router.patch("/:id", async (c) => {
  const user = useAuth(c);
  const id = c.req.param("id");
  if (!requireValidId(id)) return c.json({ message: "work not found" }, 404);
  const current = await getWorkById(id);
  if (!current) return c.json({ message: "work not found" }, 404);
  if (!(await hasPermission(user, "space.edit", { spaceId: current.spaceId }))) return authzDenied(c);

  const body = await c.req.json().catch(() => null) as Record<string, unknown> | null;
  return updateWorkWithVersion(c, current, body);
});

router.get("/:id/versions", async (c) => {
  const user = useAuth(c);
  const id = c.req.param("id");
  if (!requireValidId(id)) return c.json({ message: "work not found" }, 404);
  const work = await getWorkById(id);
  if (!work) return c.json({ message: "work not found" }, 404);
  if (!(await hasPermission(user, "space.view", { spaceId: work.spaceId }))) return authzDenied(c);
  const rows = await db.select().from(workVersions).where(eq(workVersions.workId, id)).orderBy(desc(workVersions.version));
  return c.json({ versions: rows.map(serializeWorkVersion) });
});

router.delete("/:id", async (c) => {
  const user = useAuth(c);
  const id = c.req.param("id");
  if (!requireValidId(id)) return c.json({ message: "work not found" }, 404);
  const work = await getWorkById(id);
  if (!work) return c.json({ message: "work not found" }, 404);
  if (!(await hasPermission(user, "space.edit", { spaceId: work.spaceId }))) return authzDenied(c);
  await db.transaction(async (tx) => {
    await tx.delete(workViewerGrants).where(eq(workViewerGrants.workId, work.id));
    await tx.delete(workVersions).where(eq(workVersions.workId, work.id));
    await tx.delete(works).where(eq(works.id, work.id));
  });
  return c.json({ ok: true });
});

router.post("/:id/session", async (c) => {
  const user = useAuth(c);
  const id = c.req.param("id");
  if (!requireValidId(id)) return c.json({ message: "work not found" }, 404);
  const work = await getWorkById(id);
  if (work?.status !== "published") return c.json({ message: "work not found" }, 404);
  const token = createWorkSessionToken({
    userUuid: user.uuid,
    workId: work.id,
    spaceId: work.spaceId,
    workScopes: work.workScopes as Permission[],
  });
  return c.json({ token, expiresIn: WORK_SESSION_TTL_SECONDS, work: serializeWork(work) });
});

router.post("/:id/authorize", async (c) => {
  const user = useAuth(c);
  const id = c.req.param("id");
  if (!requireValidId(id)) return c.json({ message: "work not found" }, 404);
  const work = await getWorkById(id);
  if (work?.status !== "published") return c.json({ message: "work not found" }, 404);
  const body = await c.req.json().catch(() => null) as { scopes?: unknown } | null;
  const requested = normalizeScopes(body?.scopes, ALLOWED_VIEWER_SCOPES);
  if (requested.length === 0) return c.json({ message: "no valid scopes requested" }, 400);
  if (!isSubset(requested, work.allowedViewerScopes ?? [])) return c.json({ message: "scope not allowed for this work" }, 403);

  const expiresAt = new Date(Date.now() + WORK_SESSION_TTL_SECONDS * 1000);
  const [grant] = await db.insert(workViewerGrants).values({
    workId: work.id,
    spaceId: work.spaceId,
    viewerUserUuid: user.uuid,
    scopes: requested,
    expiresAt,
  }).onConflictDoUpdate({
    target: [workViewerGrants.workId, workViewerGrants.viewerUserUuid],
    set: { scopes: requested, expiresAt, revokedAt: null, updatedAt: new Date() },
  }).returning();
  if (!grant) return c.json({ message: "failed to create grant" }, 500);

  const token = createWorkSessionToken({
    userUuid: user.uuid,
    workId: work.id,
    spaceId: work.spaceId,
    workScopes: work.workScopes as Permission[],
    viewerScopes: requested,
    workViewerGrantId: grant.id,
  });
  return c.json({ token, expiresIn: WORK_SESSION_TTL_SECONDS, grant: { id: grant.id, scopes: requested, expiresAt: expiresAt.toISOString() } });
});

export default router;
