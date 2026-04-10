import DOMPurify from "isomorphic-dompurify";
import { marked, type Tokens, type Token } from "marked";
import { createHighlighter, type HighlighterGeneric, type BundledLanguage, type BundledTheme } from "shiki";

// Shiki highlighter — singleton, lazily initialized
let highlighterPromise: Promise<HighlighterGeneric<BundledLanguage, BundledTheme>> | null = null;

function getHighlighter() {
  if (!highlighterPromise) {
    highlighterPromise = createHighlighter({
      themes: ["github-dark"],
      langs: [
        "typescript", "javascript", "python", "bash", "shell",
        "json", "yaml", "yml", "html", "css", "sql",
        "rust", "go", "java", "c", "cpp", "tsx", "jsx",
        "toml", "ini", "diff", "markdown", "dockerfile",
        "mermaid", "xml", "graphql", "protobuf",
      ],
    });
  }
  return highlighterPromise;
}

/** Walk tokens recursively and highlight code blocks with shiki. */
async function highlightCodeTokens(tokens: Token[]) {
  const highlighter = await getHighlighter();

  for (const token of tokens) {
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
          theme: "github-dark",
        });

        // Replace token content; parser will wrap in <pre><code>, so we use
        // a sentinel that gets swapped out after rendering.
        const codeToken = token as Tokens.Code;
        codeToken.text = `__SHIKI_HIGHLIGHT__${highlighted}__END_SHIKI_HIGHLIGHT__`;
        codeToken.raw = codeToken.text;
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

  // Swap shiki sentinel-wrapped HTML back (bypass <pre><code> wrapper from parser)
  const resolvedHtml = html.replace(
    /<pre><code(?:\s+class="language-[^"]*")?>__SHIKI_HIGHLIGHT__(.*?)__END_SHIKI_HIGHLIGHT__\n?<\/code><\/pre>/gs,
    "$1",
  );

  // Open all links in new tab
  const linkedHtml = resolvedHtml.replace(
    /<a /g,
    '<a target="_blank" rel="noopener noreferrer" ',
  );

  return DOMPurify.sanitize(linkedHtml, { ADD_ATTR: ["target"] });
};
