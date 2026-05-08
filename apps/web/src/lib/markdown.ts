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

async function renderMarkdownHtml(source: string) {
	const tokens = marked.lexer(source, { gfm: true });
	await highlightCodeTokens(tokens);
	return marked.parser(tokens);
}

function sanitizeMarkdownHtml(html: string) {
	const sanitized = DOMPurify.sanitize(html);
	return sanitized.replace(
		/<a /g,
		'<a target="_blank" rel="noopener noreferrer" ',
	);
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
			}
			continue;
		}

		const openingFence = isFencedCodeFenceLine(line.trim());
		if (openingFence) {
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
		`<pre><code${languageClass}>${escapeHtml(code)}</code></pre>`,
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

async function renderMarkdownBlock(source: string) {
	const html = await renderMarkdownHtml(source);
	return sanitizeMarkdownHtml(html);
}

export const renderMarkdown = async (source: string) => {
	const normalizedSource = source.trim();
	if (!normalizedSource) return "";

	return cacheMarkdownRender(`full:${normalizedSource}`, async () => {
		return renderMarkdownBlock(normalizedSource);
	});
};

export const renderStreamingMarkdown = async (source: string) => {
	const normalizedSource = source.trim();
	if (!normalizedSource) return "";

	const blocks = splitMarkdownBlocks(normalizedSource);
	if (blocks.length === 0) return "";

	const renderedBlocks = await Promise.all(
		blocks.map(async (block, index) => {
			const isLast = index === blocks.length - 1;
			if (block.kind === "fence" && !block.closedFence)
				return renderPlainCodeBlock(block.text);

			const cacheKey = isLast
				? `stream-tail:${block.text}`
				: `block:${block.text}`;
			return cacheMarkdownRender(cacheKey, async () =>
				renderMarkdownBlock(block.text),
			);
		}),
	);

	return renderedBlocks.filter(Boolean).join("\n\n");
};
