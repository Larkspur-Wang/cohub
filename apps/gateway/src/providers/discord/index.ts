import { Client, GatewayIntentBits, Partials, type Message, Events, type MessageCreateOptions } from "discord.js";
import { randomUUID } from "node:crypto";
import type { GatewayInboundEvent, GatewayOutboundCommand, UnifiedContentBlock } from "@cohub/protocol";
import { publishInboundEvent } from "../../bus.js";

const buildDiscordBindingKey = (message: Message) => {
  const channel = message.channel;

  if (channel.isThread()) {
    return `discord:thread:${channel.id}`;
  }

  if (channel.isDMBased() && !message.guildId) {
    return `discord:dm:${channel.id}`;
  }

  return `discord:channel:${channel.id}`;
};

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

    this.client.on(Events.MessageCreate, async (message: Message) => {
      const channelType = `${message.channel?.type ?? "unknown"}`;
      const isDM = message.channel?.isDMBased?.() ?? false;
      const isThread = message.channel?.isThread?.() ?? false;

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
        sender: {
          id: message.author.id,
          name: message.author.username,
        },
        content,
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

      if (!("send" in channel)) {
        console.error(`[Discord:${this.channelId}] Channel ${cmd.externalChatId} does not support sending messages`);
        return { success: false as const, error: "Channel does not support sending messages" };
      }

      const texts = cmd.content
        .filter((block): block is { type: "text"; text: string } => block.type === "text")
        .map((block) => block.text)
        .join("\n");

      const files = cmd.content
        .filter((block): block is { type: "image"; uri: string } => block.type === "image" && !!block.uri)
        .map((block) => block.uri);

      const messageOptions: MessageCreateOptions = { content: texts, files };
      if (cmd.replyToExternalMessageId) {
        messageOptions.reply = { messageReference: cmd.replyToExternalMessageId };
      }

      const sendableChannel = channel as Extract<typeof channel, { send: (options: MessageCreateOptions) => Promise<unknown> }>;
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
