import type { GatewayOutboundCommand } from "@neta-art/cohub-protocol/gateway";

export interface DiscordDeliveryPlan {
  adapter: "discord";
  mode: "send" | "upsert";
  primaryText: string;
  continuationChunks: string[];
  files: string[];
  replyToExternalMessageId?: string;
  turnAnchorMessageId?: string | null;
  preferredEditExternalMessageId?: string | null;
}

export interface FeishuDeliveryPlan {
  adapter: "feishu";
  mode: "create_or_update";
  renderMode: "card" | "post";
  msgType: "interactive" | "post";
  content: string;
  imageKeys: string[];
  replyToExternalMessageId?: string;
  turnAnchorMessageId?: string | null;
  preferredEditExternalMessageId?: string | null;
}

export type GatewayDeliveryPlan = DiscordDeliveryPlan | FeishuDeliveryPlan;

export type PlannedGatewayOutboundCommand = GatewayOutboundCommand & {
  deliveryPlan?: GatewayDeliveryPlan | null;
};
