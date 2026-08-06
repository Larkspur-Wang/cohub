import { Client, GatewayIntentBits, Partials, type AllowedMentionsTypes, type AnyThreadChannel, type CommandInteraction, type Message, Events, type MessageCreateOptions, type TextBasedChannel } from "discord.js";
import { randomUUID } from "node:crypto";
import type { ContentBlock } from "@cohub/protocol/core";
import type { DiscordChannelConfig, GatewayInboundEvent } from "@cohub/protocol/gateway";
import type { PlannedGatewayOutboundCommand } from "@cohub/protocol/gateway";
import type { GatewayProvider } from "../base.js";
import { GATEWAY_CHANNEL_COMMAND_SPECS } from "@cohub/protocol/gateway";
import { resolveChannelCommand } from "../../channel-commands.js";
import { publishConversationCreateEvent, publishInboundEvent } from "../../bus.js";
import { getSpaceChannelConfig, getTurnMessageExternalRef, setTurnMessageExternalRef } from "../../redis.js";
import { buildDiscordDeliveryPlan } from "../../session-output-planner.js";
import { createLogger } from "@cohub/infra/logging";
import {
  downloadInboundUrl,
  ensureImageMediaType,
  ingestInboundMedia,
  type InboundDownloadedFile,
  type InboundDownloadedImage,
} from "../../media/inbound-attachments.js";
import {
  classifyAttachmentKind,
  imageExtensionFromMimeType,
  sanitizeFilename,
} from "../../media/mime.js";
import {
  markChannelConnecting,
  markChannelDegraded,
  markChannelError,
  markChannelReady
} from "../../channel-health.js";

const logger = createLogger({ serviceName: "cohub-gateway" });
const DISCORD_INBOUND_IMAGE_MAX_BYTES = 10 * 1024 * 1024;
const DISCORD_INBOUND_FILE_MAX_BYTES = 50 * 1024 * 1024;
const DISCORD_INBOUND_IMAGE_MAX_COUNT = 8;
const DISCORD_INBOUND_FILE_MAX_COUNT = 8;
const DISCORD_DOWNLOAD_ALLOWED_HOST_SUFFIXES = ["discordapp.com", "discordapp.net", "discord.com", "discord.gg", "discordcdn.com"];
const DISCORD_DOWNLOAD_TIMEOUT_MS = 15_000;
const buildDiscordBindingKey = (message: Message) => {
  return `discord:conversation:${message.channelId}`;
};

const buildDiscordBindingKeyForChannel = (channelId: string) => `discord:conversation:${channelId}`;

const DISCORD_NATIVE_COMMAND_MESSAGE_PREFIX = "interaction:";
const DISCORD_RAW_EVENT_MAX_ENTRIES = 1_000;

const buildDiscordSourceChannel = (input: {
  isDM: boolean;
  senderName: string;
  senderId: string;
  guildName?: string | null;
  channelName?: string | null;
  parentChannelName?: string | null;
  threadName?: string | null;
  fallbackId: string;
}) => {
  if (input.isDM) {
    return `discord:dm:${input.senderName || input.senderId}`;
  }
  if (input.threadName && input.parentChannelName && input.guildName) {
    return `discord:${input.guildName}:#${input.parentChannelName}>${input.threadName}`;
  }
  if (input.channelName && input.guildName) {
    return `discord:${input.guildName}:#${input.channelName}`;
  }
  if (input.guildName) {
    return `discord:${input.guildName}`;
  }
  return `discord:${input.fallbackId}`;
};

const DISCORD_ALLOWED_MENTIONS = { parse: [] as AllowedMentionsTypes[] };

const getDiscordInboundConfig = (config: DiscordChannelConfig | null | undefined) => {
  const inbound = config?.inbound ?? {};
  return {
    requireMentionInGuild: inbound.requireMentionInGuild !== false,
  };
};

/**
 * Resolve Discord mention patterns to readable names.
 * Converts <@USER_ID> → @username, <@&ROLE_ID> → @role, <#CHANNEL_ID> → #channel.
 * Bot's own mention is stripped entirely.
 */
