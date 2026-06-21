<script lang="ts">
import type {
	MessageToolCallsFile,
	SessionTurnIndexItem,
	SessionTurnRecord,
	StoredIntermediateMessage,
} from "@cohub/protocol/model";
import type { PromptTemplateCatalogEntry } from "@neta-art/cohub";
import { ArrowDown, ListTree, Plus } from "lucide-svelte";
import type { Snippet } from "svelte";
import CenteredLoading from "$lib/components/CenteredLoading.svelte";
import ChatTimeline from "$lib/components/ChatTimeline.svelte";
import NewChatBackground from "$lib/components/NewChatBackground.svelte";
import SessionComposer from "$lib/components/SessionComposer.svelte";
import SessionTaskTray, {
	type GenerationTaskNotice,
	type SessionTaskNotice,
} from "$lib/components/SessionTaskTray.svelte";
import TurnBottomSheet from "$lib/components/TurnBottomSheet.svelte";
import TurnRail from "$lib/components/TurnRail.svelte";
import type { ComposerAttachment } from "$lib/composer-attachments";
import type { ModelCatalogItem } from "$lib/model-catalog";
import type { TimelineItem } from "$lib/session-tree";
import type { NewChatBackgroundConfig } from "$lib/space-config";
import type { LocalUploadEntry } from "$lib/upload-entries";
import type { SessionViewState } from "./session-workspace-controller.svelte";

type SelectedModel = {
	provider: string;
	id: string;
	name?: string;
};

type Props = {
	spaceId: string;
	spaceLoadError: string;
	spaceHasMinimalAccess: boolean;
	createSessionError: string;
	bootstrapping: boolean;
	activeSessionState: SessionViewState | null | undefined;
	activeSessionInitialLoadingVisible: boolean;
	isNewSessionRoute: boolean;
	canCreateSession: boolean;
	handleCreateNewSession: () => void;
	shouldShowNewChatBackground: boolean;
	newChatBackground: NewChatBackgroundConfig | null;
	shouldShowNewChatProfile: boolean;
	newChatProfileViewportEl?: HTMLDivElement | null;
	newChatProfileExpanded: boolean;
	newChatProfile?: Snippet;
	chatTimelineRef?: unknown;
	listEl?: HTMLDivElement | null;
	timeline: TimelineItem[];
	handleFirstVisible: (index: number) => void;
	handleTimelineMarkdownRenderStart: (...args: unknown[]) => void;
	handleTimelineMarkdownRendered: (...args: unknown[]) => void;
	onLoadToolCalls: (input: {
		turn: SessionTurnRecord;
		message: StoredIntermediateMessage;
	}) => Promise<MessageToolCallsFile | null>;
	onLoadIntermediate: (
		turn: SessionTurnRecord,
	) => Promise<StoredIntermediateMessage[]>;
	handleForkTurn: (turn: SessionTurnRecord) => void | Promise<void>;
	forkingTurnId: string | null;
	openInlineFile: (path: string) => void | Promise<void>;
	modelsCatalog: ModelCatalogItem[] | null;
	sessionTaskNotices: SessionTaskNotice[];
	sessionTaskHasMore: boolean;
	sessionTaskRecentLoading: boolean;
	handleSessionTaskTrayExpand: () => void;
	handleSessionTaskTrayLoadMore: () => void;
	handleOpenGenerationTaskMedia: (notice: GenerationTaskNotice) => void;
	followupQueue: SessionTurnRecord[];
	turnPreviewText: (turn: SessionTurnRecord) => string;
	pendingFollowupActionIds: Set<string>;
	handleSteerFollowup: (turnId: string) => void | Promise<void>;
	handleCancelFollowup: (turnId: string) => void | Promise<void>;
	activeTurnRailItems: SessionTurnIndexItem[];
	turnMarkerPositions: Record<number, number>;
	turnMarkerHeights: Record<number, number>;
	timelineScrollTop: number;
	timelineScrollHeight: number;
	timelineClientHeight: number;
	composerHeight: number;
	unloadedOlderTurnCount: number;
	unloadedNewerTurnCount: number;
	currentTurnSequence: number | null;
	loadingTurnSequence: number | null;
	jumpToTurnAndUpdateUrl: (sequence: number) => void | Promise<void>;
	setProgrammaticScrollTop: (scrollTop: number) => void;
	snapScrollToNearestTurn: () => void;
	activeSessionId: string | null;
	loadOlderTurns: (sessionId: string) => void | Promise<void>;
	syncSessionNewer: (
		sessionId: string,
		cached: unknown,
	) => void | Promise<void>;
	highlightedTurnSequence: number | null;
	hasUnread: boolean;
	shouldAutoFollow?: boolean;
	forceScrollToBottom: () => void | Promise<void>;
	showTurnBottomSheet: boolean;
	loadTurnIndex: (sessionId: string, force?: boolean) => void | Promise<void>;
	composerHostEl?: HTMLDivElement | null;
	input: string;
	sending: boolean;
	activeSessionIsRunning: boolean;
	aborting: boolean;
	composerNotice: string;
	composerShowsBillingAction: boolean;
	attachments: ComposerAttachment[];
	activeSessionModel: SelectedModel | null;
	promptTemplates: PromptTemplateCatalogEntry[];
	promptTemplatesLoaded: boolean;
	handlePickAttachments: (
		files: FileList | File[] | LocalUploadEntry[] | null,
	) => void | Promise<void>;
	handleRemoveAttachment: (id: string) => void;
	handleSend: () => void | Promise<void>;
	handleAbort: () => void | Promise<void>;
	loadModelsCatalog: () => void | Promise<void>;
	loadGenerationModelsCatalog: () => void | Promise<void>;
	showModelSelector?: boolean;
};

