import type { ContentBlock } from "@neta-art/cohub-protocol/core";
import type {
  DiscordChannelConfig,
  FeishuChannelConfig,
  GatewaySessionOutput,
} from "@neta-art/cohub-protocol/gateway";
import type { GatewayDeliveryPlan, PlannedGatewayOutboundCommand } from "@cohub/gateway-contract";

export const splitPlannedMessage = (value: string, limit = 1900) => {
  const text = value.trim();
  if (!text) return [] as string[];
  if (text.length <= limit) return [text];

  const chunks: string[] = [];
  let remaining = text;
  while (remaining.length > limit) {
    const candidate = remaining.slice(0, limit);
    const breakIndex = Math.max(candidate.lastIndexOf("\n\n"), candidate.lastIndexOf("\n"), candidate.lastIndexOf(" "));
    const cut = breakIndex > Math.floor(limit * 0.5) ? breakIndex : limit;
    chunks.push(remaining.slice(0, cut).trim());
    remaining = remaining.slice(cut).trim();
  }
  if (remaining) chunks.push(remaining);
  return chunks.filter(Boolean);
};

const truncate = (value: string, limit = 120) =>
  value.length > limit ? `${value.slice(0, limit - 1)}…` : value;

const summarizeThinkingForMinimal = (thinking: string) => {
  const trimmed = thinking.trim();
  if (!trimmed) return "";
  const firstLine = trimmed.split(/\n+/).map((line) => line.trim()).find(Boolean) ?? "";
  return truncate(firstLine, 100);
};

const buildToolLine = (status: string | undefined, toolName: string | undefined, summary: string | undefined) => {
  const safeStatus = status ?? "queued";
  const safeToolName = toolName ?? "tool";
  const suffix = summary?.trim() ? ` ${summary.trim()}` : "";
  return `[${safeStatus}] ${safeToolName}${suffix}`;
};

const buildRenderText = (content: ContentBlock[], includeThinking = false, isFinalMessage = false) => {
  const textParts: string[] = [];
  const imageUris: string[] = [];

  for (const block of content) {
    if (block.type === "text") {
      textParts.push(block.text);
      continue;
    }
    if (block.type === "thinking") {
      if (includeThinking && !isFinalMessage) {
        const summary = summarizeThinkingForMinimal(block.thinking);
        if (summary) textParts.push(`> ${summary}`);
      }
      continue;
    }
    if (block.type === "tool_use") {
      if (isFinalMessage) continue;
      const inputSummary = block.input && typeof block.input === "object"
        ? Object.values(block.input as Record<string, unknown>).filter((v) => typeof v === "string").join(" ").slice(0, 80)
        : "";
      textParts.push(`[done] ${block.name}${inputSummary ? ` ${inputSummary}` : ""}`);
      continue;
    }
    if (block.type === "image" && block.source.type === "url") {
      imageUris.push(block.source.url);
      continue;
    }
    if (block.type === "system_note") {
      textParts.push(`ℹ️ ${block.text}`);
    }
  }

  return {
    text: textParts.join("\n").trim(),
    imageUris,
  };
};

const getSessionOutput = (cmd: PlannedGatewayOutboundCommand): GatewaySessionOutput | null => {
  const output = cmd.meta?.sessionOutput;
  if (!output || typeof output !== "object") return null;
  return output as GatewaySessionOutput;
};

export const buildDiscordDeliveryPlan = async (
  cmd: PlannedGatewayOutboundCommand,
  config: DiscordChannelConfig | null | undefined,
): Promise<Extract<GatewayDeliveryPlan, { adapter: "discord" }>> => {
  const output = getSessionOutput(cmd);
  const outbound = config?.outbound ?? {};
  const showThinking = outbound.showThinking === true;
  const showToolCalls = outbound.showToolCalls === true;
  const isFinalMessage = output?.type === "session.turn.final" || output?.type === "session.message.persisted";
  const renderMode = String(cmd.meta?.renderMode ?? (output?.type === "session.turn.progress" ? "rich_status" : "message"));

  if (output?.type === "session.turn.error") {
    return {
      adapter: "discord",
      mode: "upsert",
      primaryText: output.error.trim(),
      continuationChunks: [],
      files: [],
      turnAnchorMessageId: output.anchorUserMessageId,
      preferredEditExternalMessageId: typeof cmd.meta?.editExternalMessageId === "string" ? cmd.meta.editExternalMessageId : null,
    };
  }

  let rendered = buildRenderText(cmd.content, !isFinalMessage, isFinalMessage);
  if (renderMode === "rich_status") {
    const thinking = !isFinalMessage && showThinking && typeof cmd.meta?.thinking === "string" ? cmd.meta.thinking : "";
    const answer = typeof cmd.meta?.answer === "string" ? cmd.meta.answer : rendered.text;
    const toolCalls = showToolCalls && Array.isArray(cmd.meta?.toolCalls)
      ? (cmd.meta.toolCalls as Array<Record<string, unknown>>)
      : [];
    const lines: string[] = [];
    if (thinking.trim()) lines.push(`> ${thinking.trim()}`);
    if (toolCalls.length > 0) {
      lines.push(toolCalls.map((tool) => buildToolLine(
        typeof tool.status === "string" ? tool.status : undefined,
        typeof tool.toolName === "string" ? tool.toolName : undefined,
        typeof tool.summary === "string" ? tool.summary : undefined,
      )).join("\n"));
    }
    if (answer.trim()) lines.push(answer.trim());
    if (!isFinalMessage) lines.push("🍳 cooking…");
    rendered = { text: lines.join("\n\n").trim(), imageUris: [] };
  }

  const chunks = isFinalMessage ? splitPlannedMessage(rendered.text, 1900) : [rendered.text.slice(0, 1900)].filter(Boolean);
  return {
    adapter: "discord",
    mode: renderMode === "rich_status" || isFinalMessage ? "upsert" : "send",
    primaryText: chunks[0] ?? "",
    continuationChunks: chunks.slice(1),
    files: rendered.imageUris,
    replyToExternalMessageId: cmd.replyToExternalMessageId,
    turnAnchorMessageId:
      (output?.type === "session.turn.progress" || output?.type === "session.turn.final")
        ? output.anchorUserMessageId
        : (typeof cmd.meta?.turnAnchorMessageId === "string" ? cmd.meta.turnAnchorMessageId : null),
    preferredEditExternalMessageId: typeof cmd.meta?.editExternalMessageId === "string" ? cmd.meta.editExternalMessageId : null,
  };
};

