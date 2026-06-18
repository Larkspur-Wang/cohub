import { isDarkTheme, type ResolvedTheme } from "$lib/theme-registry";

type MermaidApi = typeof import("mermaid").default;

const MAX_MERMAID_SOURCE_LENGTH = 12_000;
const MAX_MERMAID_SOURCE_LINES = 240;
const FONT_FAMILY = "Geist, ui-sans-serif, system-ui, sans-serif";

const MERMAID_THEME_VARIABLES = {
	dark: {
		lineColor: "#5A5B66",
		primaryColor: "#33343B",
		primaryTextColor: "#ECEEF2",
		secondaryColor: "#3F4048",
		tertiaryColor: "#4E4F59",
	},
	light: {
		lineColor: "#D0D1D7",
		primaryColor: "#F2F2F5",
		primaryTextColor: "#22232A",
		secondaryColor: "#E8E8EC",
		tertiaryColor: "#FFFFFF",
	},
	"solarized-dark": {
		lineColor: "#4E6770",
		primaryColor: "#12343D",
		primaryTextColor: "#F3E9C5",
		secondaryColor: "#173F49",
		tertiaryColor: "#214A53",
	},
	"solarized-light": {
		lineColor: "#D9CC9E",
		primaryColor: "#F6EFCF",
		primaryTextColor: "#3A3524",
		secondaryColor: "#EFE4BC",
		tertiaryColor: "#FDF6E3",
	},
} satisfies Record<ResolvedTheme, Record<string, string>>;

let mermaidPromise: Promise<MermaidApi> | null = null;
let renderSeq = 0;
let currentTheme: ResolvedTheme | null = null;

function getMermaid() {
	mermaidPromise ??= import("mermaid").then((module) => module.default);
	return mermaidPromise;
}

function resolveTheme(): ResolvedTheme {
	const theme = document.documentElement.getAttribute("data-theme");
	if (
		theme === "dark" ||
		theme === "light" ||
		theme === "solarized-dark" ||
		theme === "solarized-light"
	) {
		return theme;
	}
	return "dark";
}

function initializeMermaid(mermaid: MermaidApi, theme: ResolvedTheme) {
	if (currentTheme === theme) return;
	currentTheme = theme;
	mermaid.initialize({
		fontFamily: FONT_FAMILY,
		securityLevel: "strict",
		startOnLoad: false,
		theme: isDarkTheme(theme) ? "dark" : "default",
		themeVariables: {
			fontFamily: FONT_FAMILY,
			...MERMAID_THEME_VARIABLES[theme],
		},
	});
}

function readMermaidSource(element: HTMLElement) {
	const encoded = element.dataset.mermaidSource;
	if (!encoded) return "";
	try {
		return decodeURIComponent(encoded);
	} catch {
		return "";
	}
}

function isMermaidSourceTooLarge(source: string) {
	return (
		source.length > MAX_MERMAID_SOURCE_LENGTH ||
		source.split(/\r?\n/).length > MAX_MERMAID_SOURCE_LINES
	);
}

function getErrorMessage(error: unknown) {
	return error instanceof Error && error.message
		? error.message
		: String(error || "Unknown error");
}

function warnMermaidFailure(message: string, details: Record<string, unknown>) {
	console.warn(`[mermaid] ${message}`, details);
}

function markMermaidUnavailable(element: HTMLElement, error?: unknown) {
	element.dataset.mermaidRendered = "true";
	element.textContent = "Preview unavailable.";
	if (error) element.title = getErrorMessage(error);
}

export async function renderMermaidDiagrams(root: HTMLElement) {
	const elements = [...root.querySelectorAll<HTMLElement>(".markdown-mermaid")];
	if (elements.length === 0) return;

	let mermaid: MermaidApi;
	try {
		mermaid = await getMermaid();
		initializeMermaid(mermaid, resolveTheme());
	} catch (error) {
		warnMermaidFailure("renderer failed to load or initialize", {
			error: getErrorMessage(error),
		});
		for (const element of elements) {
			if (element.dataset.mermaidRendered !== "true") {
				markMermaidUnavailable(element, error);
			}
		}
		return;
	}

	await Promise.all(
		elements.map(async (element) => {
			if (
				element.dataset.mermaidRendered === "true" ||
				element.dataset.mermaidRendered === "pending"
			) {
				return;
			}

			const source = readMermaidSource(element).trim();
			if (!source) return;

			if (isMermaidSourceTooLarge(source)) {
				warnMermaidFailure("diagram source is too large", {
					length: source.length,
					lines: source.split(/\r?\n/).length,
				});
				markMermaidUnavailable(element);
				return;
			}

			const token = `${++renderSeq}`;
			element.dataset.mermaidRendered = "pending";
			element.dataset.mermaidRenderToken = token;

			try {
				const { svg, bindFunctions } = await mermaid.render(
					`markdown-mermaid-${token}`,
					source,
				);
				if (
					!element.isConnected ||
					element.dataset.mermaidRenderToken !== token
				) {
					return;
				}
				element.innerHTML = svg;
				bindFunctions?.(element);
				element.dataset.mermaidRendered = "true";
			} catch (error) {
				if (
					!element.isConnected ||
					element.dataset.mermaidRenderToken !== token
				) {
					return;
				}
				warnMermaidFailure("diagram render failed", {
					error: getErrorMessage(error),
					theme: currentTheme,
					source,
				});
				markMermaidUnavailable(element, error);
			}
		}),
	);
}
