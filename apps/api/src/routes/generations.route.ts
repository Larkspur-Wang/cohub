import { Hono, type Context } from "hono";
import { createGenerationClient, GenerationValidationError } from "@neta-art/generation";
import { GENERATION_TASK_TYPE, type CreateGenerationTaskResponse } from "@cohub/protocol/generation";
import { useAuth, authzDenied } from "../lib/middleware.js";
import { hasPermission } from "../permissions.js";
import { loadGenerationDeclaration } from "../generations/declarations.js";
import { createGenerationTaskRequestSchema } from "../generations/schema.js";
import { getSpaceSessionById } from "../space-sessions.js";
import { getSessionTurnById } from "../session-turns.js";
import { enqueueTask } from "../tasks.js";
import { createLogger } from "@cohub/infra/logging";


const logger = createLogger({ serviceName: "cohub-api" });
const router = new Hono();

type ErrorStatus = 400 | 401 | 403 | 404 | 409 | 413 | 422 | 500 | 502 | 503;

function generationError(c: Context, status: ErrorStatus, code: string, message: string, details?: unknown) {
  return c.json({ error: { code, message, ...(details === undefined ? {} : { details }) } }, status);
}

function zodDetails(error: { issues: Array<{ path: PropertyKey[]; message: string }> }) {
  return error.issues.map((issue) => ({
    path: issue.path.map(String).join("."),
    message: issue.message,
  }));
}

router.post("/", async (c) => {
  const user = useAuth(c);
  const parsed = createGenerationTaskRequestSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    return generationError(c, 400, "invalid_generation_request", "Invalid generation request.", zodDetails(parsed.error));
  }

  const request = parsed.data;
  if (!(await hasPermission(user, "space.view", { spaceId: request.spaceId }))) return authzDenied(c);

  const sessionId = request.sessionId?.trim() || null;
  const turnId = request.turnId?.trim() || null;
  if (sessionId) {
    const session = await getSpaceSessionById(sessionId);
    if (!session || session.spaceId !== request.spaceId) {
      return generationError(c, 404, "generation_session_not_found", "Generation session not found in this space.");
    }
  }
  if (turnId) {
    if (!sessionId) {
      return generationError(c, 400, "generation_session_required", "sessionId is required when turnId is provided.");
    }
    const turn = await getSessionTurnById(sessionId, turnId);
    if (!turn) {
      return generationError(c, 404, "generation_turn_not_found", "Generation turn not found in this session.");
    }
  }

  const declaration = await loadGenerationDeclaration(user.uuid, request.model);
  if (!declaration) {
    return generationError(c, 404, "generation_model_not_found", `Generation model not found: ${request.model}`);
  }

  let parameters: Record<string, unknown> | undefined;
  try {
    const resolved = createGenerationClient({
      models: [declaration],
      includeBuiltinModels: false,
    }).validate({
      model: request.model,
      content: request.content,
      parameters: request.parameters,
      meta: request.meta,
    });
    parameters = resolved.parameters;
  } catch (error) {
    if (error instanceof GenerationValidationError) {
      return generationError(c, 400, "invalid_generation_input", error.message);
    }
    throw error;
  }

  let taskRunId: string;
  try {
    const enqueued = await enqueueTask({
      type: GENERATION_TASK_TYPE,
      spaceId: request.spaceId,
      sessionId: sessionId ?? undefined,
      turnId: turnId ?? undefined,
      userId: user.uuid,
      data: {
        model: request.model,
        content: request.content,
        parameters,
        meta: request.meta,
      },
    }, {
      attempts: 1,
      removeOnComplete: { age: 7 * 24 * 3600 },
      removeOnFail: { age: 30 * 24 * 3600 },
    });
    taskRunId = enqueued.taskRunId;
  } catch (error) {
    logger.error("[generations] failed to enqueue generation task", {
      userId: user.uuid,
      spaceId: request.spaceId,
      model: request.model,
      error,
    });
    return generationError(c, 503, "generation_queue_unavailable", "Generation queue is temporarily unavailable. Please try again later.");
  }

  return c.json({
    taskRunId,
    taskType: GENERATION_TASK_TYPE,
    status: "pending",
  } satisfies CreateGenerationTaskResponse, 202);
});

export default router;
