<script lang="ts">
import { onMount } from "svelte";
import {
  getCronJobs,
  createCronJob,
  deleteCronJob,
  toggleCronJob,
  getCronJobRuns,
  getTaskRuns,
  getRuntimes,
  type CronJobRecord,
  type TaskRunRecord,
  type RuntimeRecord,
} from "$lib/api";
import { logtoClient } from "$lib/auth";
import { Plus, Trash2, Power, PowerOff, Loader2, ChevronDown, ChevronRight, Clock } from "lucide-svelte";

type TabId = "cronjobs" | "runs";

let activeTab: TabId = $state("cronjobs");
let isLoading = $state(true);
let loadError = $state("");
let cronJobs = $state<CronJobRecord[]>([]);
let taskRuns = $state<TaskRunRecord[]>([]);
let expandedCronJobs = $state<Set<string>>(new Set());
let cronJobRuns = $state<Map<string, TaskRunRecord[]>>(new Map());
let actionInProgress = $state<Record<string, string>>({});

// ── Create modal ──
let showCreateModal = $state(false);
let isCreating = $state(false);
let createTitle = $state("");
let createCronExpression = $state("");
let createRuntimeId = $state("");
let createPromptText = $state("");
let createError = $state("");
let runtimes = $state<RuntimeRecord[]>([]);

async function loadCronJobs() {
  if (!(await logtoClient.isAuthenticated())) {
    isLoading = false;
    return;
  }

  loadError = "";
  try {
    const result = await getCronJobs();
    cronJobs = result.jobs ?? [];
  } catch (error) {
    loadError = error instanceof Error ? error.message : "Failed to load cron jobs";
  } finally {
    isLoading = false;
  }
}

async function loadTaskRuns() {
  if (!(await logtoClient.isAuthenticated())) {
    return;
  }

  try {
    const result = await getTaskRuns();
    taskRuns = result.runs ?? [];
  } catch (error) {
    console.warn("Failed to load task runs", error);
  }
}

async function loadCronJobRuns(cronJobId: string) {
  if (cronJobRuns.has(cronJobId)) return;

  try {
    const result = await getCronJobRuns(cronJobId);
    cronJobRuns = new Map(cronJobRuns).set(cronJobId, result.runs ?? []);
  } catch (error) {
    console.warn("Failed to load cron job runs", error);
  }
}

function toggleCronJobExpand(cronJobId: string) {
  const next = new Set(expandedCronJobs);
  if (next.has(cronJobId)) {
    next.delete(cronJobId);
  } else {
    next.add(cronJobId);
    void loadCronJobRuns(cronJobId);
  }
  expandedCronJobs = next;
}

function handleCronJobHeaderKeydown(event: KeyboardEvent, cronJobId: string) {
  if (event.key !== "Enter" && event.key !== " ") return;
  event.preventDefault();
  toggleCronJobExpand(cronJobId);
}

async function handleDelete(id: string, e: Event) {
  e.stopPropagation();
  if (!confirm("Are you sure you want to delete this cron job?")) return;
  actionInProgress = { ...actionInProgress, [id]: "delete" };
  try {
    await deleteCronJob(id);
    // Refresh from server to ensure consistency
    await loadCronJobs();
  } catch (error) {
    alert(error instanceof Error ? error.message : "Failed to delete");
  } finally {
    const { [id]: _, ...rest } = actionInProgress;
    actionInProgress = rest;
  }
}

async function handleToggle(id: string, enabled: boolean, e: Event) {
  e.stopPropagation();
  actionInProgress = { ...actionInProgress, [id]: "toggle" };
  try {
    await toggleCronJob(id, enabled);
    // Update only after successful API call
    cronJobs = cronJobs.map((j) => (j.id === id ? { ...j, enabled } : j));
  } catch (error) {
    alert(error instanceof Error ? error.message : "Failed to toggle");
    // Revert UI to match server state — reload to get correct status
    await loadCronJobs();
  } finally {
    const { [id]: _, ...rest } = actionInProgress;
    actionInProgress = rest;
  }
}

