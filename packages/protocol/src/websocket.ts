import { z } from "zod";

const contentBlockMetaSchema = z.record(z.string(), z.unknown());

export const contentBlockSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("text"),
    text: z.string(),
    _meta: contentBlockMetaSchema.optional(),
  }),
  z.object({
    type: z.literal("thinking"),
    thinking: z.string(),
    signature: z.string().optional(),
    _meta: contentBlockMetaSchema.optional(),
  }),
  z.object({
    type: z.literal("image"),
    source: z.union([
      z.object({ type: z.literal("url"), url: z.string().url() }),
      z.object({ type: z.literal("base64"), media_type: z.string(), data: z.string() }),
    ]),
    _meta: contentBlockMetaSchema.optional(),
  }),
  z.object({
    type: z.literal("tool_use"),
    id: z.string(),
    name: z.string(),
    input: z.record(z.string(), z.unknown()),
    _meta: contentBlockMetaSchema.optional(),
  }),
  z.object({
    type: z.literal("tool_result"),
    tool_use_id: z.string(),
    content: z.union([z.string(), z.array(z.unknown())]),
    is_error: z.boolean().optional(),
    _meta: contentBlockMetaSchema.optional(),
  }),
  z.object({
    type: z.literal("system_note"),
    note_type: z.enum(["session_created", "forked", "compacted", "info"]),
    text: z.string(),
    _meta: contentBlockMetaSchema.optional(),
  }),
]);

export const wsClientEventSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("auth"),
    requestId: z.string().optional(),
    payload: z.object({ token: z.string().min(1) }),
  }),
  z.object({
    type: z.literal("message.create"),
    requestId: z.string().optional(),
    payload: z.object({
      spaceId: z.string().uuid(),
      sessionId: z.string().uuid(),
      clientMessageId: z.string().optional(),
      text: z.string().optional(),
      content: z.array(contentBlockSchema).optional(),
    }).refine((value) => Boolean(value.text?.trim()) || (value.content?.length ?? 0) > 0, {
      message: "text or content is required",
      path: ["content"],
    }),
  }),
  z.object({
    type: z.literal("ping"),
    requestId: z.string().optional(),
    payload: z.record(z.string(), z.unknown()).optional(),
  }),
  z.object({
    type: z.literal("ack"),
    requestId: z.string().optional(),
    payload: z.object({
      eventId: z.string().optional(),
    }).optional(),
  }),
]);

export const wsServerEnvelopeSchema = z.object({
  id: z.string(),
  type: z.enum(["ready", "auth.ok", "message.accepted", "event", "error", "pong", "ack.ok"]),
  timestamp: z.number(),
  payload: z.record(z.string(), z.unknown()),
});

export type WsClientEvent = z.infer<typeof wsClientEventSchema>;
export type WsServerEnvelope = z.infer<typeof wsServerEnvelopeSchema>;
