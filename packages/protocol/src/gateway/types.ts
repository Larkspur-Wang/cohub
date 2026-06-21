export type DiscordChannelConfig = {
  inbound?: {
    requireMentionInGuild?: boolean;
  };
  outbound?: {
    showThinking?: boolean;
    showToolCalls?: boolean;
  };
};

export type FeishuChannelConfig = {
  brand?: "feishu" | "lark";
  inbound?: {
    requireMentionInGroup?: boolean;
  };
  outbound?: {
    renderMode?: "card" | "post";
    showThinking?: boolean;
    showToolCalls?: boolean;
  };
};

export type WeChatChannelConfig = {
  outbound?: {
    showIntermediateStatus?: boolean;
  };
};

export type ChannelConfig = DiscordChannelConfig | FeishuChannelConfig | WeChatChannelConfig | Record<string, unknown>;
