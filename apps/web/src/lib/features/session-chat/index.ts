export {
	getActiveGenerationChannelCount,
	subscribeGenerationChannel,
} from "./generation-channel";
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
export {
	acquireSpaceGeneration,
	getSpaceGenerationLeaseCount,
	releaseSpaceGeneration,
} from "./space-generation-lease";
export type {
	SelectedModel,
	SessionChatAccess,
	SessionChatContext,
	SessionChatEnvironment,
	SessionChatRoute,
} from "./types";
export {
	type ActiveViewportSource,
	type CanvasViewportObservation,
	createViewportContextController,
	type ViewportContextController,
} from "./viewport-context-controller.svelte";
