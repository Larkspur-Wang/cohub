import { z } from "zod";

const normalizeBaseUrl = (value: string) => value.replace(/\/$/, "");

export const gatewayConfig = {
  apiBaseUrl: normalizeBaseUrl(process.env.API_BASE_URL ?? "http://localhost:8787"),
  port: Number(process.env.PORT ?? 8788),
};

export const OpenAIResponsesCreateRequestSchema = z.object({
  model: z.string().optional(),
  input: z.union([
    z.string().min(1),
    z.array(
      z.object({
        role: z.enum(["user", "system", "assistant"]),
        content: z.union([
          z.string(),
          z.array(
            z.object({
              type: z.literal("input_text"),
              text: z.string(),
            }),
          ),
        ]),
      }),
    ),
  ]).optional(),
  stream: z.boolean().optional(),
  instructions: z.string().nullable().optional(),
  metadata: z.record(z.string(), z.unknown()).nullable().optional(),
});

export type OpenAIResponsesCreateRequest = z.infer<typeof OpenAIResponsesCreateRequestSchema>;

export type GatewayAuthUser = {
  uuid: string;
  nick_name?: string;
  avatar_url?: string;
  [key: string]: unknown;
};
