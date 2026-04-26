import { Hono } from "hono";
import { hasPermission } from "../permissions.js";
import { useAuth } from "../lib/middleware.js";
import { listPromptTemplates } from "../prompt-templates.js";

const router = new Hono();

router.get("/", async (c) => {
  try {
    const user = useAuth(c);
    const spaceId = c.req.query("spaceId")?.trim() || null;

    if (spaceId && !(await hasPermission(user, "space.view", { spaceId }))) {
      return c.json({ message: "not found" }, 404);
    }

    return c.json({
      prompts: await listPromptTemplates({
        userId: user?.uuid ?? null,
        spaceId,
      }),
    });
  } catch (error) {
    return c.json({ message: error instanceof Error ? error.message : "Failed to load prompt templates" }, 502);
  }
});

export default router;
