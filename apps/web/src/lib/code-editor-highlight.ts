import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import type { Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { tags as t } from "@lezer/highlight";

/**
 * Code colors resolve from the theme tokens themselves, so the editor, chat
 * markdown and the rest of the chrome share one palette per theme instead of
 * maintaining a second hard-coded scale. Because the values are CSS variables,
 * a single palette covers every theme and follows theme switches with no JS
 * work.
 */
const CODE_EDITOR_PALETTE = {
	background: "var(--bg-code)",
	foreground: "var(--text-reading)",
	muted: "var(--text-tertiary)",
	selection: "color-mix(in srgb, var(--brand) 22%, transparent)",
	activeLine: "color-mix(in srgb, var(--bg-hover-strong) 44%, transparent)",
	keyword: "var(--brand)",
	atom: "var(--warning-400)",
	string: "var(--success-400)",
	definition: "var(--info-400)",
	comment: "var(--text-placeholder)",
	variable: "var(--text-reading)",
	invalid: "var(--error-400)",
} as const;

const CODE_EDITOR_HIGHLIGHT_STYLE = HighlightStyle.define([
	{ tag: t.keyword, color: CODE_EDITOR_PALETTE.keyword },
	{
		tag: [t.atom, t.bool, t.number, t.null, t.constant(t.variableName)],
		color: CODE_EDITOR_PALETTE.atom,
	},
	{
		tag: [t.string, t.special(t.string), t.regexp, t.escape, t.attributeValue],
		color: CODE_EDITOR_PALETTE.string,
	},
	{
		tag: [
			t.definition(t.variableName),
			t.definition(t.function(t.variableName)),
			t.definition(t.propertyName),
			t.propertyName,
			t.typeName,
			t.labelName,
		],
		color: CODE_EDITOR_PALETTE.definition,
	},
	{
		tag: [t.variableName, t.attributeName],
		color: CODE_EDITOR_PALETTE.variable,
	},
	{
		tag: [t.comment, t.lineComment, t.blockComment],
		color: CODE_EDITOR_PALETTE.comment,
		fontStyle: "italic",
	},
	{
		tag: [t.heading, t.strong],
		color: CODE_EDITOR_PALETTE.foreground,
		fontWeight: "600",
	},
	{
		tag: [t.link, t.url],
		color: CODE_EDITOR_PALETTE.definition,
		textDecoration: "underline",
	},
	{
		tag: [
			t.separator,
			t.punctuation,
			t.brace,
			t.squareBracket,
			t.paren,
			t.bracket,
			t.meta,
		],
		color: CODE_EDITOR_PALETTE.muted,
	},
	{ tag: t.invalid, color: CODE_EDITOR_PALETTE.invalid },
]);

const editorHighlight = syntaxHighlighting(CODE_EDITOR_HIGHLIGHT_STYLE);

/**
 * `@lezer/yaml` buckets every plain scalar (string, number, bool, null) under
 * the `content` tag — a bucket shared with Markdown paragraphs and HTML text.
 * Coloring it is therefore only safe while YAML is the active language, so it
 * ships as a separate style attached per-language rather than in the shared
 * highlight style.
 *
 * Guarded by `tests/code-editor-highlight.test.ts`.
 */
export const YAML_SCALAR_HIGHLIGHT_STYLE = HighlightStyle.define([
	{ tag: t.content, color: CODE_EDITOR_PALETTE.string },
]);

const yamlScalarHighlight = syntaxHighlighting(YAML_SCALAR_HIGHLIGHT_STYLE);

const YAML_LANGUAGES = new Set(["yaml", "yml"]);

/**
 * Combine a language extension with the highlight rules that are only safe for
 * that language (currently YAML plain scalars).
 */
export function withLanguageHighlights(
	language: string,
	extension: Extension,
): Extension {
	return YAML_LANGUAGES.has(language.toLowerCase())
		? [extension, yamlScalarHighlight]
		: extension;
}

/** Theme island: colors are CSS variables; only the light/dark flag is JS. */
export function getCodeEditorTheme(options: {
	dark: boolean;
	fontSize: string;
}): Extension {
	return [
		EditorView.theme(
			{
				"&": {
					backgroundColor: CODE_EDITOR_PALETTE.background,
					color: CODE_EDITOR_PALETTE.foreground,
					fontSize: options.fontSize,
					fontFamily: "var(--font-mono, monospace)",
				},
				"&.cm-focused": {
					outline: "none",
				},
				".cm-scroller": {
					overflow: "auto",
				},
				".cm-gutters": {
					backgroundColor: "transparent",
					borderRight: "1px solid var(--border-subtle)",
					color: CODE_EDITOR_PALETTE.muted,
				},
				".cm-activeLineGutter": {
					backgroundColor: "transparent",
					color: CODE_EDITOR_PALETTE.foreground,
				},
				".cm-content": {
					padding: "12px 0",
					caretColor: "var(--brand)",
				},
				".cm-line": {
					padding: "0 8px",
				},
				".cm-selectionBackground, &.cm-focused .cm-selectionBackground": {
					backgroundColor: CODE_EDITOR_PALETTE.selection,
				},
				".cm-activeLine": {
					backgroundColor: CODE_EDITOR_PALETTE.activeLine,
				},
				".cm-cursor": {
					borderLeftColor: "var(--brand)",
				},
			},
			{ dark: options.dark },
		),
		editorHighlight,
	];
}
