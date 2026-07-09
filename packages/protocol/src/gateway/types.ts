export type ChannelModelConfig = {
  provider: string;
  id: string;
};

export type BaseChannelConfig = {
  model?: ChannelModelConfig | null;
};

export type DiscordChannelConfig = BaseChannelConfig & {
  inbound?: {
    requireMentionInGuild?: boolean;
  };
  outbound?: {
    showThinking?: boolean;
    showToolCalls?: boolean;
  };
};

export type FeishuChannelConfig = BaseChannelConfig & {
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

export type WeChatChannelConfig = BaseChannelConfig & {
  outbound?: {
    showIntermediateStatus?: boolean;
  };
};

export type QQChannelConfig = BaseChannelConfig & {
  inbound?: {
    requireMentionInGroup?: boolean;
  };
  outbound?: {
    markdownSupport?: boolean;
  };
};

export type ChannelConfig = DiscordChannelConfig | FeishuChannelConfig | WeChatChannelConfig | QQChannelConfig | (BaseChannelConfig & Record<string, unknown>);
