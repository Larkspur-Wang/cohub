import { createLogger } from "@cohub/infra/logging";
import { Hono } from "hono";
import { hasPermission } from "../permissions.js";
import { getSpaceSessionById } from "../space-sessions.js";
import { authzDenied, requireValidId, useAuth } from "../lib/middleware.js";
import {
  consumePublicAssetUploadQuota,
  createPublicAssetUploadPlan,
  PublicAssetConfigError,
  PublicAssetValidationError,
  type CreatePublicAssetUploadInput,
} from "../public-asset-storage.js";


const logger = createLogger({ serviceName: "cohub-api" });
const router = new Hono();

router.post("/uploads", async (c) => {
  const user = useAuth(c);
  const body = await c.req.json<CreatePublicAssetUploadInput>().catch(() => null);
  if (!body || typeof body !== "object") return c.json({ message: "invalid body" }, 400);
  if (body.purpose !== "user_avatar" && body.purpose !== "space_avatar" && body.purpose !== "chat_attachment") {
    return c.json({ message: "invalid public asset purpose" }, 400);
  }

  if (body.purpose === "space_avatar") {
    if (!body.spaceId || !requireValidId(body.spaceId)) return c.json({ message: "space not found" }, 404);
    if (!(await hasPermission(user, "space.edit", { spaceId: body.spaceId }))) return authzDenied(c);
  }

  if (body.purpose === "chat_attachment") {
    if (!body.spaceId || !requireValidId(body.spaceId)) return c.json({ message: "space not found" }, 404);
    if (!body.sessionId || !requireValidId(body.sessionId)) return c.json({ message: "session not found" }, 404);
    const session = await getSpaceSessionById(body.sessionId);
    if (!session || session.spaceId !== body.spaceId) return c.json({ message: "session not found" }, 404);
    const canPromptReadonly = await hasPermission(user, "session.prompt.readonly", { spaceId: body.spaceId, sessionId: body.sessionId });
    const canPrompt = canPromptReadonly || await hasPermission(user, "session.prompt.fullaccess", { spaceId: body.spaceId, sessionId: body.sessionId });
    if (!canPrompt) return authzDenied(c);
  }

  try {
    const plan = createPublicAssetUploadPlan({
      purpose: body.purpose,
      userUuid: user.uuid,
      spaceId: body.spaceId,
      sessionId: body.sessionId,
      file: body.file,
    });
    await consumePublicAssetUploadQuota(user.uuid);
    return c.json(plan);
  } catch (error) {
    if (error instanceof PublicAssetValidationError) {
      const status = error.message.startsWith("too many") ? 429 : 400;
      return c.json({ message: error.message }, status as never);
    }
    if (error instanceof PublicAssetConfigError) {
      logger.error("[public-assets] upload storage is not configured", error.message);
      return c.json({ message: "public asset storage is not configured" }, 500);
    }
    logger.error("[public-assets] failed to create upload", error);
    return c.json({ message: "failed to create public asset upload" }, 500);
  }
});

export default router;
