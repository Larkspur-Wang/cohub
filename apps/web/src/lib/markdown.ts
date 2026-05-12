import DOMPurify from "isomorphic-dompurify";
import { marked, type Token, type Tokens } from "marked";
import {
	type BundledLanguage,
	type BundledTheme,
	createHighlighter,
	type HighlighterGeneric,
} from "shiki";

const MARKDOWN_RENDER_CACHE_LIMIT = 256;
const markdownRenderCache = new Map<string, Promise<string>>();

function cacheMarkdownRender(key: string, render: () => Promise<string>) {
	const cached = markdownRenderCache.get(key);
	if (cached) return cached;

	const promise = render().catch((error) => {
		markdownRenderCache.delete(key);
		throw error;
	});

	markdownRenderCache.set(key, promise);
	if (markdownRenderCache.size > MARKDOWN_RENDER_CACHE_LIMIT) {
		const firstKey = markdownRenderCache.keys().next().value;
		if (firstKey) markdownRenderCache.delete(firstKey);
	}

	return promise;
}

// Shiki highlighter — singleton, lazily initialized
let highlighterPromise: Promise<
	HighlighterGeneric<BundledLanguage, BundledTheme>
> | null = null;

function getHighlighter() {
	if (!highlighterPromise) {
		highlighterPromise = createHighlighter({
			themes: ["github-light", "github-dark"],
			langs: [
				"typescript",
				"javascript",
				"python",
				"bash",
				"shell",
				"json",
				"yaml",
				"yml",
				"html",
				"css",
				"sql",
				"rust",
				"go",
				"java",
				"c",
				"cpp",
				"tsx",
				"jsx",
				"toml",
				"ini",
				"diff",
				"markdown",
				"dockerfile",
				"mermaid",
				"xml",
				"graphql",
				"protobuf",
			],
		});
	}
	return highlighterPromise;
}

/**
 * Walk tokens recursively and replace code tokens with html tokens
 * containing shiki-highlighted output.
 *
 * We use `html` tokens (not `code` tokens) because marked.parser
 * escapes code token content, which would break shiki's HTML output.
 */
async function highlightCodeTokens(tokens: Token[]) {
	const highlighter = await getHighlighter();

	for (let i = 0; i < tokens.length; i++) {
		const token = tokens[i];
		if (token.type === "code" && "lang" in token && token.lang) {
			const rawLang = token.lang.split(" ")[0]; // handle e.g. "ts {1-3}"
			const lang = rawLang.toLowerCase();

			try {
				const supportedLangs = highlighter.getLoadedLanguages();
				const useLang = supportedLangs.includes(lang as BundledLanguage)
					? lang
					: "plaintext";

				const highlighted = highlighter.codeToHtml(token.text, {
					lang: useLang as BundledLanguage,
					themes: {
						light: "github-light",
						dark: "github-dark",
					},
					defaultColor: false,
				});

				// Replace code token with html token so marked renders it unescaped
				const codeToken = token as Tokens.Code;
				tokens[i] = {
					type: "html",
					raw: codeToken.raw,
					text: highlighted,
					pre: true,
				} as Tokens.HTML;
			} catch {
				// Fallback: leave code as-is
			}
		}

		// Recurse into nested tokens (lists, blockquotes, etc.)
		if ("tokens" in token && Array.isArray(token.tokens)) {
			await highlightCodeTokens(token.tokens);
		}
	}
}

async function renderMarkdownHtml(
	source: string,
	options?: { highlight?: boolean },
) {
	const tokens = marked.lexer(source, { gfm: true });
	if (options?.highlight !== false) await highlightCodeTokens(tokens);
	return marked.parser(tokens);
}

const EXTERNAL_LINK_PROTOCOLS = new Set(["http:", "https:"]);

function isExternalHttpLink(href: string) {
	try {
		const url = new URL(
			href,
			typeof window === "undefined"
				? "https://cohub.local"
				: window.location.href,
		);
		return (
			EXTERNAL_LINK_PROTOCOLS.has(url.protocol) && /^(https?:)?\/\//i.test(href)
		);
	} catch {
		return false;
	}
}

DOMPurify.addHook("afterSanitizeAttributes", (node) => {
	if (node.nodeName !== "A") return;

	const element = node as Element;
	const href = element.getAttribute("href")?.trim();
	if (!href || !isExternalHttpLink(href)) return;

	element.setAttribute("target", "_blank");
	element.setAttribute("rel", "noopener noreferrer");
});

