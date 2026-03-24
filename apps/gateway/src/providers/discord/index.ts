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

  constructor(channelId: string, token: string) {
    this.channelId = channelId;
    this.client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.DirectMessages,
      ],
    });

    this.setupListeners();
    this.client.login(token).catch(console.error);
  }

  private setupListeners() {
    this.client.on(Events.ClientReady, (readyClient) => {
      console.log(`[Discord] Logged in as ${readyClient.user.tag} (ChannelID: ${this.channelId})`);
    });

    this.client.on(Events.MessageCreate, async (message: Message) => {
      // 忽略机器人自己的消息
      if (message.author.bot) return;

      console.log(`[Discord] Received message from ${message.author.tag} in ${message.channelId}: ${message.content}`);

      const content: UnifiedContentBlock[] = [
        { type: "text", text: message.content },
      ];

      // 处理附件 (简单实现，只取图片)
      for (const attachment of message.attachments.values()) {
        if (attachment.contentType?.startsWith("image/")) {
          content.push({ type: "image", uri: attachment.url });
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

      await publishInboundEvent(inboundEvent);
    });
  }

  public async handleOutbound(cmd: GatewayOutboundCommand) {
    try {
      const channel = await this.client.channels.fetch(cmd.externalChatId);
      if (!channel || !channel.isTextBased()) {
        console.error(`[Discord] Invalid text channel: ${cmd.externalChatId}`);
        return { success: false, error: `Invalid text channel: ${cmd.externalChatId}` };
      }

      // 检查是否是可以发送消息的频道类型
      if (!('send' in channel)) {
        console.error(`[Discord] Channel ${cmd.externalChatId} does not support sending messages`);
        return { success: false, error: `Channel does not support sending messages` };
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
      console.log(`[Discord] Successfully sent message ${sentMsg.id} to ${channel.id}`);
      return { success: true as const, externalMessageId: sentMsg.id };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error(`[Discord] Failed to send message to ${cmd.externalChatId}:`, error);
      return { success: false as const, error: errorMessage };
    }
  }

  public destroy() {
    this.client.destroy();
  }
}
