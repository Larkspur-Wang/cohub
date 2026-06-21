<script lang="ts">
import type { SessionRecord, SpaceRecord } from "@neta-art/cohub";
import {
	Check,
	Globe,
	ListTree,
	Loader2,
	MoreHorizontal,
	PanelRightClose,
	PanelRightOpen,
	Share2,
	TextCursorInput,
	X,
} from "lucide-svelte";
import PageHeader from "$lib/components/PageHeader.svelte";
import SpaceAvatar from "$lib/components/SpaceAvatar.svelte";
import { isComposingKeyboardEvent } from "$lib/keyboard";
import { getSessionTitle } from "./session-utils";

type HeaderRouteView =
	| "space"
	| "session"
	| "file"
	| "checkpoint"
	| "checkpoint-new"
	| "cronjob"
	| "cronjob-new"
	| "work"
	| "task";

type RouteDetailHeader = {
	view: "checkpoint" | "cronjob" | "work" | "task";
	id: string;
	title: string;
};

export type SpaceWorkspaceHeaderContext = {
	routeView: HeaderRouteView;
	spaceId: string;
	space: SpaceRecord | null;
	activeSession: SessionRecord | undefined;
	activeSessionLoaded: boolean;
	activeSessionLoading: boolean;
	isNewSessionRoute: boolean;
	wsConnectionState: string;
	activeRouteDetailHeader: RouteDetailHeader | null;
	activeSessionId: string | null;
	canManageSessionAccess: boolean;
	isActiveSessionPublic: boolean;
	spaceHasMinimalAccess: boolean;
	rightSidebarCollapsed: boolean;
};

export type SessionRenameState = {
	renaming: boolean;
	value: string;
	saving: boolean;
};

export type ResourceActionState = {
	open: boolean;
	available: boolean;
};

export type SpaceWorkspaceHeaderActions = {
	openShareModal: (sessionId: string) => void;
	startSessionRename: () => void;
	cancelSessionRename: () => void;
	submitSessionRename: () => void | Promise<void>;
	setSessionRenameValue: (value: string) => void;
	toggleResourceActionMenu: () => void;
	closeResourceActionMenu: () => void;
	labelHeaderResource: () => void | Promise<void>;
	insertHeaderReference: () => void;
	toggleRightSidebar: () => void | Promise<void>;
};

type Props = {
	context: SpaceWorkspaceHeaderContext;
	sessionRename: SessionRenameState;
	resourceActions: ResourceActionState;
	actions: SpaceWorkspaceHeaderActions;
};

let { context, sessionRename, resourceActions, actions }: Props = $props();
let sessionRenameInputEl: HTMLInputElement | null = $state(null);
let sessionRenameFocused = $state(false);

const spaceTitle = $derived(
	context.space?.name || context.space?.title || context.spaceId,
);
const showSessionTitle = $derived(
	context.routeView === "session" &&
		(context.activeSession || context.isNewSessionRoute),
);
const routeHeaderTitle = $derived.by(() => {
	if (context.routeView === "checkpoint" && context.activeRouteDetailHeader) {
		return context.activeRouteDetailHeader.title.slice(0, 36) || "Checkpoint";
	}
	if (context.routeView === "checkpoint-new") return "New save";
	if (context.routeView === "cronjob" && context.activeRouteDetailHeader) {
		return context.activeRouteDetailHeader.title;
	}
	if (context.routeView === "cronjob-new") return "New cronjob";
	if (context.routeView === "work" && context.activeRouteDetailHeader) {
		return context.activeRouteDetailHeader.title;
	}
	if (context.routeView === "task" && context.activeRouteDetailHeader) {
		return context.activeRouteDetailHeader.title;
	}
	return null;
});

$effect(() => {
	if (!sessionRename.renaming) {
		sessionRenameFocused = false;
		return;
	}
	if (sessionRenameFocused || !sessionRenameInputEl) return;
	sessionRenameFocused = true;
	sessionRenameInputEl.focus();
	sessionRenameInputEl.select();
});

function handleSessionRenameKeydown(event: KeyboardEvent) {
	if (
		event.key === "Enter" &&
		!sessionRename.saving &&
		!isComposingKeyboardEvent(event)
	) {
		event.preventDefault();
		void actions.submitSessionRename();
	}
	if (event.key === "Escape" && !sessionRename.saving) {
		event.preventDefault();
		actions.cancelSessionRename();
	}
}
</script>

