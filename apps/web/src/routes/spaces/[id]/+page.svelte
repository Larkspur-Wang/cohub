<script lang="ts">
import { goto } from "$app/navigation";
import { page } from "$app/state";
import {
  createSpaceSession,
  createSpaceFsDir,
  deleteSpaceFsNode,
  getSessionMessages,
  getSpaceFsFile,
  getSpaceFsTree,
  moveSpaceFsNode,
  postSessionMessage,
  putSpaceFsFile,
  triggerSpaceFsDownload,
  type SessionRecord,
  type SpaceFsEntry,
  type SpaceFsFileResponse,
  type SpaceRecord,
} from "$lib/api";
import { spaceStore } from "$lib/stores/space-store.svelte";
import PageHeader from "$lib/components/PageHeader.svelte";
import SessionComposer from "$lib/components/SessionComposer.svelte";
import SpaceFilePane from "$lib/components/SpaceFilePane.svelte";
import SpaceFileSidebar from "$lib/components/SpaceFileSidebar.svelte";
import type { SpaceFsNode } from "$lib/space-fs";
import type { MessageRecord } from "@cohub/protocol";
import { FolderKanban, Loader2, MessageSquare, Plus } from "lucide-svelte";
import { onMount } from "svelte";

type Props = {
  data: {
    spaceId: string;
  };
};

const props = $props();
const data = $derived((props as Props).data);
const spaceId = $derived(data.spaceId);
const urlSessionId = $derived(page.url.searchParams.get("session"));

let space = $state<SpaceRecord | null>(null);
let sessions = $state<SessionRecord[]>([]);
let activeSessionId = $state<string | null>(null);
let messages = $state<MessageRecord[]>([]);
let loadingSpace = $state(true);
let loadingMessages = $state(false);
let creatingSession = $state(false);
let sending = $state(false);
let pageError = $state("");
let input = $state("");

let fileTree = $state<SpaceFsNode[]>([]);
let fileTreeLoading = $state(false);
let fileTreeError = $state<string | null>(null);
let openFile = $state<SpaceFsFileResponse | null>(null);
let openFileDraft = $state("");
let openFileLoading = $state(false);
let openFileSaving = $state(false);
let openFileError = $state<string | null>(null);
let openFileTooLarge = $state(false);

const activeSession = $derived(sessions.find((session) => session.id === activeSessionId) ?? null);
const fileDirty = $derived(Boolean(openFile && openFile.kind === "text" && openFileDraft !== openFile.content));

function nodeFromEntry(entry: SpaceFsEntry): SpaceFsNode {
  return {
    ...entry,
    children: [],
    isOpen: false,
    isLoaded: false,
    isLoading: false,
  };
}

function replaceNodeChildren(nodes: SpaceFsNode[], nodePath: string, children: SpaceFsNode[]): SpaceFsNode[] {
  return nodes.map((node) => {
    if (node.path === nodePath) {
      return { ...node, children, isOpen: true, isLoaded: true, isLoading: false };
    }
    if (node.children.length > 0) {
      return { ...node, children: replaceNodeChildren(node.children, nodePath, children) };
    }
    return node;
  });
}

function updateNodeState(nodes: SpaceFsNode[], nodePath: string, updater: (node: SpaceFsNode) => SpaceFsNode): SpaceFsNode[] {
  return nodes.map((node) => {
    if (node.path === nodePath) {
      return updater(node);
    }
    if (node.children.length > 0) {
      return { ...node, children: updateNodeState(node.children, nodePath, updater) };
    }
    return node;
  });
}

async function loadSpacePage(force = false) {
  loadingSpace = true;
  pageError = "";
  try {
    const [spaceData, sessionData] = await Promise.all([
      spaceStore.ensureSpaceDetail(spaceId, { force }),
      spaceStore.ensureSpaceSessions(spaceId, { force }),
    ]);
    space = spaceData;
    sessions = sessionData;
    const nextSessionId = urlSessionId && sessions.some((session) => session.id === urlSessionId)
      ? urlSessionId
      : sessionData[0]?.id ?? null;
    activeSessionId = nextSessionId;
    if (force || fileTree.length === 0) {
      await loadFileTree(true);
    }
  } catch (error) {
    pageError = error instanceof Error ? error.message : "Failed to load space";
  } finally {
    loadingSpace = false;
  }
}

