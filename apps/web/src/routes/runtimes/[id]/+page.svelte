<script lang="ts">
import { onMount } from "svelte";
import {
  abortSession,
  getRuntime,
  getRuntimeProvisioning,
  getRuntimeSessions,
  getRuntimeStreamUrl,
  getSessionMessages,
  getSessionTree,
  selectSessionLeaf,
  sendSessionMessage,
  type RuntimeProvisionResponse,
  type RuntimeRecord,
  type SessionRecord,
  type SessionMessageRecord,
  type SessionToolCallRecord,
} from "$lib/api";
import ChatTimeline from "$lib/components/ChatTimeline.svelte";
import SessionComposer from "$lib/components/SessionComposer.svelte";
import SessionTreePanel from "$lib/components/SessionTreePanel.svelte";
import {
  toChatMessages,
  toTreeNodes,
  type SessionTreeNodeView,
  type TimelineItem,
} from "$lib/session-tree";

type PersistedData = {
  runtime: RuntimeRecord;
  session: SessionRecord;
  messages: SessionMessageRecord[];
  toolCalls: SessionToolCallRecord[];
};

type TreeData = {
  runtime: RuntimeRecord;
  session: {
    id: string;
    currentLeafMessageId: string | null;
    rootMessageId: string | null;
    totalBranches: number;
  };
  nodes: SessionMessageRecord[];
};

type Props = {
  data: {
    runtime: RuntimeRecord;
    session: SessionRecord | null;
    persisted: PersistedData | null;
    tree: TreeData | null;
  };
};

type SessionViewState = {
  session: SessionRecord;
  messages: SessionMessageRecord[];
  toolCalls: SessionToolCallRecord[];
  treeNodes: SessionTreeNodeView[];
  currentLeafMessageId: string | null;
  branchFromMessageId: string | null;
  loading: boolean;
  error: string;
};

type WorkspaceTab =
  | { key: string; type: "session"; sessionId: string; title: string }
  | { key: string; type: "draft"; title: string }
  | { key: string; type: "file"; path: string; title: string; temporary?: boolean };

const { data }: Props = $props();

let runtime = $state<RuntimeRecord>({
  id: "",
  userUuid: "",
  workspaceId: null,
  workspaceCommitHash: null,
  agentId: null,
  agentCommitHash: null,
  title: null,
  status: null,
  liveStatus: null,
  currentSessionId: null,
  meta: null,
  createdAt: new Date(0).toISOString(),
  updatedAt: new Date(0).toISOString(),
});
let runtimeSessions = $state<SessionRecord[]>([]);
let sessionStateById = $state<Record<string, SessionViewState>>({});
let tabs = $state<WorkspaceTab[]>([]);
let activeTabKey = $state("");
let sidebarMode = $state<"sessions" | "files">("sessions");
let leftSidebarCollapsed = $state(false);
let rightSidebarCollapsed = $state(false);
let leftSidebarWidth = $state(250);
let rightSidebarWidth = $state(280);
let resizingSidebar = $state<"left" | "right" | null>(null);
let draggingTabKey = $state<string | null>(null);
let dragOverTabKey = $state<string | null>(null);
let savedTabOrder = $state<string[]>([]);
let hasLoadedLayoutPrefs = false;
let draftCounter = 1;

let listEl = $state<HTMLDivElement | null>(null);
let input = $state("");
let sending = $state(false);
let selectingLeaf = $state(false);
let streamStatus = $state<"connecting" | "open" | "closed" | "error">("connecting");
let streamError = $state("");
let runtimeLoadError = $state("");
let provisioning = $state<RuntimeProvisionResponse | null>(null);
let provisioningError = $state("");
let eventSource: EventSource | null = null;
let provisioningPollingTimer: ReturnType<typeof setInterval> | null = null;
let streamingAssistantText = $state("");

const effectiveRuntimeStatus = $derived(runtime.liveStatus ?? runtime.status ?? "unknown");
const isProvisioningDone = $derived(
  provisioning?.status === "succeeded" || provisioning?.status === "failed",
);
const activeTab = $derived(tabs.find((tab) => tab.key === activeTabKey) ?? null);
const activeSessionId = $derived(activeTab?.type === "session" ? activeTab.sessionId : null);
const activeSessionState = $derived(
  activeSessionId ? sessionStateById[activeSessionId] ?? null : null,
);
const isRuntimeReady = $derived(effectiveRuntimeStatus === "running");

const timeline = $derived.by<TimelineItem[]>(() => {
  const state = activeSessionState;
  if (!state) return [];

  const persisted = toChatMessages(state.messages, state.toolCalls).map((message) => ({
    id: message.id,
    kind: "message" as const,
    message,
  }));

  if (streamingAssistantText.trim() && activeSessionId === runtime.currentSessionId) {
    persisted.push({
      id: "assistant-streaming",
      kind: "message",
      message: {
        id: "assistant-streaming",
        role: "assistant",
        text: streamingAssistantText,
      },
    });
  }

  return persisted;
});

const rightMetaItems = $derived.by(() => {
  const state = activeSessionState;
  return [
    ["runtime", runtime.id],
    ["title", runtime.title ?? "untitled"],
    ["status", effectiveRuntimeStatus],
    ["workspace", runtime.workspaceId ?? "unbound"],
    ["agent", runtime.agentId ?? "none"],
    ["current session", runtime.currentSessionId ?? "none"],
    ["active tab", activeTab?.title ?? "none"],
    ["session id", state?.session.id ?? "—"],
    ["protocol", state?.session.protocol ?? "—"],
    ["cwd", state?.session.cwd ?? "—"],
    ["messages", state ? String(state.messages.length) : "0"],
    [
      "branch points",
      state ? String(state.treeNodes.filter((node) => node.childCount > 1).length) : "0",
    ],
    ["updated", new Date(runtime.updatedAt).toLocaleString()],
  ] as Array<[string, string]>;
});

