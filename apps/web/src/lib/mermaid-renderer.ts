import { isDarkTheme, type ResolvedTheme } from "$lib/theme-registry";

type MermaidApi = typeof import("mermaid").default;

const MAX_MERMAID_SOURCE_LENGTH = 12_000;
const MAX_MERMAID_SOURCE_LINES = 240;
const FONT_FAMILY = "Geist, ui-sans-serif, system-ui, sans-serif";
const MIN_SCALE = 0.25;
const MAX_SCALE = 2.5;
const DEFAULT_MAX_WIDTH = 760;
const DEFAULT_MAX_HEIGHT = 460;

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

function clampScale(scale: number) {
	return Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale));
}

function getSvgSize(svg: SVGSVGElement) {
	const viewBox = svg.viewBox.baseVal;
	if (viewBox.width > 0 && viewBox.height > 0) {
		return { width: viewBox.width, height: viewBox.height };
	}
	const rect = svg.getBoundingClientRect();
	return {
		width: Math.max(1, rect.width),
		height: Math.max(1, rect.height),
	};
}

function getDefaultScale(svg: SVGSVGElement) {
	const { width, height } = getSvgSize(svg);
	return clampScale(
		Math.min(1, DEFAULT_MAX_WIDTH / width, DEFAULT_MAX_HEIGHT / height),
	);
}

function setMermaidScale(element: HTMLElement, scale: number) {
	const svg = element.querySelector<SVGSVGElement>("svg");
	const label = element.querySelector<HTMLElement>("[data-mermaid-zoom-label]");
	if (!svg) return;

	const nextScale = clampScale(scale);
	const { width } = getSvgSize(svg);
	element.dataset.mermaidScale = String(nextScale);
	svg.style.width = `${Math.round(width * nextScale)}px`;
	svg.style.maxWidth = "none";
	svg.style.height = "auto";
	if (label) label.textContent = `${Math.round(nextScale * 100)}%`;
}

function createMermaidButton(input: {
	label: string;
	title: string;
	onClick: () => void;
}) {
	const button = document.createElement("button");
	button.type = "button";
	button.className = "markdown-mermaid-action";
	button.textContent = input.label;
	button.title = input.title;
	button.setAttribute("aria-label", input.title);
	button.addEventListener("click", (event) => {
		event.preventDefault();
		event.stopPropagation();
		input.onClick();
	});
	return button;
}

async function downloadMermaidPng(element: HTMLElement) {
	const svg = element.querySelector<SVGSVGElement>("svg");
	if (!svg) return;

	const { width, height } = getSvgSize(svg);
	const exportScale = Math.min(2, 4096 / Math.max(width, height));
	const canvas = document.createElement("canvas");
	canvas.width = Math.max(1, Math.round(width * exportScale));
	canvas.height = Math.max(1, Math.round(height * exportScale));

	const context = canvas.getContext("2d");
	if (!context) return;

	const clone = svg.cloneNode(true) as SVGSVGElement;
	clone.removeAttribute("style");
	clone.setAttribute("width", String(width));
	clone.setAttribute("height", String(height));
	clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");

	const svgBlob = new Blob([new XMLSerializer().serializeToString(clone)], {
		type: "image/svg+xml;charset=utf-8",
	});
	const url = URL.createObjectURL(svgBlob);
	try {
		const image = new Image();
		image.decoding = "async";
		const loaded = new Promise<void>((resolve, reject) => {
			image.onload = () => resolve();
			image.onerror = () => reject(new Error("Unable to load diagram image."));
		});
		image.src = url;
		await loaded;
		context.drawImage(image, 0, 0, canvas.width, canvas.height);
		const pngBlob = await new Promise<Blob | null>((resolve) =>
			canvas.toBlob(resolve, "image/png"),
		);
		if (!pngBlob) return;

		const link = document.createElement("a");
		const pngUrl = URL.createObjectURL(pngBlob);
		link.href = pngUrl;
		link.download = "mermaid-diagram.png";
		document.body.appendChild(link);
		link.click();
		link.remove();
		URL.revokeObjectURL(pngUrl);
	} finally {
		URL.revokeObjectURL(url);
	}
}

function enhanceMermaidDiagram(element: HTMLElement) {
	const svg = element.querySelector<SVGSVGElement>("svg");
	if (!svg) return;

	const canvas = document.createElement("div");
	canvas.className = "markdown-mermaid-canvas";
	svg.parentNode?.insertBefore(canvas, svg);
	canvas.appendChild(svg);

	const controls = document.createElement("div");
	controls.className = "markdown-mermaid-actions";
	controls.append(
		createMermaidButton({
			label: "−",
			title: "Zoom out",
			onClick: () =>
				setMermaidScale(
					element,
					Number(element.dataset.mermaidScale || 1) - 0.1,
				),
		}),
	);

	const zoomLabel = document.createElement("button");
	zoomLabel.type = "button";
	zoomLabel.className = "markdown-mermaid-action markdown-mermaid-zoom-label";
	zoomLabel.dataset.mermaidZoomLabel = "";
	zoomLabel.title = "Reset zoom";
	zoomLabel.setAttribute("aria-label", "Reset zoom");
	zoomLabel.addEventListener("click", (event) => {
		event.preventDefault();
		event.stopPropagation();
		setMermaidScale(element, getDefaultScale(svg));
	});
	controls.append(zoomLabel);

	controls.append(
		createMermaidButton({
			label: "+",
			title: "Zoom in",
			onClick: () =>
				setMermaidScale(
					element,
					Number(element.dataset.mermaidScale || 1) + 0.1,
				),
		}),
		createMermaidButton({
			label: "PNG",
			title: "Download PNG",
			onClick: () => {
				void downloadMermaidPng(element).catch((error) =>
					warnMermaidFailure("diagram download failed", {
						error: getErrorMessage(error),
					}),
				);
			},
		}),
	);
	element.appendChild(controls);

	element.onwheel = (event) => {
		if (!event.ctrlKey && !event.metaKey) return;
		event.preventDefault();
		const step = event.deltaY > 0 ? -0.08 : 0.08;
		setMermaidScale(element, Number(element.dataset.mermaidScale || 1) + step);
	};

	setMermaidScale(element, getDefaultScale(svg));
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
				enhanceMermaidDiagram(element);
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