const resolveMentions = (message: Message): string => {
  let content = message.content;
  const botUserId = message.client.user?.id;

  // Build a map of all mention IDs → display names, sorted by ID length descending
  // to avoid partial matches (e.g. shorter ID matching inside a longer one)
  const replacements: Map<string, string> = new Map();

  // Guild members have display names (nicknames), fall back to user.username
  for (const [id, member] of message.mentions.members ?? []) {
    const prefix = id === botUserId ? "__BOT__" : "@";
    replacements.set(id, `${prefix}${member.displayName}`);
  }
  // Users not in members (e.g. DMs)
  for (const [id, user] of message.mentions.users) {
    if (!replacements.has(id)) {
      const prefix = id === botUserId ? "__BOT__" : "@";
      replacements.set(id, `${prefix}${user.username}`);
    }
  }
  // Roles
  for (const [id, role] of message.mentions.roles ?? []) {
    replacements.set(`&${id}`, `@${role.name}`);
  }
  // Channels
  for (const [id, channel] of message.mentions.channels ?? []) {
    replacements.set(`#${id}`, `#${"name" in channel ? channel.name : id}`);
  }

  // Replace mentions by building a single regex, sorted by ID length descending
  const sortedEntries = [...replacements.entries()].sort(
    (a, b) => b[0].length - a[0].length,
  );

  for (const [id, name] of sortedEntries) {
    if (name.startsWith("__BOT__")) {
      // Strip bot mention entirely
      content = content.replace(new RegExp(`<@!?${id}>`, "g"), "");
    } else {
      const isUser = !id.startsWith("&") && !id.startsWith("#");
      const rawId = isUser ? id : id.slice(1);
      const pattern = isUser ? "<@!?(\\d+)>" : id.startsWith("&") ? "<@&(\\d+)>" : "<#(\\d+)>";
      content = content.replace(new RegExp(pattern, "g"), (match, capturedId) => {
        return capturedId === rawId ? name : match;
      });
    }
  }

  return content.replace(/\s{2,}/g, " ").trim();
};

