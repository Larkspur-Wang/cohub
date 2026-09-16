import { z } from "zod";
import type { ContentBlock } from "../core/content.js";
import type { Usage } from "../core/usage.js";
import { contentBlockSchema } from "../core/content-schema.js";
export { contextToPiMessages, contextToTranscript, selectRuntimeContextMessages } from "./context.js";

export const RUNTIME_PROTOCOL_VERSION = 1 as const;
export const RUNTIME_MAX_FRAME_BYTES = 32 * 1024 * 1024;
export const runtimeRegistrationKey = (spaceId: string) => `runtime:space:${spaceId}`;
export const harnessSchema = z.enum(["cohub", "pi", "codex"]);
export type HarnessKind = z.infer<typeof harnessSchema>;
export type LocalHarness = Exclude<HarnessKind, "cohub">;
export const isLocalHarness = (value: unknown): value is LocalHarness => value === "pi" || value === "codex";
export const resolveHarness = (meta: unknown): HarnessKind => {
  const value = meta && typeof meta === "object" ? (meta as { harness?: unknown }).harness : null;
  return isLocalHarness(value) ? value : "cohub";
};

export type HarnessArchiveIndex = {
  version: 1;
  objectKey: string;
  sizeBytes?: number | null;
  sha256?: string | null;
  harness: HarnessKind;
  nativeFormat: string;
};

export type RuntimeContextMessage = {
  id: string;
  turnId: string;
  role: "user" | "assistant" | "system";
  content: ContentBlock[];
  provider?: string | null;
  model?: string | null;
  meta?: Record<string, unknown> | null;
};

export type RuntimeContext = {
  complete?: boolean;
  revision: string;
  throughTurnId: string | null;
  messages: RuntimeContextMessage[];
  archive?: HarnessArchive | null;
  resolvedTurnIds?: string[];
  settledTurnIds?: string[];
};

export type HarnessArchive = {
  version: 1;
  harness: HarnessKind;
  sessionId: string;
  turnId: string;
  nativeFormat: "pi.jsonl" | "codex.rollout" | "cohub.jsonl";
  nativeSessionId: string;
  /** Native JSONL, never a path to a file expected to exist on another host. */
  data: string;
};

export const runtimeCapabilitiesSchema = z.object({
  harnesses: z.array(z.enum(["pi", "codex"])).min(1).max(2),
  models: z.array(z.object({
    harness: z.enum(["pi", "codex"]),
    provider: z.string().max(100),
    id: z.string().min(1).max(255),
    name: z.string().max(255),
  })).max(2000),
});
export type RuntimeCapabilities = z.infer<typeof runtimeCapabilitiesSchema>;
export const runtimeRegistrationSchema = z.object({
  connectionId: z.string().uuid(),
  endpoint: z.url({ protocol: /^wss?$/ }),
  ownerUserId: z.string().min(1),
  capabilities: runtimeCapabilitiesSchema,
});
export type RuntimeRegistration = z.infer<typeof runtimeRegistrationSchema>;

export function parseRuntimeRegistration(raw: string): RuntimeRegistration | null {
  try { return runtimeRegistrationSchema.parse(JSON.parse(raw)); }
  catch { return null; }
}

export const runtimeReadySchema = z.object({ type: z.literal("runtime.ready"), connectionId: z.string().uuid() });

export type RuntimeExecutionIdentity = { spaceId: string; sessionId: string; turnId: string; harness: LocalHarness };
export type RuntimeRecoveryState = { state: "executing" | "attention" | "confirmed_stopped"; ownerUserId?: string | null; resolvedBy?: string; resolvedAt?: string };
export type RuntimeStatus = {
  kind: "cloud" | "local"; online: boolean; capabilities: RuntimeCapabilities | null;
  recovery: { pending: number; revision: string }; canManage: boolean;
};
export const runtimeStopConfirmationSchema = z.object({ revision: z.string().min(1), confirmed: z.literal(true) }).strict();
export type RuntimeStopConfirmation = z.infer<typeof runtimeStopConfirmationSchema>;

export type RuntimeTurnInput = {
  spaceId: string;
  sessionId: string;
  turnId: string;
  userMessageId: string;
  harness: LocalHarness;
  content: ContentBlock[];
  context: RuntimeContext;
  provider?: string | null;
  model?: string | null;
  thinkingLevel?: string | null;
  accessMode: "read_only" | "full_access";
};

export type RuntimeMessage = {
  ordinal: number;
  content: ContentBlock[];
  provider?: string | null;
  model?: string | null;
  usage?: Usage | null;
  stopReason?: string | null;
  errorMessage?: string | null;
};

