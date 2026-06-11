import type { ContentBlock } from "@cohub/protocol/core";

export const deriveMessagePreviewText = (input: { content: ContentBlock[] }): string => {
  return input.content
    .flatMap((block) => {
      switch (block.type) {
        case "text":
          return [block.text];
        case "image":
          return block.source.type === "url" ? [block.source.url] : [];
        case "shell_command":
          return [["$", block.command].join("")];
        case "system_note":
          return [block.text];
        default:
          return [];
      }
    })
    .join("\n")
    .trim();
};

export const extractPlainText = (blocks: ContentBlock[]): string => {
  return blocks
    .flatMap((block) => {
      switch (block.type) {
        case "text":
          return [block.text];
        case "thinking":
          return [block.thinking];
        case "image":
          return block.source.type === "url" ? [block.source.url] : [];
        case "shell_command":
          return [["$", block.command].join("")];
        case "tool_use":
          return [`${block.name}(...)`];
        case "tool_result":
          return typeof block.content === "string" ? [block.content] : [];
        case "system_note":
          return [block.text];
        default:
          return [];
      }
    })
    .join("\n")
    .trim();
};

export const countToolCallsInContent = (blocks: ContentBlock[]) => blocks.filter((block) => block.type === "tool_use").length;
