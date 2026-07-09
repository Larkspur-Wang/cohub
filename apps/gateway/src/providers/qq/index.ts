import { createLogger } from "@cohub/infra/logging";
import { randomUUID } from "node:crypto";
import type { ContentBlock } from "@cohub/protocol/core";
import type { GatewayInboundEvent, QQChannelConfig } from "@cohub/protocol/gateway";
import type { PlannedGatewayOutboundCommand, QQMediaKind } from "@cohub/protocol/gateway";
import type { GatewayProvider } from "../base.js";
import { resolveChannelCommand } from "../../channel-commands.js";
import { publishInboundEvent } from "../../bus.js";
import { getSpaceChannelConfig } from "../../redis.js";
import { buildQQDeliveryPlan } from "../../session-output-planner.js";
import { QQApiClient, QQApiError, QQMediaFileType } from "./api.js";
import { buildQQInboundFileBlocks, buildQQInboundImageBlocks } from "./media.js";
import {
  clearQQStreamState,
  getQQRefIndex,
  getQQStreamState,
  reserveQQPassiveReply,
  setQQRefIndex,
  setQQStreamState,
  updateQQStatus,
} from "./state.js";
import { QQWebSocketTransport } from "./transport.js";
import type {
  QQC2CMessageEvent,
  QQCredentials,
  QQDispatchEvent,
  QQGroupMessageEvent,
  QQGuildMessageEvent,
  QQMessageAttachment,
  QQMsgElement,
} from "./types.js";

const logger = createLogger({ serviceName: "cohub-gateway" });
const QQ_REPLY_LIMIT = 4;

type QQChatKind = "c2c" | "group" | "guild";
type QQTarget = { kind: QQChatKind; id: string };

const buildQQBindingKey = (kind: QQChatKind, id: string) => `qq:${kind}:${id}`;
const normalizeContent = (value: string | undefined) => (value ?? "").replace(/<@!?\d+>/g, "").replace(/\s{2,}/g, " ").trim();

const qqMediaFileType = (kind: QQMediaKind) => {
  if (kind === "image") return QQMediaFileType.IMAGE;
  if (kind === "voice") return QQMediaFileType.VOICE;
  if (kind === "video") return QQMediaFileType.VIDEO;
  return QQMediaFileType.FILE;
};

const qqMediaSource = (item: { source: { type: "url"; url: string } | { type: "base64"; media_type: string; data: string } }) => {
  if (item.source.type === "url") return item.source.url;
  return `data:${item.source.media_type};base64,${item.source.data}`;
};

const extractRefIdx = (ext: string[] | undefined, name: "ref_msg_idx" | "msg_idx") => {
  for (const value of ext ?? []) {
    const match = value.match(new RegExp(`^${name}=([^,\\s]+)$`));
    if (match?.[1]) return match[1];
  }
  return null;
};

const sourceChannel = (kind: QQChatKind, id: string) => {
  if (kind === "c2c") return `qq:dm:${id}`;
  if (kind === "group") return `qq:group:${id}`;
  return `qq:guild:${id}`;
};

const nonImageAttachmentBlocks = (attachments: QQMessageAttachment[] | undefined) => (attachments ?? [])
  .filter((attachment) => !attachment.content_type?.startsWith("image/"))
  .map((attachment) => ({ type: "text" as const, text: `[Attachment: ${attachment.filename ?? attachment.content_type ?? "file"}]` }));

export class QQProvider implements GatewayProvider {
  private readonly api: QQApiClient;
  private readonly transport: QQWebSocketTransport;

  constructor(private readonly channelId: string, credentials: QQCredentials) {
    this.api = new QQApiClient(credentials);
    this.transport = new QQWebSocketTransport({
      channelId,
      api: this.api,
      onEvent: (event) => this.handleEvent(event),
      onReady: () => logger.info(`[QQ:${channelId}] ready`),
    });
    this.transport.start();
  }

