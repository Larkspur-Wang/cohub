import { Client, GatewayIntentBits, type Message, Events, type MessageCreateOptions } from "discord.js";
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
      console.log(`[Discord:${this.channelId}] ✓ Connected as ${readyClient.user.tag}`);
      console.log(`[Discord:${this.channelId}] Guilds: ${readyClient.guilds.cache.size}`);
      if (readyClient.guilds.cache.size > 0) {
        console.log(`[Discord:${this.channelId}] Guild names: ${readyClient.guilds.cache.map(g => g.name).join(", ")}`);
      }
    });

    this.client.on(Events.Debug, (message) => {
      // Only log debug messages if DEBUG_MODE is enabled
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

    this.client.on(Events.MessageCreate, async (message: Message) => {
      // 忽略机器人自己的消息
      if (message.author.bot) {
        return;
      }

      console.log(`[Discord:${this.channelId}] ← Message received:`, {
        author: `${message.author.tag} (${message.author.id})`,
        channelId: message.channelId,
        guildId: message.guildId || "DM",
        content: message.content.slice(0, 50) + (message.content.length > 50 ? "..." : ""),
        attachments: message.attachments.size,
      });

      const content: UnifiedContentBlock[] = [
        { type: "text", text: message.content },
      ];

      // 处理附件 (简单实现，只取图片)
      for (const attachment of message.attachments.values()) {
        if (attachment.contentType?.startsWith("image/")) {
          content.push({ type: "image", uri: attachment.url });
          console.log(`[Discord:${this.channelId}] Attachment: ${attachment.name} (${attachment.contentType})`);
        }
      }

      const inboundEvent: GatewayInboundEvent = {
        eventId: randomUUID(),
        timestamp: Date.now(),
        channelId: this.channelId,
        provider: "discord",
        externalChatId: message.channelId, // 寻址用的外部聊天 ID
        externalMessageId: message.id,
        bindingKey: buildDiscordBindingKey(message),
        sender: {
          id: message.author.id,
          name: message.author.username,
        },
        content,
      };

      console.log(`[Discord:${this.channelId}] → Publishing inbound event ${inboundEvent.eventId.slice(0, 8)}`);
      await publishInboundEvent(inboundEvent);
    });
  }

  public async handleOutbound(cmd: GatewayOutboundCommand) {
    console.log(`[Discord:${this.channelId}] → Sending message to ${cmd.externalChatId}:`, {
      contentPreview: cmd.content.map(c => c.type === "text" ? c.text?.slice(0, 30) : c.type).join(", "),
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

      // 检查是否是可以发送消息的频道类型
      if (!('send' in channel)) {
        console.error(`[Discord:${this.channelId}] Channel ${cmd.externalChatId} does not support sending messages`);
        return { success: false as const, error: "Channel does not support sending messages" };
      }

      // 提取纯文本内容
      const texts = cmd.content
        .filter((block): block is { type: "text"; text: string } => block.type === "text")
        .map((block) => block.text)
        .join("\n");

      // 如果有图片，转为 Discord 的附件
      const files = cmd.content
        .filter((block): block is { type: "image"; uri: string } => block.type === "image" && !!block.uri)
        .map((block) => block.uri);

      // 如果有 reply 的要求
      const messageOptions: MessageCreateOptions = { content: texts, files };
      if (cmd.replyToExternalMessageId) {
        messageOptions.reply = { messageReference: cmd.replyToExternalMessageId };
      }

      // 使用类型断言，因为我们已经检查了 'send' in channel
      const sendableChannel = channel as Extract<typeof channel, { send: (options: MessageCreateOptions) => Promise<unknown> }>;
      const sentMsg = await sendableChannel.send(messageOptions) as { id: string };
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
