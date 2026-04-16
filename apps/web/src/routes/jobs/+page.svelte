<script lang="ts">
import { onMount } from "svelte";
import {
  getCronJobs,
  createCronJob,
  createScheduledTask,
  deleteCronJob,
  toggleCronJob,
  getTaskRuns,
  getRuntimes,
  type CronJobRecord,
  type TaskRunRecord,
  type RuntimeRecord,
} from "$lib/api";
import { logtoClient } from "$lib/auth";
import { Plus, Trash2, Power, PowerOff, Loader2, Clock, Activity, Filter, X, Clipboard, ClipboardCheck } from "lucide-svelte";
import PageHeader from "$lib/components/PageHeader.svelte";

type TabId = "cronjobs" | "history";

let activeTab: TabId = $state("cronjobs");
let isLoading = $state(true);
let loadError = $state("");
let cronJobs = $state<CronJobRecord[]>([]);
let taskRuns = $state<TaskRunRecord[]>([]);
let filterCronJobId = $state<string | null>(null);
let actionInProgress = $state<Record<string, string>>({});

// ── Create modal ──
let showCreateModal = $state(false);
let isCreating = $state(false);
let createType: "repeating" | "onetime" = $state("repeating");
let createTitle = $state("");
let createCronExpression = $state("");
let createScheduleAt = $state("");
let createRuntimeId = $state("");
let createPromptText = $state("");
let createError = $state("");
let runtimes = $state<RuntimeRecord[]>([]);
let copiedIndex = $state<number | null>(null);

// Example prompts for agent-based task creation
const examplePrompts = [
  "Every day at 10 AM, send a daily report summary to this runtime",
  "Remind me to check the deployment status in 5 minutes",
  "Every Monday at 9 AM, run tests and report the results",
  "After each commit, send a notification with the build status",
];

function copyPrompt(text: string, index: number) {
  navigator.clipboard.writeText(text).then(() => {
    copiedIndex = index;
    setTimeout(() => { copiedIndex = null; }, 1500);
  });
}

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

async function handleDelete(id: string, e: Event) {
  e.stopPropagation();
  if (!confirm("Are you sure you want to delete this cron job?")) return;
  actionInProgress = { ...actionInProgress, [id]: "delete" };
  try {
    await deleteCronJob(id);
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
    cronJobs = cronJobs.map((j) => (j.id === id ? { ...j, enabled } : j));
  } catch (error) {
    alert(error instanceof Error ? error.message : "Failed to toggle");
    await loadCronJobs();
  } finally {
    const { [id]: _, ...rest } = actionInProgress;
    actionInProgress = rest;
  }
}

function showRunsForJob(jobId: string) {
  filterCronJobId = jobId;
  activeTab = "history";
}

function clearFilter() {
  filterCronJobId = null;
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
  createType = "repeating";
  createTitle = "";
  createCronExpression = "";
  createScheduleAt = "";
  createRuntimeId = runtimes[0]?.id ?? "";
  createPromptText = "";
  createError = "";
  copiedIndex = null;
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
  if (!createPromptText.trim()) {
    createError = "Prompt message is required";
    return;
  }
  if (!createRuntimeId) {
    createError = "Runtime is required";
    return;
  }

  isCreating = true;
  try {
    if (createType === "repeating") {
      if (!createCronExpression.trim()) {
        createError = "Cron expression is required";
        return;
      }
      const cronParts = createCronExpression.trim().split(/\s+/);
      if (cronParts.length < 5 || cronParts.length > 6) {
        createError = "Invalid cron expression format. Expected 5 or 6 space-separated fields (min hour day month weekday [year])";
        return;
      }
      await createCronJob({
        title: createTitle.trim(),
        taskType: "send_message",
        payload: {
          content: [{ type: "text", text: createPromptText.trim() }],
        },
        cronExpression: createCronExpression.trim(),
        runtimeId: createRuntimeId || undefined,
      });
    } else {
      if (!createScheduleAt) {
        createError = "Schedule time is required";
        return;
      }
      const scheduleTime = new Date(createScheduleAt);
      if (Number.isNaN(scheduleTime.getTime()) || scheduleTime.getTime() <= Date.now()) {
        createError = "Schedule time must be in the future";
        return;
      }
      await createScheduledTask({
        taskType: "send_message",
        payload: {
          content: [{ type: "text", text: createPromptText.trim() }],
        },
        scheduleAt: scheduleTime.toISOString(),
        runtimeId: createRuntimeId || undefined,
      });
    }
    showCreateModal = false;
    await loadCronJobs();
    await loadTaskRuns();
  } catch (error) {
    createError = error instanceof Error ? error.message : "Failed to create";
  } finally {
    isCreating = false;
  }
}

