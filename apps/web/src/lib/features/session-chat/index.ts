/**
 * session-chat public surface.
 * Prefer this barrel for host/shell integration; internal controllers stay private.
 */
export {
	createSessionChatHost,
	type SessionChatHost,
	type SessionChatHostOptions,
} from "./session-chat-host.controller.svelte";
export { getSessionTitle } from "./session-utils";
export {
	getActiveSpaceChannelCount,
	subscribeSpaceChannel,
} from "./space-channel";
export type {
	SelectedModel,
	SessionChatAccess,
	SessionChatContext,
	SessionChatEnvironment,
	SessionChatRoute,
} from "./types";