let {
	spaceId,
	spaceLoadError,
	spaceHasMinimalAccess,
	createSessionError,
	bootstrapping,
	activeSessionState,
	activeSessionInitialLoadingVisible,
	isNewSessionRoute,
	canCreateSession,
	handleCreateNewSession,
	shouldShowNewChatBackground,
	newChatBackground,
	shouldShowNewChatProfile,
	newChatProfileViewportEl = $bindable(),
	newChatProfileExpanded,
	newChatProfile,
	chatTimelineRef = $bindable(),
	listEl = $bindable(),
	timeline,
	handleFirstVisible,
	handleTimelineMarkdownRenderStart,
	handleTimelineMarkdownRendered,
	onLoadToolCalls,
	onLoadIntermediate,
	handleForkTurn,
	forkingTurnId,
	openInlineFile,
	modelsCatalog,
	sessionTaskNotices,
	sessionTaskHasMore,
	sessionTaskRecentLoading,
	handleSessionTaskTrayExpand,
	handleSessionTaskTrayLoadMore,
	handleOpenGenerationTaskMedia,
	followupQueue,
	turnPreviewText,
	pendingFollowupActionIds,
	handleSteerFollowup,
	handleCancelFollowup,
	activeTurnRailItems,
	turnMarkerPositions,
	turnMarkerHeights,
	timelineScrollTop,
	timelineScrollHeight,
	timelineClientHeight,
	composerHeight,
	unloadedOlderTurnCount,
	unloadedNewerTurnCount,
	currentTurnSequence,
	loadingTurnSequence,
	jumpToTurnAndUpdateUrl,
	setProgrammaticScrollTop,
	snapScrollToNearestTurn,
	activeSessionId,
	loadOlderTurns,
	syncSessionNewer,
	highlightedTurnSequence,
	hasUnread,
	shouldAutoFollow = $bindable(),
	forceScrollToBottom,
	showTurnBottomSheet = $bindable(),
	loadTurnIndex,
	composerHostEl = $bindable(),
	input = $bindable(),
	sending,
	activeSessionIsRunning,
	aborting,
	composerNotice,
	composerShowsBillingAction,
	attachments,
	activeSessionModel,
	promptTemplates,
	promptTemplatesLoaded,
	handlePickAttachments,
	handleRemoveAttachment,
	handleSend,
	handleAbort,
	loadModelsCatalog,
	loadGenerationModelsCatalog,
	showModelSelector = $bindable(),
}: Props = $props();
</script>

  <!-- Chat -->
{#if spaceLoadError && !spaceHasMinimalAccess}
  <div class="m-4 rounded-md border border-error-soft/30 bg-error-bg p-3 text-[12px] font-mono text-error-soft break-all">{spaceLoadError}</div>
{/if}
{#if createSessionError}
  <div class="m-4 mt-0 rounded-md border border-error-soft/30 bg-error-bg p-3 text-[12px] font-mono text-error-soft break-all">{createSessionError}</div>
{/if}
{#if bootstrapping && !activeSessionState && !isNewSessionRoute}
  <CenteredLoading label="Loading space…" />
{:else if !activeSessionState}
  <div class="flex-1 flex flex-col items-center justify-center text-text-tertiary gap-4">
    <div class="text-[14px]">No chat selected</div>
    {#if !spaceHasMinimalAccess}
      <button
        type="button"
        class="flex items-center gap-1.5 px-3 py-2 rounded-[5px] bg-bg-hover hover:bg-bg-hover-strong border border-border-subtle text-[12px] text-text-secondary hover:text-text-primary transition-colors duration-100 disabled:opacity-50"
        onclick={() => handleCreateNewSession()}
        disabled={!canCreateSession}
      >
        <Plus class="w-3.5 h-3.5" />
        Create a session
      </button>
    {/if}
  </div>
{:else if activeSessionState.loading && !activeSessionState.loaded && activeSessionInitialLoadingVisible}
  <CenteredLoading label="Loading turns…" />
{:else}
  {#if activeSessionState.error}
    <div class="m-4 rounded-md border border-error-soft/30 bg-error-bg p-3 text-[12px] font-mono text-error-soft break-all">
      {activeSessionState.error}
    </div>
  {/if}
  <div class="relative flex-1 min-h-0 flex flex-col overflow-hidden">
    {#if shouldShowNewChatBackground && newChatBackground}
      <NewChatBackground background={newChatBackground} />
      <div class="relative z-10 flex-1 min-h-0 pointer-events-none"></div>
    {:else if shouldShowNewChatProfile}
      <div bind:this={newChatProfileViewportEl} class="flex-1 min-h-0 overflow-hidden sm:overflow-y-auto" class:overflow-y-auto={newChatProfileExpanded}>
        {#if newChatProfile}{@render newChatProfile()}{/if}
      </div>
    {:else}
      <ChatTimeline
          bind:this={chatTimelineRef}
          bind:bindListEl={listEl}
          timeline={timeline}
          preloadThreshold={10}
          onFirstVisible={handleFirstVisible}
          {onLoadToolCalls}
          {onLoadIntermediate}
          onMarkdownRenderStart={handleTimelineMarkdownRenderStart}
          onMarkdownRendered={handleTimelineMarkdownRendered}
          onForkTurn={handleForkTurn}
          forkingTurnId={forkingTurnId}
          loading={activeSessionInitialLoadingVisible}
          loadingOlder={activeSessionState?.loadingOlder ?? false}
          onOpenFile={openInlineFile}
          modelsCatalog={modelsCatalog ?? undefined}
        />
    {/if}
      <SessionTaskTray
        notices={sessionTaskNotices}
        hasMore={sessionTaskHasMore}
        loadingMore={sessionTaskRecentLoading}
        onExpand={handleSessionTaskTrayExpand}
        onLoadMore={handleSessionTaskTrayLoadMore}
        onOpenGenerationMedia={handleOpenGenerationTaskMedia}
      />
      {#if followupQueue.length > 0}
        <div class="mx-auto w-full max-w-4xl border-t border-border-subtle/70 bg-bg-content px-4 py-2 sm:px-6">
          <div class="mb-1 flex items-center gap-2 text-[11px] text-text-placeholder">
            <span class="font-medium text-text-secondary">Follow-up</span>
            <span>{followupQueue.length} queued</span>
          </div>
          <div class="max-h-[min(22dvh,9rem)] space-y-1 overflow-y-auto overscroll-contain pr-1 sm:max-h-[min(28vh,12rem)]">
            {#each followupQueue as turn (turn.id)}
              <div class="group flex items-center gap-2 rounded-lg px-2 py-1.5 text-[12px] text-text-tertiary hover:bg-bg-hover/60">
                <div class="min-w-0 flex-1 truncate">{turnPreviewText(turn)}</div>
                <button type="button" class="shrink-0 rounded px-1.5 py-1 text-text-secondary hover:bg-bg-surface hover:text-text-primary disabled:cursor-default disabled:opacity-50" disabled={pendingFollowupActionIds.has(turn.id)} onclick={() => { void handleSteerFollowup(turn.id); }}>Steer now</button>
                <button type="button" class="shrink-0 rounded px-1.5 py-1 text-text-placeholder hover:bg-bg-surface hover:text-text-secondary disabled:cursor-default disabled:opacity-50" disabled={pendingFollowupActionIds.has(turn.id)} onclick={() => { void handleCancelFollowup(turn.id); }}>Cancel</button>
              </div>
            {/each}
          </div>
        </div>
      {/if}
      <TurnRail
        turns={activeTurnRailItems}
        loadedTurns={activeSessionState.turns}
        markerPositions={turnMarkerPositions}
        markerHeights={turnMarkerHeights}
        scrollTop={timelineScrollTop}
        scrollHeight={timelineScrollHeight}
        clientHeight={timelineClientHeight}
        bottomOffset={composerHeight}
        olderCount={unloadedOlderTurnCount}
        newerCount={unloadedNewerTurnCount}
        hasMoreOlder={activeSessionState.hasMore}
        hasMoreNewer={activeSessionState.hasMoreNewer}
        loadingOlder={activeSessionState.loadingOlder}
        loadingNewer={activeSessionState.loadingNewer}
        currentSequence={currentTurnSequence}
        loadingSequence={loadingTurnSequence}
        onJump={(sequence) => { void jumpToTurnAndUpdateUrl(sequence); }}
        onScrollTo={(scrollTop) => { setProgrammaticScrollTop(scrollTop); }}
        onScrollCommit={() => { snapScrollToNearestTurn(); }}
        onLoadOlder={() => { if (activeSessionId) void loadOlderTurns(activeSessionId); }}
        onLoadNewer={() => { if (activeSessionId) void syncSessionNewer(activeSessionId, null); }}
      />
    {#if highlightedTurnSequence}
      <div class="pointer-events-none absolute left-0 right-0 top-0 z-10 h-px bg-brand/70"></div>
    {/if}
    {#if hasUnread || !shouldAutoFollow || activeTurnRailItems.length > 1}
      <div class={`pointer-events-none absolute left-1/2 z-20 -translate-x-1/2 ${!hasUnread && shouldAutoFollow ? 'lg:hidden' : ''}`}
        style:bottom={`${Math.max(composerHeight + 12, 96)}px`}
        style="animation: cohub-scroll-to-bottom-in 180ms cubic-bezier(0.22, 1, 0.36, 1);">
        <div class="pointer-events-auto flex items-center gap-0.5 rounded-full border border-border-subtle/80 bg-bg-primary/95 p-1 shadow-[0_4px_18px_rgba(0,0,0,0.16)] backdrop-blur-sm">
          {#if hasUnread}
            <button
              type="button"
              aria-label="Jump to new messages"
              class="flex h-7 items-center justify-center rounded-full bg-brand px-2.5 text-[11px] font-semibold leading-none text-brand-contrast-fg transition-colors duration-150 hover:bg-brand-hover active:scale-95"
              onclick={() => {
                shouldAutoFollow = true;
                void forceScrollToBottom();
              }}
            >
              New
            </button>
          {/if}
          {#if !shouldAutoFollow}
            <button
              type="button"
              aria-label="Jump to bottom"
              class="flex h-7 min-w-7 items-center justify-center rounded-full px-1.5 text-text-secondary transition-colors hover:bg-bg-hover hover:text-text-primary active:scale-95"
              onclick={() => {
                shouldAutoFollow = true;
                void forceScrollToBottom();
              }}
            >
              <ArrowDown class="w-4 h-4" />
            </button>
          {/if}
          {#if activeTurnRailItems.length > 1}
            <button
              type="button"
              aria-label="Open turn list"
              class="flex h-7 min-w-7 items-center justify-center rounded-full px-1.5 text-text-secondary transition-colors hover:bg-bg-hover hover:text-text-primary active:scale-95 lg:hidden"
              onclick={() => { showTurnBottomSheet = true; if (activeSessionId) void loadTurnIndex(activeSessionId, true); }}
            >
              <ListTree class="w-4 h-4" />
            </button>
          {/if}
        </div>
      </div>
    {/if}
    <TurnBottomSheet
      open={showTurnBottomSheet}
      turns={activeTurnRailItems}
      currentSequence={currentTurnSequence}
      onClose={() => { showTurnBottomSheet = false; }}
      onJump={(sequence) => { void jumpToTurnAndUpdateUrl(sequence); }}
    />
    <div bind:this={composerHostEl} class:relative={shouldShowNewChatBackground} class:z-10={shouldShowNewChatBackground}>
      <SessionComposer
        bind:value={input}
        disabled={!activeSessionState && !isNewSessionRoute}
        sending={sending}
        isRunning={activeSessionIsRunning}
        aborting={aborting}
        streamError={composerNotice}
        showBillingAction={composerShowsBillingAction}
        attachments={attachments}
        currentModel={activeSessionModel}
        currentSpaceId={spaceId}
        mobileAutoFocusOnMount={isNewSessionRoute && !activeSessionId}
        promptTemplates={promptTemplates}
        promptTemplatesLoaded={promptTemplatesLoaded}
        onpickattachment={handlePickAttachments}
        onremoveattachment={handleRemoveAttachment}
        onsubmit={handleSend}
        onabort={handleAbort}
        onModelSelect={() => {
          void loadModelsCatalog();
          void loadGenerationModelsCatalog();
          showModelSelector = true;
        }}
      />
    </div>
  </div>
{/if}
