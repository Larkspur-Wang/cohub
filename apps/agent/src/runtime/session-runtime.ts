import type { Agent, AgentEvent, AgentMessage, StreamFn } from "@mariozechner/pi-agent-core";
import { Agent as PiAgent } from "@mariozechner/pi-agent-core";
import { streamSimple, type Api, type Context, type ImageContent, type Model, type SimpleStreamOptions } from "@mariozechner/pi-ai";
import type { SessionManager } from "./local-session-manager.js";
import type { CohubModelRegistry } from "./model-registry.js";
import { buildCohubSystemPrompt } from "./system-prompt-builder.js";
import { wrapLlmCompletion, recordLlmUsage, getAgentTracer } from "@cohub/tracing/agent";

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
  let llmTurnCounter = 0;

  return async (model: Model<Api>, ctx: Context, options?: SimpleStreamOptions) => {
    llmTurnCounter += 1;
    const turn = llmTurnCounter;

    return wrapLlmCompletion(tracer, {
      provider: model.provider,
      model: model.id,
      turn,
      messageCount: ctx.messages.length,
    }, async (span) => {
      const headers = modelRegistry.getHeaders(model.provider, model.id);
      const stream = await streamSimple(model, ctx, {
        ...options,
        headers: headers ? { ...headers, ...(options?.headers ?? {}) } : options?.headers,
      });

      // Wrap the stream to capture usage information when it completes
      const originalOnUsage = (stream as unknown as { onUsage?: (u: Record<string, unknown>) => void }).onUsage;
      (stream as unknown as { onUsage?: (u: Record<string, unknown>) => void }).onUsage = (usage: Record<string, unknown>) => {
        try {
          recordLlmUsage(span, {
            inputTokens: usage.inputTokens as number | undefined,
            outputTokens: usage.outputTokens as number | undefined,
            totalTokens: usage.totalTokens as number | undefined,
            cacheReadTokens: usage.cacheReadTokens as number | undefined,
            cacheWriteTokens: usage.cacheWriteTokens as number | undefined,
          });
        } catch {
          // Ignore recording errors to avoid breaking the stream
        }
        try {
          originalOnUsage?.(usage);
        } catch {
          // Ignore original callback errors
        }
      };

      return stream;
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