async function loadRuntimes() {
  try {
    const data = await getRuntimes();
    runtimes = (data ?? []).filter((r: RuntimeRecord) => r.status !== "deleted");
  } catch (error) {
    console.warn("[Jobs] Failed to load runtimes", error);
  }
}

function openCreateModal() {
  showCreateModal = true;
  isCreating = false;
  createTitle = "";
  createCronExpression = "";
  createRuntimeId = runtimes[0]?.id ?? "";
  createPromptText = "";
  createError = "";
  void loadRuntimes();
}

function closeCreateModal() {
  if (isCreating) return;
  showCreateModal = false;
}

function handleModalBackdropKeydown(event: KeyboardEvent) {
  if (event.key === "Escape") closeCreateModal();
}

async function handleCreate() {
  createError = "";
  if (isCreating) return;

  if (!createTitle.trim()) {
    createError = "Title is required";
    return;
  }
  if (!createCronExpression.trim()) {
    createError = "Cron expression is required";
    return;
  }
  // Basic frontend cron format validation (5-6 space-separated fields)
  const cronParts = createCronExpression.trim().split(/\s+/);
  if (cronParts.length < 5 || cronParts.length > 6) {
    createError = "Cron 表达式格式错误，应为 5 或 6 个空格分隔的字段（分 时 日 月 周 [年]）";
    return;
  }
  if (!createPromptText.trim()) {
    createError = "Prompt message is required";
    return;
  }

  isCreating = true;
  try {
    await createCronJob({
      title: createTitle.trim(),
      taskType: "send_message",
      payload: {
        runtimeId: createRuntimeId,
        data: {
          content: [{ type: "text", text: createPromptText.trim() }],
        },
      },
      cronExpression: createCronExpression.trim(),
      runtimeId: createRuntimeId || undefined,
    });
    showCreateModal = false;
    await loadCronJobs();
  } catch (error) {
    createError = error instanceof Error ? error.message : "Failed to create";
  } finally {
    isCreating = false;
  }
}

function statusBadge(run: TaskRunRecord) {
  switch (run.status) {
    case "completed":
      return { label: "Completed", color: "bg-emerald-500/15 text-emerald-400" };
    case "failed":
      return { label: "Failed", color: "bg-red-500/15 text-red-400" };
    case "running":
      return { label: "Running", color: "bg-blue-500/15 text-blue-400" };
    case "pending":
      return { label: "Pending", color: "bg-amber-500/15 text-amber-400" };
    default:
      return { label: run.status, color: "bg-bg-hover text-text-tertiary" };
  }
}