const gridTemplateColumns = $derived.by(() => {
  const columns: string[] = [];

  columns.push(leftSidebarCollapsed ? "44px" : `${leftSidebarWidth}px`);
  if (!leftSidebarCollapsed) columns.push("4px");

  columns.push("minmax(0,1fr)");

  if (!rightSidebarCollapsed) columns.push("4px");
  columns.push(rightSidebarCollapsed ? "44px" : `${rightSidebarWidth}px`);

  return columns.join(" ");
});

const streamIndicatorClass = $derived(
  streamStatus === "open"
    ? streamingAssistantText.trim()
      ? "bg-emerald-300 shadow-[0_0_0_4px_rgba(110,231,183,0.08)] animate-pulse"
      : "bg-emerald-300/80"
    : streamStatus === "error"
      ? "bg-red-300"
      : streamStatus === "connecting"
        ? "bg-amber-200 animate-pulse"
        : "bg-white/20",
);

const runtimeLayoutStorageKey = $derived(`runtime-detail-layout:${runtime.id || data.runtime.id || 'unknown'}`);

function getTabSelectionClass(tab: WorkspaceTab) {
  if (activeTabKey === tab.key) {
    return "bg-[#141414] text-white after:absolute after:inset-x-2 after:bottom-0 after:h-px after:bg-white/26 shadow-[inset_0_1px_0_rgba(255,255,255,0.02)]";
  }

  if (tab.type === "session" && tab.sessionId === runtime.currentSessionId) {
    return "bg-white/[0.015] text-white/62 hover:bg-white/[0.028] hover:text-white/84";
  }

  return "bg-transparent text-white/40 hover:bg-white/[0.022] hover:text-white/82";
}

function getTabIcon(tab: WorkspaceTab) {
  if (tab.type === "session") return "◌";
  if (tab.type === "file") return "≡";
  return "+";
}

function getSessionListIcon(sessionRecord: SessionRecord) {
  return runtime.currentSessionId === sessionRecord.id ? "●" : "◌";
}

function mergeTabsWithSavedOrder(nextTabs: WorkspaceTab[]) {
  if (savedTabOrder.length === 0) {
    return nextTabs;
  }

  const orderMap = new Map(savedTabOrder.map((key, index) => [key, index]));
  return [...nextTabs].sort((a, b) => {
    const aIndex = orderMap.get(a.key);
    const bIndex = orderMap.get(b.key);

    if (aIndex == null && bIndex == null) return 0;
    if (aIndex == null) return 1;
    if (bIndex == null) return -1;
    return aIndex - bIndex;
  });
}

function persistLayoutPrefs() {
  if (typeof localStorage === "undefined" || !hasLoadedLayoutPrefs) return;

  localStorage.setItem(
    runtimeLayoutStorageKey,
    JSON.stringify({
      leftSidebarCollapsed,
      rightSidebarCollapsed,
      leftSidebarWidth,
      rightSidebarWidth,
      sidebarMode,
      tabOrder: tabs.map((tab) => tab.key),
    }),
  );
}

function startSidebarResize(side: "left" | "right", event: MouseEvent) {
  event.preventDefault();
  resizingSidebar = side;

  const handlePointerMove = (moveEvent: MouseEvent) => {
    if (side === "left") {
      leftSidebarWidth = Math.max(200, Math.min(420, moveEvent.clientX));
      persistLayoutPrefs();
      return;
    }

    rightSidebarWidth = Math.max(220, Math.min(420, window.innerWidth - moveEvent.clientX));
    persistLayoutPrefs();
  };

  const handlePointerUp = () => {
    resizingSidebar = null;
    window.removeEventListener("mousemove", handlePointerMove);
    window.removeEventListener("mouseup", handlePointerUp);
  };

  window.addEventListener("mousemove", handlePointerMove);
  window.addEventListener("mouseup", handlePointerUp);
}

function isStreamingTab(tab: WorkspaceTab) {
  return tab.type === "session" && tab.sessionId === runtime.currentSessionId && streamStatus === "open";
}

$effect(() => {
  runtime = data.runtime;

  if (data.session && data.persisted && data.tree) {
    sessionStateById = {
      ...sessionStateById,
      [data.session.id]: {
        session: data.session,
        messages: data.persisted.messages,
        toolCalls: data.persisted.toolCalls,
        treeNodes: toTreeNodes(data.tree),
        currentLeafMessageId: data.tree.session.currentLeafMessageId,
        branchFromMessageId: null,
        loading: false,
        error: "",
      },
    };

    const initialTitle = getSessionTitle(data.session, 0);
    tabs = mergeTabsWithSavedOrder([{ key: `session:${data.session.id}`, type: "session", sessionId: data.session.id, title: initialTitle }]);
    activeTabKey = `session:${data.session.id}`;
  } else {
    tabs = mergeTabsWithSavedOrder([{ key: "draft:1", type: "draft", title: "New session" }]);
    activeTabKey = "draft:1";
    draftCounter = 2;
  }
});

$effect(() => {
  const id = activeSessionId;
  if (id) {
    void loadSessionState(id);
  }
});

$effect(() => {
  if (activeSessionState) {
    scrollToBottom();
  }
});

