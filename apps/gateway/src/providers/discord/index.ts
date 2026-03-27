import { Client, GatewayIntentBits, Partials, type AnyThreadChannel, type Message, Events, type MessageCreateOptions, type TextBasedChannel } from "discord.js";
import { randomUUID } from "node:crypto";
import type { GatewayInboundEvent, GatewayOutboundCommand, UnifiedContentBlock, DiscordRuntimeChannelConfig } from "@cohub/protocol";
import { publishConversationCreateEvent, publishInboundEvent } from "../../bus.js";
import { getRuntimeChannelConfig } from "../../redis.js";

const buildDiscordBindingKey = (message: Message) => {
  return `discord:conversation:${message.channelId}`;
};

const truncate = (value: string, limit = 120) =>
  value.length > limit ? `${value.slice(0, limit - 1)}…` : value;

const summarizeThinkingForMinimal = (thinking: string) => {
  const trimmed = thinking.trim();
  if (!trimmed) return "";
  const firstLine = trimmed.split(/\n+/).map((line) => line.trim()).find(Boolean) ?? "";
  return truncate(firstLine, 100);
};

const buildToolLine = (status: string | undefined, toolName: string | undefined, summary: string | undefined) => {
  const safeStatus = status ?? "queued";
  const safeToolName = toolName ?? "tool";
  const suffix = summary?.trim() ? ` ${summary.trim()}` : "";
  return `[${safeStatus}] ${safeToolName}${suffix}`;
};

const buildDiscordRenderText = (content: UnifiedContentBlock[]) => {
  const textParts: string[] = [];
  const imageUris: string[] = [];

  for (const block of content) {
    if (block.type === "text") {
      textParts.push(block.text);
      continue;
    }

    if (block.type === "image" && block.uri) {
      imageUris.push(block.uri);
      continue;
    }

    if (block.type === "resource") {
      const label = block.resource.uri;
      textParts.push(`📎 Resource: ${label}`);
      continue;
    }

    if (block.type === "resource_link") {
      textParts.push(`📎 ${block.title ?? block.name}: ${block.uri}`);
    }
  }

  const mergedText = textParts.join("\n").trim();
  return {
    text: mergedText,
    imageUris,
  };
};

const getDiscordOutboundConfig = (config: DiscordRuntimeChannelConfig | null | undefined) => {
  const outbound = config?.outbound ?? {};
  return {
    showThinking: outbound.showThinking === true,
    showToolCalls: outbound.showToolCalls === true,
  };
};

const getDiscordInboundConfig = (config: DiscordRuntimeChannelConfig | null | undefined) => {
  const inbound = config?.inbound ?? {};
  return {
    requireMentionInGuild: inbound.requireMentionInGuild !== false,
  };
};

const shouldAcceptDiscordInboundMessage = async (channelId: string, message: Message) => {
  const isDM = message.channel?.isDMBased?.() ?? false;
  if (isDM) return true;

  const channelConfig = await getRuntimeChannelConfig<DiscordRuntimeChannelConfig>(channelId);
  const inboundConfig = getDiscordInboundConfig(channelConfig);
  if (!inboundConfig.requireMentionInGuild) return true;

  const botUserId = message.client.user?.id;
  if (!botUserId) return false;
  return message.mentions.users.has(botUserId);
};

