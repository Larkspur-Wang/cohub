export const WECHAT_DEFAULT_BASE_URL = "https://ilinkai.weixin.qq.com";
export const WECHAT_DEFAULT_CDN_BASE_URL = "https://novac2c.cdn.weixin.qq.com/c2c";
export const WECHAT_DEFAULT_BOT_AGENT = "Cohub/1.0";

export const WeChatMessageItemType = {
  TEXT: 1,
  IMAGE: 2,
  VOICE: 3,
  FILE: 4,
  VIDEO: 5,
} as const;

export const WeChatMessageType = {
  BOT: 2,
} as const;

export const WeChatMessageState = {
  FINISH: 2,
} as const;

export type WeChatCredentials = {
  token: string;
  accountId?: string;
  userId?: string;
  baseUrl?: string;
  cdnBaseUrl?: string;
};

export type WeChatTextItem = {
  text?: string;
};

export type WeChatVoiceItem = {
  text?: string;
};

export type WeChatRefMessage = {
  title?: string;
  message_item?: WeChatMessageItem;
};

export type WeChatMessageItem = {
  type?: number;
  text_item?: WeChatTextItem;
  voice_item?: WeChatVoiceItem;
  ref_msg?: WeChatRefMessage;
};

export type WeChatMessage = {
  seq?: number;
  message_id?: number;
  from_user_id?: string;
  to_user_id?: string;
  client_id?: string;
  create_time_ms?: number;
  update_time_ms?: number;
  session_id?: string;
  group_id?: string;
  item_list?: WeChatMessageItem[];
  context_token?: string;
};

export type WeChatGetUpdatesResponse = {
  ret?: number;
  errcode?: number;
  errmsg?: string;
  msgs?: WeChatMessage[];
  get_updates_buf?: string;
  longpolling_timeout_ms?: number;
};

export type WeChatSendMessageRequest = {
  msg: {
    from_user_id: string;
    to_user_id: string;
    client_id: string;
    message_type: number;
    message_state: number;
    item_list?: WeChatMessageItem[];
    context_token?: string;
  };
};
