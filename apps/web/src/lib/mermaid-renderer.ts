import { isDarkTheme, type ResolvedTheme } from "$lib/theme-registry";

type MermaidApi = typeof import("mermaid").default;

const MAX_MERMAID_SOURCE_LENGTH = 12_000;
const MAX_MERMAID_SOURCE_LINES = 240;

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
		fontFamily: "var(--font-sans, Geist, ui-sans-serif, system-ui, sans-serif)",
		securityLevel: "strict",
		startOnLoad: false,
		theme: isDarkTheme(theme) ? "dark" : "default",
		themeVariables: {
			background: "transparent",
			fontFamily:
				"var(--font-sans, Geist, ui-sans-serif, system-ui, sans-serif)",
			lineColor: "var(--border-primary)",
			mainBkg: "var(--bg-surface-muted, var(--bg-surface))",
			primaryColor: "var(--bg-surface-muted, var(--bg-surface))",
			primaryTextColor: "var(--text-primary)",
			secondaryColor: "var(--bg-hover)",
			tertiaryColor: "var(--bg-elevated)",
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

function markMermaidUnavailable(element: HTMLElement) {
	element.dataset.mermaidRendered = "true";
	element.textContent = "Preview unavailable.";
}

export async function renderMermaidDiagrams(root: HTMLElement) {
	const elements = [...root.querySelectorAll<HTMLElement>(".markdown-mermaid")];
	if (elements.length === 0) return;

	let mermaid: MermaidApi;
	try {
		mermaid = await getMermaid();
		initializeMermaid(mermaid, resolveTheme());
	} catch {
		for (const element of elements) {
			if (element.dataset.mermaidRendered !== "true") {
				markMermaidUnavailable(element);
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
			} catch {
				if (
					!element.isConnected ||
					element.dataset.mermaidRenderToken !== token
				) {
					return;
				}
				markMermaidUnavailable(element);
			}
		}),
	);
}