$effect(() => {
  if (!hasLoadedLayoutPrefs) return;
  persistLayoutPrefs();
});

function getSessionTitle(session: SessionRecord, index: number) {
  return session.title?.trim() || session.latestMessageText?.trim() || `Session ${index + 1}`;
}

function scrollToBottom() {
  queueMicrotask(() => {
    listEl?.scrollTo({ top: listEl.scrollHeight, behavior: "smooth" });
  });
}

function createDraftTab() {
  const key = `draft:${draftCounter++}`;
  tabs = mergeTabsWithSavedOrder([{ key, type: "draft", title: "New session" }, ...tabs]);
  activeTabKey = key;
  input = "";
  streamError = "";
}

function openFilePlaceholder(path: string) {
  const key = `file:${path}`;
  if (!tabs.some((tab) => tab.key === key)) {
    tabs = mergeTabsWithSavedOrder([{ key, type: "file", path, title: path.split("/").at(-1) ?? path, temporary: true }, ...tabs]);
  }
  activeTabKey = key;
}

function openSessionTab(sessionRecord: SessionRecord) {
  const key = `session:${sessionRecord.id}`;
  const title = getSessionTitle(sessionRecord, runtimeSessions.findIndex((item) => item.id === sessionRecord.id));

  if (!tabs.some((tab) => tab.key === key)) {
    tabs = mergeTabsWithSavedOrder([{ key, type: "session", sessionId: sessionRecord.id, title }, ...tabs]);
  } else {
    tabs = tabs.map((tab) => (tab.key === key ? { ...tab, title } : tab));
  }

  activeTabKey = key;
}

function closeTab(key: string) {
  const index = tabs.findIndex((tab) => tab.key === key);
  if (index === -1) return;

  const nextTabs = tabs.filter((tab) => tab.key !== key);
  tabs = nextTabs.length
    ? mergeTabsWithSavedOrder(nextTabs)
    : [{ key: `draft:${draftCounter++}`, type: "draft", title: "New session" }];

  if (activeTabKey === key) {
    activeTabKey = tabs[Math.max(0, index - 1)]?.key ?? tabs[0]?.key ?? "";
  }
}

function reorderTabs(sourceKey: string, targetKey: string) {
  if (sourceKey === targetKey) return;

  const sourceIndex = tabs.findIndex((tab) => tab.key === sourceKey);
  const targetIndex = tabs.findIndex((tab) => tab.key === targetKey);
  if (sourceIndex === -1 || targetIndex === -1) return;

  const nextTabs = [...tabs];
  const [moved] = nextTabs.splice(sourceIndex, 1);
  nextTabs.splice(targetIndex, 0, moved);
  tabs = nextTabs;
  savedTabOrder = nextTabs.map((tab) => tab.key);
  persistLayoutPrefs();
}

function handleTabDragStart(key: string) {
  draggingTabKey = key;
  dragOverTabKey = key;
}

function handleTabDragOver(key: string) {
  if (!draggingTabKey || draggingTabKey === key) return;
  dragOverTabKey = key;
  reorderTabs(draggingTabKey, key);
}

function handleTabDragEnd() {
  draggingTabKey = null;
  dragOverTabKey = null;
}


async function loadSessionState(sessionId: string, force = false) {
  const existing = sessionStateById[sessionId];
  if (!force && existing && (existing.messages.length > 0 || existing.treeNodes.length > 0 || existing.loading)) {
    return;
  }

  sessionStateById = {
    ...sessionStateById,
    [sessionId]: {
      session: existing?.session ?? runtimeSessions.find((item) => item.id === sessionId) ?? {
        id: sessionId,
        runtimeId: runtime.id,
        title: null,
        status: null,
        cwd: null,
        protocol: null,
        createdAt: runtime.createdAt,
        updatedAt: runtime.updatedAt,
      },
      messages: existing?.messages ?? [],
      toolCalls: existing?.toolCalls ?? [],
      treeNodes: existing?.treeNodes ?? [],
      currentLeafMessageId: existing?.currentLeafMessageId ?? null,
      branchFromMessageId: existing?.branchFromMessageId ?? null,
      loading: true,
      error: "",
    },
  };

  try {
    const [messagesResponse, treeResponse] = await Promise.all([
      getSessionMessages(sessionId),
      getSessionTree(sessionId),
    ]);

    sessionStateById = {
      ...sessionStateById,
      [sessionId]: {
        session: messagesResponse.session,
        messages: messagesResponse.messages,
        toolCalls: messagesResponse.toolCalls,
        treeNodes: toTreeNodes(treeResponse),
        currentLeafMessageId: treeResponse.session.currentLeafMessageId,
        branchFromMessageId: existing?.branchFromMessageId ?? null,
        loading: false,
        error: "",
      },
    };

    tabs = tabs.map((tab) =>
      tab.type === "session" && tab.sessionId === sessionId
        ? {
            ...tab,
            title: getSessionTitle(
              messagesResponse.session,
              runtimeSessions.findIndex((item) => item.id === sessionId),
            ),
          }
        : tab,
    );
  } catch (error) {
    sessionStateById = {
      ...sessionStateById,
      [sessionId]: {
        ...(sessionStateById[sessionId] ?? existing),
        session: sessionStateById[sessionId]?.session ?? existing?.session,
        messages: sessionStateById[sessionId]?.messages ?? existing?.messages ?? [],
        toolCalls: sessionStateById[sessionId]?.toolCalls ?? existing?.toolCalls ?? [],
        treeNodes: sessionStateById[sessionId]?.treeNodes ?? existing?.treeNodes ?? [],
        currentLeafMessageId:
          sessionStateById[sessionId]?.currentLeafMessageId ?? existing?.currentLeafMessageId ?? null,
        branchFromMessageId:
          sessionStateById[sessionId]?.branchFromMessageId ?? existing?.branchFromMessageId ?? null,
        loading: false,
        error: error instanceof Error ? error.message : "Failed to load session",
      },
    };
  }
}

