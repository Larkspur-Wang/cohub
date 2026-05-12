import { z } from "zod";

const metaSchema = z.record(z.string(), z.unknown());

const MAX_BASE64_CHARS = 14 * 1024 * 1024;

const generationSourceSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("url"), url: z.string().url() }),
  z.object({ type: z.literal("base64"), media_type: z.string().min(1), data: z.string().min(1).max(MAX_BASE64_CHARS) }),
  z.object({ type: z.literal("space_file"), space_id: z.string().uuid(), path: z.string().min(1) }),
]);

export const generationContentBlockSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("text"), text: z.string(), _meta: metaSchema.optional() }),
  z.object({ type: z.literal("image"), source: generationSourceSchema, _meta: metaSchema.optional() }),
  z.object({ type: z.literal("video"), source: generationSourceSchema, _meta: metaSchema.optional() }),
  z.object({ type: z.literal("audio"), source: generationSourceSchema, _meta: metaSchema.optional() }),
]);

export const createGenerationRequestSchema = z.object({
  model: z.string().min(1),
  content: z.array(generationContentBlockSchema).min(1),
  parameters: z.record(z.string(), z.unknown()).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

const generationContentSpecSchema = z.object({
  type: z.enum(["text", "image", "video", "audio"]),
  required: z.boolean().optional(),
  min: z.number().int().nonnegative().optional(),
  max: z.number().int().nonnegative().optional(),
  sources: z.array(z.enum(["url", "base64", "space_file"])).optional(),
  merge: z.enum(["newline", "space", "concat"]).optional(),
  meta: metaSchema.optional(),
  description: z.string().optional(),
});

const baseParameterSpecSchema = {
  optional: z.boolean().optional(),
  description: z.string().optional(),
};

const generationParameterSpecSchema = z.discriminatedUnion("type", [
  z.object({
    ...baseParameterSpecSchema,
    type: z.literal("string"),
    default: z.string().optional(),
    enum: z.array(z.string()).optional(),
    examples: z.array(z.string()).optional(),
  }),
  z.object({
    ...baseParameterSpecSchema,
    type: z.literal("number"),
    default: z.number().optional(),
    min: z.number().optional(),
    max: z.number().optional(),
    examples: z.array(z.number()).optional(),
  }),
  z.object({
    ...baseParameterSpecSchema,
    type: z.literal("integer"),
    default: z.number().int().optional(),
    min: z.number().optional(),
    max: z.number().optional(),
    examples: z.array(z.number()).optional(),
  }),
  z.object({
    ...baseParameterSpecSchema,
    type: z.literal("boolean"),
    default: z.boolean().optional(),
    examples: z.array(z.boolean()).optional(),
  }),
]);

export const generationDeclarationSchema = z.object({
  schema: z.literal("cohub.generation.v1"),
  model: z.string().min(1),
  title: z.string().optional(),
  description: z.string().optional(),
  adapter: z.object({
    type: z.string().min(1),
    base_url: z.string().url(),
    api_key: z.string().min(1),
  }),
  content: z.object({
    input: z.array(generationContentSpecSchema),
  }),
  parameters: z.record(z.string(), generationParameterSpecSchema).optional(),
  examples: z.array(z.object({
    title: z.string().optional(),
    request: createGenerationRequestSchema,
  })).optional(),
});

export type CreateGenerationRequestInput = z.infer<typeof createGenerationRequestSchema>;
export type GenerationDeclarationInput = z.infer<typeof generationDeclarationSchema>;
