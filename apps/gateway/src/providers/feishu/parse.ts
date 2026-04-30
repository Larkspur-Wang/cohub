import { resolveAtMentions } from "./utils.js";

export type FeishuInboundResource = {
  type: "image";
  fileKey: string;
};

export type FeishuParsedMessageBlock =
  | { type: "text"; text: string }
  | { type: "resource"; resource: FeishuInboundResource; fallbackText: string };

export type FeishuParsedMessageContent = {
  blocks: FeishuParsedMessageBlock[];
  resources: FeishuInboundResource[];
};

type FeishuPostBody = {
  content?: unknown;
};

type FeishuPostItem = Record<string, unknown>;

const FEISHU_IMAGE_REFERENCE_RE = /\[image:\s*(img_v3_[a-zA-Z0-9_-]+)\]|!\[[^\]]*\]\((img_v3_[a-zA-Z0-9_-]+)\)/g;

function readJsonObject(value: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

function appendResource(
  output: FeishuParsedMessageContent,
  resource: FeishuInboundResource,
  fallbackText = `![image](${resource.fileKey})`,
) {
  output.resources.push(resource);
  output.blocks.push({ type: "resource", resource, fallbackText });
}

function appendTextWithImageReferences(output: FeishuParsedMessageContent, text: string) {
  let lastIndex = 0;
  let matched = false;

  for (const match of text.matchAll(FEISHU_IMAGE_REFERENCE_RE)) {
    matched = true;
    const index = match.index ?? 0;
    if (index > lastIndex) {
      const before = text.slice(lastIndex, index);
      if (before.trim()) output.blocks.push({ type: "text", text: before });
    }

    const imageKey = match[1] ?? match[2];
    if (imageKey) appendResource(output, { type: "image", fileKey: imageKey });
    lastIndex = index + match[0].length;
  }

  if (!matched) {
    if (text.trim()) output.blocks.push({ type: "text", text });
    return;
  }

  const rest = text.slice(lastIndex);
  if (rest.trim()) output.blocks.push({ type: "text", text: rest });
}

function resolvePostBody(parsed: Record<string, unknown>): FeishuPostBody | null {
  if (Array.isArray(parsed.content)) return parsed as FeishuPostBody;

  const preferred = [parsed.zh_cn, parsed.en_us];
  for (const candidate of preferred) {
    if (candidate && typeof candidate === "object" && Array.isArray((candidate as FeishuPostBody).content)) {
      return candidate as FeishuPostBody;
    }
  }

  for (const candidate of Object.values(parsed)) {
    if (candidate && typeof candidate === "object" && Array.isArray((candidate as FeishuPostBody).content)) {
      return candidate as FeishuPostBody;
    }
  }

  return null;
}

function itemText(item: FeishuPostItem, key: string) {
  const value = item[key];
  return typeof value === "string" ? value : "";
}

function parsePostContent(content: string, output: FeishuParsedMessageContent) {
  const parsed = readJsonObject(content);
  if (!parsed) {
    appendTextWithImageReferences(output, content);
    return;
  }

  const body = resolvePostBody(parsed);
  if (!body || !Array.isArray(body.content)) {
    appendTextWithImageReferences(output, content);
    return;
  }

  const textParts: string[] = [];
  const flushText = () => {
    const joined = resolveAtMentions(textParts.join(""));
    if (joined.trim()) appendTextWithImageReferences(output, joined);
    textParts.length = 0;
  };

  for (let rowIndex = 0; rowIndex < body.content.length; rowIndex += 1) {
    const row = body.content[rowIndex];
    if (!Array.isArray(row)) continue;
    if (rowIndex > 0) textParts.push("\n");

    for (const rawItem of row) {
      if (!rawItem || typeof rawItem !== "object") continue;
      const item = rawItem as FeishuPostItem;
      const tag = itemText(item, "tag");

      if (tag === "text" || tag === "md") {
        textParts.push(itemText(item, "text"));
      } else if (tag === "at") {
        const name = itemText(item, "user_name") || itemText(item, "text");
        if (name) textParts.push(`@${name}`);
      } else if (tag === "a") {
        const href = itemText(item, "href");
        const text = itemText(item, "text") || href || "link";
        textParts.push(href ? `[${text}](${href})` : text);
      } else if (tag === "img" || tag === "image") {
        flushText();
        const imageKey = itemText(item, "image_key") || itemText(item, "file_key");
        if (imageKey) appendResource(output, { type: "image", fileKey: imageKey });
      } else if (tag === "media") {
        textParts.push(`[media:${itemText(item, "file_key") || "unknown"}]`);
      } else if (tag === "file") {
        textParts.push(`[file:${itemText(item, "file_key") || "unknown"}]`);
      }
    }
  }

  flushText();
}

export function parseFeishuMessageContent(msg: {
  message_type: string;
  content: string;
}): FeishuParsedMessageContent {
  const output: FeishuParsedMessageContent = { blocks: [], resources: [] };

  if (msg.message_type === "text") {
    const parsed = readJsonObject(msg.content);
    const text = resolveAtMentions(typeof parsed?.text === "string" ? parsed.text : msg.content);
    appendTextWithImageReferences(output, text);
  } else if (msg.message_type === "post") {
    parsePostContent(msg.content, output);
  } else if (msg.message_type === "image") {
    const parsed = readJsonObject(msg.content);
    const imageKey = typeof parsed?.image_key === "string" ? parsed.image_key : "";
    if (imageKey) appendResource(output, { type: "image", fileKey: imageKey });
    else output.blocks.push({ type: "text", text: "[image]" });
  } else if (msg.message_type === "file") {
    const parsed = readJsonObject(msg.content);
    const fileName = typeof parsed?.file_name === "string" ? parsed.file_name : null;
    const fileKey = typeof parsed?.file_key === "string" ? parsed.file_key : null;
    output.blocks.push({ type: "text", text: `[file: ${fileName ?? fileKey ?? "unknown"}]` });
  } else {
    output.blocks.push({ type: "text", text: `[${msg.message_type} message]` });
  }

  return output;
}