async function refreshRuntimeState() {
  try {
    runtimeLoadError = "";
    const nextRuntime = await getRuntime(runtime.id);
    const sessionsResponse = await getRuntimeSessions(runtime.id);

    runtime = nextRuntime;
    runtimeSessions = sessionsResponse.sessions;

    tabs = tabs.map((tab) => {
      if (tab.type !== "session") return tab;
      const nextSession = sessionsResponse.sessions.find((item) => item.id === tab.sessionId);
      if (!nextSession) return tab;
      return {
        ...tab,
        title: getSessionTitle(
          nextSession,
          sessionsResponse.sessions.findIndex((item) => item.id === tab.sessionId),
        ),
      };
    });

    const bootstrapSessionId =
      activeSessionId ?? nextRuntime.currentSessionId ?? sessionsResponse.sessions.at(-1)?.id ?? null;

    if (bootstrapSessionId) {
      const bootstrapSession = sessionsResponse.sessions.find((item) => item.id === bootstrapSessionId);
      if (bootstrapSession) {
        const sessionKey = `session:${bootstrapSession.id}`;
        if (!tabs.some((tab) => tab.key === sessionKey)) {
          tabs = mergeTabsWithSavedOrder([{ key: sessionKey, type: "session", sessionId: bootstrapSession.id, title: getSessionTitle(bootstrapSession, sessionsResponse.sessions.findIndex((item) => item.id === bootstrapSession.id)) }, ...tabs]);
        }
        if (!activeTabKey) {
          activeTabKey = sessionKey;
        }
        await loadSessionState(bootstrapSession.id, true);
      }
    }
  } catch (error) {
    runtimeLoadError = error instanceof Error ? error.message : "Failed to refresh runtime";
  }
}

async function refreshProvisioningState() {
  try {
    provisioningError = "";
    provisioning = await getRuntimeProvisioning(runtime.id);
  } catch (error) {
    provisioningError = error instanceof Error ? error.message : "Failed to refresh provisioning status";
  }
}

async function handleSend() {
  const text = input.trim();
  const sessionId = activeSessionId;
  const state = sessionId ? sessionStateById[sessionId] : null;

  if (!text || sending || !sessionId || !state) {
    return;
  }

  const pendingText = text;
  input = "";
  sending = true;

  try {
    const result = await sendSessionMessage(sessionId, {
      text: pendingText,
      branchFromMessageId: state.branchFromMessageId ?? undefined,
    });

    const userMessage = result?.userMessage as SessionMessageRecord | undefined;
    if (userMessage) {
      sessionStateById = {
        ...sessionStateById,
        [sessionId]: {
          ...state,
          messages: [...state.messages, userMessage],
          currentLeafMessageId: userMessage.id,
          branchFromMessageId: null,
        },
      };
    }

    await loadSessionState(sessionId, true);
    await refreshRuntimeState();
    scrollToBottom();
  } catch (error) {
    streamError = error instanceof Error ? error.message : "Unknown error";
  } finally {
    sending = false;
  }
}

async function handleAbort() {
  if (!activeSessionId) return;
  try {
    await abortSession(activeSessionId);
  } catch (error) {
    streamError = error instanceof Error ? error.message : "Unknown error";
  }
}

async function handleSelectLeaf(messageId: string) {
  if (selectingLeaf || !activeSessionId || !activeSessionState) return;
  selectingLeaf = true;
  try {
    await selectSessionLeaf(activeSessionId, messageId);
    await loadSessionState(activeSessionId, true);
    scrollToBottom();
  } catch (error) {
    streamError = error instanceof Error ? error.message : "Failed to switch branch";
  } finally {
    selectingLeaf = false;
  }
}

function handleBranchFrom(messageId: string) {
  if (!activeSessionId || !activeSessionState) return;
  const nextValue = activeSessionState.branchFromMessageId === messageId ? null : messageId;
  sessionStateById = {
    ...sessionStateById,
    [activeSessionId]: {
      ...activeSessionState,
      branchFromMessageId: nextValue,
    },
  };
}

function handleAgentEvent(payload: Record<string, unknown>) {
  const type = typeof payload.type === "string" ? payload.type : "unknown";

  if (type === "message_start") {
    const message = payload.message as Record<string, unknown> | undefined;
    if (message?.role === "assistant") {
      streamingAssistantText = "";
    }
    return;
  }

  if (type === "message_update") {
    const delta = payload.assistantMessageEvent as Record<string, unknown> | undefined;
    const deltaType = typeof delta?.type === "string" ? delta.type : "";

    if (deltaType === "text_delta") {
      const deltaText = typeof delta?.delta === "string" ? delta.delta : "";
      streamingAssistantText = `${streamingAssistantText}${deltaText}`;
      scrollToBottom();
    }
    return;
  }

  if (type === "turn_end") {
    streamingAssistantText = "";
    if (runtime.currentSessionId) {
      void loadSessionState(runtime.currentSessionId, true);
    }
    void refreshRuntimeState();
    return;
  }

  if (type === "error") {
    streamError = typeof payload.error === "string" ? payload.error : "Runtime stream error";
  }
}

