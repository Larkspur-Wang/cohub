import { extname } from "node:path";
import { Hono } from "hono";
import { z } from "zod";
import {
  BillingAccessBlockedError,
  billingOperations,
  createBillingUsageGate,
  COHUB_BILLING_TOKEN_TYPES,
  COHUB_BILLING_USAGE_TYPES,
  normalizePositiveUsd,
  serializeBillingBlocked,
} from "@cohub/billing";
import type {
  CompletionMessage,
  CreateSpaceCompletionInput,
  SpaceCompletionResult,
  SpaceCompletionStreamEvent,
} from "@cohub/protocol";
import type { ContentBlock } from "@cohub/protocol/core";
import { createLogger } from "@cohub/infra/logging";
import { authzDenied, requireValidId, useAuth } from "../../lib/middleware.js";
import { hasPermission } from "../../permissions.js";
import { getSpaceById } from "../../space-sessions.js";
import {
  readSpaceFile,
  SpaceFsError,
  spaceFsJsonError,
} from "../../space-fs-backend.js";
import { archiveCompletionBestEffort, createCompletionId } from "../../completion-object-storage.js";
import { resolveCompletionModel } from "../../llm/models.js";
import {
  runCompletion,
  streamCompletionEvents,
  type RunCompletionOutcome,
} from "../../llm/stream-completion.js";

const logger = createLogger({ serviceName: "cohub-api" });
const router = new Hono();

const billingUsageGate = createBillingUsageGate({
  operations: billingOperations,
  onEvaluationError: (error, gateInput) => {
    logger.warn("[BillingGate] fail-open after completion billing evaluation error", { error, gateInput });
  },
});

const MAX_MESSAGES = 200;
const MAX_SYSTEM_PROMPT_CHARS = 500_000;
const ALLOWED_SYSTEM_PROMPT_EXTENSIONS = new Set([".md", ".markdown", ".txt", ".prompt"]);

const contentBlockSchema = z.object({
  type: z.string().min(1),
}).passthrough();

const completionMessageSchema = z.object({
  role: z.enum(["user", "assistant", "system"]),
  content: z.array(contentBlockSchema).min(1),
});

const createCompletionSchema = z.object({
  provider: z.string().trim().min(1).nullish(),
  model: z.string().trim().min(1).nullish(),
  systemPromptPath: z.string().trim().nullish(),
  messages: z.array(completionMessageSchema).min(1).max(MAX_MESSAGES),
  temperature: z.number().finite().nullish(),
  maxTokens: z.number().finite().positive().nullish(),
  thinkingLevel: z.enum(["off", "minimal", "low", "medium", "high", "xhigh"]).nullish(),
  stream: z.boolean().nullish(),
});

type ErrorStatus = 400 | 401 | 402 | 403 | 404 | 413 | 500 | 502 | 503;

function completionError(c: Parameters<typeof useAuth>[0], status: ErrorStatus, code: string, message: string, details?: unknown) {
  return c.json({ error: { code, message, ...(details === undefined ? {} : { details }) }, message }, status);
}

function zodDetails(error: z.ZodError) {
  return error.issues.map((issue) => ({
    path: issue.path.map(String).join("."),
    message: issue.message,
  }));
}

function isContentBlock(value: unknown): value is ContentBlock {
  return Boolean(value && typeof value === "object" && !Array.isArray(value) && typeof (value as { type?: unknown }).type === "string");
}

function normalizeMessages(raw: z.infer<typeof createCompletionSchema>["messages"]): CompletionMessage[] {
  return raw.map((message) => ({
    role: message.role,
    content: message.content.filter(isContentBlock),
  })).filter((message) => message.content.length > 0);
}

