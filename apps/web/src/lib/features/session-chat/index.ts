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
export { subscribeSpaceChannel } from "./space-channel";
