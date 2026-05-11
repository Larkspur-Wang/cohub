import { randomUUID } from "node:crypto";
import type { ContentBlock } from "@neta-art/cohub-protocol/core";
import { enqueueSpacePrompt, SandboxNotReadyError } from "./space-sessions.js";
import { createSessionTurn, failSessionTurn } from "./session-turns.js";
import { expandPromptTemplate } from "./prompt-templates.js";

export type PromptSource =
  | "web_app"
  | "public_api"
  | "scheduled_task"
  | "websocket"
  | string;

export type WebAppPromptContext = {
  kind: "web_app";
};

export type WebsocketPromptContext = {
  kind: "websocket";
  requestId?: string | null;
  connectionId?: string | null;
};

export type PublicApiPromptContext = {
  kind: "public_api";
};

export type ScheduledTaskPromptContext = {
  kind: "scheduled_task";
  taskRunId: string;
  cronJobId?: string | null;
};

export type ChannelPromptContext = {
  kind: "channel";
  provider: string;
  spaceChannelId: string;
  externalConversationId?: string | null;
  externalMessageId: string;
  providerContext?: Record<string, unknown> | null;
};

export type SubmitSessionPromptContext =
  | WebAppPromptContext
  | WebsocketPromptContext
  | PublicApiPromptContext
  | ScheduledTaskPromptContext
  | ChannelPromptContext;

export type PromptTemplateUsageMeta = {
  name: string;
  description: string;
  argumentHint: string | null;
  category: string | null;
  scope: "platform" | "user" | "project";
  rawInput: string;
  args: string[];
};

export type SubmitSessionPromptInput = {
  spaceId: string;
  sessionId: string;
  userId: string;
  clientMessageId: string;
  content: ContentBlock[];
  source: PromptSource;
  model?: string | null;
  provider?: string | null;
  context?: SubmitSessionPromptContext | null;
};

export type SubmitSessionPromptResult = {
  turnId: string;
  userMessageId: string;
};

type SubmitSessionPromptHooks = {
  beforeEnqueue?: (input: {
    turnId: string;
    userMessageId: string;
    content: ContentBlock[];
    meta: Record<string, unknown>;
  }) => Promise<void>;
};

export class SubmitSessionPromptError extends Error {
  constructor(
    message: string,
    public readonly cause: unknown,
  ) {
    super(message);
    this.name = "SubmitSessionPromptError";
  }
}

function normalizeDirectShellCommandContent(content: ContentBlock[]): ContentBlock[] {
  if (content.length !== 1) return content;
  const first = content[0];
  if (first?.type !== "text") return content;
  if (!first.text.startsWith("!")) return content;
  const command = first.text.slice(1);
  if (!command.trim()) throw new Error("shell command is empty");
  return [{ type: "shell_command", command, rawText: first.text } satisfies ContentBlock];
}

export const expandPromptContent = async (input: {
  content: ContentBlock[];
  userId: string;
  spaceId: string;
}) => {
  let content = input.content;
  let promptTemplate: PromptTemplateUsageMeta | null = null;

  if (content.length === 1 && content[0]?.type === "text") {
    const originalText = typeof content[0].text === "string" ? content[0].text : "";
    const rawText = originalText.trim();
    if (rawText.startsWith("/")) {
      const expanded = await expandPromptTemplate(rawText, {
        userId: input.userId,
        spaceId: input.spaceId,
      });
      if (expanded) {
        content = [{ type: "text", text: expanded.renderedText } satisfies ContentBlock];
        promptTemplate = {
          name: expanded.template.name,
          description: expanded.template.description,
          argumentHint: expanded.template.argumentHint ?? null,
          category: expanded.template.category ?? null,
          scope: expanded.template.scope,
          rawInput: expanded.rawInput,
          args: expanded.args,
        };
      }
    } else if (originalText.startsWith("!")) {
      content = normalizeDirectShellCommandContent(content);
    }
  }

  return { content, promptTemplate };
};

export const submitSessionPrompt = async (
  input: SubmitSessionPromptInput,
  hooks: SubmitSessionPromptHooks = {},
): Promise<SubmitSessionPromptResult> => {
  const userId = input.userId.trim();
  if (!userId) throw new Error("userId is required");
  const clientMessageId = input.clientMessageId.trim();
  if (!clientMessageId) throw new Error("clientMessageId is required");
  if (!Array.isArray(input.content) || input.content.length === 0) throw new Error("content is required");

  const { content, promptTemplate } = await expandPromptContent({
    content: input.content,
    userId,
    spaceId: input.spaceId,
  });

  const isDirectShellCommand = content.length === 1 && content[0]?.type === "shell_command";
  const inputIntent = isDirectShellCommand ? "shell_command" : "steer";
  const turnMeta = {
    source: input.source,
    userId,
    clientMessageId,
    intent: inputIntent,
    llm: isDirectShellCommand ? false : undefined,
    model: input.model ?? null,
    provider: input.provider ?? null,
    promptTemplate,
    context: input.context ?? null,
  };

  const turn = await createSessionTurn({
    sessionId: input.sessionId,
    userUuid: userId,
    userContent: content,
    intent: "steer",
    meta: turnMeta,
  }).catch((error: unknown) => {
    throw new SubmitSessionPromptError("failed to create session turn", error);
  });
  const turnId = turn.id;
  const userMessageId = randomUUID();
  const meta = {
    source: input.source,
    userId,
    clientMessageId,
    turnId,
    intent: inputIntent,
    llm: isDirectShellCommand ? false : undefined,
    model: input.model ?? null,
    provider: input.provider ?? null,
    promptTemplate,
    context: input.context ?? null,
  };

  try {
    await hooks.beforeEnqueue?.({ turnId, userMessageId, content, meta });
    await enqueueSpacePrompt({
      spaceId: input.spaceId,
      sessionId: input.sessionId,
      userMessageId,
      content,
      meta,
    });
  } catch (error) {
    await failSessionTurn({
      sessionId: input.sessionId,
      turnId,
      errorMessage: error instanceof Error ? error.message : String(error),
    }).catch(() => undefined);

    if (error instanceof SandboxNotReadyError) throw error;
    throw new SubmitSessionPromptError("failed to submit session prompt", error);
  }

  return { turnId, userMessageId };
};