function statusBadge(run: TaskRunRecord) {
  switch (run.status) {
    case "completed":
      return { label: "Completed", color: "text-status-running", dot: "bg-status-running" };
    case "failed":
      return { label: "Failed", color: "text-status-error", dot: "bg-status-error" };
    case "running":
      return { label: "Running", color: "text-info", dot: "bg-info" };
    case "pending":
      return { label: "Pending", color: "text-warning", dot: "bg-warning" };
    default:
      return { label: run.status, color: "text-text-placeholder", dot: "bg-text-placeholder" };
  }
}

function formatDate(dateStr: string | null) {
  if (!dateStr) return "—";
  const d = new Date(dateStr);
  return d.toLocaleString("en-US", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function getJobTitle(cronJobId: string | null) {
  if (!cronJobId) return null;
  const job = cronJobs.find((j) => j.id === cronJobId);
  return job?.title ?? null;
}

function formatScheduled(dateStr: string | null) {
  if (!dateStr) return "—";
  const d = new Date(dateStr);
  return d.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

const filteredRuns = $derived(
  filterCronJobId ? taskRuns.filter((r) => r.cronJobId === filterCronJobId) : taskRuns
);

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

<div class="flex-1 flex flex-col min-h-0 overflow-y-auto">
  <!-- Header -->
  <PageHeader>
    {#snippet left()}
      <span class="text-[13px] lg:text-[11px] font-medium text-text-primary lg:text-text-secondary">Jobs</span>
    {/snippet}
    {#snippet right()}
      <button
        type="button"
        class="flex items-center gap-1.5 px-2.5 py-1 rounded-[5px] text-[12px] bg-[#FF3E00]/10 border border-[#FF3E00]/20 text-brand font-medium hover:bg-[#FF3E00]/15 transition-colors"
        onclick={openCreateModal}
      >
        <Plus class="w-3.5 h-3.5" />
        New Task
      </button>
    {/snippet}
  </PageHeader>

  <!-- Tabs -->
  <div class="flex items-center gap-0 px-4 border-b border-border-subtle shrink-0">
    <button
      type="button"
      class="relative px-1 py-2.5 text-[13px] font-medium transition-colors {activeTab === 'cronjobs' ? 'text-text-primary' : 'text-text-tertiary hover:text-text-secondary'}"
      onclick={() => { activeTab = "cronjobs"; }}
    >
      <span class="flex items-center gap-1.5">
        <Clock class="w-3.5 h-3.5" />
        Cronjobs
      </span>
      {#if activeTab === 'cronjobs'}
        <span class="absolute bottom-0 left-0 right-0 h-[2px] bg-brand rounded-full"></span>
      {/if}
    </button>
    <button
      type="button"
      class="relative px-1 py-2.5 text-[13px] font-medium transition-colors {activeTab === 'history' ? 'text-text-primary' : 'text-text-tertiary hover:text-text-secondary'}"
      onclick={() => { activeTab = "history"; void loadTaskRuns(); }}
    >
      <span class="flex items-center gap-1.5">
        <Activity class="w-3.5 h-3.5" />
        History
      </span>
      {#if activeTab === 'history'}
        <span class="absolute bottom-0 left-0 right-0 h-[2px] bg-brand rounded-full"></span>
      {/if}
    </button>
  </div>

  <!-- Content -->
  <div class="flex-1 overflow-y-auto">
    {#if activeTab === "cronjobs"}
      <!-- Cronjobs Tab -->
      <div class="max-w-3xl mx-auto px-4 py-4">
        {#if isLoading}
          <div class="flex items-center justify-center gap-2 py-12 text-text-tertiary text-[13px]">
            <Loader2 class="w-4 h-4 animate-spin" />
            Loading...
          </div>
        {:else if loadError}
          <div class="py-4 text-center text-error-soft text-[13px]">{loadError}</div>
        {:else if cronJobs.length === 0}
          <div class="flex flex-col items-center justify-center py-16 text-center">
            <div class="w-11 h-11 rounded-md bg-bg-surface border border-border-subtle flex items-center justify-center mb-3">
              <Clock class="w-5 h-5 text-text-placeholder" />
            </div>
            <p class="text-[14px] text-text-tertiary">No cronjobs yet</p>
            <p class="text-[12px] text-text-placeholder mt-1">Create a scheduled task to automate your workflows</p>
          </div>
        {:else}
          <div class="space-y-0.5">
            {#each cronJobs as job (job.id)}
              {@const isBusy = actionInProgress[job.id]}
              <div class="group rounded-[5px] border border-transparent hover:border-border-subtle transition-colors">
                <div class="flex items-center gap-2.5 px-3 py-2.5">
                  <!-- Status dot -->
                  <span class="w-[7px] h-[7px] rounded-full shrink-0 {job.enabled ? 'bg-status-running' : 'bg-text-placeholder'}"></span>

                  <!-- Title (clickable to view history) -->
                  <button
                    type="button"
                    class="flex-1 text-left text-[13px] font-medium truncate hover:text-brand transition-colors"
                    onclick={() => showRunsForJob(job.id)}
                    title="View history"
                  >
                    {job.title}
                  </button>

                  <!-- Cron expression -->
                  <span class="text-[11px] font-mono text-text-placeholder px-1.5 py-0.5 rounded-sm bg-bg-code hidden sm:inline">{job.cronExpression}</span>

                  <!-- Actions -->
                  <div class="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity lg:opacity-100 lg:group-hover:opacity-100">
                    <button
                      type="button"
                      class="p-1.5 rounded-[5px] hover:bg-bg-hover transition-colors {job.enabled ? 'text-text-tertiary hover:text-status-running' : 'text-text-placeholder hover:text-status-running'}"
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
                    <button
                      type="button"
                      class="p-1.5 rounded-[5px] hover:bg-bg-hover text-text-placeholder hover:text-error-soft transition-colors"
                      title="Delete"
                      onclick={(e) => handleDelete(job.id, e)}
                    >
                      <Trash2 class="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              </div>
            {/each}
          </div>
        {/if}
      </div>

    {:else}
      <!-- History Tab -->
      <div class="max-w-4xl mx-auto px-4 py-4">
        <!-- Filter bar -->
        {#if filterCronJobId}
          {@const jobTitle = getJobTitle(filterCronJobId)}
          <div class="flex items-center gap-2 mb-3 px-1">
            <Filter class="w-3.5 h-3.5 text-text-tertiary" />
            <span class="text-[12px] text-text-secondary">Filtered by</span>
            <span class="text-[12px] font-medium text-text-primary">{jobTitle ?? filterCronJobId}</span>
            <button type="button" class="p-0.5 rounded hover:bg-bg-hover text-text-tertiary hover:text-text-primary transition-colors" onclick={clearFilter} title="Clear filter">
              <X class="w-3.5 h-3.5" />
            </button>
          </div>
        {/if}

        {#if filteredRuns.length === 0}
          <div class="flex flex-col items-center justify-center py-16 text-center">
            <div class="w-11 h-11 rounded-md bg-bg-surface border border-border-subtle flex items-center justify-center mb-3">
              <Activity class="w-5 h-5 text-text-placeholder" />
            </div>
            {#if filterCronJobId}
              <p class="text-[14px] text-text-tertiary">No runs for this cronjob</p>
            {:else}
              <p class="text-[14px] text-text-tertiary">No task run records</p>
              <p class="text-[12px] text-text-placeholder mt-1">Task runs will appear here once cronjobs start executing</p>
            {/if}
          </div>
        {:else}
          <table class="w-full text-[12px]">
            <thead>
              <tr class="text-[10px] font-medium uppercase tracking-[0.08em] text-text-placeholder border-b border-border-subtle">
                <th class="text-left py-2 pr-3 font-medium">Status</th>
                <th class="text-left py-2 pr-3 font-medium">Source</th>
                <th class="text-left py-2 pr-3 font-medium">Scheduled</th>
                <th class="text-left py-2 pr-3 font-medium">Started</th>
                <th class="text-left py-2 pr-3 font-medium">Duration</th>
                <th class="text-left py-2 font-medium">Error</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-border-subtle/50">
              {#each filteredRuns as run (run.id)}
                {@const badge = statusBadge(run)}
                {@const duration = run.startedAt && run.finishedAt
                  ? (() => {
                      const ms = new Date(run.finishedAt).getTime() - new Date(run.startedAt).getTime();
                      return `${(ms / 1000).toFixed(1)}s`;
                    })()
                  : "—"}
                <tr class="hover:bg-bg-hover/30 transition-colors">
                  <td class="py-2 pr-3">
                    <span class="flex items-center gap-1.5">
                      <span class="w-[5px] h-[5px] rounded-full shrink-0 {badge.dot}"></span>
                      <span class="{badge.color}">{badge.label}</span>
                    </span>
                  </td>
                  <td class="py-2 pr-3">
                    {#if run.cronJobId}
                      <button
                        type="button"
                        class="text-left text-[12px] text-text-secondary hover:text-brand transition-colors truncate max-w-[150px]"
                        onclick={() => {
                          filterCronJobId = run.cronJobId;
                        }}
                      >
                        {getJobTitle(run.cronJobId) ?? "—"}
                      </button>
                    {:else}
                      <span class="text-[12px] text-text-placeholder">One-time</span>
                    {/if}
                  </td>
                  <td class="py-2 pr-3 text-text-placeholder">{formatScheduled(run.scheduledAt)}</td>
                  <td class="py-2 pr-3 text-text-placeholder">{formatDate(run.startedAt ?? run.createdAt)}</td>
                  <td class="py-2 pr-3 text-text-placeholder font-mono">{duration}</td>
                  <td class="py-2 text-status-error max-w-[200px] truncate" title={run.errorMessage ?? ""}>
                    {run.errorMessage ?? "—"}
                  </td>
                </tr>
              {/each}
            </tbody>
          </table>
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
      class="w-full max-w-2xl rounded-xl bg-bg-primary border border-border-subtle shadow-2xl mx-4"
      role="dialog"
      tabindex="-1"
      aria-modal="true"
      aria-labelledby="create-task-title"
      onclick={(e) => e.stopPropagation()}
    >
      <div class="flex items-center justify-between px-4 py-3 border-b border-border-subtle">
        <h2 id="create-task-title" class="text-[14px] font-semibold">New Task</h2>
        <button type="button" class="text-text-tertiary hover:text-text-primary" aria-label="Close" onclick={closeCreateModal}>
          <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>

      <div class="p-4">
        <!-- Agent prompt section -->
        <div class="mb-4 p-3 rounded-lg bg-bg-surface border border-border-subtle">
          <div class="flex items-start gap-2 mb-3">
            <span class="text-[13px] font-medium text-text-primary">Create via Agent</span>
            <span class="text-[11px] text-text-placeholder font-normal">Recommended</span>
          </div>
          <p class="text-[12px] text-text-secondary mb-3">
            Simply ask your agent in any workspace chat. Try these examples:
          </p>
          <div class="space-y-2">
            {#each examplePrompts as prompt, i}
              <button
                type="button"
                class="w-full text-left group/prompt p-2 rounded-md bg-bg-code border border-border-subtle hover:border-border-primary transition-colors"
                onclick={() => copyPrompt(prompt, i)}
              >
                <div class="flex items-start justify-between gap-2">
                  <span class="text-[12px] text-text-primary leading-relaxed flex-1">{prompt}</span>
                  <span class="shrink-0 text-text-placeholder group-hover/prompt:text-text-tertiary transition-colors">
                    {#if copiedIndex === i}
                      <ClipboardCheck class="w-3.5 h-3.5 text-status-running" />
                    {:else}
                      <Clipboard class="w-3.5 h-3.5" />
                    {/if}
                  </span>
                </div>
              </button>
            {/each}
          </div>
        </div>

        <!-- Divider -->
        <div class="flex items-center gap-3 mb-4">
          <span class="flex-1 h-px bg-border-subtle"></span>
          <span class="text-[11px] text-text-placeholder uppercase tracking-wider font-medium">Or create manually</span>
          <span class="flex-1 h-px bg-border-subtle"></span>
        </div>

        <!-- Type toggle -->
        <div class="flex items-center gap-2 mb-4">
          <button
            type="button"
            class="px-3 py-1.5 rounded-md text-[12px] font-medium transition-colors {createType === 'repeating' ? 'bg-bg-active text-text-primary' : 'text-text-tertiary hover:text-text-secondary hover:bg-bg-hover'}"
            onclick={() => { createType = "repeating"; }}
          >
            <span class="flex items-center gap-1.5">
              <Clock class="w-3.5 h-3.5" />
              Repeating
            </span>
          </button>
          <button
            type="button"
            class="px-3 py-1.5 rounded-md text-[12px] font-medium transition-colors {createType === 'onetime' ? 'bg-bg-active text-text-primary' : 'text-text-tertiary hover:text-text-secondary hover:bg-bg-hover'}"
            onclick={() => { createType = "onetime"; }}
          >
            <span class="flex items-center gap-1.5">
              <Activity class="w-3.5 h-3.5" />
              One-time
            </span>
          </button>
        </div>

        <!-- Form fields -->
        <div class="space-y-3">
          <div>
            <label class="block text-[12px] font-medium text-text-secondary mb-1" for="task-title">Name</label>
            <input
              id="task-title"
              type="text"
              bind:value={createTitle}
              placeholder="e.g. Daily report"
              class="w-full px-3 py-2 rounded-md border border-border-subtle bg-bg-secondary text-[13px] outline-none focus:border-brand/50 placeholder:text-text-placeholder"
            />
          </div>

          <div>
            <label class="block text-[12px] font-medium text-text-secondary mb-1" for="task-runtime">Target Runtime</label>
            <select
              id="task-runtime"
              bind:value={createRuntimeId}
              class="w-full px-3 py-2 rounded-md border border-border-subtle bg-bg-secondary text-[13px] outline-none focus:border-brand/50 text-text-primary"
            >
              <option value="">— Select —</option>
              {#each runtimes as rt (rt.id)}
                <option value={rt.id}>{rt.title || rt.id.slice(0, 12)}</option>
              {/each}
            </select>
          </div>

          {#if createType === "repeating"}
            <div>
              <label class="block text-[12px] font-medium text-text-secondary mb-1" for="task-expression">Cron Expression</label>
              <input
                id="task-expression"
                type="text"
                bind:value={createCronExpression}
                placeholder="e.g. 0 10 * * * (daily at 10AM)"
                class="w-full px-3 py-2 rounded-md border border-border-subtle bg-bg-secondary text-[13px] font-mono outline-none focus:border-brand/50 placeholder:text-text-placeholder"
              />
              <p class="mt-1 text-[11px] text-text-placeholder">
                Format: min hour day month weekday · Example: */30 * * * * (every 30 min)
              </p>
            </div>
          {:else}
            <div>
              <label class="block text-[12px] font-medium text-text-secondary mb-1" for="task-schedule">Schedule At</label>
              <input
                id="task-schedule"
                type="datetime-local"
                bind:value={createScheduleAt}
                class="w-full px-3 py-2 rounded-md border border-border-subtle bg-bg-secondary text-[13px] outline-none focus:border-brand/50 text-text-primary"
              />
              <p class="mt-1 text-[11px] text-text-placeholder">
                Local time (UTC{new Date().getTimezoneOffset() > 0 ? '-' : '+'}{Math.abs(new Date().getTimezoneOffset() / 60)})
              </p>
            </div>
          {/if}

          <div>
            <label class="block text-[12px] font-medium text-text-secondary mb-1" for="task-prompt">Prompt Message</label>
            <textarea
              id="task-prompt"
              bind:value={createPromptText}
              rows="2"
              placeholder="Message content to send to the runtime..."
              class="w-full px-3 py-2 rounded-md border border-border-subtle bg-bg-secondary text-[13px] outline-none focus:border-brand/50 placeholder:text-text-placeholder resize-none"
            ></textarea>
          </div>
        </div>

        {#if createError}
          <div class="mt-3 text-[12px] text-error-soft">{createError}</div>
        {/if}
      </div>

      <div class="flex justify-end gap-2 px-4 py-3 border-t border-border-subtle">
        <button
          type="button"
          class="px-4 py-1.5 rounded-md text-[12px] text-text-tertiary hover:bg-bg-hover transition-colors"
          onclick={closeCreateModal}
          disabled={isCreating}
        >
          Cancel
        </button>
        <button
          type="button"
          class="px-4 py-1.5 rounded-md text-[12px] font-medium bg-brand text-white hover:bg-brand-hover transition-colors disabled:opacity-50 flex items-center gap-1.5"
          disabled={isCreating || !createTitle.trim() || !createPromptText.trim() || !createRuntimeId || (createType === 'repeating' && !createCronExpression.trim()) || (createType === 'onetime' && !createScheduleAt)}
          onclick={handleCreate}
        >
          {#if isCreating}
            <Loader2 class="w-3.5 h-3.5 animate-spin" />
            Creating...
          {:else}
            Create
          {/if}
        </button>
      </div>
    </div>
  </div>
{/if}
