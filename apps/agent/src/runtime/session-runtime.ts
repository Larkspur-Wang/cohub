import type { Agent, AgentEvent, AgentMessage, StreamFn } from "@mariozechner/pi-agent-core";
import { Agent as PiAgent } from "@mariozechner/pi-agent-core";
import { createAssistantMessageEventStream, streamSimple, type Api, type Context, type ImageContent, type Model, type SimpleStreamOptions } from "@mariozechner/pi-ai";
import { context } from "@opentelemetry/api";
import type { SessionManager } from "./local-session-manager.js";
import type { CohubModelRegistry } from "./model-registry.js";
import { buildCohubSystemPrompt } from "./system-prompt-builder.js";
import { recordLlmUsage, startLlmRoundSpan, getAgentTracer } from "@cohub/tracing/agent";
import { getCurrentToolExecutionContext, runWithToolExecutionContext } from "../tool-context.js";

export type CohubAgentSessionEvent = AgentEvent;

export type CohubAgentSession = {
  agent: Agent;
  modelRegistry: CohubModelRegistry;
  sessionManager: SessionManager;
  isStreaming: boolean;
  prompt(text: string, options?: { images?: ImageContent[] }): Promise<void>;
  steer(text: string, images?: ImageContent[]): Promise<void>;
  setModel(model: Model<Api>): Promise<void>;
  reload(): Promise<void>;
  abort(): Promise<void>;
  dispose(): void;
  subscribe(listener: (event: CohubAgentSessionEvent) => void): () => void;
};

type ToolLike = {
  name: string;
};

export type CreateCohubAgentSessionOptions = {
  cwd: string;
  userId?: string | null;
  sessionManager: SessionManager;
  modelRegistry: CohubModelRegistry;
  tools: ToolLike[];
  model?: Model<Api>;
};

function toLlmMessages(messages: AgentMessage[]) {
  return messages.filter((message) => {
    const role = (message as { role?: string }).role;
    return role === "user" || role === "assistant" || role === "toolResult";
  }) as never;
}

function createStreamFn(modelRegistry: CohubModelRegistry): StreamFn {
  const tracer = getAgentTracer();

  return async (model: Model<Api>, ctx: Context, options?: SimpleStreamOptions) => {
    const toolCtx = getCurrentToolExecutionContext();
    const round = (toolCtx?.llmRound ?? 0) + 1;
    if (toolCtx) {
      toolCtx.llmRound = round;
    }
    const metrics = toolCtx?.metrics;
    if (metrics) {
      metrics.llmRoundCount = Math.max(metrics.llmRoundCount, round);
    }

    const llmRound = startLlmRoundSpan(tracer, {
      provider: model.provider,
      model: model.id,
      messageCount: ctx.messages.length,
      spaceId: toolCtx?.spaceId,
      sessionId: toolCtx?.sessionId,
      turnId: toolCtx?.turnId,
      turnSeq: toolCtx?.turnSeq,
      llmRound: round,
    });

    return context.with(llmRound.context, async () => {
      try {
        const headers = modelRegistry.getHeaders(model.provider, model.id);
        const stream = await streamSimple(model, ctx, {
          ...options,
          headers: headers ? { ...headers, ...(options?.headers ?? {}) } : options?.headers,
        });

        const wrapped = createAssistantMessageEventStream();
        void context.with(llmRound.context, async () => {
          try {
            for await (const event of stream) {
              if (event.type !== "start") {
                llmRound.markFirstToken();
              }

              wrapped.push(event);

              if (event.type === "done") {
                recordLlmUsage(llmRound.span, {
                  inputTokens: event.message.usage?.input,
                  outputTokens: event.message.usage?.output,
                  totalTokens: event.message.usage?.totalTokens,
                  cacheReadTokens: event.message.usage?.cacheRead,
                  cacheWriteTokens: event.message.usage?.cacheWrite,
                  cost: event.message.usage?.cost?.total,
                });
                llmRound.finish({ finishReason: event.reason, outcome: "ok" });
              } else if (event.type === "error") {
                recordLlmUsage(llmRound.span, {
                  inputTokens: event.error.usage?.input,
                  outputTokens: event.error.usage?.output,
                  totalTokens: event.error.usage?.totalTokens,
                  cacheReadTokens: event.error.usage?.cacheRead,
                  cacheWriteTokens: event.error.usage?.cacheWrite,
                  cost: event.error.usage?.cost?.total,
                });
                llmRound.finish({ finishReason: event.reason, outcome: event.reason === "aborted" ? "aborted" : "error" });
              }
            }
          } catch (error) {
            llmRound.fail(error);
            wrapped.end();
          } finally {
            if (toolCtx) {
              toolCtx.llmRound = round - 1;
            }
          }
        });

        return wrapped;
      } catch (error) {
        llmRound.fail(error);
        throw error;
      }
    });
  };
}