export type RuntimeExecutionEvent =
  | { type: "message.start"; ordinal: number }
  | { type: "text.delta"; ordinal: number; index: number; kind: "text" | "thinking"; delta: string }
  | { type: "content.replace"; ordinal: number; content: ContentBlock[] }
  | { type: "message.commit"; message: RuntimeMessage }
  | { type: "turn.end"; message: RuntimeMessage; archive?: HarnessArchive | null; resume: "native" | "restored" | "handoff" | "new" }
  | { type: "context.required"; pendingTurnIds?: string[] }
  | { type: "turn.acknowledged" }
  | { type: "turn.error"; message: string; uncertain?: boolean };

const id = z.string().uuid();
const ordinal = z.number().int().min(0).max(100_000);
const content = z.array(contentBlockSchema).max(100_000);
const count = z.number().finite().nonnegative().optional();
const usageSchema = z.object({ input: count, output: count, cacheRead: count, cacheWrite: count, totalTokens: count,
  cost: z.object({ input: count, output: count, cacheRead: count, cacheWrite: count, total: count }).nullable().optional(),
});
const runtimeMessageSchema = z.object({
  ordinal,
  content,
  provider: z.string().nullable().optional(),
  model: z.string().nullable().optional(),
  usage: usageSchema.nullable().optional(),
  stopReason: z.string().max(64).nullable().optional(),
  errorMessage: z.string().max(16_384).nullable().optional(),
});
export const harnessArchiveSchema = z.object({
  version: z.literal(1), harness: harnessSchema, sessionId: id, turnId: id,
  nativeFormat: z.enum(["pi.jsonl", "codex.rollout", "cohub.jsonl"]),
  nativeSessionId: z.string().min(1).max(255), data: z.string().max(RUNTIME_MAX_FRAME_BYTES),
});
export const runtimeEventSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("message.start"), ordinal }),
  z.object({ type: z.literal("text.delta"), ordinal, index: ordinal, kind: z.enum(["text", "thinking"]), delta: z.string() }),
  z.object({ type: z.literal("content.replace"), ordinal, content }),
  z.object({ type: z.literal("message.commit"), message: runtimeMessageSchema }),
  z.object({ type: z.literal("turn.end"), message: runtimeMessageSchema, archive: harnessArchiveSchema.nullable().optional(), resume: z.enum(["native", "restored", "handoff", "new"]) }),
  z.object({ type: z.literal("context.required"), pendingTurnIds: z.array(id).max(2).optional() }),
  z.object({ type: z.literal("turn.acknowledged") }),
  z.object({ type: z.literal("turn.error"), message: z.string().max(16_384), uncertain: z.boolean().optional() }),
]);
export const runtimeClientFrameSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("runtime.hello"), version: z.literal(RUNTIME_PROTOCOL_VERSION), spaceId: id, token: z.string().min(1).max(16_384), capabilities: runtimeCapabilitiesSchema }),
  z.object({ type: z.literal("runtime.heartbeat") }),
  z.object({ type: z.literal("runtime.auth"), token: z.string().min(1).max(16_384) }),
  z.object({ type: z.literal("runtime.event"), requestId: id, event: runtimeEventSchema }),
]);
export type RuntimeClientFrame = z.infer<typeof runtimeClientFrameSchema>;

const runtimeContextSchema = z.object({ complete: z.boolean().optional(), revision: z.string(), throughTurnId: id.nullable(), messages: z.array(z.object({
  id: z.string(), turnId: id, role: z.enum(["user", "assistant", "system"]), content,
  provider: z.string().nullable().optional(), model: z.string().nullable().optional(), meta: z.record(z.string(), z.unknown()).nullable().optional(),
})), archive: harnessArchiveSchema.nullable().optional(), resolvedTurnIds: z.array(id).max(2).optional(), settledTurnIds: z.array(id).max(2).optional() });

export const runtimeCommandSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("turn.recover"), requestId: id, execution: z.object({ spaceId: id, sessionId: id, turnId: id, harness: z.enum(["pi", "codex"]) }) }),
  z.object({ type: z.literal("turn.start"), requestId: id, resumeOnly: z.boolean().optional(), input: z.object({
    spaceId: id, sessionId: id, turnId: id, userMessageId: id, harness: z.enum(["pi", "codex"]), content,
    context: runtimeContextSchema,
    provider: z.string().nullable().optional(), model: z.string().nullable().optional(), thinkingLevel: z.string().nullable().optional(),
    accessMode: z.enum(["read_only", "full_access"]),
  }) }),
  z.object({ type: z.literal("session.context"), requestId: id, context: runtimeContextSchema }),
  z.object({ type: z.literal("turn.abort"), requestId: id }),
  z.object({ type: z.literal("turn.ack"), requestId: id, revision: z.string(), turnId: id }),
]);
export type RuntimeCommand = z.infer<typeof runtimeCommandSchema>;
