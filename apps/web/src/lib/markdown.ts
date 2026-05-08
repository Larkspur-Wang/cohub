import DOMPurify from "isomorphic-dompurify";
import { marked, type Token, type Tokens } from "marked";
import {
	type BundledLanguage,
	type BundledTheme,
	createHighlighter,
	type HighlighterGeneric,
} from "shiki";

const linkTargetHook = (node: Element) => {
	if (node.nodeName === "A" && "setAttribute" in node) {
		node.setAttribute("target", "_blank");
		node.setAttribute("rel", "noopener noreferrer");
	}
};

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

export const renderMarkdown = async (source: string) => {
	const tokens = marked.lexer(source, { gfm: true });
	await highlightCodeTokens(tokens);
	const html = marked.parser(tokens);

	DOMPurify.addHook("afterSanitizeAttributes", linkTargetHook);
	try {
		return DOMPurify.sanitize(html, { ADD_ATTR: ["target"] });
	} finally {
		DOMPurify.removeHook("afterSanitizeAttributes");
	}
};
