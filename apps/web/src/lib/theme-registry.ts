export const THEME_STORAGE_KEY = "cohub-theme";

export const RESOLVED_THEMES = [
	"dark",
	"light",
	"solarized-dark",
	"solarized-light",
] as const;

export type ResolvedTheme = (typeof RESOLVED_THEMES)[number];
export type ThemeMode = ResolvedTheme | "system";

export type ThemeOption = {
	value: ThemeMode;
	label: string;
	description: string;
};

export const THEME_OPTIONS: ThemeOption[] = [
	{
		value: "dark",
		label: "Dark",
		description: "Always use the default dark theme",
	},
	{
		value: "light",
		label: "Light",
		description: "Always use the default light theme",
	},
	{
		value: "solarized-dark",
		label: "Solarized Dark",
		description: "A calm low-contrast dark theme for long sessions",
	},
	{
		value: "solarized-light",
		label: "Solarized Light",
		description: "A warm light theme tuned for reading and code",
	},
	{
		value: "system",
		label: "System",
		description: "Follow your system preference",
	},
];

export const THEME_COLOR: Record<ResolvedTheme, string> = {
	dark: "#1F2026",
	light: "#F8F8FA",
	"solarized-dark": "#002B36",
	"solarized-light": "#FDF6E3",
};

export function isResolvedTheme(value: string | null): value is ResolvedTheme {
	return RESOLVED_THEMES.includes(value as ResolvedTheme);
}

export function isThemeMode(value: string | null): value is ThemeMode {
	return value === "system" || isResolvedTheme(value);
}

export function isDarkTheme(theme: ResolvedTheme): boolean {
	return theme === "dark" || theme === "solarized-dark";
}

export function getSystemTheme(): ResolvedTheme {
	if (typeof window === "undefined") return "dark";
	return window.matchMedia("(prefers-color-scheme: dark)").matches
		? "dark"
		: "light";
}

export function resolveThemeMode(mode: ThemeMode): ResolvedTheme {
	return mode === "system" ? getSystemTheme() : mode;
}