const buildDiscordOutboundPayload = async (channelId: string, cmd: GatewayOutboundCommand) => {
  const renderMode = String(cmd.meta?.renderMode ?? "message");
  if (renderMode !== "rich_status") {
    return buildDiscordRenderText(cmd.content);
  }

  const channelConfig = await getRuntimeChannelConfig<DiscordRuntimeChannelConfig>(channelId);
  const outboundConfig = getDiscordOutboundConfig(channelConfig);
  const displayMode = String(cmd.meta?.displayMode ?? "compact");
  const thinking = outboundConfig.showThinking && typeof cmd.meta?.thinking === "string" ? cmd.meta.thinking : "";
  const answer = typeof cmd.meta?.answer === "string" ? cmd.meta.answer : buildDiscordRenderText(cmd.content).text;
  const toolCalls = outboundConfig.showToolCalls && Array.isArray(cmd.meta?.toolCalls)
    ? cmd.meta.toolCalls as Array<Record<string, unknown>>
    : [];

  if (displayMode === "minimal") {
    const lines: string[] = [];
    if (thinking.trim()) {
      lines.push(`🤔 ${summarizeThinkingForMinimal(thinking) || "Thinking..."}`);
    }
    if (toolCalls.length > 0) {
      const firstTwo = toolCalls.slice(0, 2).map((tool) => buildToolLine(
        typeof tool.status === "string" ? tool.status : undefined,
        typeof tool.toolName === "string" ? tool.toolName : undefined,
        typeof tool.summary === "string" ? tool.summary : undefined,
      ));
      lines.push(...firstTwo.map((line) => `🛠 ${line}`));
      if (toolCalls.length > 2) lines.push(`🛠 +${toolCalls.length - 2} more`);
    }
    if (answer.trim()) {
      lines.push(`💬 ${truncate(answer.trim(), 280)}`);
    }
    return {
      text: lines.join("\n").trim(),
      imageUris: [],
    };
  }

  const sections: string[] = [];
  if (thinking.trim()) {
    sections.push(`🤔 Thinking\n${thinking.trim()}`);
  }
  if (toolCalls.length > 0) {
    sections.push(
      `🛠 Tools\n${toolCalls
        .map((tool) => buildToolLine(
          typeof tool.status === "string" ? tool.status : undefined,
          typeof tool.toolName === "string" ? tool.toolName : undefined,
          typeof tool.summary === "string" ? tool.summary : undefined,
        ))
        .join("\n")}`,
    );
  }
  if (answer.trim()) {
    sections.push(`💬 Answer\n${answer.trim()}`);
  }

  return {
    text: sections.join("\n\n").trim(),
    imageUris: [],
  };
};

const buildThreadConversationMeta = async (thread: AnyThreadChannel) => {
  const fetchableThread = thread as AnyThreadChannel & { fetchStarterMessage?: () => Promise<Message | null> };
  const starter = await fetchableThread.fetchStarterMessage?.().catch(() => null);

  return {
    parentId: thread.parentId ?? null,
    starterMessageId: starter?.id ?? null,
    threadName: thread.name ?? null,
    archived: thread.archived ?? false,
    locked: thread.locked ?? false,
    autoArchiveDuration: thread.autoArchiveDuration ?? null,
  };
};

function resolveDiscordDisplayMode(cmd: GatewayOutboundCommand) {
  const explicit = typeof cmd.meta?.displayMode === "string" ? cmd.meta.displayMode : null;
  if (explicit === "full" || explicit === "compact" || explicit === "minimal") {
    return explicit;
  }

  const providerMeta = cmd.meta?.providerMeta;
  const providerObject = providerMeta && typeof providerMeta === "object" ? providerMeta as Record<string, unknown> : null;
  const isThread = providerObject?.isThread === true;
  const isDm = providerObject?.isDm === true;

  if (isThread || isDm) return "compact";
  return "minimal";
}

export class DiscordProvider {
  private client: Client;
  private channelId: string; // 在我们的数据库中定义的该 Channel 实体 ID
  private isConnected = false;

