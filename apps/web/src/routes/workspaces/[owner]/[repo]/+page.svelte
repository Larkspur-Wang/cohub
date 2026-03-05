<script lang="ts">
  import { onMount } from "svelte";

  import { getFile, getTree, getWorkspace } from "$lib/api";
  import ChatPanel from "$lib/components/ChatPanel.svelte";
  import FileTree from "$lib/components/FileTree.svelte";
  import FileViewer from "$lib/components/FileViewer.svelte";
  import { renderMarkdown } from "$lib/markdown";
  import type { TreeNode, WorkspaceEntry } from "$lib/types";
  import { isMarkdown } from "$lib/utils";

  interface PageData {
    owner: string;
    repo: string;
    workspace: {
      full_name?: string;
      default_branch?: string;
    } | null;
    initialTreeEntries: WorkspaceEntry[];
    readmeContent: { content: string } | null;
  }

  const { data }: { data: PageData } = $props();

  const owner = $derived(data.owner);
  const repo = $derived(data.repo);
  const ref = $derived(data.workspace?.default_branch);
  const workspaceTitle = $derived(data.workspace?.full_name ?? `${data.owner}/${data.repo}`);

  let rootNodes = $state<TreeNode[]>([]);
  let selectedPath = $state("");
  let fileContent = $state("");
  let markdownHtml = $state("");
  let fileLoading = $state(false);
  let pageLoading = $state(true);
  let error = $state<string | null>(null);

  const toNode = (entry: WorkspaceEntry): TreeNode => ({
    ...entry,
    children: [],
    isOpen: false,
    isLoaded: false,
    isLoading: false
  });

  const loadDirectory = async (path = "") => {
    const data = (await getTree(owner, repo, path, ref)) as {
      entries: WorkspaceEntry[];
    };
    return data.entries.map(toNode);
  };

  const walkNodes = (
    nodes: TreeNode[],
    path: string,
    updater: (node: TreeNode) => void
  ): boolean => {
    for (const node of nodes) {
      if (node.path === path) {
        updater(node);
        return true;
      }
      if (node.children.length > 0 && walkNodes(node.children, path, updater)) {
        return true;
      }
    }
    return false;
  };

  const selectFile = async (path: string) => {
    selectedPath = path;
    fileLoading = true;
    error = null;

    try {
      const data = (await getFile(owner, repo, path, ref)) as {
        content: string;
      };
      fileContent = data.content;
      markdownHtml = isMarkdown(path) ? await renderMarkdown(data.content) : "";
    } catch {
      error = "Failed to load file.";
      fileContent = "";
      markdownHtml = "";
    } finally {
      fileLoading = false;
    }
  };

  const pickDefaultFile = (nodes: TreeNode[]) => {
    for (const node of nodes) {
      if (node.type === "file" && node.name.toLowerCase() === "readme.md") {
        return node.path;
      }
    }
    for (const node of nodes) {
      if (node.type === "file") {
        return node.path;
      }
    }
    return "";
  };

  const onToggle = async (node: TreeNode) => {
    if (node.type !== "dir") {
      return;
    }

    if (node.isOpen) {
      walkNodes(rootNodes, node.path, (target) => {
        target.isOpen = false;
      });
      rootNodes = [...rootNodes];
      return;
    }

    if (!node.isLoaded) {
      walkNodes(rootNodes, node.path, (target) => {
        target.isLoading = true;
      });
      rootNodes = [...rootNodes];

      try {
        const children = await loadDirectory(node.path);
        walkNodes(rootNodes, node.path, (target) => {
          target.children = children;
          target.isLoaded = true;
          target.isOpen = true;
          target.isLoading = false;
        });
      } catch {
        walkNodes(rootNodes, node.path, (target) => {
          target.isLoading = false;
        });
        error = "Failed to load folder.";
      }

      rootNodes = [...rootNodes];
      return;
    }

    walkNodes(rootNodes, node.path, (target) => {
      target.isOpen = true;
    });
    rootNodes = [...rootNodes];
  };

  const onSelect = async (node: TreeNode) => {
    if (node.type !== "file") {
      return;
    }

    await selectFile(node.path);
  };

  onMount(async () => {
    // SSR 已经提供了初始数据，只需要选择默认文件并渲染
    rootNodes = data.initialTreeEntries.map(toNode);
    const defaultFile = pickDefaultFile(rootNodes);
    if (defaultFile) {
      await selectFile(defaultFile);
    } else if (data.readmeContent) {
      // 如果 SSR 预加载了 README，直接使用
      fileContent = data.readmeContent.content;
      markdownHtml = await renderMarkdown(data.readmeContent.content);
      selectedPath = "README.md";
    }
    pageLoading = false;
  });
</script>

<main class="workspace-page">
  <header class="topbar">
    <strong>{workspaceTitle}</strong>
    <span>{ref ? `branch: ${ref}` : ""}</span>
  </header>

  {#if pageLoading}
    <p class="status">Loading workspace...</p>
  {:else if error && rootNodes.length === 0}
    <p class="status error">{error}</p>
  {:else}
    <section class="layout">
      <aside class="left-panel">
        <div class="panel-header">Files</div>
        <FileTree nodes={rootNodes} {selectedPath} {onToggle} {onSelect} />
      </aside>

      <FileViewer
        filePath={selectedPath}
        {fileContent}
        {markdownHtml}
        isMarkdown={isMarkdown(selectedPath)}
        loading={fileLoading}
        {error}
      />

      <ChatPanel />
    </section>
  {/if}
</main>

<style>
  .workspace-page {
    height: 100vh;
    display: flex;
    flex-direction: column;
  }

  .topbar {
    height: 46px;
    border-bottom: 1px solid var(--border);
    background: #161b24;
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0 14px;
    font-size: 13px;
  }

  .topbar span {
    color: var(--text-soft);
  }

  .layout {
    flex: 1;
    min-height: 0;
    display: grid;
    grid-template-columns: 300px 1fr 360px;
  }

  .left-panel {
    background: var(--panel);
    min-width: 0;
    overflow: auto;
  }

  .panel-header {
    height: 44px;
    border-bottom: 1px solid var(--border);
    display: flex;
    align-items: center;
    padding: 0 12px;
    font-size: 13px;
    color: var(--text-soft);
  }

  .status {
    margin: 16px;
    color: var(--text-soft);
    font-size: 13px;
  }

  .status.error {
    color: var(--danger);
  }

  @media (max-width: 1200px) {
    .layout {
      grid-template-columns: 260px 1fr;
    }

    :global(.chat-panel) {
      display: none;
    }
  }
</style>
