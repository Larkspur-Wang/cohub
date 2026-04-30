import * as Lark from "@larksuiteoapi/node-sdk";
import { randomUUID } from "node:crypto";
import type { ContentBlock } from "@neta-art/cohub-protocol/core";
import type { FeishuChannelConfig, GatewayInboundEvent } from "@neta-art/cohub-protocol/gateway";
import type { PlannedGatewayOutboundCommand } from "@cohub/gateway-contract";
import type { GatewayProvider } from "../base.js";
import { publishInboundEvent, } from "../../bus.js";
import { getSpaceChannelConfig, getTurnMessageExternalRef, setTurnMessageExternalRef } from "../../redis.js";
import { buildFeishuDeliveryPlan } from "../../session-output-planner.js";
import {
  resolveReceiveIdType,
  buildFeishuBindingKey,
} from "./utils.js";
import { parseFeishuMessageContent, type FeishuInboundResource, type FeishuParsedMessageBlock } from "./parse.js";
import {
  FEISHU_INBOUND_IMAGE_MAX_BYTES,
  FEISHU_INBOUND_IMAGE_MAX_COUNT,
  readFeishuResourceBuffer,
} from "./media.js";

// Detect image MIME type from magic bytes (first 4 bytes)
function detectMimeType(buffer: Buffer): string | null {
  if (buffer.length < 4) return null;
  // PNG: 89 50 4E 47
  if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) return "image/png";
  // JPEG: FF D8 FF
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return "image/jpeg";
  // GIF: 47 49 46 38
  if (buffer[0] === 0x47 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x38) return "image/gif";
  // WebP: 52 49 46 46 ... 57 45 42 50
  if (buffer[0] === 0x52 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x46) return "image/webp";
  return null;
}

// Provider-level dedup for WS reconnect duplicate delivery
const messageDedup = new Map<string, number>();
const DEDUP_TTL_MS = 5 * 60 * 1000;
const DEDUP_MAX_ENTRIES = 10000;

function dedupAndPurge(eventId: string): boolean {
  if (messageDedup.has(eventId)) return false;
  messageDedup.set(eventId, Date.now());
  if (messageDedup.size > DEDUP_MAX_ENTRIES) {
    const now = Date.now();
    for (const [id, ts] of messageDedup) {
      if (now - ts > DEDUP_TTL_MS) messageDedup.delete(id);
    }
  }
  return true;
}

export class FeishuProvider implements GatewayProvider {
  private client: Lark.Client;
  private wsClient: Lark.WSClient;
  private dispatcher: Lark.EventDispatcher;
  private channelId: string;
  private appId: string;
  private botOpenId?: string;

  constructor(
    channelId: string,
    credentials: { appId: string; appSecret: string; brand?: "feishu" | "lark" },
  ) {
    this.channelId = channelId;
    this.appId = credentials.appId;
    const domain = credentials.brand === "lark" ? Lark.Domain.Lark : Lark.Domain.Feishu;

    console.log(`[Feishu:${channelId}] Creating Feishu client (domain=${domain})`);

    this.client = new Lark.Client({
      appId: credentials.appId,
      appSecret: credentials.appSecret,
      appType: Lark.AppType.SelfBuild,
      domain,
    });

    this.dispatcher = new Lark.EventDispatcher({
      encryptKey: "",
      verificationToken: "",
    });

    this.wsClient = new Lark.WSClient({
      appId: credentials.appId,
      appSecret: credentials.appSecret,
      domain,
      loggerLevel: Lark.LoggerLevel.info,
    });

    this.setupListeners();

    console.log(`[Feishu:${channelId}] Starting WebSocket connection...`);
    this.wsClient.start({ eventDispatcher: this.dispatcher }).catch((err) => {
      console.error(`[Feishu:${channelId}] WS start failed:`, err);
    });

    // Probe bot identity
    this.probeBot();
  }

  private async probeBot() {
    try {
      // biome-ignore lint/suspicious/noExplicitAny: Lark SDK request method is not publicly typed
      const res = await (this.client as any).request({
        method: "GET",
        url: "/open-apis/bot/v3/info",
      });
      if (res.code === 0 && res.data?.bot?.open_id) {
        this.botOpenId = res.data.bot.open_id;
        console.log(`[Feishu:${this.channelId}] ✓ Bot open_id: ${this.botOpenId}`);
      } else {
        console.warn(`[Feishu:${this.channelId}] Probe bot returned no open_id:`, JSON.stringify(res).slice(0, 200));
      }
    } catch (err) {
      console.error(`[Feishu:${this.channelId}] Probe bot failed:`, err);
    }
  }

