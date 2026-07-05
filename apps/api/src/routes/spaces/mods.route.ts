import { Hono } from "hono";
import { and, eq } from "drizzle-orm";
import { listSpaceMods } from "@cohub/core/space-mods";
import { deleteReference } from "@cohub/core/references";
import { spaceMods } from "@cohub/db";
import { db } from "../../db/index.js";
import { getOptionalAuth, requireValidId, useAuth, authzDenied } from "../../lib/middleware.js";
import { hasPermission } from "../../permissions.js";
import { createSpaceMod, getSpaceModUniqueViolationMessage, normalizeSpaceModName, parseSpaceModMountSlug, restartSandboxForMods, spaceModErrorResponse } from "../../space-mods.js";

const router = new Hono();

function getValidParam(value: string | undefined): string | null {
  return value && requireValidId(value) ? value : null;
}

router.get("/", async (c) => {
  const user = getOptionalAuth(c);
  const spaceId = getValidParam(c.req.param("id"));
  if (!spaceId) return c.json({ message: "space not found" }, 404);
  if (!(await hasPermission(user, "mod.view", { spaceId }))) return authzDenied(c);
  return c.json({ items: await listSpaceMods(db, spaceId) });
});

router.post("/", async (c) => {
  const user = useAuth(c);
  const spaceId = getValidParam(c.req.param("id"));
  if (!spaceId) return c.json({ message: "space not found" }, 404);
  if (!(await hasPermission(user, "mod.manage", { spaceId }))) return authzDenied(c);

  const body = await c.req.json<{ modSpaceId?: string; name?: string | null; mountSlug?: string | null }>().catch(() => null);
  try {
    const result = await createSpaceMod({
      actor: user,
      spaceId,
      mod: { modSpaceId: body?.modSpaceId ?? "", name: body?.name, mountSlug: body?.mountSlug },
      restartSandbox: true,
    });
    return c.json(result, 201);
  } catch (error) {
    const response = spaceModErrorResponse(error);
    if (response) return c.json({ message: response.message }, response.status);
    throw error;
  }
});

router.post("/reorder", async (c) => {
  const user = useAuth(c);
  const spaceId = getValidParam(c.req.param("id"));
  if (!spaceId) return c.json({ message: "space not found" }, 404);
  if (!(await hasPermission(user, "mod.manage", { spaceId }))) return authzDenied(c);

  const body = await c.req.json<{ ids?: string[] }>().catch(() => null);
  const ids = Array.isArray(body?.ids) ? body.ids : [];
  if (ids.length === 0 || ids.some((id) => !requireValidId(id))) return c.json({ message: "valid ids are required" }, 400);
  if (new Set(ids).size !== ids.length) return c.json({ message: "ids must be unique" }, 400);

  const current = await db.select({ id: spaceMods.id }).from(spaceMods).where(eq(spaceMods.spaceId, spaceId));
  const currentIds = new Set(current.map((item) => item.id));
  if (ids.length !== currentIds.size || ids.some((id) => !currentIds.has(id))) {
    return c.json({ message: "ids must include all mods in this space" }, 400);
  }

  await db.transaction(async (tx) => {
    for (const [index, id] of ids.entries()) {
      await tx.update(spaceMods).set({ sortOrder: index, updatedAt: new Date() }).where(and(eq(spaceMods.id, id), eq(spaceMods.spaceId, spaceId)));
    }
  });

  await restartSandboxForMods(spaceId);
  return c.json({ items: await listSpaceMods(db, spaceId), sandboxRestarting: true });
});

router.patch("/:modId", async (c) => {
  const user = useAuth(c);
  const spaceId = getValidParam(c.req.param("id"));
  const modId = getValidParam(c.req.param("modId"));
  if (!spaceId || !modId) return c.json({ message: "not found" }, 404);
  if (!(await hasPermission(user, "mod.manage", { spaceId }))) return authzDenied(c);

  const body = await c.req.json<{ name?: string | null; mountSlug?: string; enabled?: boolean; sortOrder?: number }>().catch(() => null);
  if (!body) return c.json({ message: "invalid body" }, 400);
  const patch: Partial<typeof spaceMods.$inferInsert> = { updatedAt: new Date() };
  if ("name" in body) patch.name = normalizeSpaceModName(body.name);
  if (typeof body.mountSlug === "string") {
    const slug = parseSpaceModMountSlug(body.mountSlug);
    if (!slug.ok) return c.json({ message: slug.message }, 400);
    patch.mountSlug = slug.value ?? undefined;
  }
  if (typeof body.enabled === "boolean") patch.enabled = body.enabled;
  if (Number.isInteger(body.sortOrder)) patch.sortOrder = Math.max(0, body.sortOrder ?? 0);

  try {
    const [updated] = await db.update(spaceMods).set(patch).where(and(eq(spaceMods.id, modId), eq(spaceMods.spaceId, spaceId))).returning();
    if (!updated) return c.json({ message: "mod not found" }, 404);

    await restartSandboxForMods(spaceId);
    return c.json({ item: (await listSpaceMods(db, spaceId)).find((mod) => mod.id === modId), sandboxRestarting: true });
  } catch (error) {
    const message = getSpaceModUniqueViolationMessage(error);
    if (message) return c.json({ message }, 409);
    throw error;
  }
});

router.delete("/:modId", async (c) => {
  const user = useAuth(c);
  const spaceId = getValidParam(c.req.param("id"));
  const modId = getValidParam(c.req.param("modId"));
  if (!spaceId || !modId) return c.json({ message: "not found" }, 404);
  if (!(await hasPermission(user, "mod.manage", { spaceId }))) return authzDenied(c);

  const [deleted] = await db.delete(spaceMods).where(and(eq(spaceMods.id, modId), eq(spaceMods.spaceId, spaceId))).returning();
  if (!deleted) return c.json({ message: "mod not found" }, 404);

  // Keep the reference index consistent: drop the mod edge when unmounted.
  // Idempotent single-row delete; a rare miss is recoverable via backfill --reset.
  void deleteReference(db, {
    kind: "mod",
    sourceType: "space",
    sourceId: spaceId,
    targetType: "space",
    targetId: deleted.modSpaceId,
  }).catch(() => undefined);

  await restartSandboxForMods(spaceId);
  return c.json({ ok: true, sandboxRestarting: true });
});

export default router;