const fileTreePlaceholder = [
  "README.md",
  "apps/web/src/routes/runtimes/[id]/+page.svelte",
  "apps/web/src/lib/components/ChatTimeline.svelte",
  "apps/web/src/lib/components/SessionComposer.svelte",
  "notes/runtime-ui-plan.md",
];

onMount(() => {
  if (typeof localStorage !== "undefined") {
    const raw = localStorage.getItem(runtimeLayoutStorageKey);
    if (raw) {
      try {
        const parsed = JSON.parse(raw) as {
          leftSidebarCollapsed?: boolean;
          rightSidebarCollapsed?: boolean;
          leftSidebarWidth?: number;
          rightSidebarWidth?: number;
          sidebarMode?: "sessions" | "files";
          tabOrder?: string[];
        };

        leftSidebarCollapsed = parsed.leftSidebarCollapsed ?? leftSidebarCollapsed;
        rightSidebarCollapsed = parsed.rightSidebarCollapsed ?? rightSidebarCollapsed;
        leftSidebarWidth = Math.max(200, Math.min(420, parsed.leftSidebarWidth ?? leftSidebarWidth));
        rightSidebarWidth = Math.max(220, Math.min(420, parsed.rightSidebarWidth ?? rightSidebarWidth));
        sidebarMode = parsed.sidebarMode ?? sidebarMode;
        savedTabOrder = parsed.tabOrder ?? [];
      } catch (error) {
        console.warn("Failed to restore runtime detail layout", error);
      }
    }
  }

  hasLoadedLayoutPrefs = true;
  scrollToBottom();

  void Promise.all([refreshRuntimeState(), refreshProvisioningState()]);

  eventSource = new EventSource(getRuntimeStreamUrl(runtime.id), {
    withCredentials: true,
  });

  eventSource.addEventListener("ready", () => {
    streamStatus = "open";
    streamError = "";
  });

  eventSource.addEventListener("message", (event) => {
    try {
      const payload = JSON.parse((event as MessageEvent).data) as Record<string, unknown>;
      handleAgentEvent(payload);
    } catch (error) {
      streamError = error instanceof Error ? error.message : "Invalid event payload";
    }
  });

  eventSource.onerror = () => {
    streamStatus = "error";
    streamError = "Stream disconnected. Browser will retry automatically.";
  };

  provisioningPollingTimer = setInterval(() => {
    if (!isProvisioningDone) {
      void refreshProvisioningState();
      return;
    }

    if (provisioningPollingTimer) {
      clearInterval(provisioningPollingTimer);
      provisioningPollingTimer = null;
    }
  }, 1000);

  return () => {
    streamStatus = "closed";
    eventSource?.close();
    eventSource = null;
    if (provisioningPollingTimer) clearInterval(provisioningPollingTimer);
    provisioningPollingTimer = null;
  };
});
</script>

