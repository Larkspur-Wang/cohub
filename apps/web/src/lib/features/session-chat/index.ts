export {
	createSessionChatHost,
	type SessionChatHost,
	type SessionChatHostOptions,
} from "./session-chat-host.controller.svelte";
export {
	extractBackgroundBashResultPreview,
	formatBackgroundBashSubtitle,
	getSessionTitle,
	getTurnClientMessageId,
	isOptimisticTurn,
	isSameClientMessageTurn,
	normalizeTurnDuplicates,
	preserveSessionTurnRefs,
	reconcileOptimisticTurn,
} from "./session-utils";
export type { SessionViewState } from "./session-workspace-controller.svelte";
export { createSessionWorkspaceController } from "./session-workspace-controller.svelte";
export {
	getActiveSpaceChannelCount,
	subscribeSpaceChannel,
} from "./space-channel";
export type {
	SelectedModel,
	SessionChatAccess,
	SessionChatContext,
	SessionChatEnvironment,
	SessionChatHandle,
	SessionChatRoute,
} from "./types";
export {
	type ActiveViewportSource,
	type CanvasViewportObservation,
	createViewportContextController,
	type ViewportContextController,
} from "./viewport-context-controller.svelte";