  async handleOutbound(cmd: PlannedGatewayOutboundCommand) {
    const config = await getSpaceChannelConfig<QQChannelConfig>(this.channelId);
    const plan = cmd.deliveryPlan?.adapter === "qq" ? cmd.deliveryPlan : buildQQDeliveryPlan(cmd, config);
    if (plan.mode === "skip" || (plan.chunks.length === 0 && plan.mediaItems.length === 0 && !plan.streamText)) return { success: true as const };

    const target = this.parseExternalChatId(cmd.externalChatId);
    if (!target) return { success: false as const, error: `Invalid QQ externalChatId: ${cmd.externalChatId}` };

    let lastExternalMessageId: string | undefined;
    try {
      if (plan.mode === "stream") {
        const streamed = await this.handleStreamOutbound(plan, target);
        if (streamed) return streamed;
      }

      for (const chunk of plan.chunks) {
        const msgId = await this.reservePassiveMessageId(plan.replyToExternalMessageId);
        const response = target.kind === "c2c"
          ? await this.api.sendC2CMessage(target.id, chunk, msgId, config?.outbound?.markdownSupport === true)
          : target.kind === "group"
            ? await this.api.sendGroupMessage(target.id, chunk, msgId, config?.outbound?.markdownSupport === true)
            : await this.api.sendChannelMessage(target.id, chunk, msgId);
        lastExternalMessageId = response.id;
        await this.recordOutboundRef(response.ext_info?.ref_idx, chunk, target);
      }

      for (const item of plan.mediaItems) {
        const msgId = await this.reservePassiveMessageId(plan.replyToExternalMessageId);
        const source = qqMediaSource(item);
        if (target.kind === "guild") {
          const fallbackText = `[${item.kind}: ${item.filename ?? source}]`;
          const response = await this.api.sendChannelMessage(target.id, fallbackText, msgId);
          lastExternalMessageId = response.id;
          await this.recordOutboundRef(response.ext_info?.ref_idx, fallbackText, target);
          continue;
        }
        const response = target.kind === "c2c"
          ? await this.api.sendC2CMedia(target.id, qqMediaFileType(item.kind), source, msgId, undefined, item.filename)
          : await this.api.sendGroupMedia(target.id, qqMediaFileType(item.kind), source, msgId, undefined, item.filename);
        lastExternalMessageId = response.id;
        await this.recordOutboundRef(response.ext_info?.ref_idx, `[${item.kind}: ${item.filename ?? source}]`, target);
      }

      await updateQQStatus(this.channelId, { lastOutboundAt: Date.now() }).catch(() => undefined);
      return { success: true as const, externalMessageId: lastExternalMessageId };
    } catch (error) {
      const errorMessage = error instanceof QQApiError ? `${error.status} ${error.bizMessage ?? error.message}` : error instanceof Error ? error.message : String(error);
      logger.error(`[QQ:${this.channelId}] failed to send message`, error);
      await updateQQStatus(this.channelId, { lastErrorAt: Date.now(), lastError: errorMessage }).catch(() => undefined);
      return { success: false as const, error: errorMessage, externalMessageId: lastExternalMessageId };
    }
  }

  destroy() {
    this.transport.stop();
  }

  private async handleStreamOutbound(plan: Extract<PlannedGatewayOutboundCommand["deliveryPlan"], { adapter: "qq" }>, target: QQTarget) {
    if (target.kind !== "c2c" || !plan.replyToExternalMessageId || !plan.eventId || !plan.turnAnchorMessageId || !plan.streamText) return null;

    const existing = await getQQStreamState(this.channelId, plan.turnAnchorMessageId).catch(() => null);
    const state = existing ?? { msgSeq: 1, index: 0, lastText: "" };
    const isDone = plan.streamState === "done";
    const response = await this.api.sendC2CStreamMessage(target.id, {
      inputState: isDone ? "done" : "generating",
      contentRaw: plan.streamText,
      eventId: plan.eventId,
      msgId: plan.replyToExternalMessageId,
      msgSeq: state.msgSeq,
      index: state.index,
      streamMsgId: state.streamMsgId,
    });

    if (isDone) {
      await clearQQStreamState(this.channelId, plan.turnAnchorMessageId).catch(() => undefined);
    } else {
      await setQQStreamState(this.channelId, plan.turnAnchorMessageId, {
        streamMsgId: response.id || state.streamMsgId,
        msgSeq: state.msgSeq + 1,
        index: state.index + 1,
        lastText: plan.streamText,
      }).catch(() => undefined);
    }
    await this.recordOutboundRef(response.ext_info?.ref_idx, plan.streamText, target);
    return { success: true as const, externalMessageId: response.id };
  }

