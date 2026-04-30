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
const FEISHU_DOC_URL_RE = /https?:\/\/[^\s<>'"]+/g;
const FEISHU_DOC_MAX_PER_MESSAGE = 3;
const FEISHU_DOC_MAX_CHARS = 12_000;
const FEISHU_DOC_FETCH_TIMEOUT_MS = 10_000;
const FEISHU_WIKI_CHILD_MAX_COUNT = 5;
const FEISHU_WIKI_CHILD_MAX_CHARS = 4_000;

type FeishuDocumentRef = {
  url: string;
  type: "docx" | "wiki" | "docs";
  token: string;
};

type ResolvedFeishuDocumentRef = FeishuDocumentRef & {
  type: "docx";
  wiki?: {
    spaceId?: string;
    nodeToken?: string;
    title?: string;
    hasChild?: boolean;
  };
};

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

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | null = null;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => reject(new Error(message)), timeoutMs);
  });
  return Promise.race([promise, timeoutPromise]).finally(() => {
    if (timeout) clearTimeout(timeout);
  });
}

function cleanUrlCandidate(value: string) {
  return value.replace(/[),.。;；:：!！?？\]}]+$/g, "");
}

function parseFeishuDocumentUrl(value: string): FeishuDocumentRef | null {
  let url: URL;
  try {
    url = new URL(cleanUrlCandidate(value));
  } catch {
    return null;
  }

  if (!/(^|\.)(feishu\.cn|larksuite\.com|larkoffice\.com)$/.test(url.hostname)) return null;
  const match = url.pathname.match(/\/(docx|wiki|docs)\/([A-Za-z0-9]+)/);
  if (!match?.[1] || !match[2]) return null;
  return { url: url.toString(), type: match[1] as "docx" | "wiki" | "docs", token: match[2] };
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
    const enrichedContentBlocks = await this.expandFeishuDocumentLinks(contentBlocks);

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
      content: enrichedContentBlocks,
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

  private findDocumentRefs(blocks: ContentBlock[]): FeishuDocumentRef[] {
    const refs: FeishuDocumentRef[] = [];
    const seen = new Set<string>();

    for (const block of blocks) {
      if (block.type !== "text") continue;
      for (const match of block.text.matchAll(FEISHU_DOC_URL_RE)) {
        const ref = parseFeishuDocumentUrl(match[0]);
        if (!ref || seen.has(ref.url)) continue;
        seen.add(ref.url);
        refs.push(ref);
        if (refs.length >= FEISHU_DOC_MAX_PER_MESSAGE) return refs;
      }
    }

    return refs;
  }

  private async resolveDocumentRef(ref: FeishuDocumentRef): Promise<ResolvedFeishuDocumentRef> {
    if (ref.type === "docx") return { ...ref, type: "docx" };
    if (ref.type === "docs") throw new Error("legacy /docs/ URLs are not supported");

    const res = await this.client.wiki.space.getNode({
      params: { token: ref.token },
    });
    if (res.code && res.code !== 0) throw new Error(res.msg ?? `Feishu wiki get_node failed with code ${res.code}`);
    const node = res.data?.node;
    const objToken = node?.obj_token;
    const objType = node?.obj_type;
    if (!objToken) throw new Error("failed to resolve wiki token");
    if (objType !== "docx") throw new Error(`wiki object type ${objType || "unknown"} is not supported`);
    return {
      ...ref,
      type: "docx",
      token: objToken,
      wiki: {
        spaceId: node?.space_id,
        nodeToken: node?.node_token,
        title: node?.title,
        hasChild: node?.has_child,
      },
    };
  }

  private async fetchDocxRawContent(documentId: string): Promise<string> {
    const res = await this.client.docx.document.rawContent({
      path: { document_id: documentId },
    });
    if (res.code && res.code !== 0) throw new Error(res.msg ?? `Feishu docx raw_content failed with code ${res.code}`);
    return res.data?.content ?? "";
  }

  private appendBoundedSection(sections: string[], heading: string, content: string, remainingChars: number): number {
    if (remainingChars <= 0) return 0;

    const normalized = content || "[empty document]";
    const sectionPrefix = `${heading}\n`;
    const available = Math.max(0, remainingChars - sectionPrefix.length);
    if (available <= 0) return 0;

    const page = normalized.slice(0, available);
    const more = normalized.length > page.length
      ? `\n\n[Truncated: showing ${page.length} of ${normalized.length} characters.]`
      : "";
    const section = `${sectionPrefix}${page}${more}`;
    sections.push(section);
    return section.length;
  }

  private async fetchWikiChildSections(ref: ResolvedFeishuDocumentRef, remainingChars: number): Promise<string[]> {
    const spaceId = ref.wiki?.spaceId;
    const parentNodeToken = ref.wiki?.nodeToken;
    if (!spaceId || !parentNodeToken || !ref.wiki?.hasChild || remainingChars <= 0) return [];

    const res = await this.client.wiki.spaceNode.list({
      path: { space_id: spaceId },
      params: {
        parent_node_token: parentNodeToken,
        page_size: FEISHU_WIKI_CHILD_MAX_COUNT,
      },
    });
    if (res.code && res.code !== 0) throw new Error(res.msg ?? `Feishu wiki spaceNode list failed with code ${res.code}`);

    const sections: string[] = [];
    let remaining = remainingChars;
    const children = res.data?.items ?? [];
    for (const child of children.slice(0, FEISHU_WIKI_CHILD_MAX_COUNT)) {
      const title = child.title || child.obj_token || "Untitled";
      if (child.obj_type !== "docx" || !child.obj_token) {
        const used = this.appendBoundedSection(
          sections,
          `Child document: ${title}`,
          `[Skipped unsupported wiki child type: ${child.obj_type || "unknown"}]`,
          remaining,
        );
        remaining -= used;
        continue;
      }

      const content = await this.fetchDocxRawContent(child.obj_token);
      const childContent = content.slice(0, FEISHU_WIKI_CHILD_MAX_CHARS);
      const used = this.appendBoundedSection(
        sections,
        `Child document: ${title}`,
        childContent || "[empty document]",
        remaining,
      );
      remaining -= used;
      if (remaining <= 0) break;
    }

    if (res.data?.has_more && remaining > 0) {
      this.appendBoundedSection(
        sections,
        "Additional wiki children",
        `[Not expanded: showing first ${FEISHU_WIKI_CHILD_MAX_COUNT} child documents.]`,
        remaining,
      );
    }

    return sections;
  }

  private async fetchDocumentContent(ref: FeishuDocumentRef): Promise<string> {
    if (ref.type === "docs") {
      return `Feishu document link: ${ref.url}\nLegacy /docs/ URLs are not supported. Please use a /docx/ or /wiki/ link.`;
    }

    const resolved = await this.resolveDocumentRef(ref);
    const sections: string[] = [`Feishu document link: ${ref.url}`];
    let used = sections[0]?.length ?? 0;
    const rootContent = await this.fetchDocxRawContent(resolved.token);

    used += this.appendBoundedSection(
      sections,
      resolved.wiki?.title ? `Document: ${resolved.wiki.title}` : "Document content",
      rootContent,
      FEISHU_DOC_MAX_CHARS - used,
    );

    const childSections = await this.fetchWikiChildSections(resolved, FEISHU_DOC_MAX_CHARS - used);
    sections.push(...childSections);
    return sections.join("\n\n");
  }

  private async expandFeishuDocumentLinks(blocks: ContentBlock[]): Promise<ContentBlock[]> {
    const refs = this.findDocumentRefs(blocks);
    if (refs.length === 0) return blocks;

    const docBlocks: ContentBlock[] = [];
    for (const ref of refs) {
      try {
        const text = await withTimeout(
          this.fetchDocumentContent(ref),
          FEISHU_DOC_FETCH_TIMEOUT_MS,
          `Feishu document fetch timed out after ${FEISHU_DOC_FETCH_TIMEOUT_MS}ms`,
        );
        docBlocks.push({ type: "text", text });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.warn(`[Feishu:${this.channelId}] Failed to expand document ${ref.url}:`, message);
        docBlocks.push({ type: "text", text: `Feishu document link: ${ref.url}\n[Unable to fetch document content: ${message}]` });
      }
    }

    return [...blocks, ...docBlocks];
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