async function loadSystemPrompt(spaceId: string, systemPromptPath: string | null | undefined): Promise<{ path: string | null; text: string }> {
  const path = systemPromptPath?.trim() || null;
  if (!path) return { path: null, text: "" };

  const ext = extname(path).toLowerCase();
  if (ext && !ALLOWED_SYSTEM_PROMPT_EXTENSIONS.has(ext)) {
    throw new SpaceFsError(400, "system_prompt_invalid", "System prompt path must be a markdown or text file.");
  }

  const file = await readSpaceFile(spaceId, path, { visibility: "full" });
  if (!("content" in file) || typeof file.content !== "string") {
    throw new SpaceFsError(503, "system_prompt_preparing", "System prompt file is not ready yet.");
  }
  if (file.delivery === "url" || file.kind === "binary") {
    throw new SpaceFsError(400, "system_prompt_unsupported", "System prompt file is too large or binary.");
  }
  if (file.content.length > MAX_SYSTEM_PROMPT_CHARS) {
    throw new SpaceFsError(413, "system_prompt_too_large", `System prompt exceeds ${MAX_SYSTEM_PROMPT_CHARS} characters.`);
  }
  return { path, text: file.content };
}

async function recordCompletionBilling(input: {
  completionId: string;
  userId: string;
  provider: string;
  model: string;
  usage: RunCompletionOutcome["usage"];
  aborted: boolean;
  error: RunCompletionOutcome["error"];
}) {
  if (!billingOperations.status.configured) return;
  if (input.aborted || input.error) return;
  const amountUsd = normalizePositiveUsd(input.usage?.cost?.total);
  if (amountUsd <= 0) return;

  try {
    const result = await billingOperations.recordUsage({
      userId: input.userId,
      amountUsd,
      tokenType: COHUB_BILLING_TOKEN_TYPES.usdMicroCent,
      usageType: COHUB_BILLING_USAGE_TYPES.generationLlmRaw,
      sourceId: input.completionId,
      operationId: `raw_completion:${input.completionId}`,
      reason: `Raw LLM completion ${input.provider}/${input.model}`,
    });
    if (result.status === "overage") {
      logger.warn("[Billing] raw completion usage recorded as overage", {
        userId: input.userId,
        completionId: input.completionId,
        amountUsd,
        provider: input.provider,
        model: input.model,
      });
    }
  } catch (error) {
    logger.warn("[Billing] failed to record raw completion usage", {
      userId: input.userId,
      completionId: input.completionId,
      amountUsd,
      provider: input.provider,
      model: input.model,
      error,
    });
  }
}

function encodeSse(event: SpaceCompletionStreamEvent) {
  return `data: ${JSON.stringify(event)}\n\n`;
}

