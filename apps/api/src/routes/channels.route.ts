import { Hono } from "hono";
import { db } from "../db/index.js";
import { userChannels, spaceChannels, spaces } from "../db/schema-v2.js";
import { eq, and, desc, inArray } from "drizzle-orm";
import { requireAuth, useAuth, requireValidId } from "../lib/middleware.js";

const router = new Hono();

router.get("/", async (c) => {
  const user = useAuth(c);

  const channels = await db
    .select()
    .from(userChannels)
    .where(eq(userChannels.userUuid, user.uuid))
    .orderBy(desc(userChannels.updatedAt), desc(userChannels.createdAt));

  const channelIds = channels.map((ch) => ch.id);
  const boundRows = channelIds.length > 0
    ? await db
        .select({
          channelId: spaceChannels.channelId,
          spaceId: spaceChannels.spaceId,
          name: spaces.name,
        })
        .from(spaceChannels)
        .leftJoin(spaces, eq(spaces.id, spaceChannels.spaceId))
        .where(inArray(spaceChannels.channelId, channelIds))
    : [];

  const boundByChannelId = new Map(boundRows.map((row) => [row.channelId, row]));

  return c.json(
    channels.map((channel) => {
      const bound = boundByChannelId.get(channel.id);
      return {
        ...channel,
        boundSpace: bound ? { id: bound.spaceId, title: bound.name ?? null, status: "active" } : null,
      };
    }),
  );
});

router.post("/", async (c) => {
  const user = useAuth(c);

  const body = (await c.req
    .json<{ provider?: string; name?: string; credentials?: Record<string, unknown> }>()
    .catch(() => ({}))) as {
    provider?: string;
    name?: string;
    credentials?: Record<string, unknown>;
  };
  const provider = body.provider?.trim();
  const name = body.name?.trim();
  if (!provider || !name || !body.credentials || typeof body.credentials !== "object") {
    return c.json({ message: "provider, name and credentials are required" }, 400);
  }

  const [channel] = await db
    .insert(userChannels)
    .values({
      userUuid: user.uuid,
      provider,
      name,
      credentials: body.credentials,
      status: "active",
    })
    .returning();

  return c.json(channel, 201);
});

router.delete("/:id", async (c) => {
  const user = useAuth(c);
  const channelId = c.req.param("id");
  if (!requireValidId(channelId)) return c.json({ message: "channel not found" }, 404);

  const [channel] = await db
    .select()
    .from(userChannels)
    .where(and(eq(userChannels.id, channelId), eq(userChannels.userUuid, user.uuid)))
    .limit(1);
  if (!channel) return c.json({ message: "channel not found" }, 404);

  const bound = await db
    .select({ id: spaceChannels.id })
    .from(spaceChannels)
    .where(eq(spaceChannels.channelId, channelId))
    .limit(1);
  if (bound.length > 0) return c.json({ message: "channel is still bound to a space" }, 409);

  await db.delete(userChannels).where(eq(userChannels.id, channelId));
  return c.json({ ok: true });
});

export default router;