const extractFeishuText = (content: ContentBlock[]) =>
  content.filter((b): b is Extract<ContentBlock, { type: "text" }> => b.type === "text").map((b) => b.text).join("\n");

const extractFeishuImageKeys = (content: ContentBlock[]) => {
  const keys: string[] = [];
  for (const block of content) {
    if (block.type === "image" && block.source.type === "url") {
      const match = block.source.url.match(/img_v3_([a-zA-Z0-9_-]+)/);
      if (match) keys.push(match[0]);
    } else if (block.type === "text") {
      const imgPattern = /\[image:(img_v3_[a-zA-Z0-9_-]+)\]/g;
      const matches = block.text.match(imgPattern);
      if (matches) {
        for (const matched of matches) {
          const clean = matched.slice(7, -1);
          if (clean) keys.push(clean);
        }
      }
    }
  }
  return Array.from(new Set(keys));
};

export const buildFeishuDeliveryPlan = async (
  cmd: PlannedGatewayOutboundCommand,
  config: FeishuChannelConfig | null | undefined,
): Promise<Extract<GatewayDeliveryPlan, { adapter: "feishu" }>> => {
  const output = getSessionOutput(cmd);
  const isFinal = output?.type === "session.turn.final" || output?.type === "session.message.persisted";
  const renderMode = (cmd.meta?.renderMode ?? config?.outbound?.renderMode ?? "post") as "card" | "post";
  const showThinking = config?.outbound?.showThinking ?? false;
  const showToolCalls = config?.outbound?.showToolCalls ?? false;
  const thinking = !isFinal && showThinking && typeof cmd.meta?.thinking === "string" ? cmd.meta.thinking : "";
  const toolCalls = showToolCalls && !isFinal && Array.isArray(cmd.meta?.toolCalls)
    ? (cmd.meta.toolCalls as Array<Record<string, unknown>>)
    : [];
  const answer = typeof cmd.meta?.answer === "string" ? cmd.meta.answer : extractFeishuText(cmd.content);

  const lines: string[] = [];
  if (output?.type === "session.turn.error") {
    lines.push(output.error.trim());
  } else {
    if (thinking.trim()) lines.push(`> ${thinking.trim()}`);
    if (toolCalls.length > 0) {
      lines.push(toolCalls.map((tool) => buildToolLine(
        typeof tool.status === "string" ? tool.status : undefined,
        typeof tool.toolName === "string" ? tool.toolName : undefined,
        typeof tool.summary === "string" ? tool.summary : undefined,
      )).join("\n"));
    }
    if (answer.trim()) lines.push(answer.trim());
    if (!isFinal) lines.push("🍳 cooking…");
  }

  if (renderMode === "card") {
    return {
      adapter: "feishu",
      mode: "create_or_update",
      renderMode,
      msgType: "interactive",
      content: JSON.stringify({
        schema: "2.0",
        config: { wide_screen_mode: true, update_multi: true },
        body: {
          elements: lines.filter(Boolean).map((line) => ({ tag: "markdown", content: line })),
        },
      }),
      imageKeys: extractFeishuImageKeys(cmd.content),
      replyToExternalMessageId: cmd.replyToExternalMessageId,
      turnAnchorMessageId:
        (output?.type === "session.turn.progress" || output?.type === "session.turn.final")
          ? output.anchorUserMessageId
          : (typeof cmd.meta?.turnAnchorMessageId === "string" ? cmd.meta.turnAnchorMessageId : null),
      preferredEditExternalMessageId: typeof cmd.meta?.editExternalMessageId === "string" ? cmd.meta.editExternalMessageId : null,
    };
  }

  return {
    adapter: "feishu",
    mode: "create_or_update",
    renderMode,
    msgType: "post",
    content: JSON.stringify({
      zh_cn: {
        content: [[{ tag: "md", text: lines.join("\n").trim() }]],
      },
    }),
    imageKeys: extractFeishuImageKeys(cmd.content),
    replyToExternalMessageId: cmd.replyToExternalMessageId,
    turnAnchorMessageId:
      (output?.type === "session.turn.progress" || output?.type === "session.turn.final")
        ? output.anchorUserMessageId
        : (typeof cmd.meta?.turnAnchorMessageId === "string" ? cmd.meta.turnAnchorMessageId : null),
    preferredEditExternalMessageId: typeof cmd.meta?.editExternalMessageId === "string" ? cmd.meta.editExternalMessageId : null,
  };
};
