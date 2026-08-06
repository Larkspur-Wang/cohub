export type QQCredentials = {
  appId: string;
  clientSecret: string;
  baseUrl?: string;
  tokenBaseUrl?: string;
};

export type QQMessageAttachment = {
  content_type?: string;
  filename?: string;
  size?: number;
  url?: string;
  height?: number;
  width?: number;
};

export type QQMsgElement = {
  msg_idx?: string;
  message_type?: number;
  content?: string;
  attachments?: QQMessageAttachment[];
  msg_elements?: QQMsgElement[];
};

export type QQC2CMessageEvent = {
  id: string;
  content?: string;
  timestamp?: string;
  author?: {
    id?: string;
    union_openid?: string;
    user_openid?: string;
    bot?: boolean;
  };
  attachments?: QQMessageAttachment[];
  message_type?: number;
  msg_elements?: QQMsgElement[];
  message_scene?: { ext?: string[] };
};

export type QQGroupMessageEvent = {
  id: string;
  content?: string;
  timestamp?: string;
  group_id?: string;
  group_openid?: string;
  author?: {
    id?: string;
    member_openid?: string;
    username?: string;
    bot?: boolean;
  };
  mentions?: Array<{
    id?: string;
    user_openid?: string;
    member_openid?: string;
    nickname?: string;
    bot?: boolean;
    is_you?: boolean;
  }>;
  attachments?: QQMessageAttachment[];
  message_type?: number;
  msg_elements?: QQMsgElement[];
  message_scene?: { ext?: string[] };
};

export type QQGuildMessageEvent = {
  id: string;
  channel_id: string;
  guild_id: string;
  content?: string;
  timestamp?: string;
  author?: {
    id?: string;
    username?: string;
    bot?: boolean;
  };
  member?: {
    nick?: string;
  };
  attachments?: QQMessageAttachment[];
  msg_elements?: QQMsgElement[];
  message_scene?: { ext?: string[] };
};

export type QQDispatchEvent = {
  eventType: string;
  data: unknown;
  seq?: number;
  raw: QQWSPayload;
};

export type QQWSPayload = {
  op: number;
  d?: unknown;
  s?: number;
  t?: string;
};

export type QQMessageResponse = {
  id: string;
  timestamp?: number | string;
  ext_info?: {
    ref_idx?: string;
  };
};