const shouldAcceptDiscordInboundMessage = async (channelId: string, message: Message) => {
  const isDM = message.channel?.isDMBased?.() ?? false;
  if (isDM) return true;

  const channelConfig = await getSpaceChannelConfig<DiscordChannelConfig>(channelId);
  const inboundConfig = getDiscordInboundConfig(channelConfig);
  if (!inboundConfig.requireMentionInGuild) return true;

  const botUserId = message.client.user?.id;
  if (!botUserId) return false;
  return message.mentions.users.has(botUserId);
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

export class DiscordProvider implements GatewayProvider {
  private client: Client;
  private channelId: string; // 在我们的数据库中定义的该 Channel 实体 ID

  constructor(channelId: string, token: string) {
    this.channelId = channelId;
    logger.info(`[Discord:${channelId}] Creating Discord client...`);

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
    logger.info(`[Discord:${channelId}] Logging in with token...`);
    this.client.login(token).catch((err) => {
      logger.error(`[Discord:${channelId}] Login failed:`, err);
      void markChannelError(channelId, err).catch(() => undefined);
    });
  }

  private readonly rawInboundEvents = new Map<string, unknown>();

  private storeRawInboundEvent(id: string, event: unknown) {
    if (this.rawInboundEvents.size >= DISCORD_RAW_EVENT_MAX_ENTRIES) {
      const oldestId = this.rawInboundEvents.keys().next().value;
      if (oldestId) this.rawInboundEvents.delete(oldestId);
    }
    this.rawInboundEvents.set(id, event);
  }

  private takeRawInboundEvent(id: string) {
    const event = this.rawInboundEvents.get(id);
    this.rawInboundEvents.delete(id);
    return event;
  }

  private setupListeners() {
    this.client.on(Events.Raw, (packet) => {
      if ((packet.t === "MESSAGE_CREATE" || packet.t === "INTERACTION_CREATE") && typeof packet.d?.id === "string") {
        this.storeRawInboundEvent(packet.d.id, packet);
      }
    });

    this.client.on(Events.ClientReady, (readyClient) => {
      logger.info(`[Discord:${this.channelId}] ✓ Connected as ${readyClient.user.tag} (${readyClient.user.id})`);
      logger.info(`[Discord:${this.channelId}] Guilds: ${readyClient.guilds.cache.size}`);
      if (readyClient.guilds.cache.size > 0) {
        logger.info(`[Discord:${this.channelId}] Guild names: ${readyClient.guilds.cache.map((g) => g.name).join(", ")}`);
      }

      const intents = Array.isArray(this.client.options.intents)
        ? this.client.options.intents.join(",")
        : this.client.options.intents.toArray().join(",");
      const partials = (this.client.options.partials ?? []).join(",") || "none";
      logger.info(`[Discord:${this.channelId}] Client options: intents=${intents}, partials=${partials}`);
      logger.info(`[Discord:${this.channelId}] DM debugging enabled. Waiting for MessageCreate events...`);
      void markChannelReady(this.channelId, {
        meta: {
          botTag: readyClient.user.tag,
          botId: readyClient.user.id,
          guildCount: readyClient.guilds.cache.size,
        },
      }).catch(() => undefined);
      this.registerNativeCommands().catch((error) => {
        logger.warn(`[Discord:${this.channelId}] Failed to register native commands:`, error);
      });
    });

    this.client.on(Events.Debug, (message) => {
      if (process.env.DEBUG_MODE === "true") {
        logger.info(`[Discord:${this.channelId}] Debug: ${message}`);
      }
    });

    this.client.on(Events.Warn, (message) => {
      logger.warn(`[Discord:${this.channelId}] Warn: ${message}`);
    });

    this.client.on(Events.Error, (error) => {
      logger.error(`[Discord:${this.channelId}] Error:`, error);
      void markChannelDegraded(this.channelId, error).catch(() => undefined);
    });

    this.client.on("disconnect", () => {
      logger.warn(`[Discord:${this.channelId}] Disconnected from Discord`);
      void markChannelDegraded(this.channelId, "Disconnected from Discord").catch(() => undefined);
    });

    this.client.on("reconnecting", () => {
      logger.info(`[Discord:${this.channelId}] Reconnecting to Discord...`);
      void markChannelConnecting(this.channelId).catch(() => undefined);
    });

    this.client.on(Events.ShardReady, (shardId) => {
      logger.info(`[Discord:${this.channelId}] Shard ready: ${shardId}`);
      void markChannelReady(this.channelId).catch(() => undefined);
    });

    this.client.on(Events.ShardResume, (shardId, replayedEvents) => {
      logger.info(`[Discord:${this.channelId}] Shard resumed: ${shardId}, replayedEvents=${replayedEvents}`);
      void markChannelReady(this.channelId).catch(() => undefined);
    });

    this.client.on(Events.ShardDisconnect, (closeEvent, shardId) => {
      logger.warn(
        `[Discord:${this.channelId}] Shard disconnected: shard=${shardId}, code=${closeEvent.code}, reason=${closeEvent.reason || "unknown"}`,
      );
      void markChannelDegraded(
        this.channelId,
        `Shard disconnected: code=${closeEvent.code}, reason=${closeEvent.reason || "unknown"}`,
      ).catch(() => undefined);
    });

    this.client.on(Events.ThreadCreate, async (thread) => {
      try {
        const meta = await buildThreadConversationMeta(thread);
        logger.info(`[Discord:${this.channelId}] ThreadCreate observed`, {
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
          bindingKey: buildDiscordBindingKeyForChannel(thread.id),
          binding: {
            key: buildDiscordBindingKeyForChannel(thread.id),
            parentKey: meta.parentId ? buildDiscordBindingKeyForChannel(meta.parentId) : null,
          },
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
        logger.error(`[Discord:${this.channelId}] Failed to inspect thread create:`, error);
      }
    });

    this.client.on(Events.InteractionCreate, async (interaction) => {
      const providerEvent = this.takeRawInboundEvent(interaction.id);
      if (!interaction.isChatInputCommand()) return;
      await this.handleCommandInteraction(interaction, providerEvent);
    });

    this.client.on(Events.MessageCreate, async (message: Message) => {
      const providerEvent = this.takeRawInboundEvent(message.id);
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

      logger.info(`[Discord:${this.channelId}] MessageCreate event observed:`, {
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
        logger.info(`[Discord:${this.channelId}] Ignoring bot-authored message ${message.id}`);
        return;
      }

      const accepted = await shouldAcceptDiscordInboundMessage(this.channelId, message);
      if (!accepted) {
        logger.info(`[Discord:${this.channelId}] Ignoring message ${message.id}: mention required by inbound config`);
        return;
      }

      logger.info(`[Discord:${this.channelId}] ← Message received:`, {
        author: `${message.author.tag} (${message.author.id})`,
        channelId: message.channelId,
        guildId: message.guildId || "DM",
        channelType,
        bindingKey: buildDiscordBindingKey(message),
        content: message.content.slice(0, 100) + (message.content.length > 100 ? "..." : ""),
        attachments: message.attachments.size,
      });

      if ("sendTyping" in message.channel) {
        await message.channel.sendTyping().catch((error) => {
          logger.warn(`[Discord:${this.channelId}] Failed to send typing indicator:`, error);
        });
      }

      const cleanedContent = resolveMentions(message);
      const content: ContentBlock[] = [{ type: "text", text: cleanedContent }];
      const channelCommand = resolveChannelCommand(cleanedContent);
      const channelName = "name" in message.channel ? message.channel.name ?? null : null;
      const parentChannelName =
        isThread && "parent" in message.channel && message.channel.parent && "name" in message.channel.parent
          ? message.channel.parent.name ?? null
          : null;
      const sourceChannel = buildDiscordSourceChannel({
        isDM,
        senderName: message.author.username,
        senderId: message.author.id,
        guildName: message.guild?.name ?? null,
        channelName,
        parentChannelName,
        threadName: channelName,
        fallbackId: message.channelId,
      });

      const bindingKey = buildDiscordBindingKey(message);
      const inboundEventBase = {
        eventId: randomUUID(),
        timestamp: Date.now(),
        channelId: this.channelId,
        provider: "discord" as const,
        externalChatId: message.channelId,
        externalMessageId: message.id,
        bindingKey,
        binding: {
          key: bindingKey,
          parentKey: parentConversationId ? buildDiscordBindingKeyForChannel(parentConversationId) : null,
        },
        conversation: {
          id: message.channelId,
          parentId: parentConversationId,
          meta: {
            guildId: message.guildId ?? null,
            channelType,
            isDm: isDM,
            isThread,
            threadName: channelName,
            channelName,
            parentChannelName,
            guildName: message.guild?.name ?? null,
            sourceChannel,
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
        providerEvent,
        meta: {
          guildId: message.guildId ?? null,
          channelId: message.channelId,
          channelType,
          isDm: isDM,
          isThread,
          threadParentId: parentConversationId,
          channelName,
          parentChannelName,
          guildName: message.guild?.name ?? null,
          sourceChannel,
        },
      };
      const inboundEventBaseWithType = channelCommand
        ? { ...inboundEventBase, eventType: "channel_command" as const, command: channelCommand }
        : { ...inboundEventBase, eventType: "message_create" as const };
      const mediaBlocks = await this.buildInboundMediaBlocks(message, inboundEventBaseWithType as GatewayInboundEvent);
      const inboundEvent: GatewayInboundEvent = {
        ...inboundEventBaseWithType,
        content: [...inboundEventBase.content, ...mediaBlocks],
      };

      if (channelCommand) {
        logger.info(`[Discord:${this.channelId}] → Publishing command event ${inboundEvent.eventId.slice(0, 8)}`, {
          externalChatId: inboundEvent.externalChatId,
          externalMessageId: inboundEvent.externalMessageId,
          command: channelCommand.name,
        });
        await publishInboundEvent(inboundEvent);
        return;
      }

      logger.info(`[Discord:${this.channelId}] → Publishing inbound event ${inboundEvent.eventId.slice(0, 8)}`, {
        externalChatId: inboundEvent.externalChatId,
        externalMessageId: inboundEvent.externalMessageId,
        bindingKey: inboundEvent.bindingKey,
        blockTypes: inboundEvent.content.map((block) => block.type).join(","),
      });
      await publishInboundEvent(inboundEvent);
      logger.info(`[Discord:${this.channelId}] ✓ Inbound event published ${inboundEvent.eventId.slice(0, 8)}`);
    });
  }

  private async buildInboundMediaBlocks(message: Message, event: GatewayInboundEvent): Promise<ContentBlock[]> {
    if (message.attachments.size === 0) return [];

    const images: InboundDownloadedImage[] = [];
    const files: InboundDownloadedFile[] = [];
    const blocks: ContentBlock[] = [];
    let imageSeen = 0;
    let fileSeen = 0;

    for (const attachment of message.attachments.values()) {
      const sourceUrl = attachment.url || attachment.proxyURL;
      if (!sourceUrl) continue;
      const kind = classifyAttachmentKind({
        contentType: attachment.contentType,
        filename: attachment.name,
        url: sourceUrl,
        preferImageWhenUnknown: false,
      });
      const label = kind === "image" ? "image" : "file";
      const maxBytes = kind === "image" ? DISCORD_INBOUND_IMAGE_MAX_BYTES : DISCORD_INBOUND_FILE_MAX_BYTES;

      if (kind === "image") {
        imageSeen += 1;
        if (imageSeen > DISCORD_INBOUND_IMAGE_MAX_COUNT) {
          blocks.push({ type: "text", text: "[Image skipped: too many images]", _meta: { source: "discord", originalUrl: sourceUrl } });
          continue;
        }
      } else {
        fileSeen += 1;
        if (fileSeen > DISCORD_INBOUND_FILE_MAX_COUNT) {
          blocks.push({ type: "text", text: "[File skipped: too many files]", _meta: { source: "discord", originalUrl: sourceUrl } });
          continue;
        }
      }

      try {
        const downloaded = await downloadInboundUrl({
          url: sourceUrl,
          maxBytes,
          label: `discord:${this.channelId}:${label}`,
          allowedHosts: DISCORD_DOWNLOAD_ALLOWED_HOST_SUFFIXES,
          timeoutMs: DISCORD_DOWNLOAD_TIMEOUT_MS,
        });
        if (kind === "image") {
          const mediaType = ensureImageMediaType(downloaded.buffer, attachment.contentType ?? downloaded.mediaType);
          images.push({
            id: `image-${images.length}`,
            buffer: downloaded.buffer,
            mediaType,
            filename: sanitizeFilename(attachment.name, `discord-image-${images.length + 1}.${imageExtensionFromMimeType(mediaType)}`),
            originalUrl: sourceUrl,
          });
        } else {
          const name = sanitizeFilename(attachment.name, `discord-file-${files.length + 1}`);
          files.push({
            id: `file-${files.length}`,
            buffer: downloaded.buffer,
            mediaType: attachment.contentType ?? downloaded.mediaType,
            name,
            relativePath: name,
            originalUrl: sourceUrl,
          });
        }
        logger.info(`[Discord:${this.channelId}] Attachment queued for ingest: ${attachment.name || "unnamed"} (${attachment.contentType || kind})`);
      } catch (error) {
        logger.warn(`[Discord:${this.channelId}] attachment download failed`, { name: attachment.name, url: sourceUrl, error });
        blocks.push({
          type: "text",
          text: kind === "image" ? "[Image unavailable]" : `[Attachment unavailable: ${sanitizeFilename(attachment.name, "file")}]`,
          _meta: { source: "discord", originalUrl: sourceUrl, reason: "download_failed" },
        });
      }
    }

    if (images.length === 0 && files.length === 0) return blocks;
    const ingested = await ingestInboundMedia({
      event,
      source: "discord",
      images,
      files,
      label: `discord:${this.channelId}`,
    });
    return [...blocks, ...ingested.blocks];
  }

  private async registerNativeCommands() {
    if (!this.client.application) {
      logger.warn(`[Discord:${this.channelId}] Application unavailable; native command registration skipped`);
      return;
    }

    await this.client.application.commands.set(GATEWAY_CHANNEL_COMMAND_SPECS.map((command) => ({
      name: command.name,
      description: command.description,
    })));
    logger.info(`[Discord:${this.channelId}] Native commands registered: ${GATEWAY_CHANNEL_COMMAND_SPECS.map((command) => command.slash).join(", ")}`);
  }

  private async handleCommandInteraction(interaction: CommandInteraction, providerEvent: unknown) {
    const command = resolveChannelCommand(`/${interaction.commandName}`);
    if (!command) return;

    const channelId = interaction.channelId;
    const channel = interaction.channel;
    const isDM = channel?.isDMBased?.() ?? !interaction.guildId;
    const isThread = channel?.isThread?.() ?? false;
    const parentConversationId = isThread && channel && "parentId" in channel ? (channel.parentId ?? null) : null;
    const channelName = channel && "name" in channel ? channel.name ?? null : null;
    const parentChannelName =
      isThread && channel && "parent" in channel && channel.parent && "name" in channel.parent
        ? channel.parent.name ?? null
        : null;
    const sourceChannel = buildDiscordSourceChannel({
      isDM,
      senderName: interaction.user.username,
      senderId: interaction.user.id,
      guildName: interaction.guild?.name ?? null,
      channelName,
      parentChannelName,
      threadName: channelName,
      fallbackId: channelId,
    });

    if (!interaction.deferred && !interaction.replied) {
      await interaction.reply({ content: "Command received.", ephemeral: true }).catch((error) => {
        logger.warn(`[Discord:${this.channelId}] Failed to acknowledge command interaction:`, error);
      });
    }

    const inboundEvent: GatewayInboundEvent = {
      eventId: randomUUID(),
      timestamp: Date.now(),
      eventType: "channel_command",
      channelId: this.channelId,
      provider: "discord",
      externalChatId: channelId,
      externalMessageId: `${DISCORD_NATIVE_COMMAND_MESSAGE_PREFIX}${interaction.id}`,
      bindingKey: buildDiscordBindingKeyForChannel(channelId),
      binding: {
        key: buildDiscordBindingKeyForChannel(channelId),
        parentKey: parentConversationId ? buildDiscordBindingKeyForChannel(parentConversationId) : null,
      },
      command,
      conversation: {
        id: channelId,
        parentId: parentConversationId,
        meta: {
          guildId: interaction.guildId ?? null,
          channelType: channel ? `${channel.type}` : "unknown",
          isDm: isDM,
          isThread,
          threadName: channelName,
          channelName,
          parentChannelName,
          guildName: interaction.guild?.name ?? null,
          sourceChannel,
        },
      },
      message: {
        parentMessageId: null,
        meta: {
          interactionId: interaction.id,
          commandName: interaction.commandName,
          source: "discord_native_command",
        },
      },
      sender: {
        id: interaction.user.id,
        name: interaction.user.username,
      },
      content: [{ type: "text", text: `/${interaction.commandName}` }],
      providerEvent,
      meta: {
        guildId: interaction.guildId ?? null,
        channelId,
        channelType: channel ? `${channel.type}` : "unknown",
        isDm: isDM,
        isThread,
        threadParentId: parentConversationId,
        channelName,
        parentChannelName,
        guildName: interaction.guild?.name ?? null,
        sourceChannel,
        commandSource: "native",
      },
    };

    logger.info(`[Discord:${this.channelId}] → Publishing native command event ${inboundEvent.eventId.slice(0, 8)}`, {
      externalChatId: inboundEvent.externalChatId,
      externalMessageId: inboundEvent.externalMessageId,
      command: command.name,
    });
    await publishInboundEvent(inboundEvent);
  }

  public async handleOutbound(cmd: PlannedGatewayOutboundCommand) {
    logger.info(`[Discord:${this.channelId}] → Sending message to ${cmd.externalChatId}:`, {
      contentPreview: cmd.content.map((c: { type: string; text?: string }) => (c.type === "text" ? c.text?.slice(0, 30) : c.type)).join(", "),
      replyTo: cmd.replyToExternalMessageId?.slice(0, 8) || "none",
      sessionMessageId: cmd.sessionMessageId ?? "none",
    });

    try {
      const channel = await this.client.channels.fetch(cmd.externalChatId);
      if (!channel) {
        logger.error(`[Discord:${this.channelId}] Channel not found: ${cmd.externalChatId}`);
        return { success: false as const, error: `Channel not found: ${cmd.externalChatId}` };
      }
      if (!channel.isTextBased()) {
        logger.error(`[Discord:${this.channelId}] Channel is not text-based: ${cmd.externalChatId}`);
        return { success: false as const, error: `Channel is not text-based: ${cmd.externalChatId}` };
      }

      const channelConfig = await getSpaceChannelConfig<DiscordChannelConfig>(this.channelId);
      const plan = cmd.deliveryPlan?.adapter === "discord"
        ? cmd.deliveryPlan
        : await buildDiscordDeliveryPlan(cmd, channelConfig);
      const files = plan.files;
      const textChannel = channel as TextBasedChannel;
      const hasRenderableContent = Boolean(plan.primaryText.trim()) || files.length > 0;

      if (plan.mode === "upsert" && !hasRenderableContent) {
        logger.info(`[Discord:${this.channelId}] Skipping empty rich_status update`, {
          commandId: cmd.commandId,
          sessionMessageId: cmd.sessionMessageId ?? "none",
        });
        return { success: true as const };
      }

      const turnAnchorMessageId = plan.turnAnchorMessageId?.trim() || "";
      const cachedTurnMessageId = turnAnchorMessageId
        ? await getTurnMessageExternalRef(this.channelId, turnAnchorMessageId).catch(() => null)
        : null;
      const editTargetMessageId = plan.preferredEditExternalMessageId?.trim().length
        ? plan.preferredEditExternalMessageId
        : (cachedTurnMessageId ?? undefined);

      if (!plan.primaryText && files.length === 0) {
        logger.info(`[Discord:${this.channelId}] Skipping empty outbound message`, {
          commandId: cmd.commandId,
          renderMode: plan.mode,
          source: typeof cmd.meta?.source === "string" ? cmd.meta.source : "unknown",
          sessionMessageId: cmd.sessionMessageId ?? "none",
        });
        return { success: true as const };
      }

      if (editTargetMessageId && "messages" in textChannel && plan.primaryText) {
        const target = await textChannel.messages.fetch(editTargetMessageId).catch(() => null);
        if (target) {
          await target.edit({ content: plan.primaryText, allowedMentions: DISCORD_ALLOWED_MENTIONS });
          if (turnAnchorMessageId) {
            await setTurnMessageExternalRef(this.channelId, turnAnchorMessageId, target.id).catch((error) => logger.error("[Discord] failed to persist edited turn message ref", { channelId: this.channelId, turnAnchorMessageId, externalMessageId: target.id, error }));
          }

          if (plan.continuationChunks.length > 0) {
            let previousMessageId = target.id;
            for (const chunk of plan.continuationChunks) {
              const continuationOptions: MessageCreateOptions = {
                content: chunk,
                files: [],
                allowedMentions: DISCORD_ALLOWED_MENTIONS,
                reply: { messageReference: previousMessageId },
              };
              const continuation = (await (textChannel as Extract<typeof textChannel, { send: (options: MessageCreateOptions) => Promise<unknown> }>).send(continuationOptions)) as { id: string };
              previousMessageId = continuation.id;
            }
          }

          logger.info(`[Discord:${this.channelId}] ✓ Message edited successfully: ${target.id}`);
          return { success: true as const, externalMessageId: target.id };
        }
      }

      if (!("send" in textChannel)) {
        logger.error(`[Discord:${this.channelId}] Channel ${cmd.externalChatId} does not support sending messages`);
        return { success: false as const, error: "Channel does not support sending messages" };
      }

      const messageOptions: MessageCreateOptions = { content: plan.primaryText, files, allowedMentions: DISCORD_ALLOWED_MENTIONS };
      if (plan.replyToExternalMessageId && !plan.replyToExternalMessageId.startsWith(DISCORD_NATIVE_COMMAND_MESSAGE_PREFIX)) {
        messageOptions.reply = { messageReference: plan.replyToExternalMessageId };
      }

      const sendableChannel = textChannel as Extract<typeof textChannel, { send: (options: MessageCreateOptions) => Promise<unknown> }>;
      const sentMsg = (await sendableChannel.send(messageOptions)) as { id: string };
      if (turnAnchorMessageId) {
        await setTurnMessageExternalRef(this.channelId, turnAnchorMessageId, sentMsg.id).catch((error) => logger.error("[Discord] failed to persist sent turn message ref", { channelId: this.channelId, turnAnchorMessageId, externalMessageId: sentMsg.id, error }));
      }

      let previousMessageId = sentMsg.id;
      for (const chunk of plan.continuationChunks) {
        const continuationOptions: MessageCreateOptions = {
          content: chunk,
          files: [],
          allowedMentions: DISCORD_ALLOWED_MENTIONS,
          reply: { messageReference: previousMessageId },
        };
        const continuation = (await sendableChannel.send(continuationOptions)) as { id: string };
        previousMessageId = continuation.id;
      }

      logger.info(`[Discord:${this.channelId}] ✓ Message sent successfully: ${sentMsg.id}`);
      return { success: true as const, externalMessageId: sentMsg.id };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error(`[Discord:${this.channelId}] ✗ Failed to send message:`, errorMessage);
      if (error instanceof Error && error.stack) {
        logger.error(`[Discord:${this.channelId}] Stack trace:`, error.stack.split("\n").slice(0, 3).join("\n"));
      }
      return { success: false as const, error: errorMessage };
    }
  }

  public destroy() {
    logger.info(`[Discord:${this.channelId}] Destroying Discord client...`);
    this.client.destroy();
    logger.info(`[Discord:${this.channelId}] Discord client destroyed`);
  }
}
