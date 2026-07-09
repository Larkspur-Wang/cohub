export type GatewayOutboundResult = {
  success: boolean;
  error?: string;
  externalMessageId?: string;
};

/**
 * Channel provider contract.
 *
 * Health is mostly automatic:
 * - Manager: connecting / start-failure / stopped
 * - Outbound router: lastOutboundAt on sent messages, degraded on failure
 * - Inbound bus: lastInboundAt when an event is accepted
 *
 * Providers only need connection-level reporting when they can detect it:
 *   markChannelReady / markChannelError / markChannelDegraded
 * (see channel-health.ts helpers, or channelHealthReporter(channelId))
 *
 * If a provider cannot detect login/ready state, leave it as connecting
 * after Manager start — UI still works.
 */
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
  }): Promise<GatewayOutboundResult>;
}
