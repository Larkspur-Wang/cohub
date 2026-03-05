<script lang="ts">
  import { goto } from "$app/navigation";
  import { onMount } from "svelte";

  import { fetchCurrentUser, loginWithToken, logout, type HubUser } from "$lib/auth";

  let tokenInput = $state("");
  // biome-ignore lint/style/useConst: Svelte state with bind:value cannot be const
  let ownerInput = $state("");
  // biome-ignore lint/style/useConst: Svelte state with bind:value cannot be const
  let repoInput = $state("");
  let currentUser = $state<HubUser | null>(null);
  let message = $state("Checking login state...");
  let loading = $state(true);

  const refreshUser = async () => {
    loading = true;
    const user = await fetchCurrentUser();
    currentUser = user;
    message = user ? "Token 已生效，可直接进入 workspace。" : "未登录，请先输入已有 x-token。";
    loading = false;
  };

  onMount(async () => {
    await refreshUser();
  });

  const submitToken = async () => {
    const token = tokenInput.trim();
    if (!token) {
      message = "请输入 token";
      return;
    }

    try {
      const user = await loginWithToken(token);
      currentUser = user;
      tokenInput = "";
      message = "登录成功";
    } catch {
      message = "token 校验失败，请确认是否有效";
      currentUser = null;
    }
  };

  const clearLogin = async () => {
    await logout();
    currentUser = null;
    message = "已退出";
  };

  const goWorkspace = async () => {
    const owner = ownerInput.trim();
    const repo = repoInput.trim();
    if (!owner || !repo) {
      message = "请输入 owner/repo";
      return;
    }

    await goto(`/workspaces/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`);
  };
</script>

<main class="home">
  <section class="card">
    <h1>Netaverses Workspace Hub</h1>
    <p class="sub">Phase 1: Hono BFF + Gitea Public Workspace + Obsidian-like Layout</p>

    {#if loading}
      <p class="hint">Loading...</p>
    {:else}
      <p class="hint">{message}</p>
    {/if}

    <div class="group">
      <label for="token">Existing x-token</label>
      <input id="token" bind:value={tokenInput} placeholder="paste x-token" type="password" />
      <div class="actions">
        <button onclick={submitToken} type="button">Login with token</button>
        <button class="ghost" onclick={clearLogin} type="button">Logout</button>
      </div>
    </div>

    <div class="group">
      <label for="workspace-owner">Open workspace</label>
      <div class="inline">
        <input id="workspace-owner" bind:value={ownerInput} placeholder="owner" type="text" />
        <span>/</span>
        <input id="workspace-repo" bind:value={repoInput} placeholder="repo" type="text" />
      </div>
      <button onclick={goWorkspace} type="button">Open</button>
    </div>

    {#if currentUser}
      <div class="profile">
        <strong>Current User</strong>
        <p>{currentUser.nick_name ?? currentUser.uuid ?? "Unknown"}</p>
      </div>
    {/if}
  </section>
</main>

<style>
  .home {
    min-height: 100vh;
    display: grid;
    place-items: center;
    padding: 24px;
  }

  .card {
    width: min(640px, 100%);
    background: var(--panel);
    border: 1px solid var(--border);
    border-radius: 12px;
    padding: 20px;
  }

  h1 {
    margin: 0;
    font-size: 24px;
  }

  .sub {
    margin-top: 8px;
    color: var(--text-soft);
    font-size: 14px;
  }

  .hint {
    color: var(--text-soft);
    font-size: 13px;
  }

  .group {
    margin-top: 18px;
    display: grid;
    gap: 8px;
  }

  label {
    font-size: 13px;
    color: var(--text-soft);
  }

  input {
    width: 100%;
    background: #121722;
    border: 1px solid var(--border);
    border-radius: 8px;
    color: var(--text);
    padding: 10px 12px;
  }

  .inline {
    display: grid;
    gap: 8px;
    align-items: center;
    grid-template-columns: 1fr auto 1fr;
  }

  .actions {
    display: flex;
    gap: 8px;
  }

  button {
    background: var(--accent);
    color: #fff;
    border: 0;
    border-radius: 8px;
    padding: 9px 12px;
    cursor: pointer;
  }

  button.ghost {
    background: transparent;
    border: 1px solid var(--border);
    color: var(--text);
  }

  .profile {
    margin-top: 16px;
    border-top: 1px solid var(--border);
    padding-top: 12px;
    font-size: 13px;
  }

  .profile p {
    margin: 6px 0 0;
    color: var(--text-soft);
  }
</style>
