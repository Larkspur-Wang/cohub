<script lang="ts">
import { Sun, Moon, Monitor } from "lucide-svelte";
import { getTheme, setTheme, type ThemeMode } from "$lib/theme";

let theme = $state<ThemeMode>(getTheme());

const themeOptions: { value: ThemeMode; label: string; icon: typeof Sun; description: string }[] = [
  { value: "dark", label: "Dark", icon: Moon, description: "Always use dark theme" },
  { value: "light", label: "Light", icon: Sun, description: "Always use light theme" },
  { value: "system", label: "System", icon: Monitor, description: "Follow your system preference" },
];

function handleThemeChange(mode: ThemeMode) {
  theme = mode;
  setTheme(mode);
}
</script>

<div class="flex-1 flex flex-col min-h-0 overflow-y-auto">
  <div class="flex-1 p-6 overflow-y-auto">
    <section class="max-w-xl">
      <h1 class="text-[18px] font-semibold text-text-primary tracking-tight">Appearance</h1>
      <p class="mt-1 text-[13px] text-text-tertiary">
        Choose how Cohub looks on your device.
      </p>

      <div class="mt-6 space-y-2">
        {#each themeOptions as option (option.value)}
          <button
            type="button"
            class="w-full flex items-center gap-3 p-3 rounded-[6px] border text-left transition-colors duration-100 {
              theme === option.value
                ? 'border-brand/40 bg-brand-bg'
                : 'border-border-subtle bg-bg-surface hover:bg-bg-surface-hover'
            }"
            onclick={() => handleThemeChange(option.value)}
          >
            <div class="w-9 h-9 rounded-[5px] flex items-center justify-center shrink-0 {
              theme === option.value
                ? 'bg-brand/15'
                : 'bg-bg-hover-strong'
            }">
              <option.icon class="w-4 h-4 {theme === option.value ? 'text-brand' : 'text-text-tertiary'}" />
            </div>
            <div class="flex-1 min-w-0">
              <div class="text-[13px] font-medium {theme === option.value ? 'text-text-primary' : 'text-text-secondary'}">
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