  private setupListeners() {
    this.dispatcher.register({
      "im.message.receive_v1": (data: unknown) => {
        this.handleMessageEvent(data).catch((err) => {
          console.error(`[Feishu:${this.channelId}] Handle message error:`, err);
        });
      },
    });
  }

  private async handleMessageEvent(data: unknown) {
    const event = data as {
      event_id?: string;
      app_id?: string;
      sender?: { sender_id: { open_id?: string; user_id?: string } };
      message?: {
        message_id: string;
        chat_id: string;
        chat_type: "p2p" | "group";
        message_type: string;
        content: string;
        thread_id?: string;
        root_id?: string;
        parent_id?: string;
        create_time?: string;
        mentions?: Array<{ key: string; id: { open_id?: string }; name: string }>;
      };
    };

    const eventId = event.event_id;
    if (!eventId) return;

    // App ownership check
    if (event.app_id && event.app_id !== this.appId) {
      return;
    }

    // Dedup
    if (!dedupAndPurge(eventId)) {
      console.log(`[Feishu:${this.channelId}] Duplicate event ${eventId.slice(0, 8)}, skipping`);
      return;
    }

    const msg = event.message;
    if (!msg) return;

    // Expired message filter (5 min)
    if (msg.create_time) {
      const age = Date.now() - Number.parseInt(msg.create_time, 10) * 1000;
      if (age > 5 * 60 * 1000) {
        console.log(`[Feishu:${this.channelId}] Expired message ${msg.message_id}, skipping`);
        return;
      }
    }

    const isDm = msg.chat_type === "p2p";

    // Group: skip if bot not mentioned (config-controlled)
    if (!isDm) {
      const config = await getSpaceChannelConfig<FeishuChannelConfig>(this.channelId);
      const requireMention = config?.inbound?.requireMentionInGroup ?? true;
      if (requireMention && this.botOpenId) {
        const hasMention = msg.mentions?.some((m) => m.id.open_id === this.botOpenId) ?? false;
        if (!hasMention) {
          console.log(`[Feishu:${this.channelId}] Bot not mentioned in group ${msg.chat_id}, skipping`);
          return;
        }
      }
    }

    const parsedContent = parseFeishuMessageContent(msg);

    const contentBlocks = parsedContent.resources.length > 0
      ? await this.resolveParsedBlocks(parsedContent.blocks, msg.message_id, FEISHU_INBOUND_IMAGE_MAX_COUNT)
      : parsedContent.blocks.map((block) => ({ type: "text", text: block.type === "text" ? block.text : block.fallbackText }) satisfies ContentBlock);

    const threadId = msg.thread_id || msg.root_id || null;
    const parentMessageId = msg.root_id || msg.parent_id || null;
    const bindingKey = buildFeishuBindingKey(msg.chat_id, threadId);

    const inboundEvent: GatewayInboundEvent = {
      eventId: randomUUID(),
      timestamp: Date.now(),
      channelId: this.channelId,
      provider: "feishu",
      externalChatId: msg.chat_id,
      externalMessageId: msg.message_id,
      bindingKey,
      conversation: {
        id: msg.chat_id,
        parentId: threadId ?? undefined,
        meta: {
          chatType: msg.chat_type,
          isDm,
          threadId,
        },
      },
      message: {
        parentMessageId: parentMessageId ?? undefined,
        meta: {
          threadId,
          messageType: msg.message_type,
        },
      },
      sender: {
        id: event.sender?.sender_id?.open_id ?? "",
        name: "", // Enriched later if needed
      },
      content: contentBlocks,
      meta: {
        chatType: msg.chat_type,
        isDm,
        threadId,
        mentions: msg.mentions?.map((m) => ({ key: m.key, openId: m.id.open_id, name: m.name })) ?? null,
      },
    };

    console.log(
      `[Feishu:${this.channelId}] → Inbound: ${inboundEvent.externalMessageId.slice(0, 8)} chat=${msg.chat_id} type=${msg.chat_type}${threadId ? ` thread=${threadId}` : ""}`,
    );
    await publishInboundEvent(inboundEvent);
  }

