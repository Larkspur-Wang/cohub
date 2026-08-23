export const LOCALE_STORAGE_KEY = "cohub-locale";

export const LOCALES = ["en", "zh-CN"] as const;
export type Locale = (typeof LOCALES)[number];

export const LOCALE_PREFERENCES = ["system", ...LOCALES] as const;
export type LocalePreference = (typeof LOCALE_PREFERENCES)[number];

export function isLocalePreference(
	value: string | null | undefined,
): value is LocalePreference {
	return LOCALE_PREFERENCES.includes(value as LocalePreference);
}

export function resolvePreferredLocale(
	preference: LocalePreference,
	languages: readonly string[] = [],
): Locale {
	if (preference !== "system") return preference;
	for (const language of languages) {
		const primaryLanguage = language.split("-")[0]?.toLowerCase();
		if (primaryLanguage === "en") return "en";
		if (primaryLanguage === "zh") return "zh-CN";
	}
	return "en";
}
