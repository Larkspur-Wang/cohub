export const buildSessionSourceChannel = (event: {
  provider: string;
  externalChatId: string;
  conversation?: { id: string; meta?: Record<string, unknown> | null };
  sender: { id: string; name?: string };
  meta?: Record<string, unknown> | null;
}) => {
  const meta = { ...((event.conversation?.meta ?? {}) as Record<string, unknown>), ...((event.meta ?? {}) as Record<string, unknown>) };
  const sourceChannel = typeof meta.sourceChannel === "string" ? meta.sourceChannel.trim() : "";
  if (sourceChannel) return sourceChannel;

  return `${event.provider}:${event.conversation?.id?.trim() || event.externalChatId}`;
};