async function loadMessages(sessionId: string) {
  loadingMessages = true;
  try {
    const result = await getSessionMessages(sessionId);
    messages = result.messages ?? [];
  } catch (error) {
    pageError = error instanceof Error ? error.message : "Failed to load messages";
  } finally {
    loadingMessages = false;
  }
}

async function selectSession(sessionId: string) {
  activeSessionId = sessionId;
  messages = [];
  await goto(`/spaces/${spaceId}?session=${sessionId}`, { replaceState: true, keepFocus: true, noScroll: true });
  await loadMessages(sessionId);
}

async function handleCreateSession() {
  if (creatingSession) return;
  creatingSession = true;
  try {
    const result = await createSpaceSession(spaceId, { source: "web" });
    sessions = [result.session, ...sessions];
    await selectSession(result.session.id);
  } catch (error) {
    pageError = error instanceof Error ? error.message : "Failed to create session";
  } finally {
    creatingSession = false;
  }
}

async function handleSubmit() {
  if (!activeSession || sending || !input.trim()) return;
  sending = true;
  try {
    // TODO: 恢复旧版完整的流式聊天体验：SSE、乐观更新、分页缓存、模型选择与附件支持。
    await postSessionMessage(activeSession.id, [{ type: "text", text: input.trim() }]);
    input = "";
    await loadMessages(activeSession.id);
  } catch (error) {
    pageError = error instanceof Error ? error.message : "Failed to send message";
  } finally {
    sending = false;
  }
}

async function loadFileTree(force = false) {
  if (fileTreeLoading && !force) return;
  fileTreeLoading = true;
  fileTreeError = null;
  try {
    const tree = await getSpaceFsTree(spaceId, "");
    fileTree = tree.entries.map(nodeFromEntry);
  } catch (error) {
    fileTreeError = error instanceof Error ? error.message : "Failed to load files";
  } finally {
    fileTreeLoading = false;
  }
}

async function expandDirectory(node: SpaceFsNode) {
  if (node.isLoaded) {
    fileTree = updateNodeState(fileTree, node.path, (current) => ({ ...current, isOpen: !current.isOpen }));
    return;
  }
  fileTree = updateNodeState(fileTree, node.path, (current) => ({ ...current, isLoading: true, isOpen: true }));
  try {
    const tree = await getSpaceFsTree(spaceId, node.path);
    fileTree = replaceNodeChildren(fileTree, node.path, tree.entries.map(nodeFromEntry));
  } catch (error) {
    fileTreeError = error instanceof Error ? error.message : "Failed to load directory";
    fileTree = updateNodeState(fileTree, node.path, (current) => ({ ...current, isLoading: false }));
  }
}