function formatDate(dateStr: string | null) {
  if (!dateStr) return "—";
  const d = new Date(dateStr);
  return d.toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

// Close modal on Escape key
$effect(() => {
  function handleKeydown(e: KeyboardEvent) {
    if (e.key === "Escape" && showCreateModal && !isCreating) {
      closeCreateModal();
    }
  }
  window.addEventListener("keydown", handleKeydown);
  return () => window.removeEventListener("keydown", handleKeydown);
});

onMount(() => {
  void loadCronJobs();
  void loadTaskRuns();
});
</script>

<div class="h-screen flex flex-col bg-bg-primary text-text-primary">
  <!-- Header -->
  <div class="h-12 flex items-center px-4 border-b border-border-subtle shrink-0">
    <h1 class="text-[15px] font-semibold">Jobs</h1>
  </div>

  <!-- Tabs -->
  <div class="flex items-center gap-1 px-4 pt-3 pb-2 border-b border-border-subtle shrink-0">
    <button
      type="button"
      class="px-3 py-1.5 rounded-md text-[13px] font-medium transition-colors {activeTab === 'cronjobs' ? 'bg-bg-active text-text-primary' : 'text-text-tertiary hover:text-text-secondary hover:bg-bg-hover'}"
      onclick={() => { activeTab = "cronjobs"; }}
    >
      Cronjob 设置
    </button>
    <button
      type="button"
      class="px-3 py-1.5 rounded-md text-[13px] font-medium transition-colors {activeTab === 'runs' ? 'bg-bg-active text-text-primary' : 'text-text-tertiary hover:text-text-secondary hover:bg-bg-hover'}"
      onclick={() => { activeTab = "runs"; void loadTaskRuns(); }}
    >
      Jobs 流水
    </button>
  </div>

  <!-- Content -->
  <div class="flex-1 overflow-y-auto px-4 py-3">
    {#if activeTab === "cronjobs"}
      <!-- Cronjob Settings Tab -->
      <div class="max-w-3xl mx-auto">
        {#if isLoading}
          <div class="flex items-center justify-center gap-2 py-8 text-text-tertiary">
            <Loader2 class="w-4 h-4 animate-spin" />
            Loading...
          </div>
        {:else if loadError}
          <div class="py-4 text-center text-error-soft">{loadError}</div>
        {:else}
          <!-- Create button -->
          <div class="flex justify-end mb-3">
            <button
              type="button"
              class="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[12px] font-medium bg-brand text-white hover:bg-brand-hover transition-colors"
              onclick={openCreateModal}
            >
              <Plus class="w-3.5 h-3.5" />
              新建 Cronjob
            </button>
          </div>

          {#if cronJobs.length === 0}
            <div class="py-12 text-center text-text-tertiary text-[13px]">
              暂无 Cronjob，点击「新建 Cronjob」创建一个定时任务
            </div>
          {:else}
            <div class="space-y-2">
              {#each cronJobs as job (job.id)}
                {@const isExpanded = expandedCronJobs.has(job.id)}
                {@const isBusy = actionInProgress[job.id]}
                <div class="rounded-lg border border-border-subtle overflow-hidden">
                  <!-- Cronjob header -->
                  <div
                    class="flex items-center gap-2 px-3 py-2.5 cursor-pointer hover:bg-bg-hover/50 transition-colors"
                    role="button"
                    tabindex="0"
                    aria-expanded={isExpanded}
                    onclick={() => toggleCronJobExpand(job.id)}
                    onkeydown={(e) => handleCronJobHeaderKeydown(e, job.id)}
                  >
                    <span class="text-text-tertiary">
                      {#if isExpanded}
                        <ChevronDown class="w-4 h-4" />
                      {:else}
                        <ChevronRight class="w-4 h-4" />
                      {/if}
                    </span>
                    <span class="flex-1 text-[13px] font-medium truncate">{job.title}</span>
                    <span class="text-[11px] text-text-placeholder font-mono">{job.taskType}</span>
                    <span class="text-[11px] text-text-placeholder font-mono px-1.5 py-0.5 rounded bg-bg-hover">{job.cronExpression}</span>
                    <!-- Enabled toggle -->
                    <button
                      type="button"
                      class="p-1 rounded hover:bg-bg-hover transition-colors {job.enabled ? 'text-emerald-400' : 'text-text-placeholder'}"
                      title={job.enabled ? "Disable" : "Enable"}
                      onclick={(e) => handleToggle(job.id, !job.enabled, e)}
                    >
                      {#if isBusy}
                        <Loader2 class="w-3.5 h-3.5 animate-spin" />
                      {:else if job.enabled}
                        <Power class="w-3.5 h-3.5" />
                      {:else}
                        <PowerOff class="w-3.5 h-3.5" />
                      {/if}
                    </button>
                    <!-- Delete -->
                    <button
                      type="button"
                      class="p-1 rounded hover:bg-bg-hover text-text-placeholder hover:text-error-soft transition-colors"
                      title="Delete"
                      onclick={(e) => handleDelete(job.id, e)}
                    >
                      <Trash2 class="w-3.5 h-3.5" />
                    </button>
                  </div>

                  <!-- Run history (expanded) -->
                  {#if isExpanded}
                    <div class="border-t border-border-subtle px-3 py-2 bg-bg-secondary/30">
                      {#if cronJobRuns.has(job.id)}
                        {@const runs = cronJobRuns.get(job.id)!}
                        {#if runs.length === 0}
                          <div class="py-2 text-[11px] text-text-placeholder italic">No runs yet</div>
                        {:else}
                          <div class="space-y-1">
                            {#each runs.slice(0, 10) as run (run.id)}
                              {@const badge = statusBadge(run)}
                              <div class="flex items-center gap-2 text-[11px]">
                                <span class="px-1.5 py-0.5 rounded font-medium {badge.color}">{badge.label}</span>
                                <span class="text-text-placeholder">{formatDate(run.startedAt ?? run.createdAt)}</span>
                                {#if run.errorMessage}
                                  <span class="text-red-400 truncate" title={run.errorMessage}>{run.errorMessage.slice(0, 60)}</span>
                                {/if}
                              </div>
                            {/each}
                          </div>
                        {/if}
                      {:else}
                        <div class="flex items-center gap-1.5 py-2 text-[11px] text-text-placeholder">
                          <Loader2 class="w-3 h-3 animate-spin" />
                          Loading runs...
                        </div>
                      {/if}
                    </div>
                  {/if}
                </div>
              {/each}
            </div>
          {/if}
        {/if}
      </div>

    {:else}
      <!-- Task Runs Tab -->
      <div class="max-w-4xl mx-auto">
        {#if taskRuns.length === 0}
          <div class="py-12 text-center text-text-tertiary text-[13px]">
            暂无任务执行记录
          </div>
        {:else}
          <div class="rounded-lg border border-border-subtle overflow-hidden">
            <table class="w-full text-[12px]">
              <thead>
                <tr class="border-b border-border-subtle bg-bg-secondary/30 text-text-tertiary">
                  <th class="text-left px-3 py-2 font-medium">Status</th>
                  <th class="text-left px-3 py-2 font-medium">Type</th>
                  <th class="text-left px-3 py-2 font-medium">Started</th>
                  <th class="text-left px-3 py-2 font-medium">Duration</th>
                  <th class="text-left px-3 py-2 font-medium">Error</th>
                </tr>
              </thead>
              <tbody>
                {#each taskRuns as run (run.id)}
                  {@const badge = statusBadge(run)}
                  {@const duration = run.startedAt && run.finishedAt
                    ? (() => {
                        const ms = new Date(run.finishedAt).getTime() - new Date(run.startedAt).getTime();
                        return `${(ms / 1000).toFixed(1)}s`;
                      })()
                    : "—"}
                  <tr class="border-b border-border-subtle/50 hover:bg-bg-hover/30 transition-colors">
                    <td class="px-3 py-2">
                      <span class="px-1.5 py-0.5 rounded font-medium text-[11px] {badge.color}">{badge.label}</span>
                    </td>
                    <td class="px-3 py-2 font-mono text-text-secondary">{run.taskType}</td>
                    <td class="px-3 py-2 text-text-placeholder">{formatDate(run.startedAt ?? run.createdAt)}</td>
                    <td class="px-3 py-2 text-text-placeholder">{duration}</td>
                    <td class="px-3 py-2 text-red-400 max-w-[200px] truncate" title={run.errorMessage ?? ""}>
                      {run.errorMessage ?? "—"}
                    </td>
                  </tr>
                {/each}
              </tbody>
            </table>
          </div>
        {/if}
      </div>
    {/if}
  </div>
</div>

<!-- Create Modal -->
{#if showCreateModal}
  <div
    class="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
    role="presentation"
    onclick={closeCreateModal}
    onkeydown={handleModalBackdropKeydown}
  >
    <div
      class="w-full max-w-lg rounded-xl bg-bg-primary border border-border-subtle shadow-2xl mx-4"
      role="dialog"
      tabindex="-1"
      aria-modal="true"
      aria-labelledby="create-cronjob-title"
    >
      <div class="flex items-center justify-between px-4 py-3 border-b border-border-subtle">
        <h2 id="create-cronjob-title" class="text-[14px] font-semibold">新建 Cronjob</h2>
        <button type="button" class="text-text-tertiary hover:text-text-primary" aria-label="关闭" onclick={closeCreateModal}>
          <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>

      <div class="p-4 space-y-4">
        <!-- Title -->
        <div>
          <label class="block text-[12px] font-medium text-text-secondary mb-1" for="cronjob-title">名称</label>
          <input
            id="cronjob-title"
            type="text"
            bind:value={createTitle}
            placeholder="例如：每天早上10点报告"
            class="w-full px-3 py-2 rounded-md border border-border-subtle bg-bg-secondary text-[13px] outline-none focus:border-brand/50 placeholder:text-text-placeholder"
          />
        </div>

        <!-- Runtime -->
        <div>
          <label class="block text-[12px] font-medium text-text-secondary mb-1" for="cronjob-runtime">目标 Runtime</label>
          <select
            id="cronjob-runtime"
            bind:value={createRuntimeId}
            class="w-full px-3 py-2 rounded-md border border-border-subtle bg-bg-secondary text-[13px] outline-none focus:border-brand/50 text-text-primary"
          >
            <option value="">— 选择 —</option>
            {#each runtimes as rt (rt.id)}
              <option value={rt.id}>{rt.title || rt.id.slice(0, 12)}</option>
            {/each}
          </select>
        </div>

        <!-- Cron Expression -->
        <div>
          <label class="block text-[12px] font-medium text-text-secondary mb-1" for="cronjob-expression">Cron 表达式</label>
          <input
            id="cronjob-expression"
            type="text"
            bind:value={createCronExpression}
            placeholder="例如：0 10 * * * （每天10点）"
            class="w-full px-3 py-2 rounded-md border border-border-subtle bg-bg-secondary text-[13px] font-mono outline-none focus:border-brand/50 placeholder:text-text-placeholder"
          />
          <p class="mt-1 text-[11px] text-text-placeholder">
            格式：分 时 日 月 周 · 示例：*/30 * * * *（每30分钟）
          </p>
        </div>

        <!-- Prompt -->
        <div>
          <label class="block text-[12px] font-medium text-text-secondary mb-1" for="cronjob-prompt">Prompt 消息</label>
          <textarea
            id="cronjob-prompt"
            bind:value={createPromptText}
            rows="3"
            placeholder="定时发送给 runtime 的消息内容..."
            class="w-full px-3 py-2 rounded-md border border-border-subtle bg-bg-secondary text-[13px] outline-none focus:border-brand/50 placeholder:text-text-placeholder resize-none"
          ></textarea>
        </div>

        <!-- Error -->
        {#if createError}
          <div class="text-[12px] text-error-soft">{createError}</div>
        {/if}
      </div>

      <!-- Footer -->
      <div class="flex justify-end gap-2 px-4 py-3 border-t border-border-subtle">
        <button
          type="button"
          class="px-4 py-1.5 rounded-md text-[12px] text-text-tertiary hover:bg-bg-hover transition-colors"
          onclick={closeCreateModal}
          disabled={isCreating}
        >
          取消
        </button>
        <button
          type="button"
          class="px-4 py-1.5 rounded-md text-[12px] font-medium bg-brand text-white hover:bg-brand-hover transition-colors disabled:opacity-50 flex items-center gap-1.5"
          disabled={isCreating || !createTitle.trim() || !createCronExpression.trim() || !createPromptText.trim()}
          onclick={handleCreate}
        >
          {#if isCreating}
            <Loader2 class="w-3.5 h-3.5 animate-spin" />
            创建中...
          {:else}
            创建
          {/if}
        </button>
      </div>
    </div>
  </div>
{/if}
