<script lang="ts">
import { Check, Languages, Monitor, Moon, Palette, Sun } from "lucide-svelte";
import type { LocalePreference } from "$lib/i18n/locale";
import {
	getLocale,
	getLocalePreference,
	setLocalePreference,
} from "$lib/i18n/locale.svelte";
import {
	localizedThemeDescription,
	localizedThemeLabel,
} from "$lib/i18n/theme";
import { m } from "$lib/paraglide/messages.js";
import { getTheme } from "$lib/theme.svelte";
import { THEME_OPTIONS, type ThemeMode } from "$lib/theme-registry";
import { setThemeWithTransition } from "$lib/theme-transition";

const mode = $derived(getTheme());
const locale = $derived(getLocale());
const localePreference = $derived(getLocalePreference());

const themeIcon = {
	dark: Moon,
	light: Sun,
	"solarized-dark": Palette,
	"solarized-light": Palette,
	"neta-studio": Palette,
	system: Monitor,
} satisfies Record<ThemeMode, typeof Sun>;

const localeOptions = $derived([
	{
		value: "system" as const,
		label: m.settings_language_system({}, { locale }),
		description: m.settings_language_system_description({}, { locale }),
	},
	{
		value: "en" as const,
		label: m.settings_language_english({}, { locale }),
		description: m.settings_language_english_description({}, { locale }),
	},
	{
		value: "zh-CN" as const,
		label: m.settings_language_chinese({}, { locale }),
		description: m.settings_language_chinese_description({}, { locale }),
	},
]);

function handleThemeChange(nextMode: ThemeMode, event: MouseEvent) {
	setThemeWithTransition(nextMode, event);
}

function handleLocaleChange(preference: LocalePreference) {
	setLocalePreference(preference);
}
</script>

<svelte:head>
	<title>{m.nav_appearance({}, { locale })} - Cohub</title>
</svelte:head>

<div class="flex min-h-0 flex-1 flex-col overflow-y-auto">
	<div class="flex-1 overflow-y-auto px-6 py-7">
		<section class="max-w-2xl">
			<div class="border-b border-border-subtle pb-5">
				<h1 class="text-[18px] font-semibold text-text-primary">
					{m.nav_appearance({}, { locale })}
				</h1>
				<p class="mt-1 text-[13px] leading-5 text-text-tertiary">
					{m.settings_appearance_description({}, { locale })}
				</p>
			</div>

			<section class="py-6">
				<div>
					<h2 class="text-[14px] font-medium text-text-primary">
						{m.settings_language({}, { locale })}
					</h2>
					<p class="mt-1 text-[12px] leading-5 text-text-tertiary">
						{m.settings_language_description({}, { locale })}
					</p>
				</div>

				<div class="mt-4 grid gap-2 sm:grid-cols-3">
					{#each localeOptions as option (option.value)}
						{@const active = localePreference === option.value}
						<button
							type="button"
							class="group flex min-w-0 items-center gap-2 rounded-[6px] px-3 py-2.5 text-left transition-colors duration-100 {active ? 'bg-brand-bg text-text-primary' : 'text-text-tertiary hover:bg-bg-hover hover:text-text-secondary'}"
							onclick={() => handleLocaleChange(option.value)}
						>
							<span class="flex h-7 w-7 shrink-0 items-center justify-center rounded-[5px] {active ? 'bg-brand/15 text-brand' : 'bg-bg-hover-strong text-text-tertiary group-hover:text-text-secondary'}">
								<Languages class="h-3.5 w-3.5" />
							</span>
							<span class="min-w-0 flex-1">
								<span class="block text-[12px] font-medium">{option.label}</span>
								<span class="block truncate text-[10px] text-text-tertiary">{option.description}</span>
							</span>
							{#if active}<Check class="h-3.5 w-3.5 shrink-0 text-brand" />{/if}
						</button>
					{/each}
				</div>
			</section>

			<section class="border-t border-border-subtle py-6">
				<div>
					<h2 class="text-[14px] font-medium text-text-primary">
						{m.settings_theme({}, { locale })}
					</h2>
					<p class="mt-1 text-[12px] leading-5 text-text-tertiary">
						{m.settings_theme_description({}, { locale })}
					</p>
				</div>

				<div class="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
					{#each THEME_OPTIONS as option (option.value)}
						{@const active = mode === option.value}
						{@const Icon = themeIcon[option.value]}
						<button
							type="button"
							class="group flex min-w-0 items-center gap-2 rounded-[6px] px-3 py-2.5 text-left transition-colors duration-100 {active ? 'bg-brand-bg text-text-primary' : 'text-text-tertiary hover:bg-bg-hover hover:text-text-secondary'}"
							onclick={(event) => handleThemeChange(option.value, event)}
						>
							<span class="flex h-7 w-7 shrink-0 items-center justify-center rounded-[5px] {active ? 'bg-brand/15 text-brand' : 'bg-bg-hover-strong text-text-tertiary group-hover:text-text-secondary'}">
								<Icon class="h-3.5 w-3.5" />
							</span>
							<span class="min-w-0 flex-1">
								<span class="block text-[12px] font-medium">{localizedThemeLabel(option.value, locale)}</span>
								<span class="block truncate text-[10px] text-text-tertiary">{localizedThemeDescription(option.value, locale)}</span>
							</span>
							{#if active}<Check class="h-3.5 w-3.5 shrink-0 text-brand" />{/if}
						</button>
					{/each}
				</div>
			</section>
		</section>
	</div>
</div>
