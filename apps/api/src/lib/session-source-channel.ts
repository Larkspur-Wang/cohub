export const buildSessionSourceChannel = (event: {
  provider: string;
  externalChatId: string;
  conversation?: { id: string; meta?: Record<string, unknown> | null };
  sender: { id: string; name?: string };
  meta?: Record<string, unknown> | null;
}) => {
  const provider = event.provider;
  const meta = (event.conversation?.meta ?? event.meta ?? {}) as Record<string, unknown>;

  switch (provider) {
    case "discord":
      return buildDiscordSourceChannel(event, meta);
    case "feishu":
      return buildFeishuSourceChannel(event, meta);
    case "web":
      return "web";
    default:
      return `${provider}:${event.conversation?.id?.trim() || event.externalChatId}`;
  }
};

const buildDiscordSourceChannel = (
  event: {
    externalChatId: string;
    conversation?: { id: string };
    sender: { id: string; name?: string };
  },
  meta: Record<string, unknown>,
) => {
  const isDm = meta.isDm === true;
  const guildName = typeof meta.guildName === "string" ? meta.guildName : null;
  const channelName = typeof meta.channelName === "string" ? meta.channelName : null;
  const parentChannelName = typeof meta.parentChannelName === "string" ? meta.parentChannelName : null;
  const threadName = typeof meta.threadName === "string" ? meta.threadName : null;
  const senderName = event.sender?.name ?? null;

  if (isDm) {
    return `discord:dm:${senderName ?? event.sender.id}`;
  }
  if (threadName && parentChannelName && guildName) {
    return `discord:${guildName}:#${parentChannelName}>${threadName}`;
  }
  if (channelName && guildName) {
    return `discord:${guildName}:#${channelName}`;
  }
  if (guildName) {
    return `discord:${guildName}`;
  }
  return `discord:${event.conversation?.id?.trim() || event.externalChatId}`;
};

const buildFeishuSourceChannel = (
  event: {
    externalChatId: string;
    conversation?: { id: string };
    sender: { id: string; name?: string };
  },
  meta: Record<string, unknown>,
) => {
  const chatType = typeof meta.chatType === "string" ? meta.chatType : undefined;
  const chatName = typeof meta.chatName === "string" ? meta.chatName : null;
  const senderName = event.sender?.name ?? null;
  const isDm = chatType === "p2p";

  if (isDm) {
    return `feishu:dm:${senderName ?? event.sender.id}`;
  }
  if (chatName) {
    return `feishu:group:${chatName}`;
  }
  return `feishu:${event.conversation?.id?.trim() || event.externalChatId}`;
};