  // Upload an image to Feishu and return the image_key.
  // Supports base64 and URL sources.
  private async uploadImage(
    imageSource: { type: "base64"; media_type: string; data: string } | { type: "url"; url: string },
  ): Promise<string | null> {
    try {
      let buffer: Buffer;
      let fileName: string;

      if (imageSource.type === "base64") {
        buffer = Buffer.from(imageSource.data, "base64");
        const ext = imageSource.media_type.split("/")[1] ?? "png";
        fileName = `image.${ext}`;
      } else {
        // Fetch from URL
        const res = await fetch(imageSource.url);
        if (!res.ok) {
          console.warn(`[Feishu:${this.channelId}] Failed to fetch image URL: ${imageSource.url} (${res.status})`);
          return null;
        }
        buffer = Buffer.from(await res.arrayBuffer());
        fileName = "image";
      }

      // biome-ignore lint/suspicious/noExplicitAny: Lark SDK upload API is not fully typed
      const uploadResult = await (this.client as any).request({
        method: "POST",
        url: "/open-apis/im/v1/images",
        data: {
          image_type: "message",
        },
        formData: {
          image: {
            value: buffer,
            options: { filename: fileName },
          },
        },
      });

      if (uploadResult.code === 0 && uploadResult.data?.image_key) {
        return uploadResult.data.image_key as string;
      }
      console.warn(`[Feishu:${this.channelId}] Image upload failed:`, JSON.stringify(uploadResult).slice(0, 200));
      return null;
    } catch (err) {
      console.warn(`[Feishu:${this.channelId}] Image upload error:`, err instanceof Error ? err.message : String(err));
      return null;
    }
  }

  // Download image from Feishu by image_key and return as base64 ContentBlock.
  // Returns null on failure — caller decides whether to use a text fallback.
  private async downloadImageBlock(imageKey: string, messageId: string): Promise<ContentBlock | null> {
    try {
      const res = await this.client.im.messageResource.get({
        path: { message_id: messageId, file_key: imageKey },
        params: { type: "image" },
      });
      const buffer = await readFeishuResourceBuffer(res, { maxBytes: FEISHU_INBOUND_IMAGE_MAX_BYTES });
      if (!buffer || buffer.length === 0) {
        console.warn(`[Feishu:${this.channelId}] Image download returned empty: ${imageKey}`);
        return null;
      }
      const mimeType = detectMimeType(buffer) ?? "image/png";
      const base64Data = buffer.toString("base64");
      return {
        type: "image",
        source: {
          type: "base64",
          media_type: mimeType,
          data: base64Data,
        },
        _meta: { imageKey, source: "feishu" },
      };
    } catch (err) {
      console.warn(`[Feishu:${this.channelId}] Failed to download image ${imageKey}:`, err instanceof Error ? err.message : String(err));
      return null;
    }
  }

  private async resolveInboundResource(resource: FeishuInboundResource, messageId: string): Promise<ContentBlock | null> {
    if (resource.type === "image") return this.downloadImageBlock(resource.fileKey, messageId);
    return null;
  }

  private async resolveParsedBlocks(blocks: FeishuParsedMessageBlock[], messageId: string, maxResources: number): Promise<ContentBlock[]> {
    const resolved: ContentBlock[] = [];
    let resourceCount = 0;

    for (const block of blocks) {
      if (block.type === "text") {
        resolved.push({ type: "text", text: block.text });
        continue;
      }

      resourceCount += 1;
      if (resourceCount > maxResources) {
        resolved.push({ type: "text", text: `[image: ${block.resource.fileKey} skipped: too many images]` });
        continue;
      }

      const resourceBlock = await this.resolveInboundResource(block.resource, messageId);
      resolved.push(resourceBlock ?? { type: "text", text: block.fallbackText });
    }
    return resolved;
  }

