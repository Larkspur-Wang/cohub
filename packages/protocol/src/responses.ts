export type OpenAIResponseInputText = {
  type: "input_text";
  text: string;
};

export type OpenAIResponseInputMessage = {
  role: "user" | "system" | "assistant";
  content: string | OpenAIResponseInputText[];
};

export type OpenAIResponsesCreateRequest = {
  model?: string;
  input?: string | OpenAIResponseInputMessage[];
  stream?: boolean;
  instructions?: string | null;
  metadata?: Record<string, unknown> | null;
};

export type CohubSessionResponseRequest = {
  runtimeId: string;
  sessionId: string;
  model?: string | null;
  inputText: string;
  stream: boolean;
  metadata?: Record<string, unknown> | null;
};

export type GatewaySessionResponseRequestEvent = {
  interactionId: string;
  timestamp: number;
  runtimeId: string;
  sessionId: string;
  inputText: string;
  model?: string | null;
  metadata?: Record<string, unknown> | null;
  actor: {
    userId: string;
    source: "responses" | "web" | "discord" | "telegram" | "feishu" | "slack";
  };
};

export type GatewaySessionResponseResultEvent =
  | {
      type: "accepted";
      interactionId: string;
      timestamp: number;
      runtimeId: string;
      sessionId: string;
      userMessageId: string;
    }
  | {
      type: "started";
      interactionId: string;
      timestamp: number;
      runtimeId: string;
      sessionId: string;
      userMessageId: string;
    }
  | {
      type: "completed";
      interactionId: string;
      timestamp: number;
      runtimeId: string;
      sessionId: string;
      userMessageId: string;
    }
  | {
      type: "failed";
      interactionId: string;
      timestamp: number;
      runtimeId: string;
      sessionId: string;
      error: {
        message: string;
        type: string;
      };
    };

export type CohubSessionResponseEvent =
  | {
      type: "response.created";
      response: {
        id: string;
        object: "response";
        created_at: number;
        status: "in_progress";
        model: string;
      };
    }
  | {
      type: "response.output_text.content";
      item_id: string;
      output_index: 0;
      content_index: 0;
      content: string;
      timestamp: number;
    }
  | {
      type: "response.completed";
      response: {
        id: string;
        object: "response";
        created_at: number;
        status: "completed";
        model: string;
        output: Array<{
          id: string;
          type: "message";
          role: "assistant";
          content: Array<{
            type: "output_text";
            text: string;
            annotations: [];
          }>;
        }>;
      };
    }
  | {
      type: "response.failed";
      response: {
        id: string;
        object: "response";
        created_at: number;
        status: "failed";
        model: string;
        error: {
          message: string;
          type: string;
        };
      };
    };