<PageHeader>
	{#snippet left()}
		<div class="flex min-w-0 items-center gap-1.5 overflow-hidden">
			{#if showSessionTitle}
				<button
					type="button"
					class="inline-flex shrink-0 items-center text-text-primary transition-colors hover:text-text-secondary lg:hidden"
					title={spaceTitle}
					aria-label="Open space"
				>
					<SpaceAvatar name={spaceTitle} profile={context.space?.publicProfile} size="xs" />
				</button>
				<div class="flex min-w-0 flex-1 items-center gap-1.5 overflow-hidden">
					{#if sessionRename.renaming && context.activeSession}
						<input
							bind:this={sessionRenameInputEl}
							value={sessionRename.value}
							type="text"
							class="max-w-[40vw] min-w-0 flex-1 rounded bg-bg-hover-strong px-1 py-0.5 text-[13px] leading-tight text-text-primary outline-none"
							placeholder="Session name"
							maxlength={80}
							disabled={sessionRename.saving}
							oninput={(event) => {
								actions.setSessionRenameValue(event.currentTarget.value);
							}}
							onkeydown={handleSessionRenameKeydown}
						/>
						<button
							type="button"
							class="shrink-0 rounded p-0.5 text-status-running transition-colors hover:bg-bg-hover"
							disabled={sessionRename.saving}
							onclick={() => void actions.submitSessionRename()}
							title="Save"
						>
							<Check class="h-3.5 w-3.5" />
						</button>
						<button
							type="button"
							class="shrink-0 rounded p-0.5 text-text-tertiary transition-colors hover:bg-bg-hover hover:text-text-primary"
							disabled={sessionRename.saving}
							onclick={actions.cancelSessionRename}
							title="Cancel"
						>
							<X class="h-3.5 w-3.5" />
						</button>
					{:else}
						<button
							type="button"
							class="min-w-0 flex-1 truncate text-[13px] text-text-secondary transition-colors hover:text-text-primary"
							onclick={context.activeSession ? actions.startSessionRename : undefined}
							title={context.activeSession ? "Click to rename" : "New chat"}
						>
							{context.activeSession ? getSessionTitle(context.activeSession) : "New chat"}
						</button>
						{#if context.activeSessionLoading && context.activeSessionLoaded}
							<Loader2 class="h-3.5 w-3.5 shrink-0 animate-spin text-text-placeholder" aria-label="Syncing" />
						{/if}
						{#if context.wsConnectionState === "reconnecting"}
							<span class="inline-flex shrink-0 items-center text-[12px] text-warning">Reconnecting...</span>
						{/if}
					{/if}
				</div>
			{:else if routeHeaderTitle}
				<button
					type="button"
					class="inline-flex shrink-0 items-center text-text-primary transition-colors hover:text-text-secondary lg:hidden"
					title={spaceTitle}
					aria-label="Open space"
				>
					<SpaceAvatar name={spaceTitle} profile={context.space?.publicProfile} size="xs" />
				</button>
				<span class="min-w-0 truncate text-[13px] text-text-secondary">{routeHeaderTitle}</span>
			{:else}
				<button
					type="button"
					class="inline-flex min-w-0 items-center gap-1.5 truncate text-left text-[13px] text-text-primary transition-colors hover:text-text-secondary"
				>
					<SpaceAvatar name={spaceTitle} profile={context.space?.publicProfile} size="xs" />
					{spaceTitle}
				</button>
			{/if}
		</div>
	{/snippet}

	{#snippet right()}
		{#if context.activeSessionId && context.canManageSessionAccess}
			<button
				type="button"
				class="flex h-8 items-center gap-1.5 rounded-[5px] px-2 transition-colors duration-100 {context.isActiveSessionPublic ? 'text-success-soft hover:bg-success-bg hover:text-success' : 'text-text-tertiary hover:bg-bg-hover hover:text-text-secondary'}"
				onclick={() => actions.openShareModal(context.activeSessionId!)}
				title={context.isActiveSessionPublic ? "Session is public" : "Share session"}
			>
				{#if context.isActiveSessionPublic}
					<Globe class="h-4 w-4 shrink-0" />
					<span class="hidden text-[13px] font-medium lg:inline">Shared</span>
				{:else}
					<Share2 class="h-4 w-4 shrink-0" />
					<span class="hidden text-[13px] font-medium lg:inline">Share</span>
				{/if}
			</button>
		{/if}

		{#if resourceActions.available}
			<div class="relative" data-resource-actions>
				<button
					type="button"
					class="flex h-8 w-8 items-center justify-center rounded-[5px] text-text-tertiary transition-colors duration-100 hover:bg-bg-hover hover:text-text-secondary"
					onclick={(event) => {
						event.stopPropagation();
						actions.toggleResourceActionMenu();
					}}
					title="More actions"
					aria-haspopup="menu"
					aria-expanded={resourceActions.open}
				>
					<MoreHorizontal class="h-4 w-4 shrink-0" />
				</button>
				{#if resourceActions.open}
					<div class="absolute right-0 top-full z-50 mt-1 w-44 overflow-hidden rounded-md border border-border-subtle bg-bg-primary py-1 shadow-lg" role="menu">
						<button
							type="button"
							class="menu-item"
							onclick={() => {
								void actions.labelHeaderResource();
								actions.closeResourceActionMenu();
							}}
							role="menuitem"
						>
							<ListTree class="h-3.5 w-3.5" />
							<span>Label as…</span>
						</button>
						<button type="button" class="menu-item" onclick={actions.insertHeaderReference} role="menuitem">
							<TextCursorInput class="h-3.5 w-3.5" />
							<span>Insert reference</span>
						</button>
					</div>
				{/if}
			</div>
		{/if}

		{#if !context.spaceHasMinimalAccess}
			<div class="relative">
				<button
					type="button"
					class="flex h-8 items-center gap-1.5 rounded-[5px] px-2 text-text-tertiary transition-colors duration-100 hover:bg-bg-hover hover:text-text-secondary"
					onclick={() => void actions.toggleRightSidebar()}
					title={context.rightSidebarCollapsed ? "Show files" : "Hide files"}
				>
					{#if context.rightSidebarCollapsed}
						<PanelRightOpen class="h-4 w-4 shrink-0" />
					{:else}
						<PanelRightClose class="h-4 w-4 shrink-0" />
					{/if}
				</button>
			</div>
		{/if}
	{/snippet}
</PageHeader>
