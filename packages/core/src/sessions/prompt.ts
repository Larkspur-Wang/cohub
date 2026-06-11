import type { ContentBlock } from "@cohub/protocol/core";
import type { GenerationPolicy } from "@cohub/protocol/generation";
import type { SessionTurnIntent } from "@cohub/protocol/model";
import { normalizeContentBlocks } from "../content/normalize.js";

export type PromptSource =
  | "web_app"
  | "public_api"
  | "scheduled_task"
  | "websocket"
  | string;

export type WebAppPromptContext = {
  kind: "web_app";
  requestId?: string | null;
};

export type WebsocketPromptContext = {
  kind: "websocket";
  requestId?: string | null;
  connectionId?: string | null;
};

export type PublicApiPromptContext = {
  kind: "public_api";
  requestId?: string | null;
};

export type ScheduledTaskPromptContext = {
  kind: "scheduled_task";
  taskRunId: string;
  cronJobId?: string | null;
};

export type BackgroundBashTaskPromptContext = {
  kind: "background_bash_task";
  taskRunId: string;
  origin?: {
    kind: "bash_tool_call";
    sessionId: string;
    turnId: string;
    toolCallId: string;
    requestId?: string | null;
  } | null;
};

export type ChannelPromptContext = {
  kind: "channel";
  provider: string;
  spaceChannelId: string;
  requestId?: string | null;
  externalConversationId?: string | null;
  externalMessageId: string;
  providerContext?: Record<string, unknown> | null;
};

export type SubmitSessionPromptContext =
  | WebAppPromptContext
  | WebsocketPromptContext
  | PublicApiPromptContext
  | ScheduledTaskPromptContext
  | BackgroundBashTaskPromptContext
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

export type PromptAccessMode = "read_only" | "full_access";

export type SubmitSessionPromptInput = {
  spaceId: string;
  sessionId: string;
  userId: string;
  clientMessageId: string;
  content: ContentBlock[];
  source: PromptSource;
  model?: string | null;
  provider?: string | null;
  generationPolicy?: GenerationPolicy | null;
  accessMode?: PromptAccessMode | null;
  intent?: SessionTurnIntent | null;
  context?: SubmitSessionPromptContext | null;
};

export type SubmitSessionPromptResult = {
  turnId: string;
  userMessageId: string;
};

export type SubmitSessionPromptHooks = {
  beforeEnqueue?: (input: {
    turnId: string;
    userMessageId: string;
    content: ContentBlock[];
    meta: Record<string, unknown>;
  }) => Promise<void>;
};

export type ExpandedPromptTemplate = {
  renderedText: string;
  template: {
    name: string;
    description: string;
    argumentHint?: string | null;
    category?: string | null;
    scope: "platform" | "user" | "project";
  };
  args: string[];
  rawInput: string;
};

export type SessionPromptDependencies = {
  randomUUID(): string;
  expandPromptTemplate(input: {
    text: string;
    userId: string;
    spaceId: string;
  }): Promise<ExpandedPromptTemplate | null>;
  sandboxRecovery?: {
    maybeRecoverForPrompt(input: {
      spaceId: string;
      sessionId: string;
      userId: string;
      source: PromptSource;
      context?: SubmitSessionPromptContext | null;
    }): void | Promise<void>;
  };
  createSessionTurn(input: {
    sessionId: string;
    userUuid: string;
    userContent: ContentBlock[];
    intent: SessionTurnIntent;
    meta: Record<string, unknown>;
  }): Promise<{ id: string }>;
  enqueueSpacePrompt(input: {
    spaceId: string;
    sessionId: string;
    turnId: string;
    userMessageId: string;
    content: ContentBlock[];
    meta: Record<string, unknown>;
  }): Promise<void>;
  failSessionTurn(input: {
    sessionId: string;
    turnId: string;
    errorMessage: string;
  }): Promise<unknown>;
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
  const rawText = first.text.trimStart();
  if (!rawText.startsWith("!")) return content;
  const command = rawText.slice(1);
  if (!command.trim()) throw new Error("shell command is empty");
  return [{ type: "shell_command", command, rawText } satisfies ContentBlock];
}

