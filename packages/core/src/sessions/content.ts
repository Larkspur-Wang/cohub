import type { ContentBlock } from "@cohub/protocol/core";

const imagePreviewLabel = (count: number) => (count === 1 ? "Image" : `${count} images`);

export const deriveMessagePreviewText = (input: { content: ContentBlock[] }): string => {
  const parts: string[] = [];
  let imageCount = 0;

  for (const block of input.content) {
    switch (block.type) {
      case "text": {
        const text = block.text.trim();
        if (text) parts.push(text);
        break;
      }
      case "image":
        imageCount += 1;
        break;
      case "shell_command":
        parts.push(["$", block.command].join(""));
        break;
      case "system_note": {
        const text = block.text.trim();
        if (text) parts.push(text);
        break;
      }
      default:
        break;
    }
  }

  if (imageCount > 0) parts.push(imagePreviewLabel(imageCount));
  return parts.join(" · ").replace(/\s+/g, " ").trim();
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
