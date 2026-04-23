export interface GatewayProvider {
  destroy(): void;
  handleOutbound(cmd: {
    commandId: string;
    provider: string;
    channelId: string;
    externalChatId: string;
    deliveryPlan?: unknown;
    content?: unknown[];
    meta?: Record<string, unknown> | null;
    replyToExternalMessageId?: string;
    sessionMessageId?: string;
  }): Promise<{ success: boolean; error?: string; externalMessageId?: string }>;
}
