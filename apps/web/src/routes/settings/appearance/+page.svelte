<script lang="ts">
import { Monitor, Moon, Sun } from "lucide-svelte";
import {
	getResolvedTheme,
	getTheme,
	setTheme,
	type ThemeMode,
} from "$lib/theme.svelte";

// Reactive — reads from $state-backed store, auto-updates on system changes
const mode = $derived(getTheme());
const resolved = $derived(getResolvedTheme());

const themeOptions: {
	value: ThemeMode;
	label: string;
	icon: typeof Sun;
	description: string;
}[] = [
	{
		value: "dark",
		label: "Dark",
		icon: Moon,
		description: "Always use dark theme",
	},
	{
		value: "light",
		label: "Light",
		icon: Sun,
		description: "Always use light theme",
	},
	{
		value: "system",
		label: "System",
		icon: Monitor,
		description: "Follow your system preference",
	},
];

function handleThemeChange(mode: ThemeMode) {
	setTheme(mode);
}

// An option is "active" if:
// 1. Its mode matches the stored mode (dark/light/system)
// 2. OR user is in "system" mode and the option's resolved theme matches the current resolved theme
function isActive(option: ThemeMode): boolean {
	if (mode === option) return true;
	if (mode === "system" && resolved === option) return true;
	return false;
}
</script>

<svelte:head>
	<title>Appearance — Cohub</title>
</svelte:head>

<div class="flex-1 flex flex-col min-h-0 overflow-y-auto">
  <div class="flex-1 p-6 overflow-y-auto">
    <section class="max-w-xl">
      <h1 class="text-[18px] font-semibold text-text-primary tracking-tight">Appearance</h1>
      <p class="mt-1 text-[13px] text-text-tertiary">
        Choose how Cohub looks on your device.
      </p>

      <div class="mt-6 space-y-2">
        {#each themeOptions as option (option.value)}
          {@const active = isActive(option.value)}
          <button
            type="button"
            class="w-full flex items-center gap-3 p-3 rounded-[6px] border text-left transition-colors duration-100 {
              active
                ? 'border-brand/40 bg-brand-bg'
                : 'border-border-subtle bg-bg-surface hover:bg-bg-surface-hover'
            }"
            onclick={() => handleThemeChange(option.value)}
          >
            <div class="w-9 h-9 rounded-[5px] flex items-center justify-center shrink-0 {
              active
                ? 'bg-brand/15'
                : 'bg-bg-hover-strong'
            }">
              <option.icon class="w-4 h-4 {active ? 'text-brand' : 'text-text-tertiary'}" />
            </div>
            <div class="flex-1 min-w-0">
              <div class="text-[13px] font-medium {active ? 'text-text-primary' : 'text-text-secondary'}">
                {option.label}
              </div>
              <div class="text-[11px] text-text-tertiary mt-0.5">{option.description}</div>
            </div>
          </button>
        {/each}
      </div>
    </section>
  </div>
</div>
