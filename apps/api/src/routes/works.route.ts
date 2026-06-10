import { Hono } from "hono";
import { and, eq } from "drizzle-orm";
import { works, workViewerGrants, userProfiles } from "@cohub/db";
import { readSpaceFile, spaceFsJsonError } from "../space-fs.js";
import { createWorkAssetPublicUrl, writeWorkHtmlAsset } from "../work-asset-storage.js";
import type { Permission } from "@cohub/core/permissions";
import { db } from "../db/index.js";
import { authzDenied, requireValidId, useAuth } from "../lib/middleware.js";
import { hasPermission } from "../permissions.js";
import { createWorkSessionToken, WORK_SESSION_TTL_SECONDS } from "../work-sessions.js";

const router = new Hono();

const WORK_STATUSES = new Set(["draft", "published"]);
const TARGET_TYPES = new Set(["file", "directory", "port"]);
const SLUG_RE = /^[a-z0-9](?:[a-z0-9_-]{0,78}[a-z0-9])?$/;
const ALLOWED_WORK_SCOPES = new Set<Permission>(["space.view", "session.view", "file.view"]);
const ALLOWED_VIEWER_SCOPES = new Set<Permission>([
  "session.prompt.readonly",
  "session.prompt.fullaccess",
]);


const normalizeScopes = (value: unknown, allowed: Set<Permission>): Permission[] => {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(value.filter((item): item is Permission => typeof item === "string" && allowed.has(item as Permission))));
};

const isSubset = (requested: Permission[], allowed: string[]) => requested.every((scope) => allowed.includes(scope));

const serializeWork = (work: typeof works.$inferSelect) => ({
  id: work.id,
  spaceId: work.spaceId,
  userUuid: work.userUuid,
  name: work.name,
  slug: work.slug,
  description: work.description,
  status: work.status,
  targetType: work.targetType,
  targetRef: work.targetRef,
  assetKey: work.assetKey,
  publishedAt: work.publishedAt?.toISOString() ?? null,
  workScopes: work.workScopes ?? [],
  allowedViewerScopes: work.allowedViewerScopes ?? [],
  meta: work.meta ?? null,
  createdAt: work.createdAt?.toISOString() ?? null,
  updatedAt: work.updatedAt?.toISOString() ?? null,
});

async function getWorkById(id: string) {
  const [work] = await db.select().from(works).where(eq(works.id, id)).limit(1);
  return work ?? null;
}

router.get("/by-slug/:username/:slug", async (c) => {
  const username = c.req.param("username");
  const slug = c.req.param("slug");
  if (!username || !SLUG_RE.test(slug)) return c.json({ message: "work not found" }, 404);

  const [profile] = await db.select({ userUuid: userProfiles.userUuid, username: userProfiles.username, displayName: userProfiles.displayName }).from(userProfiles).where(eq(userProfiles.username, username)).limit(1);
  if (!profile) return c.json({ message: "work not found" }, 404);

  const [work] = await db.select().from(works).where(and(eq(works.userUuid, profile.userUuid), eq(works.slug, slug))).limit(1);
  if (!work || work.status !== "published") return c.json({ message: "work not found" }, 404);

  return c.json({ work: serializeWork(work), owner: profile });
});

router.get("/space/:spaceId", async (c) => {
  const user = useAuth(c);
  const spaceId = c.req.param("spaceId");
  if (!requireValidId(spaceId)) return c.json({ message: "space not found" }, 404);
  if (!(await hasPermission(user, "space.view", { spaceId }))) return authzDenied(c);
  const rows = await db.select().from(works).where(eq(works.spaceId, spaceId));
  return c.json({ works: rows.map(serializeWork) });
});

