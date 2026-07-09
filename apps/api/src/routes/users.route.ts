import { Hono } from "hono";
import { getProfilesByUuids } from "../user-profiles.js";
import { requireValidId, useAuth } from "../lib/middleware.js";

const router = new Hono();

const MAX_BATCH_USER_PROFILES = 100;

type BatchProfilesBody = {
  userUuids?: unknown;
};

router.post("/profiles/batch", async (c) => {
  const user = useAuth(c);
  if (user instanceof Response) return user;

  const body = await c.req.json<BatchProfilesBody>().catch(() => null);
  if (!body || !Array.isArray(body.userUuids)) {
    return c.json({ message: "userUuids must be an array" }, 400);
  }

  const userUuidSet = new Set<string>();
  for (const value of body.userUuids) {
    if (typeof value !== "string") {
      return c.json({ message: "userUuids must contain only strings" }, 400);
    }

    const userUuid = value.trim();
    if (!requireValidId(userUuid)) {
      return c.json({ message: "userUuids contains an invalid id" }, 400);
    }

    userUuidSet.add(userUuid);
  }

  const uniqueUserUuids = [...userUuidSet];
  if (uniqueUserUuids.length > MAX_BATCH_USER_PROFILES) {
    return c.json({ message: `userUuids must contain at most ${MAX_BATCH_USER_PROFILES} unique items` }, 400);
  }
  const profileMap = await getProfilesByUuids(uniqueUserUuids);
  const profiles = Object.fromEntries(profileMap);
  const missingUserUuids = uniqueUserUuids.filter((userUuid) => !profileMap.has(userUuid));

  c.header("Cache-Control", "private, max-age=60, stale-while-revalidate=300");
  return c.json({ profiles, missingUserUuids });
});

export default router;
