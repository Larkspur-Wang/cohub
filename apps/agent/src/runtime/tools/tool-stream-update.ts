import type { AgentToolUpdateCallback } from "@earendil-works/pi-agent-core";

export function tailText(content: string, maxChars = 900) {
  if (content.length <= maxChars) return content;
  return `…${content.slice(-maxChars)}`;
}

export function createThrottledTextToolUpdate(
  onUpdate?: AgentToolUpdateCallback<unknown>,
  options: { intervalMs?: number; maxChars?: number } = {},
) {
  const intervalMs = options.intervalMs ?? 250;
  const maxChars = options.maxChars ?? 900;
  let lastSentAt = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let pendingText = "";
  let lastSentText = "";

  const emit = () => {
    if (!onUpdate || !pendingText || pendingText === lastSentText) return;
    lastSentAt = Date.now();
    lastSentText = pendingText;
    onUpdate({
      content: [{ type: "text", text: tailText(pendingText, maxChars) }],
      details: { partial: true },
    });
  };

  return {
    push(text: string) {
      pendingText = text;
      if (!onUpdate) return;
      const elapsed = Date.now() - lastSentAt;
      if (elapsed >= intervalMs) {
        if (timer) {
          clearTimeout(timer);
          timer = null;
        }
        emit();
        return;
      }
      if (!timer) {
        timer = setTimeout(() => {
          timer = null;
          emit();
        }, intervalMs - elapsed);
      }
    },
    flush() {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      emit();
    },
  };
}