  private async recordOutboundRef(refIdx: string | undefined, content: string, target: QQTarget) {
    if (!refIdx) return;
    await setQQRefIndex(this.channelId, refIdx, {
      content,
      senderId: `bot:${this.channelId}`,
      senderName: "Cohub",
      timestamp: Date.now(),
      isBot: true,
      attachments: [],
    }).catch((error) => logger.warn(`[QQ:${this.channelId}] failed to record outbound ref`, { refIdx, target, error }));
  }

  private async reservePassiveMessageId(messageId: string | undefined) {
    if (!messageId) return undefined;
    const allowed = await reserveQQPassiveReply(this.channelId, messageId, QQ_REPLY_LIMIT).catch((error) => {
      logger.warn(`[QQ:${this.channelId}] passive reply reservation failed`, error);
      return false;
    });
    return allowed ? messageId : undefined;
  }

  private async handleEvent(event: QQDispatchEvent) {
    if (event.eventType === "C2C_MESSAGE_CREATE") {
      await this.publishC2CMessage(event.data as QQC2CMessageEvent, event.seq);
      return;
    }
    if (event.eventType === "GROUP_AT_MESSAGE_CREATE" || event.eventType === "GROUP_MESSAGE_CREATE") {
      await this.publishGroupMessage(event.data as QQGroupMessageEvent, event.seq, event.eventType);
      return;
    }
    if (event.eventType === "AT_MESSAGE_CREATE") {
      await this.publishGuildMessage(event.data as QQGuildMessageEvent, event.seq);
    }
  }

  private async publishC2CMessage(message: QQC2CMessageEvent, seq?: number) {
    const openid = message.author?.user_openid || message.author?.union_openid || message.author?.id;
    if (!openid || !message.id || message.author?.bot) return;
    const text = await this.resolveReferencedContent(normalizeContent(message.content), message.message_scene?.ext, message.msg_elements);
    const content: ContentBlock[] = text ? [{ type: "text", text }] : [];
    content.push(...nonImageAttachmentBlocks(message.attachments));
    if (content.length === 0) content.push({ type: "text", text: "[Message]" });
    await this.publishMessage({
      kind: "c2c",
      externalChatId: `c2c:${openid}`,
      externalConversationId: openid,
      externalMessageId: message.id,
      senderId: openid,
      content,
      text,
      seq,
      attachments: message.attachments,
      meta: { rawEventType: "C2C_MESSAGE_CREATE", msgIdx: extractRefIdx(message.message_scene?.ext, "msg_idx"), sourceChannel: sourceChannel("c2c", openid) },
    });
  }

  private async publishGroupMessage(message: QQGroupMessageEvent, seq: number | undefined, rawEventType: string) {
    const groupOpenid = message.group_openid || message.group_id;
    const senderId = message.author?.member_openid || message.author?.id || "unknown";
    if (!groupOpenid || !message.id || message.author?.bot) return;
    const config = await getSpaceChannelConfig<QQChannelConfig>(this.channelId);
    const requireMention = config?.inbound?.requireMentionInGroup !== false;
    const mentioned = rawEventType === "GROUP_AT_MESSAGE_CREATE" || (message.mentions ?? []).some((mention) => mention.is_you === true || mention.bot === true);
    if (requireMention && !mentioned) return;
    const text = await this.resolveReferencedContent(normalizeContent(message.content), message.message_scene?.ext, message.msg_elements);
    const content: ContentBlock[] = text ? [{ type: "text", text }] : [];
    content.push(...nonImageAttachmentBlocks(message.attachments));
    if (content.length === 0) content.push({ type: "text", text: "[Message]" });
    await this.publishMessage({
      kind: "group",
      externalChatId: `group:${groupOpenid}`,
      externalConversationId: groupOpenid,
      externalMessageId: message.id,
      senderId,
      senderName: message.author?.username,
      content,
      text,
      seq,
      attachments: message.attachments,
      meta: { rawEventType, groupId: message.group_id ?? null, msgIdx: extractRefIdx(message.message_scene?.ext, "msg_idx"), sourceChannel: sourceChannel("group", groupOpenid) },
    });
  }