function normalizePromptModelProvider(input: Pick<SubmitSessionPromptInput, "model" | "provider">): {
  model: string | null;
  provider: string | null;
} {
  const model = input.model?.trim() || null;
  const provider = input.provider?.trim() || null;
  return {
    model,
    provider: provider ?? (model ? "cohub" : null),
  };
}

export const expandPromptContent = async (
  deps: Pick<SessionPromptDependencies, "expandPromptTemplate">,
  input: {
    content: ContentBlock[];
    userId: string;
    spaceId: string;
  },
) => {
  let content = input.content;
  let promptTemplate: PromptTemplateUsageMeta | null = null;

  if (content.length === 1 && content[0]?.type === "text") {
    const originalText = typeof content[0].text === "string" ? content[0].text : "";
    const rawText = originalText.trim();
    if (rawText.startsWith("/")) {
      const expanded = await deps.expandPromptTemplate({
        text: rawText,
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
    }

    content = normalizeDirectShellCommandContent(content);
  }

  return { content, promptTemplate };
};

export const submitSessionPrompt = async (
  deps: SessionPromptDependencies,
  input: SubmitSessionPromptInput,
  hooks: SubmitSessionPromptHooks = {},
): Promise<SubmitSessionPromptResult> => {
  const userId = input.userId.trim();
  if (!userId) throw new Error("userId is required");
  const clientMessageId = input.clientMessageId.trim();
  if (!clientMessageId) throw new Error("clientMessageId is required");
  if (!Array.isArray(input.content) || input.content.length === 0) throw new Error("content is required");

  if (deps.sandboxRecovery) {
    void Promise.resolve(deps.sandboxRecovery.maybeRecoverForPrompt({
      spaceId: input.spaceId,
      sessionId: input.sessionId,
      userId,
      source: input.source,
      context: input.context ?? null,
    })).catch((error: unknown) => {
      console.warn(`[SandboxResume] failed to resume sandbox for prompt spaceId=${input.spaceId}:`, error);
    });
  }

  const { content: expandedContent, promptTemplate } = await expandPromptContent(deps, {
    content: input.content,
    userId,
    spaceId: input.spaceId,
  });
  const content = normalizeContentBlocks(expandedContent);
  const accessMode = input.accessMode ?? "full_access";

  const isDirectShellCommand = content.length === 1 && content[0]?.type === "shell_command";
  if (accessMode === "read_only" && isDirectShellCommand) {
    throw new Error("shell_command is not allowed in read_only accessMode");
  }
  const inputIntent = isDirectShellCommand ? "shell_command" : "prompt";
  const turnIntent: SessionTurnIntent = isDirectShellCommand ? "steer" : (input.intent ?? "followup");
  const userMessageId = deps.randomUUID();
  const modelProvider = normalizePromptModelProvider(input);
  const baseMeta = {
    source: input.source,
    userId,
    clientMessageId,
    userMessageId,
    intent: inputIntent,
    dispatchIntent: turnIntent,
    llm: isDirectShellCommand ? false : undefined,
    model: modelProvider.model,
    provider: modelProvider.provider,
    promptTemplate,
    generationPolicy: input.generationPolicy ?? null,
    accessMode,
    context: input.context ?? null,
  };

  const turn = await deps.createSessionTurn({
    sessionId: input.sessionId,
    userUuid: userId,
    userContent: content,
    intent: turnIntent,
    meta: baseMeta,
  }).catch((error: unknown) => {
    throw new SubmitSessionPromptError("failed to create session turn", error);
  });

  const turnId = turn.id;
  const meta = {
    ...baseMeta,
    turnId,
  };

  try {
    await hooks.beforeEnqueue?.({ turnId, userMessageId, content, meta });
    await deps.enqueueSpacePrompt({
      spaceId: input.spaceId,
      sessionId: input.sessionId,
      turnId,
      userMessageId,
      content,
      meta,
    });
  } catch (error) {
    await deps.failSessionTurn({
      sessionId: input.sessionId,
      turnId,
      errorMessage: error instanceof Error ? error.message : String(error),
    }).catch(() => undefined);

    throw error;
  }

  return { turnId, userMessageId };
};
