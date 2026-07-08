<script lang="ts">
import { Monitor, Moon, Palette, Sun } from "lucide-svelte";
import { getTheme } from "$lib/theme.svelte";
import { THEME_OPTIONS, type ThemeMode } from "$lib/theme-registry";
import { setThemeWithTransition } from "$lib/theme-transition";

// Reactive — reads from $state-backed store, auto-updates on system changes
const mode = $derived(getTheme());

const themeIcon = {
	dark: Moon,
	light: Sun,
	"solarized-dark": Palette,
	"solarized-light": Palette,
	"neta-studio": Palette,
	system: Monitor,
} satisfies Record<ThemeMode, typeof Sun>;

function handleThemeChange(mode: ThemeMode, event: MouseEvent) {
	setThemeWithTransition(mode, event);
}

// An option is active when it matches the stored mode. System remains
// separate, even though it resolves to the current OS light/dark preference.
function isActive(option: ThemeMode): boolean {
	return mode === option;
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
        {#each THEME_OPTIONS as option (option.value)}
          {@const active = isActive(option.value)}
          {@const Icon = themeIcon[option.value]}
          <button
            type="button"
            class="w-full flex items-center gap-3 p-3 rounded-[6px] border text-left transition-colors duration-100 {
              active
                ? 'border-brand/40 bg-brand-bg'
                : 'border-border-subtle bg-bg-surface hover:bg-bg-surface-hover'
            }"
            onclick={(event) => handleThemeChange(option.value, event)}
          >
            <div class="w-9 h-9 rounded-[5px] flex items-center justify-center shrink-0 {
              active
                ? 'bg-brand/15'
                : 'bg-bg-hover-strong'
            }">
              <Icon class="w-4 h-4 {active ? 'text-brand' : 'text-text-tertiary'}" />
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