  public async handleOutbound(cmd: PlannedGatewayOutboundCommand): Promise<{ success: boolean; error?: string; externalMessageId?: string }> {
    console.log(`[Feishu:${this.channelId}] → Outbound to ${cmd.externalChatId}`, {
      contentPreview: cmd.content.map((c: { type: string; text?: string }) => (c.type === "text" ? c.text?.slice(0, 30) : c.type)).join(", "),
      replyTo: cmd.replyToExternalMessageId?.slice(0, 8) || "none",
      source: typeof cmd.meta?.source === "string" ? cmd.meta.source : "unknown",
    });

    try {
      const config = await getSpaceChannelConfig<FeishuChannelConfig>(this.channelId);
      const plan = cmd.deliveryPlan?.adapter === "feishu"
        ? cmd.deliveryPlan
        : await buildFeishuDeliveryPlan(cmd, config);
      const msgType = plan.msgType;
      const content = plan.content;
      // Resolve image keys: pre-existing Feishu keys + uploaded images
      const imageKeys = plan.imageKeys;
      let uploadedImageKeys: string[] = [];
      if (plan.imagesToUpload && plan.imagesToUpload.length > 0) {
        uploadedImageKeys = (
          await Promise.all(
            plan.imagesToUpload.map((img) => this.uploadImage(img.source)),
          )
        ).filter((k): k is string => k !== null);
        if (uploadedImageKeys.length < plan.imagesToUpload.length) {
          console.warn(`[Feishu:${this.channelId}] Only uploaded ${uploadedImageKeys.length}/${plan.imagesToUpload.length} images`);
        }
      }
      const allImageKeys = [...imageKeys, ...uploadedImageKeys];

      const editExternalMessageId = plan.preferredEditExternalMessageId?.trim();
      const turnAnchorMessageId = plan.turnAnchorMessageId?.trim();
      const cachedMessageId = turnAnchorMessageId
        ? await getTurnMessageExternalRef(this.channelId, turnAnchorMessageId).catch(() => null)
        : null;
      const targetMessageId = editExternalMessageId || cachedMessageId;

      if (targetMessageId) {
        if (plan.renderMode === "card") {
          await this.client.im.message.patch({
            path: { message_id: targetMessageId },
            data: { content },
          });
          console.log(`[Feishu:${this.channelId}] ✓ Card patched: ${targetMessageId}`);
          return { success: true, externalMessageId: targetMessageId };
        }
        await this.client.im.message.update({
          path: { message_id: targetMessageId },
          data: { content, msg_type: "post" },
        });
        console.log(`[Feishu:${this.channelId}] ✓ Post updated: ${targetMessageId}`);
        return { success: true, externalMessageId: targetMessageId };
      }

      const receiveIdType = resolveReceiveIdType(cmd.externalChatId);

      if (plan.replyToExternalMessageId) {
        const threadId = cmd.meta?.threadId as string | undefined;
        const replyResult = await this.client.im.message.reply({
          path: { message_id: plan.replyToExternalMessageId },
          data: {
            content,
            msg_type: msgType,
            reply_in_thread: !!threadId,
          },
        });
        const messageId = replyResult?.data?.message_id;
        if (turnAnchorMessageId && messageId) {
          await setTurnMessageExternalRef(this.channelId, turnAnchorMessageId, messageId).catch(() => {});
        }
        console.log(`[Feishu:${this.channelId}] ✓ Reply sent: ${messageId}`);
        return { success: true, externalMessageId: messageId };
      }

      const createResult = await this.client.im.message.create({
        params: { receive_id_type: receiveIdType as "chat_id" | "open_id" | "user_id" },
        data: {
          receive_id: cmd.externalChatId,
          msg_type: msgType,
          content,
        },
      });
      const messageId = createResult?.data?.message_id;
      if (turnAnchorMessageId && messageId) {
        await setTurnMessageExternalRef(this.channelId, turnAnchorMessageId, messageId).catch(() => {});
      }

      // Send images as separate messages after the card/text (Feishu doesn't support inline images)
      const imageSendErrors: string[] = [];
      if (allImageKeys.length > 0 && messageId) {
        for (const imgKey of allImageKeys) {
          try {
            await this.client.im.message.create({
              params: { receive_id_type: receiveIdType as "chat_id" | "open_id" | "user_id" },
              data: {
                receive_id: cmd.externalChatId,
                msg_type: "image",
                content: JSON.stringify({ image_key: imgKey }),
              },
            });
          } catch (err) {
            const errMsg = err instanceof Error ? err.message : String(err);
            console.error(`[Feishu:${this.channelId}] ✗ Failed to send image ${imgKey}:`, errMsg);
            imageSendErrors.push(imgKey);
          }
        }
      }

      console.log(`[Feishu:${this.channelId}] ✓ Message created: ${messageId}`);
      return { success: true, externalMessageId: messageId };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[Feishu:${this.channelId}] ✗ Outbound failed:`, msg);
      if (err instanceof Error && err.stack) {
        console.error(`[Feishu:${this.channelId}] Stack:`, err.stack.split("\n").slice(0, 3).join("\n"));
      }
      return { success: false, error: msg };
    }
  }

  public destroy() {
    console.log(`[Feishu:${this.channelId}] Destroying Feishu client...`);
    try {
      this.wsClient.close({ force: true });
    } catch {
      // Ignore errors during close
    }
    console.log(`[Feishu:${this.channelId}] Feishu client destroyed`);
  }
}