  constructor(channelId: string, token: string) {
    this.channelId = channelId;
    console.log(`[Discord:${channelId}] Creating Discord client...`);

    this.client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.DirectMessages,
      ],
      // DM 场景下 Channel 往往需要 partial，避免事件被吞掉或对象不完整
      partials: [Partials.Channel],
    });

    this.setupListeners();
    console.log(`[Discord:${channelId}] Logging in with token...`);
    this.client.login(token).catch((err) => {
      console.error(`[Discord:${channelId}] Login failed:`, err);
    });
  }

  private setupListeners() {
    this.client.on(Events.ClientReady, (readyClient) => {
      this.isConnected = true;
      console.log(`[Discord:${this.channelId}] ✓ Connected as ${readyClient.user.tag} (${readyClient.user.id})`);
      console.log(`[Discord:${this.channelId}] Guilds: ${readyClient.guilds.cache.size}`);
      if (readyClient.guilds.cache.size > 0) {
        console.log(`[Discord:${this.channelId}] Guild names: ${readyClient.guilds.cache.map((g) => g.name).join(", ")}`);
      }

      const intents = Array.isArray(this.client.options.intents)
        ? this.client.options.intents.join(",")
        : this.client.options.intents.toArray().join(",");
      const partials = (this.client.options.partials ?? []).join(",") || "none";
      console.log(`[Discord:${this.channelId}] Client options: intents=${intents}, partials=${partials}`);
      console.log(`[Discord:${this.channelId}] DM debugging enabled. Waiting for MessageCreate events...`);
    });

    this.client.on(Events.Debug, (message) => {
      if (process.env.DEBUG_MODE === "true") {
        console.log(`[Discord:${this.channelId}] Debug: ${message}`);
      }
    });

    this.client.on(Events.Warn, (message) => {
      console.warn(`[Discord:${this.channelId}] Warn: ${message}`);
    });

    this.client.on(Events.Error, (error) => {
      console.error(`[Discord:${this.channelId}] Error:`, error);
    });

    this.client.on("disconnect", () => {
      this.isConnected = false;
      console.warn(`[Discord:${this.channelId}] Disconnected from Discord`);
    });

    this.client.on("reconnecting", () => {
      console.log(`[Discord:${this.channelId}] Reconnecting to Discord...`);
    });

    this.client.on(Events.ShardReady, (shardId) => {
      console.log(`[Discord:${this.channelId}] Shard ready: ${shardId}`);
    });

    this.client.on(Events.ShardResume, (shardId, replayedEvents) => {
      console.log(`[Discord:${this.channelId}] Shard resumed: ${shardId}, replayedEvents=${replayedEvents}`);
    });

    this.client.on(Events.ShardDisconnect, (closeEvent, shardId) => {
      console.warn(
        `[Discord:${this.channelId}] Shard disconnected: shard=${shardId}, code=${closeEvent.code}, reason=${closeEvent.reason || "unknown"}`,
      );
    });

    this.client.on(Events.ThreadCreate, async (thread) => {
      try {
        const meta = await buildThreadConversationMeta(thread);
        console.log(`[Discord:${this.channelId}] ThreadCreate observed`, {
          threadId: thread.id,
          parentId: meta.parentId,
          starterMessageId: meta.starterMessageId,
          name: meta.threadName,
        });

        await publishConversationCreateEvent({
          channelId: this.channelId,
          provider: "discord",
          externalChatId: thread.id,
          externalMessageId: meta.starterMessageId ?? `thread:${thread.id}`,
          bindingKey: `discord:conversation:${thread.id}`,
          conversation: {
            id: thread.id,
            parentId: meta.parentId,
            meta: {
              isThread: true,
              isDm: false,
              threadName: meta.threadName,
              channelName: meta.threadName,
              parentChannelName: "parent" in thread && thread.parent && "name" in thread.parent ? thread.parent.name ?? null : null,
              guildName: thread.guild?.name ?? null,
              archived: meta.archived,
              locked: meta.locked,
              autoArchiveDuration: meta.autoArchiveDuration,
            },
          },
          message: {
            parentMessageId: meta.starterMessageId,
            meta: {
              source: "thread_create",
            },
          },
          meta: {
            isThread: true,
            threadCreate: true,
            threadName: meta.threadName,
            channelName: meta.threadName,
            parentChannelName: "parent" in thread && thread.parent && "name" in thread.parent ? thread.parent.name ?? null : null,
            guildName: thread.guild?.name ?? null,
            parentId: meta.parentId,
          },
        });
      } catch (error) {
        console.error(`[Discord:${this.channelId}] Failed to inspect thread create:`, error);
      }
    });

    this.client.on(Events.MessageCreate, async (message: Message) => {
      const channelType = `${message.channel?.type ?? "unknown"}`;
      const isDM = message.channel?.isDMBased?.() ?? false;
      const isThread = message.channel?.isThread?.() ?? false;
      const parentConversationId = isThread && "parentId" in message.channel ? (message.channel.parentId ?? null) : null;
      let parentMessageId = message.reference?.messageId ?? null;

      if (isThread && !parentMessageId && "fetchStarterMessage" in message.channel) {
        const starter = await (message.channel as AnyThreadChannel & { fetchStarterMessage?: () => Promise<Message | null> })
          .fetchStarterMessage?.()
          .catch(() => null);
        parentMessageId = starter?.id ?? null;
      }

      console.log(`[Discord:${this.channelId}] MessageCreate event observed:`, {
        messageId: message.id,
        authorId: message.author?.id,
        authorTag: message.author?.tag,
        authorBot: message.author?.bot,
        channelId: message.channelId,
        channelType,
        guildId: message.guildId || "DM",
        isDM,
        isThread,
        partial: message.partial,
        contentLength: message.content?.length ?? 0,
        attachments: message.attachments.size,
      });

      if (message.author.bot) {
        console.log(`[Discord:${this.channelId}] Ignoring bot-authored message ${message.id}`);
        return;
      }

      const accepted = await shouldAcceptDiscordInboundMessage(this.channelId, message);
      if (!accepted) {
        console.log(`[Discord:${this.channelId}] Ignoring message ${message.id}: mention required by inbound config`);
        return;
      }

      console.log(`[Discord:${this.channelId}] ← Message received:`, {
        author: `${message.author.tag} (${message.author.id})`,
        channelId: message.channelId,
        guildId: message.guildId || "DM",
        channelType,
        bindingKey: buildDiscordBindingKey(message),
        content: message.content.slice(0, 100) + (message.content.length > 100 ? "..." : ""),
        attachments: message.attachments.size,
      });

      const content: UnifiedContentBlock[] = [{ type: "text", text: message.content }];

      for (const attachment of message.attachments.values()) {
        if (attachment.contentType?.startsWith("image/")) {
          content.push({ type: "image", uri: attachment.url });
          console.log(`[Discord:${this.channelId}] Attachment: ${attachment.name} (${attachment.contentType})`);
        } else {
          console.log(
            `[Discord:${this.channelId}] Non-image attachment ignored: ${attachment.name || "unnamed"} (${attachment.contentType || "unknown"})`,
          );
        }
      }

      const inboundEvent: GatewayInboundEvent = {
        eventId: randomUUID(),
        timestamp: Date.now(),
        channelId: this.channelId,
        provider: "discord",
        externalChatId: message.channelId,
        externalMessageId: message.id,
        bindingKey: buildDiscordBindingKey(message),
        conversation: {
          id: message.channelId,
          parentId: parentConversationId,
          meta: {
            guildId: message.guildId ?? null,
            channelType,
            isDm: isDM,
            isThread,
            threadName: "name" in message.channel ? message.channel.name ?? null : null,
            channelName: "name" in message.channel ? message.channel.name ?? null : null,
            parentChannelName:
              isThread && "parent" in message.channel && message.channel.parent && "name" in message.channel.parent
                ? message.channel.parent.name ?? null
                : null,
            guildName: message.guild?.name ?? null,
          },
        },
        message: {
          parentMessageId,
          meta: {
            discordMessageType: message.type,
            reference: message.reference
              ? {
                  messageId: message.reference.messageId ?? null,
                  channelId: message.reference.channelId ?? null,
                  guildId: message.reference.guildId ?? null,
                }
              : null,
            attachments: message.attachments.map((attachment) => ({
              id: attachment.id,
              name: attachment.name,
              contentType: attachment.contentType,
              size: attachment.size,
              url: attachment.url,
            })),
          },
        },
        sender: {
          id: message.author.id,
          name: message.author.username,
        },
        content,
        meta: {
          guildId: message.guildId ?? null,
          channelId: message.channelId,
          channelType,
          isDm: isDM,
          isThread,
          threadParentId: parentConversationId,
          channelName: "name" in message.channel ? message.channel.name ?? null : null,
          parentChannelName:
            isThread && "parent" in message.channel && message.channel.parent && "name" in message.channel.parent
              ? message.channel.parent.name ?? null
              : null,
          guildName: message.guild?.name ?? null,
        },
      };

      console.log(`[Discord:${this.channelId}] → Publishing inbound event ${inboundEvent.eventId.slice(0, 8)}`, {
        externalChatId: inboundEvent.externalChatId,
        externalMessageId: inboundEvent.externalMessageId,
        bindingKey: inboundEvent.bindingKey,
        blockTypes: inboundEvent.content.map((block) => block.type).join(","),
      });
      await publishInboundEvent(inboundEvent);
      console.log(`[Discord:${this.channelId}] ✓ Inbound event published ${inboundEvent.eventId.slice(0, 8)}`);
    });
  }

  public async handleOutbound(cmd: GatewayOutboundCommand) {
    console.log(`[Discord:${this.channelId}] → Sending message to ${cmd.externalChatId}:`, {
      contentPreview: cmd.content.map((c) => (c.type === "text" ? c.text?.slice(0, 30) : c.type)).join(", "),
      replyTo: cmd.replyToExternalMessageId?.slice(0, 8) || "none",
      sessionMessageId: cmd.sessionMessageId ?? "none",
    });

    try {
      const channel = await this.client.channels.fetch(cmd.externalChatId);
      if (!channel) {
        console.error(`[Discord:${this.channelId}] Channel not found: ${cmd.externalChatId}`);
        return { success: false as const, error: `Channel not found: ${cmd.externalChatId}` };
      }
      if (!channel.isTextBased()) {
        console.error(`[Discord:${this.channelId}] Channel is not text-based: ${cmd.externalChatId}`);
        return { success: false as const, error: `Channel is not text-based: ${cmd.externalChatId}` };
      }

      const { text, imageUris } = await buildDiscordOutboundPayload(this.channelId, {
        ...cmd,
        meta: {
          ...(cmd.meta ?? {}),
          displayMode: resolveDiscordDisplayMode(cmd),
        },
      });
      const content = truncate(text || "(empty message)", 1900);
      const files = imageUris;
      const textChannel = channel as TextBasedChannel;

      const editTargetMessageId = typeof cmd.meta?.editExternalMessageId === "string"
        ? cmd.meta.editExternalMessageId
        : undefined;

      if (editTargetMessageId && "messages" in textChannel) {
        const target = await textChannel.messages.fetch(editTargetMessageId).catch(() => null);
        if (target) {
          await target.edit({ content });
          console.log(`[Discord:${this.channelId}] ✓ Message edited successfully: ${target.id}`);
          return { success: true as const, externalMessageId: target.id };
        }
      }

      if (!("send" in textChannel)) {
        console.error(`[Discord:${this.channelId}] Channel ${cmd.externalChatId} does not support sending messages`);
        return { success: false as const, error: "Channel does not support sending messages" };
      }

      const messageOptions: MessageCreateOptions = { content, files };
      if (cmd.replyToExternalMessageId) {
        messageOptions.reply = { messageReference: cmd.replyToExternalMessageId };
      }

      const sendableChannel = textChannel as Extract<typeof textChannel, { send: (options: MessageCreateOptions) => Promise<unknown> }>;
      const sentMsg = (await sendableChannel.send(messageOptions)) as { id: string };
      console.log(`[Discord:${this.channelId}] ✓ Message sent successfully: ${sentMsg.id}`);
      return { success: true as const, externalMessageId: sentMsg.id };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error(`[Discord:${this.channelId}] ✗ Failed to send message:`, errorMessage);
      if (error instanceof Error && error.stack) {
        console.error(`[Discord:${this.channelId}] Stack trace:`, error.stack.split("\n").slice(0, 3).join("\n"));
      }
      return { success: false as const, error: errorMessage };
    }
  }

  public destroy() {
    console.log(`[Discord:${this.channelId}] Destroying Discord client...`);
    this.client.destroy();
    this.isConnected = false;
    console.log(`[Discord:${this.channelId}] Discord client destroyed`);
  }
}
