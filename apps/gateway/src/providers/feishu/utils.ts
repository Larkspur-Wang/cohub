// Feishu ID prefix constants
const CHAT_PREFIX = "oc_";
const OPEN_ID_PREFIX = "ou_";

export function detectIdType(id: string): "chat_id" | "open_id" | "user_id" | null {
  if (id.startsWith(CHAT_PREFIX)) return "chat_id";
  if (id.startsWith(OPEN_ID_PREFIX)) return "open_id";
  if (/^[a-zA-Z0-9]+$/.test(id)) return "user_id";
  return null;
}

export function resolveReceiveIdType(id: string): "chat_id" | "open_id" | "user_id" {
  if (id.startsWith(CHAT_PREFIX)) return "chat_id";
  if (id.startsWith(OPEN_ID_PREFIX)) return "open_id";
  return "open_id";
}

export function buildFeishuBindingKey(chatId: string, threadId?: string | null): string {
  return threadId ? `feishu:conversation:${chatId}:${threadId}` : `feishu:conversation:${chatId}`;
}

// Replace <at user_id="ou_xxx">name</at> with @name
export function resolveAtMentions(content: string): string {
  return content.replace(/<at\s+user_id="([^"]+)">(.*?)<\/at>/g, "@$2");
}

// Split long text for post mode (Feishu post has ~15000 char limit per message)
export function splitFeishuMessage(value: string, limit = 1800): string[] {
  const text = value.trim();
  if (!text) return [];
  if (text.length <= limit) return [text];

  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > limit) {
    const candidate = remaining.slice(0, limit);
    const breakIndex = Math.max(
      candidate.lastIndexOf("\n\n"),
      candidate.lastIndexOf("\n"),
      candidate.lastIndexOf(" "),
    );
    const cut = breakIndex > Math.floor(limit * 0.5) ? breakIndex : limit;
    chunks.push(remaining.slice(0, cut).trim());
    remaining = remaining.slice(cut).trim();
  }

  if (remaining) chunks.push(remaining);
  return chunks.filter(Boolean);
}