async function openSpaceFile(path: string) {
  openFileLoading = true;
  openFileError = null;
  openFileTooLarge = false;
  try {
    const file = await getSpaceFsFile(spaceId, path);
    openFile = file;
    openFileDraft = file.kind === "text" ? file.content : "";
    await goto(`/spaces/${spaceId}?${new URLSearchParams(activeSessionId ? { session: activeSessionId, file: path } : { file: path }).toString()}`, { replaceState: true, keepFocus: true, noScroll: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to open file";
    if (message.includes("413") || message.includes("too large")) {
      openFileTooLarge = true;
      openFile = null;
      openFileDraft = "";
      openFileError = null;
    } else {
      openFileError = message;
    }
  } finally {
    openFileLoading = false;
  }
}

function closeFile() {
  openFile = null;
  openFileDraft = "";
  openFileError = null;
  openFileTooLarge = false;
}

async function saveOpenFile() {
  if (!openFile || openFile.kind !== "text") return;
  openFileSaving = true;
  openFileError = null;
  try {
    await putSpaceFsFile(spaceId, { path: openFile.path, content: openFileDraft, encoding: "utf-8" });
    openFile = { ...openFile, content: openFileDraft, size: new Blob([openFileDraft]).size };
    await loadFileTree(true);
  } catch (error) {
    openFileError = error instanceof Error ? error.message : "Failed to save file";
  } finally {
    openFileSaving = false;
  }
}

async function handleCreateFile(parentPath: string) {
  const name = prompt("New file name");
  if (!name?.trim()) return;
  const path = parentPath ? `${parentPath}/${name.trim()}` : name.trim();
  try {
    await putSpaceFsFile(spaceId, { path, content: "", encoding: "utf-8" });
    await loadFileTree(true);
    await openSpaceFile(path);
  } catch (error) {
    fileTreeError = error instanceof Error ? error.message : "Failed to create file";
  }
}

async function handleCreateDir(parentPath: string) {
  const name = prompt("New folder name");
  if (!name?.trim()) return;
  const path = parentPath ? `${parentPath}/${name.trim()}` : name.trim();
  try {
    await createSpaceFsDir(spaceId, path);
    await loadFileTree(true);
  } catch (error) {
    fileTreeError = error instanceof Error ? error.message : "Failed to create folder";
  }
}

async function handleRenameNode(node: SpaceFsNode) {
  const nextName = prompt("Rename", node.name);
  if (!nextName?.trim() || nextName.trim() === node.name) return;
  const parent = node.path.includes("/") ? node.path.slice(0, node.path.lastIndexOf("/")) : "";
  const toPath = parent ? `${parent}/${nextName.trim()}` : nextName.trim();
  try {
    await moveSpaceFsNode(spaceId, { fromPath: node.path, toPath });
    await loadFileTree(true);
    if (openFile?.path === node.path) {
      await openSpaceFile(toPath);
    }
  } catch (error) {
    fileTreeError = error instanceof Error ? error.message : "Failed to rename";
  }
}

async function handleDeleteNode(node: SpaceFsNode) {
  if (!confirm(`Delete ${node.name}?`)) return;
  try {
    await deleteSpaceFsNode(spaceId, node.path, node.type === "dir");
    await loadFileTree(true);
    if (openFile?.path === node.path) {
      closeFile();
    }
  } catch (error) {
    fileTreeError = error instanceof Error ? error.message : "Failed to delete";
  }
}

onMount(() => {
  void loadSpacePage();
});

$effect(() => {
  const sessionId = activeSessionId;
  if (sessionId) {
    void loadMessages(sessionId);
  }
});
</script>

<div class="flex-1 flex flex-col min-h-0 overflow-hidden bg-bg-content">
  <PageHeader>
    {#snippet left()}
      <div class="flex items-center gap-2 min-w-0">
        <FolderKanban class="w-4 h-4 text-text-tertiary shrink-0" />
        <span class="text-[13px] font-medium text-text-primary truncate">{space?.name || space?.title || spaceId}</span>
      </div>
    {/snippet}
    {#snippet right()}
      <button
        type="button"
        class="flex items-center gap-1.5 px-2.5 py-1 rounded-[5px] text-[12px] bg-[#FF3E00]/10 border border-[#FF3E00]/20 text-brand font-medium hover:bg-[#FF3E00]/15 transition-colors disabled:opacity-60"
        onclick={handleCreateSession}
        disabled={creatingSession}
      >
        {#if creatingSession}
          <Loader2 class="w-3.5 h-3.5 animate-spin" />
        {:else}
          <Plus class="w-3.5 h-3.5" />
        {/if}
        New Session
      </button>
    {/snippet}
  </PageHeader>

  {#if pageError}
    <div class="mx-4 mt-4 rounded-md border border-error-soft/30 bg-error-bg p-3 text-[12px] font-mono text-error-soft break-all">{pageError}</div>
  {/if}

  <div class="flex-1 min-h-0 grid grid-cols-[220px_minmax(0,1fr)_320px]">
    <aside class="border-r border-border-subtle bg-bg-primary min-h-0 overflow-y-auto">
      <div class="p-3 border-b border-border-subtle text-[11px] uppercase tracking-[0.12em] text-text-tertiary">Sessions</div>
      <div class="p-2 space-y-1">
        {#if loadingSpace}
          <div class="px-2 py-3 text-[12px] text-text-tertiary">Loading…</div>
        {:else if sessions.length === 0}
          <div class="px-2 py-3 text-[12px] text-text-tertiary">No sessions yet</div>
        {:else}
          {#each sessions as session (session.id)}
            <button
              type="button"
              class="w-full text-left px-2.5 py-2 rounded-[6px] transition-colors {session.id === activeSessionId ? 'bg-bg-hover text-text-primary' : 'text-text-secondary hover:bg-bg-hover'}"
              onclick={() => selectSession(session.id)}
            >
              <div class="text-[13px] truncate">{session.title || session.latestMessageText || `Session ${session.id.slice(0, 8)}`}</div>
              <div class="text-[11px] text-text-tertiary truncate mt-0.5">{session.updatedAt || session.createdAt}</div>
            </button>
          {/each}
        {/if}
      </div>
    </aside>

    <section class="min-w-0 min-h-0 flex flex-col border-r border-border-subtle">
      {#if !activeSession}
        <div class="flex-1 flex flex-col items-center justify-center gap-3 text-center px-6 text-text-tertiary">
          <MessageSquare class="w-6 h-6" />
          <div class="text-[14px]">Create or select a session to start chatting.</div>
        </div>
      {:else}
        <div class="flex-1 min-h-0 overflow-y-auto px-4 py-4 space-y-3">
          {#if loadingMessages}
            <div class="text-[12px] text-text-tertiary">Loading messages…</div>
          {:else if messages.length === 0}
            <div class="text-[12px] text-text-tertiary">No messages yet.</div>
          {:else}
            {#each messages as message (message.id)}
              <div class="rounded-[10px] border border-border-subtle bg-bg-primary px-3 py-2">
                <div class="text-[11px] text-text-tertiary mb-1">{message.role}</div>
                <div class="text-[13px] text-text-primary whitespace-pre-wrap break-words">{message.content.map((block) => block.type === 'text' ? block.text : '').join('\n').trim() || '[non-text content]'}</div>
              </div>
            {/each}
          {/if}
        </div>
        <SessionComposer bind:value={input} disabled={sending || !activeSession} onsubmit={handleSubmit} />
      {/if}
    </section>

    <section class="min-w-0 min-h-0 flex">
      <div class="w-[280px] border-r border-border-subtle min-h-0">
        <SpaceFileSidebar
          nodes={fileTree}
          selectedPath={openFile?.path ?? ""}
          loading={fileTreeLoading}
          error={fileTreeError}
          onToggle={expandDirectory}
          onSelect={(node) => { if (node.type !== 'dir') void openSpaceFile(node.path); }}
          onRefresh={() => loadFileTree(true)}
          onCreateFile={handleCreateFile}
          onCreateDir={handleCreateDir}
          onRename={handleRenameNode}
          onDelete={handleDeleteNode}
          canWrite={true}
        />
      </div>
      <div class="flex-1 min-w-0 min-h-0">
        <SpaceFilePane
          file={openFile}
          draftContent={openFileDraft}
          dirty={fileDirty}
          loading={openFileLoading}
          saving={openFileSaving}
          error={openFileError}
          onInput={(value) => openFileDraft = value}
          onSave={saveOpenFile}
          onClose={closeFile}
          onDownload={() => openFile && triggerSpaceFsDownload(spaceId, openFile.path)}
        >
          {#if openFileTooLarge}
            <div class="px-4 py-3 text-[12px] text-text-tertiary">This file is too large to preview. Download it instead.</div>
          {/if}
        </SpaceFilePane>
      </div>
    </section>
  </div>
</div>
