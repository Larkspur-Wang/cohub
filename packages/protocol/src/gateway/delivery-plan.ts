import type { GatewayOutboundCommand } from "@cohub/protocol/gateway";

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

export interface FeishuImageToUpload {
  source: { type: "base64"; media_type: string; data: string } | { type: "url"; url: string };
}

export interface FeishuDeliveryPlan {
  adapter: "feishu";
  mode: "create_or_update";
  renderMode: "card" | "post";
  msgType: "interactive" | "post";
  content: string;
  /** Feishu image keys (img_v3_*) — can be sent directly. */
  imageKeys: string[];
  /** Images that must be uploaded to Feishu first to obtain an image_key. */
  imagesToUpload: FeishuImageToUpload[];
  replyToExternalMessageId?: string;
  turnAnchorMessageId?: string | null;
  preferredEditExternalMessageId?: string | null;
}

export type GatewayDeliveryPlan = DiscordDeliveryPlan | FeishuDeliveryPlan;

export type PlannedGatewayOutboundCommand = GatewayOutboundCommand & {
  deliveryPlan?: GatewayDeliveryPlan | null;
};
