export type SessionEventPayload = Record<string, unknown>;

export type ChatMessage = {
  id: string;
  role: "system" | "user" | "assistant" | "error";
  title?: string;
  text: string;
  tone?: "default" | "thinking";
};

export type ToolState = {
  id: string;
  name: string;
  args?: Record<string, unknown>;
  status: "running" | "done" | "error";
  output: string;
};

export type TimelineItem =
  | {
      id: string;
      kind: "message";
      message: ChatMessage;
    }
  | {
      id: string;
      kind: "tool";
      tool: ToolState;
    };

export const stringifyUnknown = (value: unknown) => {
  if (typeof value === "string") {
    return value;
  }

  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
};

export const extractTextContent = (value: unknown): string => {
  if (!value || typeof value !== "object") {
    return "";
  }

  const content = (
    value as { content?: Array<{ type?: string; text?: string }> }
  ).content;
  if (!Array.isArray(content)) {
    return "";
  }

  return content
    .filter((item) => item?.type === "text" && typeof item.text === "string")
    .map((item) => item.text)
    .join("\n");
};

export const renderToolPreview = (
  name: string,
  args?: Record<string, unknown>,
) => {
  if (name === "bash" && typeof args?.command === "string") {
    return `$ ${args.command}`;
  }

  if (name === "read" && typeof args?.path === "string") {
    return `read ${args.path}`;
  }

  if (name === "find" && typeof args?.pattern === "string") {
    return `find ${args.pattern}`;
  }

  if (name === "grep" && typeof args?.pattern === "string") {
    return `grep ${args.pattern}`;
  }

  if (name === "write" && typeof args?.path === "string") {
    return `write ${args.path}`;
  }

  if (name === "edit" && typeof args?.path === "string") {
    return `edit ${args.path}`;
  }

  return stringifyUnknown(args ?? {});
};
