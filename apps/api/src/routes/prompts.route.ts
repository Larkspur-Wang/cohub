import { Hono } from "hono";
import { hasPermission } from "../permissions.js";
import { getOptionalAuth, authzDenied } from "../lib/middleware.js";
import { listPromptTemplates } from "../prompt-templates.js";

const router = new Hono();

router.get("/", async (c) => {
  const user = getOptionalAuth(c);
  const spaceId = c.req.query("spaceId")?.trim() || null;

  if (!user && !spaceId) {
    return c.json({ prompts: [] });
  }

  if (spaceId && !(await hasPermission(user, "space.view", { spaceId }))) {
    return authzDenied(c);
  }

  try {
    return c.json({
      prompts: await listPromptTemplates({
        userId: user?.uuid ?? null,
        spaceId,
      }),
    });
  } catch (error) {
    console.error("[prompts] failed to load templates", error);
    return c.json({ message: "failed to load prompt templates" }, 502);
  }
});

export default router;