<div class="h-[100vh] overflow-hidden bg-[#0f0f0f] text-[#d6d2ca] [font-feature-settings:'ss01'_1,'cv05'_1]">
  <div class="grid h-full transition-[grid-template-columns] duration-200 ease-out" style={`grid-template-columns: ${gridTemplateColumns};`}>
    <aside class="relative flex min-h-0 flex-col border-r border-white/5 bg-[#111111] transition-all duration-200 ease-out">
      <div class={`flex items-center border-b border-white/5 ${leftSidebarCollapsed ? 'justify-center px-1 py-2' : 'justify-between px-3 py-2'}`}>
        {#if leftSidebarCollapsed}
          <button
            type="button"
            class="flex h-7 w-7 items-center justify-center rounded-md text-[11px] text-white/32 transition-all duration-150 hover:bg-white/[0.035] hover:text-white/84 cursor-pointer"
            onclick={() => {
              leftSidebarCollapsed = false;
              persistLayoutPrefs();
            }}
            title="Expand navigator"
          >
            ≡
          </button>
        {:else}
          <div class="flex w-full items-center justify-between gap-1">
            <div class="text-[10px] font-medium uppercase tracking-[0.28em] text-white/30">Navigator</div>
            <div class="flex items-center gap-1">
              <div class="flex items-center gap-1 rounded-md bg-white/[0.02] p-0.5 text-[11px]">
                <button
                  type="button"
                  class={`rounded px-2 py-1 transition-all duration-150 cursor-pointer ${sidebarMode === 'sessions' ? 'bg-white/[0.055] text-white/86 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.03)]' : 'text-white/36 hover:text-white/70'}`}
                  onclick={() => {
                    sidebarMode = 'sessions';
                    persistLayoutPrefs();
                  }}
                >
                  sessions
                </button>
                <button
                  type="button"
                  class={`rounded px-2 py-1 transition-all duration-150 cursor-pointer ${sidebarMode === 'files' ? 'bg-white/[0.055] text-white/86 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.03)]' : 'text-white/36 hover:text-white/70'}`}
                  onclick={() => {
                    sidebarMode = 'files';
                    persistLayoutPrefs();
                  }}
                >
                  files
                </button>
              </div>
              <button
                type="button"
                class="flex h-7 w-7 items-center justify-center rounded-md text-[11px] text-white/28 transition-all duration-150 hover:bg-white/[0.035] hover:text-white/84 cursor-pointer"
                onclick={() => {
                  leftSidebarCollapsed = true;
                  persistLayoutPrefs();
                }}
                title="Collapse navigator"
              >
                ←
              </button>
            </div>
          </div>
        {/if}
      </div>

      {#if !leftSidebarCollapsed && sidebarMode === 'sessions'}
        <div class="min-h-0 flex-1 overflow-y-auto px-2 py-2">
          <div class="mb-2 px-2 text-[9px] font-semibold uppercase tracking-[0.28em] text-white/22">Runtime sessions</div>
          {#if runtimeSessions.length === 0}
            <div class="px-2 py-2 text-sm text-white/35">No session yet.</div>
          {:else}
            <div class="space-y-0.5">
              {#each runtimeSessions as item, index (item.id)}
                <button
                  type="button"
                  class={`w-full rounded-md px-2 py-1.5 text-left transition-all duration-150 cursor-pointer ${activeSessionId === item.id ? 'bg-white/[0.055] text-white shadow-[inset_0_0_0_1px_rgba(255,255,255,0.045)]' : 'text-white/50 hover:bg-white/[0.028] hover:text-white/84'}`}
                  onclick={() => openSessionTab(item)}
                >
                  <div class="flex items-center gap-2">
                    <span class={`w-3 shrink-0 text-center text-[10px] ${runtime.currentSessionId === item.id ? 'text-white/64' : 'text-white/20'}`}>
                      {getSessionListIcon(item)}
                    </span>
                    <div class="min-w-0 truncate text-[11px] font-medium leading-[1.35] tracking-[-0.01em]">{getSessionTitle(item, index)}</div>
                  </div>
                  <div class="mt-0.5 flex items-center gap-2 pl-5 text-[9px] font-medium uppercase tracking-[0.18em] text-white/22">
                    <span>{item.protocol ?? 'unknown'}</span>
                    <span>·</span>
                    <span>{item.totalMessages ?? 0} msgs</span>
                    {#if runtime.currentSessionId === item.id}
                      <span>· current</span>
                    {/if}
                  </div>
                </button>
              {/each}
            </div>
          {/if}

          {#if activeSessionState}
            <div class="mt-4 border-t border-white/5 pt-3">
              <div class="mb-2 px-2 text-[9px] font-semibold uppercase tracking-[0.28em] text-white/22">Branch map</div>
              <div class="h-[calc(100vh-21rem)] min-h-[220px] overflow-hidden rounded-md bg-white/[0.015]">
                <SessionTreePanel
                  nodes={activeSessionState.treeNodes}
                  currentLeafMessageId={activeSessionState.currentLeafMessageId}
                  selectedBranchFromId={activeSessionState.branchFromMessageId}
                  onSelectLeaf={handleSelectLeaf}
                  onBranchFrom={handleBranchFrom}
                />
              </div>
            </div>
          {/if}
        </div>
      {:else if !leftSidebarCollapsed}
        <div class="min-h-0 flex-1 overflow-y-auto px-2 py-2">
          <div class="mb-2 px-2 text-[9px] font-semibold uppercase tracking-[0.28em] text-white/22">Workspace files</div>
          <div class="mb-3 px-2 text-[11px] leading-[1.55] text-white/32">Placeholder for file tree. You can already open simulated file tabs below.</div>
          <div class="space-y-0.5">
            {#each fileTreePlaceholder as path (path)}
              <button
                type="button"
                class="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[12px] text-white/48 transition-all duration-150 hover:bg-white/[0.028] hover:text-white/84 cursor-pointer"
                onclick={() => openFilePlaceholder(path)}
              >
                <span class="w-3 shrink-0 text-center text-white/22">≡</span>
                <span class="truncate">{path}</span>
              </button>
            {/each}
          </div>
        </div>
      {:else}
        <div class="flex min-h-0 flex-1 flex-col items-center justify-start gap-2 px-1 py-2">
          <button
            type="button"
            class={`flex h-8 w-8 items-center justify-center rounded-md text-[11px] transition-colors cursor-pointer ${sidebarMode === 'sessions' ? 'bg-white/[0.06] text-white/88' : 'text-white/34 hover:bg-white/[0.04] hover:text-white/70'}`}
            onclick={() => {
              sidebarMode = 'sessions';
              persistLayoutPrefs();
            }}
            title="Sessions"
          >
            ◌
          </button>
          <button
            type="button"
            class={`flex h-8 w-8 items-center justify-center rounded-md text-[11px] transition-colors cursor-pointer ${sidebarMode === 'files' ? 'bg-white/[0.06] text-white/88' : 'text-white/34 hover:bg-white/[0.04] hover:text-white/70'}`}
            onclick={() => {
              sidebarMode = 'files';
              persistLayoutPrefs();
            }}
            title="Files"
          >
            ≡
          </button>
        </div>
      {/if}
    </aside>

    {#if !leftSidebarCollapsed}
      <button
        type="button"
        class={`group relative z-10 w-[4px] cursor-col-resize bg-transparent transition-colors ${resizingSidebar === 'left' ? 'bg-white/12' : 'hover:bg-white/8'}`}
        aria-label="Resize left sidebar"
        onmousedown={(event) => startSidebarResize('left', event)}
      >
        <div class="absolute inset-y-0 left-0 right-0 mx-auto w-px bg-white/0 transition-colors group-hover:bg-white/18"></div>
      </button>
    {/if}

    <main class="flex min-h-0 flex-col bg-[#141414] transition-colors duration-200 ease-out">
      <div class="flex items-center justify-between border-b border-white/5 bg-[#111111] px-1.5 py-1">
        <div class="flex min-w-0 flex-1 items-stretch overflow-x-auto">
          {#each tabs as tab (tab.key)}
            <div
              class={`group relative flex max-w-[220px] shrink-0 items-center gap-2 border-r border-white/5 px-3 py-2 text-left text-[12px] transition-all duration-150 ${getTabSelectionClass(tab)} ${draggingTabKey === tab.key ? 'opacity-60' : ''} ${dragOverTabKey === tab.key && draggingTabKey !== tab.key ? 'bg-white/[0.028]' : ''}`}
              role="button"
              tabindex="0"
              draggable="true"
              onclick={() => (activeTabKey = tab.key)}
              ondragstart={() => handleTabDragStart(tab.key)}
              ondragover={(event) => {
                event.preventDefault();
                handleTabDragOver(tab.key);
              }}
              ondragend={handleTabDragEnd}
              ondrop={(event) => {
                event.preventDefault();
                handleTabDragEnd();
              }}
              onkeydown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  activeTabKey = tab.key;
                }
              }}
            >
              <span class={`flex h-4 w-4 shrink-0 items-center justify-center text-[10px] ${activeTabKey === tab.key ? 'text-white/72' : 'text-white/28'}`}>
                {getTabIcon(tab)}
              </span>
              {#if tab.type === 'session'}
                <span class={`h-1.5 w-1.5 shrink-0 rounded-full transition-all ${isStreamingTab(tab) ? streamIndicatorClass : tab.sessionId === runtime.currentSessionId ? 'bg-white/24' : 'bg-transparent'}`}></span>
              {/if}
              <span class="truncate leading-5">{tab.title}</span>
              <span class="text-[9px] uppercase tracking-[0.2em] text-white/18">
                {tab.type}
              </span>
              <button
                type="button"
                class="ml-auto flex h-5 w-5 items-center justify-center rounded text-white/0 transition-all duration-150 group-hover:text-white/34 hover:bg-white/[0.04] hover:text-white/84 cursor-pointer"
                onclick={(event) => {
                  event.stopPropagation();
                  closeTab(tab.key);
                }}
              >
                ×
              </button>
            </div>
          {/each}
        </div>
        <button
          type="button"
          class="ml-2 flex h-7 w-7 items-center justify-center rounded-md text-[13px] text-white/34 transition-all duration-150 hover:bg-white/[0.03] hover:text-white/86 cursor-pointer"
          onclick={createDraftTab}
          title="New tab"
        >
          +
        </button>
      </div>

      <div class="flex min-h-0 flex-1 flex-col">
        <div class="flex items-center justify-between border-b border-white/5 px-4 py-2 text-[11px] text-white/34">
          <div class="flex min-w-0 items-center gap-3 overflow-hidden">
            <span class="truncate">{runtime.title ?? 'Untitled runtime'}</span>
            <span>·</span>
            <span class="flex items-center gap-2">
              <span class={`h-1.5 w-1.5 rounded-full ${streamIndicatorClass}`}></span>
              <span class={`${streamStatus === 'open' ? 'text-emerald-300/80' : streamStatus === 'error' ? 'text-red-300/80' : 'text-amber-200/80'}`}>{streamStatus}</span>
            </span>
            {#if activeSessionState?.branchFromMessageId}
              <span>· branching enabled</span>
            {/if}
          </div>
          <div class="flex items-center gap-2">
            {#if activeSessionId}
              <button
                type="button"
                class="rounded border border-white/6 px-2 py-1 text-[10px] uppercase tracking-[0.18em] text-white/40 transition-all duration-150 hover:border-white/12 hover:bg-white/[0.025] hover:text-white/78 cursor-pointer"
                onclick={handleAbort}
              >
                abort
              </button>
            {/if}
          </div>
        </div>

        {#if runtimeLoadError}
          <div class="border-b border-red-400/12 bg-red-400/[0.04] px-4 py-2 text-[11px] text-red-200/76">{runtimeLoadError}</div>
        {/if}
        {#if provisioningError}
          <div class="border-b border-red-400/12 bg-red-400/[0.04] px-4 py-2 text-[11px] text-red-200/76">{provisioningError}</div>
        {/if}
        {#if !isRuntimeReady}
          <div class="border-b border-white/5 bg-white/[0.018] px-4 py-2.5 text-[11px] text-white/42">
            Runtime is preparing. Provisioning status: <span class="text-white/75">{provisioning?.status ?? 'queued'}</span>
            {#if provisioning?.currentMessage}
              <span class="ml-2 text-white/35">{provisioning.currentMessage}</span>
            {/if}
          </div>
        {/if}

        {#if activeTab?.type === 'draft'}
          <div class="flex min-h-0 flex-1 flex-col items-center justify-center px-8 text-center">
            <div class="max-w-md space-y-3">
              <div class="text-[10px] font-medium uppercase tracking-[0.28em] text-white/26">New session</div>
              <h2 class="text-[22px] font-normal tracking-[-0.02em] text-white/90">Draft tab ready</h2>
              <p class="text-[13px] leading-6 text-white/42">
                This tab is a lightweight placeholder for a new session. Once backend session creation is available on this page,
                the + action can directly instantiate a real session here.
              </p>
            </div>
          </div>
        {:else if activeTab?.type === 'file'}
          <div class="min-h-0 flex-1 overflow-auto bg-[#131313] px-5 py-4 font-mono text-[11px] leading-6 text-white/68">
            <div class="mb-4 text-[10px] font-medium uppercase tracking-[0.24em] text-white/24">File preview · placeholder</div>
            <div class="rounded-md border border-white/5 bg-[#0f0f0f] p-4">
              <div class="mb-3 text-white/35">{activeTab.path}</div>
              <div class="grid grid-cols-[36px_minmax(0,1fr)] gap-x-4">
                {#each Array.from({ length: 14 }) as _, index}
                  <div class="select-none text-right text-white/20">{index + 1}</div>
                  <div class="whitespace-pre-wrap break-words">{index === 0
                    ? "// File tree is not connected yet."
                    : index === 1
                      ? "// This tab demonstrates the future multi-document workspace."
                      : index === 3
                        ? `<${activeTab.title}>`
                        : index === 5
                          ? "export const placeholder = true;"
                          : index === 7
                            ? "// Minimal. Compact. Quiet."
                            : ""}</div>
                {/each}
              </div>
            </div>
          </div>
        {:else if activeSessionState}
          <div class="min-h-0 flex-1 flex-col">
            {#if activeSessionState.error}
              <div class="border-b border-red-400/12 bg-red-400/[0.04] px-4 py-2 text-[11px] text-red-200/76">{activeSessionState.error}</div>
            {/if}
            <ChatTimeline bind:bindListEl={listEl} {timeline} />
            <SessionComposer
              bind:value={input}
              sending={sending || !activeSessionId || !isRuntimeReady}
              {streamError}
              onSubmit={() => void handleSend()}
            />
          </div>
        {:else}
          <div class="flex min-h-0 flex-1 items-center justify-center px-8 text-[13px] text-white/36">
            Select a session from the left sidebar.
          </div>
        {/if}
      </div>
    </main>

    {#if !rightSidebarCollapsed}
      <button
        type="button"
        class={`group relative z-10 w-[4px] cursor-col-resize bg-transparent transition-colors ${resizingSidebar === 'right' ? 'bg-white/12' : 'hover:bg-white/8'}`}
        aria-label="Resize right sidebar"
        onmousedown={(event) => startSidebarResize('right', event)}
      >
        <div class="absolute inset-y-0 left-0 right-0 mx-auto w-px bg-white/0 transition-colors group-hover:bg-white/18"></div>
      </button>
    {/if}

    <aside class="relative flex min-h-0 flex-col border-l border-white/5 bg-[#111111] transition-all duration-200 ease-out">
      <div class={`border-b border-white/5 ${rightSidebarCollapsed ? 'px-1 py-2' : 'px-4 py-3'}`}>
        {#if rightSidebarCollapsed}
          <button
            type="button"
            class="flex h-7 w-7 items-center justify-center rounded-md text-[11px] text-white/32 transition-all duration-150 hover:bg-white/[0.035] hover:text-white/84 cursor-pointer"
            onclick={() => {
              rightSidebarCollapsed = false;
              persistLayoutPrefs();
            }}
            title="Expand metadata"
          >
            ≣
          </button>
        {:else}
          <div class="flex items-center justify-between gap-2">
            <div class="text-[10px] font-semibold uppercase tracking-[0.28em] text-white/28">Metadata</div>
            <button
              type="button"
              class="flex h-7 w-7 items-center justify-center rounded-md text-[11px] text-white/28 transition-all duration-150 hover:bg-white/[0.035] hover:text-white/84 cursor-pointer"
              onclick={() => {
                rightSidebarCollapsed = true;
                persistLayoutPrefs();
              }}
              title="Collapse metadata"
            >
              →
            </button>
          </div>
        {/if}
      </div>

      {#if !rightSidebarCollapsed}
        <div class="min-h-0 flex-1 overflow-y-auto px-4 py-3">
          <div class="space-y-3">
            <section>
              <div class="mb-2 text-[9px] font-semibold uppercase tracking-[0.28em] text-white/22">Overview</div>
              <div class="space-y-1.5 text-[11px]">
                {#each rightMetaItems as [label, value]}
                  <div class="grid grid-cols-[92px_minmax(0,1fr)] gap-3">
                    <div class="text-white/22">{label}</div>
                    <div class="truncate text-white/66" title={value}>{value}</div>
                  </div>
                {/each}
              </div>
            </section>

            {#if provisioning}
              <section class="border-t border-white/5 pt-3">
                <div class="mb-2 text-[9px] font-semibold uppercase tracking-[0.28em] text-white/22">Provisioning</div>
                <div class="space-y-2 text-[11px] text-white/56">
                  <div class="flex items-center justify-between gap-2">
                    <span>status</span>
                    <span>{provisioning.status}</span>
                  </div>
                  {#if provisioning.currentStep}
                    <div class="flex items-center justify-between gap-2">
                      <span>step</span>
                      <span>{provisioning.currentStep}</span>
                    </div>
                  {/if}
                  {#if provisioning.currentMessage}
                    <div class="rounded-md bg-white/[0.025] px-2 py-2 text-white/42">
                      {provisioning.currentMessage}
                    </div>
                  {/if}
                </div>
              </section>
            {/if}

            {#if runtime.meta}
              <section class="border-t border-white/5 pt-3">
                <div class="mb-2 text-[9px] font-semibold uppercase tracking-[0.28em] text-white/22">Runtime meta</div>
                <pre class="overflow-x-auto whitespace-pre-wrap break-words rounded-md bg-white/[0.025] p-3 text-[10px] leading-5 text-white/46">{JSON.stringify(runtime.meta, null, 2)}</pre>
              </section>
            {/if}
          </div>
        </div>
      {:else}
        <div class="flex min-h-0 flex-1 flex-col items-center justify-start gap-2 px-1 py-2">
          <div class="text-[10px] uppercase tracking-[0.18em] text-white/20 [writing-mode:vertical-rl] rotate-180">meta</div>
        </div>
      {/if}
    </aside>
  </div>
</div>