function sanitizeMarkdownHtml(html: string) {
	return DOMPurify.sanitize(html);
}

function isFencedCodeFenceLine(line: string) {
	const match = line.match(/^([`~]{3,})(.*)$/);
	if (!match) return null;
	return { fence: match[1], marker: match[1][0] };
}

type MarkdownBlock = {
	text: string;
	kind: "text" | "fence";
	closedFence: boolean;
};

function splitMarkdownBlocks(source: string): MarkdownBlock[] {
	if (!source) return [];

	const lines = source.split(/\r?\n/);
	const blocks: MarkdownBlock[] = [];
	let buffer: string[] = [];
	let fence: { fence: string; marker: string } | null = null;

	const pushBuffer = () => {
		if (buffer.length === 0) return;
		blocks.push({
			text: buffer.join("\n"),
			kind: fence ? "fence" : "text",
			closedFence: !fence,
		});
		buffer = [];
	};

	for (const line of lines) {
		const fenceState = fence ? isFencedCodeFenceLine(line.trim()) : null;

		if (fence) {
			buffer.push(line);
			if (
				fenceState &&
				fenceState.marker === fence.marker &&
				fenceState.fence.length >= fence.fence.length
			) {
				fence = null;
				pushBuffer();
			}
			continue;
		}

		const openingFence = isFencedCodeFenceLine(line.trim());
		if (openingFence) {
			pushBuffer();
			buffer.push(line);
			fence = openingFence;
			continue;
		}

		buffer.push(line);
	}

	pushBuffer();
	return blocks;
}

function renderPlainCodeBlock(source: string) {
	const lines = source.split(/\r?\n/);
	const openingFence = isFencedCodeFenceLine(lines[0]?.trim() ?? "");
	const language = openingFence
		? lines[0].trim().slice(openingFence.fence.length).trim().split(/\s+/)[0]
		: "";
	const code = openingFence ? lines.slice(1).join("\n") : source;
	const languageClass = language ? ` class="language-${language}"` : "";
	return sanitizeMarkdownHtml(
		`<pre data-streaming-code="true"><code${languageClass}>${escapeHtml(code)}</code></pre>`,
	);
}

function escapeHtml(source: string) {
	return source
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replaceAll('"', "&quot;")
		.replaceAll("'", "&#039;");
}

function renderStreamingTail(source: string) {
	if (!source) return "";
	return `<span class="markdown-streaming-tail">${escapeHtml(source)}</span>`;
}

async function renderMarkdownBlock(
	source: string,
	options?: { highlight?: boolean },
) {
	const html = await renderMarkdownHtml(source, options);
	return sanitizeMarkdownHtml(html);
}

export const renderMarkdown = async (source: string) => {
	const normalizedSource = source.trim();
	if (!normalizedSource) return "";

	return cacheMarkdownRender(`full:${normalizedSource}`, async () => {
		return renderMarkdownBlock(normalizedSource);
	});
};

function hasUnclosedInlineMarkdown(source: string) {
	const tail = source.slice(-320);
	const inlineCodeTicks = (tail.match(/(?<!`)`(?!`)/g) ?? []).length;
	if (inlineCodeTicks % 2 === 1) return true;

	const boldStars = (tail.match(/(?<!\*)\*\*(?!\*)/g) ?? []).length;
	const boldUnderscores = (tail.match(/(?<!_)__(?!_)/g) ?? []).length;
	if (boldStars % 2 === 1 || boldUnderscores % 2 === 1) return true;

	const linkOpen = tail.lastIndexOf("[");
	const linkClose = tail.lastIndexOf("]");
	const parenOpen = tail.lastIndexOf("](");
	const parenClose = tail.lastIndexOf(")");
	return linkOpen > linkClose || parenOpen > parenClose;
}

function findStreamingSafeIndex(source: string) {
	const length = source.length;
	if (length < 140) return 0;

	const minTail = source.endsWith("\n")
		? 64
		: Math.min(320, Math.max(96, Math.floor(length * 0.16)));
	const maxStableIndex = Math.max(0, length - minTail);
	const searchStart = Math.max(0, maxStableIndex - 1400);
	const window = source.slice(searchStart, maxStableIndex);
	const candidates: number[] = [];

	// Only promote completed paragraphs/blocks while streaming. Promoting at
	// sentence or single-line boundaries makes the live plain-text tail suddenly
	// reflow into Markdown (lists, headings, bold text), which reads as a visual
	// jump. Paragraph boundaries are slower, but much more stable and refined.
	for (const match of window.matchAll(/\n\s*\n/g)) {
		candidates.push(searchStart + match.index + match[0].length);
	}

	candidates.sort((a, b) => b - a);
	for (const candidate of candidates) {
		const stable = source.slice(0, candidate);
		const tail = source.slice(candidate);
		if (!stable.trim()) continue;
		if (tail.length > 620) continue;
		if (hasUnclosedInlineMarkdown(stable.slice(-480))) continue;
		return candidate;
	}

	return 0;
}