function createUserMessage(text: string, images?: ImageContent[]): AgentMessage {
  return {
    role: "user",
    content: [{ type: "text", text }, ...(images ?? [])],
    timestamp: Date.now(),
  } as AgentMessage;
}

function toolSnippets(toolName: string): string | undefined {
  switch (toolName) {
    case "read": return "Read file contents";
    case "bash": return "Execute bash commands";
    case "edit": return "Make precise file edits with exact text replacement";
    case "write": return "Create or overwrite files";
    case "grep": return "Search file contents";
    case "find": return "Search files by glob pattern";
    case "ls": return "List directory contents";
    default: return undefined;
  }
}

export async function createCohubAgentSession(options: CreateCohubAgentSessionOptions): Promise<{ session: CohubAgentSession }> {
  const sessionContext = options.sessionManager.buildSessionContext();
  const model = options.model ?? (sessionContext.model ? options.modelRegistry.find(sessionContext.model.provider, sessionContext.model.modelId) : undefined) ?? options.modelRegistry.getDefault();
  if (!model) {
    throw new Error("No model available. Check platform models.json");
  }

  if (sessionContext.messages.length === 0) {
    options.sessionManager.appendModelChange(model.provider, model.id);
    options.sessionManager.appendThinkingLevelChange(model.reasoning ? "medium" : "off");
  }

  const systemPrompt = buildCohubSystemPrompt({
    cwd: options.cwd,
    userId: options.userId,
    selectedTools: options.tools.map((tool) => tool.name),
    toolSnippets: Object.fromEntries(options.tools.map((tool) => [tool.name, toolSnippets(tool.name)]).filter((entry): entry is [string, string] => Boolean(entry[1]))),
  });

  const agent = new PiAgent({
    initialState: {
      systemPrompt,
      model,
      thinkingLevel: model.reasoning ? "medium" : "off",
      tools: options.tools as never,
      messages: sessionContext.messages,
    },
    convertToLlm: toLlmMessages,
    streamFn: createStreamFn(options.modelRegistry),
    getApiKey: (provider: string) => options.modelRegistry.getApiKey(provider),
  });

  const unsubscribe = agent.subscribe((event: AgentEvent) => {
    if (event.type === "message_end") {
      const message = event.message as { role?: string };
      if (message.role === "user" || message.role === "assistant" || message.role === "toolResult") {
        options.sessionManager.appendMessage(event.message as never);
      }
    }
  });

  const session: CohubAgentSession = {
    agent,
    modelRegistry: options.modelRegistry,
    sessionManager: options.sessionManager,
    get isStreaming() {
      return agent.state.isStreaming;
    },
    async prompt(text, inputOptions) {
      await agent.prompt(text, inputOptions?.images);
      await agent.waitForIdle();
    },
    async steer(text, images) {
      agent.steer(createUserMessage(text, images));
      await agent.waitForIdle();
    },
    async setModel(nextModel) {
      agent.state.model = nextModel;
      options.sessionManager.appendModelChange(nextModel.provider, nextModel.id);
    },
    async reload() {
      const nextPrompt = buildCohubSystemPrompt({
        cwd: options.cwd,
        userId: options.userId,
        selectedTools: options.tools.map((tool) => tool.name),
        toolSnippets: Object.fromEntries(options.tools.map((tool) => [tool.name, toolSnippets(tool.name)]).filter((entry): entry is [string, string] => Boolean(entry[1]))),
      });
      agent.state.systemPrompt = nextPrompt;
      agent.state.tools = options.tools as never;
    },
    async abort() {
      agent.abort();
      await agent.waitForIdle();
    },
    dispose() {
      unsubscribe();
      agent.abort();
    },
    subscribe(listener) {
      return agent.subscribe((event: AgentEvent) => {
        listener(event);
      });
    },
  };

  return { session };
}