  private async publishGuildMessage(message: QQGuildMessageEvent, seq?: number) {
    if (!message.channel_id || !message.id || message.author?.bot) return;
    const text = await this.resolveReferencedContent(normalizeContent(message.content), message.message_scene?.ext, message.msg_elements);
    const content: ContentBlock[] = text ? [{ type: "text", text }] : [];
    content.push(...nonImageAttachmentBlocks(message.attachments));
    if (content.length === 0) content.push({ type: "text", text: "[Message]" });
    await this.publishMessage({
      kind: "guild",
      externalChatId: `guild:${message.channel_id}`,
      externalConversationId: message.channel_id,
      externalMessageId: message.id,
      senderId: message.author?.id ?? "unknown",
      senderName: message.member?.nick ?? message.author?.username,
      content,
      text,
      seq,
      attachments: message.attachments,
      meta: { rawEventType: "AT_MESSAGE_CREATE", guildId: message.guild_id, msgIdx: extractRefIdx(message.message_scene?.ext, "msg_idx"), sourceChannel: sourceChannel("guild", message.channel_id) },
    });
  }

  private async resolveReferencedContent(text: string, ext?: string[], msgElements?: QQMsgElement[]) {
    const refIdx = extractRefIdx(ext, "ref_msg_idx");
    const cached = refIdx ? await getQQRefIndex(this.channelId, refIdx).catch(() => null) : null;
    const embedded = msgElements?.[0]?.content?.trim();
    const referenced = cached?.content?.trim() || embedded;
    if (!referenced) return text;
    return `[Quoted message]\n${referenced}\n\n${text}`.trim();
  }

  private async publishMessage(input: {
    kind: QQChatKind;
    externalChatId: string;
    externalConversationId: string;
    externalMessageId: string;
    senderId: string;
    senderName?: string;
    content: ContentBlock[];
    text: string;
    seq?: number;
    attachments?: QQMessageAttachment[];
    meta: Record<string, unknown>;
  }) {
    const bindingKey = buildQQBindingKey(input.kind, input.externalConversationId);
    const command = resolveChannelCommand(input.text);
    const base = {
      eventId: randomUUID(),
      timestamp: Date.now(),
      channelId: this.channelId,
      provider: "qq" as const,
      externalChatId: input.externalChatId,
      externalMessageId: input.externalMessageId,
      bindingKey,
      binding: { key: bindingKey },
      conversation: {
        id: input.externalChatId,
        meta: {
          kind: input.kind,
          sourceChannel: input.meta.sourceChannel,
        },
      },
      message: {
        parentMessageId: null,
        meta: {
          seq: input.seq ?? null,
          ...input.meta,
        },
      },
      sender: {
        id: input.senderId,
        name: input.senderName,
      },
      content: input.content,
      meta: input.meta,
    } satisfies Omit<GatewayInboundEvent, "eventType" | "command">;
    const mediaEvent = { ...base, eventType: command ? "channel_command" : "message_create", ...(command ? { command } : {}) } as GatewayInboundEvent;
    const imageBlocks = await buildQQInboundImageBlocks({ event: mediaEvent, attachments: input.attachments }).catch((error) => {
      logger.warn(`[QQ:${this.channelId}] failed to process inbound images`, error);
      return [] as ContentBlock[];
    });
    const fileBlocks = await buildQQInboundFileBlocks({ event: mediaEvent, attachments: input.attachments }).catch((error) => {
      logger.warn(`[QQ:${this.channelId}] failed to process inbound files`, error);
      return [] as ContentBlock[];
    });
    const content = [...input.content, ...imageBlocks, ...fileBlocks];
    const event: GatewayInboundEvent = command
      ? { ...base, content, eventType: "channel_command", command }
      : { ...base, content, eventType: "message_create" };
    await publishInboundEvent(event);
    const msgIdx = typeof input.meta.msgIdx === "string" ? input.meta.msgIdx : null;
    if (msgIdx) {
      await setQQRefIndex(this.channelId, msgIdx, {
        content: input.text,
        senderId: input.senderId,
        senderName: input.senderName,
        timestamp: Date.now(),
        isBot: false,
        attachments: (input.attachments ?? []).map((attachment) => ({
          type: attachment.content_type?.split("/")[0] ?? "file",
          filename: attachment.filename,
          contentType: attachment.content_type,
          url: attachment.url,
        })),
      }).catch((error) => logger.warn(`[QQ:${this.channelId}] failed to record inbound ref`, { msgIdx, error }));
    }
    await updateQQStatus(this.channelId, { lastInboundAt: Date.now() }).catch(() => undefined);
  }

  private parseExternalChatId(value: string): QQTarget | null {
    const [kind, ...rest] = value.split(":");
    const id = rest.join(":").trim();
    if ((kind === "c2c" || kind === "group" || kind === "guild") && id) return { kind, id };
    return null;
  }
}
