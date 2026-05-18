import { Hono } from "hono";
import { and, eq, inArray } from "drizzle-orm";
import { createDefaultMountSlug, listSpaceMods, assertValidMountSlug } from "@cohub/core/space-mods";
import { spaceMods, spaces } from "@cohub/db";
import { db } from "../../db/index.js";
import { getOptionalAuth, requireValidId, useAuth } from "../../lib/middleware.js";
import { hasPermission } from "../../permissions.js";
import { getSpaceById } from "../../space-sessions.js";
import { recoverSpaceSandbox } from "../../space-sandboxes.js";

const router = new Hono();

function getValidParam(value: string | undefined): string | null {
  return value && requireValidId(value) ? value : null;
}

function normalizeName(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, 255) : null;
}

function parseMountSlug(value: string | null | undefined) {
  if (!value) return { ok: true as const, value: null };
  try {
    return { ok: true as const, value: assertValidMountSlug(value) };
  } catch (error) {
    return { ok: false as const, message: error instanceof Error ? error.message : String(error) };
  }
}

function getUniqueViolationMessage(error: unknown): string | null {
  const record = error as { code?: string; constraint_name?: string; constraint?: string };
  if (record.code !== "23505") return null;
  const constraint = record.constraint_name ?? record.constraint ?? "";
  if (constraint.includes("space_mod")) return "mod space is already mounted";
  if (constraint.includes("mount_slug")) return "mountSlug is already used in this space";
  return "space mod already exists";
}

async function restartSandboxForMods(spaceId: string) {
  const space = await getSpaceById(spaceId);
  if (!space) return;
  void recoverSpaceSandbox({
    spaceId,
    userUuid: space.userUuid,
    ownerUserUuid: space.userUuid,
    reason: "space_mods_changed",
    source: "space_mods",
    verify: true,
  }).catch((error) => {
    console.error(`[SpaceMods] failed to restart sandbox spaceId=${spaceId}`, error);
  });
}

router.get("/", async (c) => {
  const user = getOptionalAuth(c);
  const spaceId = getValidParam(c.req.param("id"));
  if (!spaceId) return c.json({ message: "space not found" }, 404);
  if (!(await hasPermission(user, "mod.view", { spaceId }))) return c.json({ message: "not found" }, 404);
  return c.json({ items: await listSpaceMods(db, spaceId) });
});

router.post("/", async (c) => {
  const user = useAuth(c);
  const spaceId = getValidParam(c.req.param("id"));
  if (!spaceId) return c.json({ message: "space not found" }, 404);
  if (!(await hasPermission(user, "mod.manage", { spaceId }))) return c.json({ message: "not found" }, 404);

  const body = await c.req.json<{ modSpaceId?: string; name?: string | null; mountSlug?: string | null }>().catch(() => null);
  const modSpaceId = getValidParam(body?.modSpaceId?.trim());
  if (!modSpaceId) return c.json({ message: "modSpaceId is required" }, 400);
  if (modSpaceId === spaceId) return c.json({ message: "space cannot mount itself as a mod" }, 400);
  if (!(await hasPermission(user, "file.view", { spaceId: modSpaceId }))) return c.json({ message: "missing file.view permission for mod space" }, 403);

  const slug = parseMountSlug(body?.mountSlug);
  if (!slug.ok) return c.json({ message: slug.message }, 400);

  const [target] = await db.select({ id: spaces.id }).from(spaces).where(eq(spaces.id, modSpaceId)).limit(1);
  if (!target) return c.json({ message: "mod space not found" }, 404);

  const existing = await listSpaceMods(db, spaceId);
  const mountSlug = slug.value ?? createDefaultMountSlug(modSpaceId, existing.map((mod) => mod.mountSlug));
  const nextSortOrder = existing.reduce((max, mod) => Math.max(max, mod.sortOrder), -1) + 1;

  try {
    const [created] = await db.insert(spaceMods).values({
      spaceId,
      modSpaceId,
      name: normalizeName(body?.name),
      mountSlug,
      sortOrder: nextSortOrder,
      createdBy: user.uuid,
    }).returning();
    if (!created) return c.json({ message: "failed to create mod" }, 500);

    await restartSandboxForMods(spaceId);
    return c.json({ item: (await listSpaceMods(db, spaceId)).find((mod) => mod.id === created.id), sandboxRestarting: true }, 201);
  } catch (error) {
    const message = getUniqueViolationMessage(error);
    if (message) return c.json({ message }, 409);
    throw error;
  }
});

router.post("/reorder", async (c) => {
  const user = useAuth(c);
  const spaceId = getValidParam(c.req.param("id"));
  if (!spaceId) return c.json({ message: "space not found" }, 404);
  if (!(await hasPermission(user, "mod.manage", { spaceId }))) return c.json({ message: "not found" }, 404);

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
  if (!(await hasPermission(user, "mod.manage", { spaceId }))) return c.json({ message: "not found" }, 404);

  const body = await c.req.json<{ name?: string | null; mountSlug?: string; enabled?: boolean; sortOrder?: number }>().catch(() => null);
  if (!body) return c.json({ message: "invalid body" }, 400);
  const patch: Partial<typeof spaceMods.$inferInsert> = { updatedAt: new Date() };
  if ("name" in body) patch.name = normalizeName(body.name);
  if (typeof body.mountSlug === "string") {
    const slug = parseMountSlug(body.mountSlug);
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
    const message = getUniqueViolationMessage(error);
    if (message) return c.json({ message }, 409);
    throw error;
  }
});

router.delete("/:modId", async (c) => {
  const user = useAuth(c);
  const spaceId = getValidParam(c.req.param("id"));
  const modId = getValidParam(c.req.param("modId"));
  if (!spaceId || !modId) return c.json({ message: "not found" }, 404);
  if (!(await hasPermission(user, "mod.manage", { spaceId }))) return c.json({ message: "not found" }, 404);

  const [deleted] = await db.delete(spaceMods).where(and(eq(spaceMods.id, modId), eq(spaceMods.spaceId, spaceId))).returning();
  if (!deleted) return c.json({ message: "mod not found" }, 404);

  await restartSandboxForMods(spaceId);
  return c.json({ ok: true, sandboxRestarting: true });
});

export default router;
