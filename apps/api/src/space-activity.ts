import { spaces } from "@cohub/db";
import { eq } from "drizzle-orm";
import { db } from "./db/index.js";

export const touchSpaceActivity = async (spaceId: string, at = new Date()) => {
  await db.update(spaces).set({
    lastActivityAt: at,
  }).where(eq(spaces.id, spaceId));
};