export function splitStreamingStableMarkdown(source: string) {
	const safeIndex = findStreamingSafeIndex(source);
	return {
		stable: source.slice(0, safeIndex),
		tail: source.slice(safeIndex),
	};
}

function countMarkdownBlockMarkers(source: string) {
	const headingCount = (source.match(/^#{1,6}\s/gm) ?? []).length;
	const listCount = (source.match(/^\s*(?:[-+*]|\d+[.)])\s+/gm) ?? []).length;
	const quoteCount = (source.match(/^>\s?/gm) ?? []).length;
	const fenceCount = (source.match(/^\s*([`~]{3,})/gm) ?? []).length;
	return headingCount + listCount + quoteCount + fenceCount;
}

export const renderStreamingMarkdownStable = async (source: string) => {
	const streamingSource = source.trimStart();
	if (!streamingSource.trim()) {
		return { stableSource: "", tailSource: "", stableHtml: "" };
	}

	const blocks = splitMarkdownBlocks(streamingSource);
	if (blocks.length === 0) {
		return { stableSource: "", tailSource: streamingSource, stableHtml: "" };
	}

	const stableSources: string[] = [];
	let tailSource = "";

	for (let index = 0; index < blocks.length; index += 1) {
		const block = blocks[index];
		const isLast = index === blocks.length - 1;
		if (block.kind === "fence") {
			if (block.closedFence || !isLast) stableSources.push(block.text);
			else tailSource = block.text;
			continue;
		}

		if (!isLast) {
			stableSources.push(block.text);
			continue;
		}

		const { stable, tail } = splitStreamingStableMarkdown(block.text);
		if (stable.trim()) stableSources.push(stable);
		tailSource = tail;
	}

	const stableSource = stableSources.join("\n\n");
	const hasMeaningfulTail = tailSource.trim().length > 0;
	const stableHtml = stableSource.trim()
		? await cacheMarkdownRender(`stream-stable-v2:${stableSource}`, async () =>
				renderMarkdownBlock(stableSource, {
					highlight:
						!hasMeaningfulTail || countMarkdownBlockMarkers(stableSource) <= 1,
				}),
			)
		: "";

	return { stableSource, tailSource, stableHtml };
};

export const renderStreamingMarkdown = async (source: string) => {
	const streamingSource = source.trimStart();
	if (!streamingSource.trim()) return "";

	const blocks = splitMarkdownBlocks(streamingSource);
	if (blocks.length === 0) return "";

	const renderedBlocks = await Promise.all(
		blocks.map(async (block, index) => {
			const isLast = index === blocks.length - 1;
			if (block.kind === "fence") return renderPlainCodeBlock(block.text);

			if (
				isLast &&
				/^\s*([`~]{3,})[\s\S]*\n\1\s*$/.test(block.text) &&
				block.text.trim().length < 120
			) {
				return renderPlainCodeBlock(block.text);
			}

			const shouldRenderWholeLastBlock =
				isLast &&
				block.text.endsWith("\n") &&
				block.text.trim().length < 120 &&
				!hasUnclosedInlineMarkdown(block.text);
			if (shouldRenderWholeLastBlock) {
				return renderMarkdownBlock(block.text, { highlight: false });
			}

			if (!isLast) {
				return cacheMarkdownRender(`stream-block:${block.text}`, async () =>
					renderMarkdownBlock(block.text, { highlight: false }),
				);
			}

			const { stable, tail } = splitStreamingStableMarkdown(block.text);
			const stableHtml = stable.trim()
				? await cacheMarkdownRender(`stream-stable:${stable}`, async () =>
						renderMarkdownBlock(stable, { highlight: false }),
					)
				: "";
			return [stableHtml, renderStreamingTail(tail)].filter(Boolean).join("\n");
		}),
	);

	return renderedBlocks.filter(Boolean).join("\n\n");
};