router.post("/", async (c) => {
  const user = useAuth(c);
  if (user instanceof Response) return user;

  const spaceId = c.req.param("id");
  if (!spaceId || !requireValidId(spaceId)) {
    return completionError(c, 404, "space_not_found", "Space not found.");
  }

  if (!(await hasPermission(user, "session.prompt.readonly", { spaceId }))) {
    return authzDenied(c);
  }

  const space = await getSpaceById(spaceId);
  if (!space) return completionError(c, 404, "space_not_found", "Space not found.");

  const rawBody = await c.req.json().catch(() => null);
  const parsed = createCompletionSchema.safeParse(rawBody);
  if (!parsed.success) {
    return completionError(c, 400, "invalid_completion_request", "Invalid completion request.", zodDetails(parsed.error));
  }

  const body = parsed.data as CreateSpaceCompletionInput;
  const messages = normalizeMessages(parsed.data.messages);
  if (messages.length === 0) {
    return completionError(c, 400, "messages_required", "messages must contain at least one valid content block.");
  }

  const stream = Boolean(body.stream);
  const completionId = createCompletionId();
  const startedAt = new Date();

  let systemPromptPath: string | null = null;
  let systemPrompt = "";
  try {
    const loaded = await loadSystemPrompt(spaceId, body.systemPromptPath);
    systemPromptPath = loaded.path;
    systemPrompt = loaded.text;
  } catch (error) {
    if (error instanceof SpaceFsError) {
      const mappedCode = error.code === "path_not_found" || error.status === 404
        ? "system_prompt_not_found"
        : error.code;
      const mappedMessage = mappedCode === "system_prompt_not_found"
        ? "System prompt file not found."
        : error.message;
      return completionError(c, error.status as ErrorStatus, mappedCode, mappedMessage);
    }
    const { status, body: errBody } = spaceFsJsonError(error);
    return completionError(c, status as ErrorStatus, errBody.code, errBody.message);
  }

  const resolved = await resolveCompletionModel({
    userId: user.uuid,
    provider: body.provider,
    model: body.model,
  }).catch((error) => {
    logger.error("[Completion] failed to resolve model", error);
    return null;
  });
  if (!resolved) {
    return completionError(c, 502, "models_unavailable", "Failed to load models catalog.");
  }
  if (!resolved.model) {
    return completionError(c, 404, "model_not_found", resolved.error ?? "Model not found.");
  }

  const model = resolved.model;
  const registry = resolved.registry;

  const decision = await billingUsageGate.evaluate({
    userId: user.uuid,
    usageKind: "llm.raw_completion",
    source: "raw_completion",
    model: model.id,
    provider: model.provider,
    spaceId,
  });
  if (decision.status === "blocked") {
    const blocked = new BillingAccessBlockedError(decision);
    return c.json(serializeBillingBlocked(blocked), 402);
  }

  const runInput = {
    completionId,
    registry,
    model,
    systemPrompt,
    messages,
    temperature: body.temperature,
    maxTokens: body.maxTokens,
    thinkingLevel: body.thinkingLevel,
    userId: user.uuid,
    spaceId,
    signal: c.req.raw.signal,
  };

  const finalize = async (outcome: RunCompletionOutcome) => {
    const completedAt = new Date();
    await recordCompletionBilling({
      completionId,
      userId: user.uuid,
      provider: model.provider,
      model: model.id,
      usage: outcome.usage,
      aborted: outcome.aborted,
      error: outcome.error,
    });
    archiveCompletionBestEffort({
      completionId,
      spaceId,
      userId: user.uuid,
      provider: model.provider,
      model: model.id,
      systemPromptPath,
      systemPrompt,
      request: {
        messages,
        temperature: body.temperature ?? null,
        maxTokens: body.maxTokens ?? null,
        thinkingLevel: body.thinkingLevel ?? null,
        stream,
      },
      response: {
        message: outcome.message,
        usage: outcome.usage,
        stopReason: outcome.message.stopReason,
        errorMessage: outcome.message.errorMessage ?? null,
      },
      startedAt: startedAt.toISOString(),
      completedAt: completedAt.toISOString(),
      durationMs: Math.max(0, completedAt.getTime() - startedAt.getTime()),
      clientAborted: outcome.aborted,
      error: outcome.error,
    });
  };

  if (!stream) {
    const outcome = await runCompletion(runInput);
    await finalize(outcome);
    if (outcome.error && !outcome.aborted) {
      return completionError(c, 502, outcome.error.code, outcome.error.message);
    }
    const result: SpaceCompletionResult = {
      completionId,
      provider: model.provider,
      model: model.id,
      systemPromptPath,
      message: outcome.message,
      usage: outcome.usage,
    };
    return c.json(result);
  }

  const encoder = new TextEncoder();
  let settled = false;
  const readable = new ReadableStream<Uint8Array>({
    async start(controller) {
      const push = (event: SpaceCompletionStreamEvent) => {
        controller.enqueue(encoder.encode(encodeSse(event)));
      };

      // Override meta with actual systemPromptPath.
      push({
        type: "meta",
        completionId,
        provider: model.provider,
        model: model.id,
        systemPromptPath,
      });

      const iterator = streamCompletionEvents(runInput);
      let outcome: RunCompletionOutcome | null = null;
      try {
        while (true) {
          const next = await iterator.next();
          if (next.done) {
            outcome = next.value;
            break;
          }
          // Skip the internal meta event; we already sent a corrected one.
          if (next.value.type === "meta") continue;
          push(next.value);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        push({
          type: "error",
          code: "llm_error",
          message,
          completionId,
        });
        outcome = {
          message: {
            role: "assistant",
            content: [{ type: "text", text: "" }],
            stopReason: "error",
            errorMessage: message,
          },
          usage: null,
          raw: null,
          aborted: Boolean(c.req.raw.signal.aborted),
          error: { code: "llm_error", message },
        };
      } finally {
        if (outcome && !settled) {
          settled = true;
          await finalize(outcome);
        }
        controller.close();
      }
    },
    cancel() {
      // Abort is observed via c.req.raw.signal.
    },
  });

  return new Response(readable, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
});

export default router;