router.post("/", async (c) => {
  const user = useAuth(c);
  const body = await c.req.json().catch(() => null) as Record<string, unknown> | null;
  const spaceId = typeof body?.spaceId === "string" ? body.spaceId : "";
  if (!requireValidId(spaceId)) return c.json({ message: "space not found" }, 404);
  if (!(await hasPermission(user, "space.edit", { spaceId }))) return authzDenied(c);

  const name = typeof body?.name === "string" && body.name.trim() ? body.name.trim().slice(0, 120) : "Untitled work";
  const slug = typeof body?.slug === "string" ? body.slug.trim().toLowerCase() : "";
  if (!SLUG_RE.test(slug)) return c.json({ message: "slug must use lowercase letters, numbers, hyphens, or underscores" }, 400);
  const targetType = typeof body?.targetType === "string" ? body.targetType : "";
  const targetRef = typeof body?.targetRef === "string" ? body.targetRef.trim() : "";
  if (!TARGET_TYPES.has(targetType) || !targetRef) return c.json({ message: "target is invalid" }, 400);
  if (targetType === "file" && !/\.html?$/i.test(targetRef)) {
    return c.json({ message: "only HTML files can be published as work" }, 400);
  }
  const status = typeof body?.status === "string" && WORK_STATUSES.has(body.status) ? body.status : "published";

  const [existingWork] = await db
    .select({ id: works.id })
    .from(works)
    .where(and(eq(works.userUuid, user.uuid), eq(works.slug, slug)))
    .limit(1);
  if (existingWork) return c.json({ message: "slug already exists" }, 409);

  let assetKey: string | null = null;
  if (status === "published" && targetType === "file") {
    try {
      const result = await readSpaceFile(spaceId, targetRef, { visibility: "full" });
      if (!("content" in result)) return c.json({ message: "file is still preparing" }, 409);
      const written = await writeWorkHtmlAsset({ spaceId, workSlug: slug, html: result.content });
      assetKey = written.objectKey;
    } catch (error) {
      if (error instanceof Error && error.message === "work asset must be 1 byte to 5MB") {
        return c.json({ message: error.message }, 400);
      }
      if (error instanceof Error && error.message === "work asset storage is not configured") {
        return c.json({ message: error.message }, 500);
      }
      const { status: errorStatus, body: errorBody } = spaceFsJsonError(error);
      return c.json(errorBody, errorStatus as never);
    }
  }

  const [work] = await db.insert(works).values({
    spaceId,
    userUuid: user.uuid,
    name,
    slug,
    description: typeof body?.description === "string" ? body.description : null,
    status,
    targetType,
    targetRef,
    assetKey,
    publishedAt: status === "published" ? new Date() : null,
    workScopes: normalizeScopes(body?.workScopes, ALLOWED_WORK_SCOPES),
    allowedViewerScopes: normalizeScopes(body?.allowedViewerScopes, ALLOWED_VIEWER_SCOPES),
    meta: body?.meta && typeof body.meta === "object" ? body.meta as Record<string, unknown> : null,
  }).returning().catch((error: unknown) => {
    const code = typeof error === "object" && error !== null && "code" in error ? String((error as { code?: unknown }).code) : null;
    if (code === "23505") return [];
    throw error;
  });
  if (!work) return c.json({ message: "slug already exists" }, 409);
  return c.json({ work: serializeWork(work) }, 201);
});

router.get("/:id/content", async (c) => {
  const id = c.req.param("id");
  if (!requireValidId(id)) return c.json({ message: "work not found" }, 404);
  const work = await getWorkById(id);
  if (!work || work.status !== "published") return c.json({ message: "work not found" }, 404);
  if (work.targetType === "port") return c.json({ url: work.targetRef, targetType: "port" });
  if (work.assetKey) {
    return c.json({ url: createWorkAssetPublicUrl(work.assetKey), targetType: work.targetType, path: work.targetRef });
  }
  return c.json({ message: "work asset is unavailable" }, 409);
});

router.post("/:id/session", async (c) => {
  const user = useAuth(c);
  const id = c.req.param("id");
  if (!requireValidId(id)) return c.json({ message: "work not found" }, 404);
  const work = await getWorkById(id);
  if (!work || work.status !== "published") return c.json({ message: "work not found" }, 404);
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
  if (!work || work.status !== "published") return c.json({ message: "work not found" }, 404);
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
