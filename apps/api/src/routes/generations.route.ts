import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import type { Generation } from "@neta-art/cohub-protocol";
import { useAuth } from "../lib/middleware.js";
import { loadGenerationDeclaration } from "../generations/declarations.js";
import { createGenerationRequestSchema } from "../generations/schema.js";
import { GenerationHttpError } from "../generations/errors.js";
import { GenerationValidationError, resolveGenerationParameters, validateGenerationContent } from "../generations/validation.js";
import { getGenerationAdapter } from "../generations/adapters/index.js";

const router = new Hono();

router.post("/", async (c) => {
  const user = useAuth(c);
  const parsed = createGenerationRequestSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    return c.json({ message: parsed.error.issues.map((issue) => issue.message).join("; ") }, 400);
  }

  const request = parsed.data;
  const declaration = await loadGenerationDeclaration(user.uuid, request.model);
  if (!declaration) return c.json({ message: `Generation model not found: ${request.model}` }, 404);

  let parameters: Record<string, unknown>;
  try {
    validateGenerationContent(declaration, request.content);
    parameters = resolveGenerationParameters(declaration, request.parameters);
  } catch (error) {
    if (error instanceof GenerationValidationError) return c.json({ message: error.message }, 400);
    throw error;
  }

  const now = new Date().toISOString();
  const base = {
    id: randomUUID(),
    model: request.model,
    input: request.content,
    parameters,
    metadata: request.metadata,
    created_at: now,
  } satisfies Pick<Generation, "id" | "model" | "input" | "parameters" | "metadata" | "created_at">;

  try {
    const output = await getGenerationAdapter(declaration.adapter.type)({ declaration, user, request, parameters });
    const completedAt = new Date().toISOString();
    return c.json({
      ...base,
      status: "succeeded",
      output,
      updated_at: completedAt,
      completed_at: completedAt,
    } satisfies Generation);
  } catch (error) {
    const completedAt = new Date().toISOString();
    if (error instanceof GenerationHttpError) {
      return c.json({
        ...base,
        status: "failed",
        error: { code: error.code, message: error.message },
        updated_at: completedAt,
        completed_at: completedAt,
      } satisfies Generation, error.status as 400 | 401 | 403 | 404 | 413 | 500 | 502);
    }

    console.error("[generations] generation failed", {
      model: request.model,
      error,
    });
    return c.json({
      ...base,
      status: "failed",
      error: { code: "generation_failed", message: "Generation failed" },
      updated_at: completedAt,
      completed_at: completedAt,
    } satisfies Generation, 500);
  }
});

export default router;
