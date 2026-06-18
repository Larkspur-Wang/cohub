import { isDarkTheme, type ResolvedTheme } from "$lib/theme-registry";

type MermaidApi = typeof import("mermaid").default;

const MAX_MERMAID_SOURCE_LENGTH = 12_000;
const MAX_MERMAID_SOURCE_LINES = 240;

let mermaidPromise: Promise<MermaidApi> | null = null;
let renderSeq = 0;
let currentTheme: ResolvedTheme | null = null;

function logMermaidError(message: string, details: Record<string, unknown>) {
	console.warn(`[mermaid] ${message}`, details);
}

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

function getErrorMessage(error: unknown) {
	return error instanceof Error && error.message
		? error.message
		: String(error || "Unknown error");
}

function markMermaidUnavailable(element: HTMLElement, error?: unknown) {
	element.dataset.mermaidRendered = "true";
	element.textContent = "Preview unavailable.";
	if (error) element.title = getErrorMessage(error);
}

function quoteMermaidLabel(label: string) {
	const text = label.trim();
	if (!text || text.startsWith('"') || text.startsWith("'")) return label;
	return `"${text.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
}

function repairFlowchartLabels(source: string) {
	if (!/^\s*(?:flowchart|graph)\s+/m.test(source)) return source;
	return source
		.replaceAll(/([A-Za-z][\w-]*)\[([^\]"'][^\]]*)\]/g, (_, id, label) => {
			return `${id}[${quoteMermaidLabel(label)}]`;
		})
		.replaceAll(/([A-Za-z][\w-]*)\{([^}"'][^}]*)\}/g, (_, id, label) => {
			return `${id}{${quoteMermaidLabel(label)}}`;
		});
}

async function renderMermaidSvg(
	mermaid: MermaidApi,
	id: string,
	source: string,
) {
	try {
		return await mermaid.render(id, source);
	} catch (error) {
		const repairedSource = repairFlowchartLabels(source);
		if (repairedSource === source) throw error;
		logMermaidError("retrying with quoted flowchart labels", {
			error: getErrorMessage(error),
			id,
			source,
			repairedSource,
		});
		return mermaid.render(`${id}-repaired`, repairedSource);
	}
}

export async function renderMermaidDiagrams(root: HTMLElement) {
	const elements = [...root.querySelectorAll<HTMLElement>(".markdown-mermaid")];
	if (elements.length === 0) return;

	let mermaid: MermaidApi;
	try {
		mermaid = await getMermaid();
		initializeMermaid(mermaid, resolveTheme());
	} catch (error) {
		logMermaidError("renderer failed to load or initialize", {
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
			if (!source) {
				logMermaidError("empty diagram source", { element });
				return;
			}
			if (isMermaidSourceTooLarge(source)) {
				logMermaidError("diagram source is too large", {
					length: source.length,
					lines: source.split(/\r?\n/).length,
					source,
				});
				markMermaidUnavailable(element);
				return;
			}

			const token = `${++renderSeq}`;
			element.dataset.mermaidRendered = "pending";
			element.dataset.mermaidRenderToken = token;

			try {
				const { svg, bindFunctions } = await renderMermaidSvg(
					mermaid,
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
				logMermaidError("diagram render failed", {
					error: getErrorMessage(error),
					source,
					repairedSource: repairFlowchartLabels(source),
					theme: currentTheme,
				});
				markMermaidUnavailable(element, error);
			}
		}),
	);
}
