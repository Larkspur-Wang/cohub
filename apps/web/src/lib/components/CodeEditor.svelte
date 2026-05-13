<script lang="ts">
import { closeBrackets, closeBracketsKeymap } from "@codemirror/autocomplete";
import {
	defaultKeymap,
	history,
	historyKeymap,
	indentWithTab,
} from "@codemirror/commands";
import { css } from "@codemirror/lang-css";
import { html } from "@codemirror/lang-html";
import { javascript } from "@codemirror/lang-javascript";
import { json } from "@codemirror/lang-json";
import { markdown } from "@codemirror/lang-markdown";
import { python } from "@codemirror/lang-python";
import { xml } from "@codemirror/lang-xml";
import { yaml } from "@codemirror/lang-yaml";
import {
	bracketMatching,
	foldGutter,
	foldKeymap,
	indentOnInput,
} from "@codemirror/language";
import { highlightSelectionMatches, searchKeymap } from "@codemirror/search";
import { Compartment, EditorState } from "@codemirror/state";
import {
	crosshairCursor,
	drawSelection,
	dropCursor,
	EditorView,
	highlightActiveLine,
	highlightActiveLineGutter,
	highlightSpecialChars,
	keymap,
	lineNumbers,
	rectangularSelection,
} from "@codemirror/view";
import { githubDark, githubLight } from "@uiw/codemirror-theme-github";
import { onDestroy, onMount } from "svelte";

const {
	value = "",
	language = "plaintext",
	readonly = false,
	onInput,
}: {
	value: string;
	language?: string;
	readonly?: boolean;
	onInput?: (v: string) => void;
} = $props();

let container: HTMLDivElement | undefined = $state();
let view: EditorView | undefined = $state();

// Compartments for dynamic reconfiguration
const langConf = new Compartment();
const themeConf = new Compartment();
const readOnlyConf = new Compartment();

function getLanguageExtension(lang: string) {
	const l = lang.toLowerCase();
	const map: Record<string, () => import("@codemirror/state").Extension> = {
		js: () => javascript({ typescript: false, jsx: false }),
		javascript: () => javascript({ typescript: false, jsx: false }),
		ts: () => javascript({ typescript: true, jsx: false }),
		typescript: () => javascript({ typescript: true, jsx: false }),
		jsx: () => javascript({ typescript: false, jsx: true }),
		tsx: () => javascript({ typescript: true, jsx: true }),
		py: () => python(),
		python: () => python(),
		json: () => json(),
		jsonc: () => json(),
		html: () => html(),
		htm: () => html(),
		svelte: () => html(),
		css: () => css(),
		scss: () => css(),
		md: () => markdown(),
		markdown: () => markdown(),
		yaml: () => yaml(),
		yml: () => yaml(),
		xml: () => xml(),
		svg: () => xml(),
	};
	return map[l]?.() ?? [];
}

function isMobile(): boolean {
	if (typeof window === "undefined") return false;
	return window.innerWidth < 640;
}

function getThemeExtension(dark: boolean) {
	return dark ? githubDark : githubLight;
}

function getEditorFont(): string {
	return isMobile() ? "15px" : "13px";
}

function resolveTheme(): boolean {
	if (typeof document === "undefined") return true;
	const attr = document.documentElement.getAttribute("data-theme");
	return attr !== "light";
}

let currentLanguage = $derived(language);
let currentDark = $state(resolveTheme());

$effect(() => {
	if (!view) return;
	view.dispatch({
		effects: langConf.reconfigure(getLanguageExtension(currentLanguage)),
	});
});

$effect(() => {
	if (!view) return;
	const dark = resolveTheme();
	if (dark !== currentDark) {
		currentDark = dark;
		view.dispatch({
			effects: themeConf.reconfigure(getThemeExtension(dark)),
		});
	}
});

$effect(() => {
	if (!view) return;
	view.dispatch({
		effects: readOnlyConf.reconfigure([
			EditorView.editable.of(!readonly),
			EditorState.readOnly.of(readonly),
		]),
	});
});

// Sync external value changes into the editor (but not while typing)
let syncing = $state(false);
let lastExternal = $state("");

$effect(() => {
	const v = value;
	if (syncing || !view || v === lastExternal) return;
	lastExternal = v;
	const current = view.state.doc.toString();
	if (v !== current) {
		view.dispatch({
			changes: { from: 0, to: current.length, insert: v },
			selection: { anchor: 0 },
		});
	}
});

onMount(() => {
	if (!container) return;

	const dark = resolveTheme();
	currentDark = dark;
	lastExternal = value;
	syncing = true;

	view = new EditorView({
		state: EditorState.create({
			doc: value,
			extensions: [
				lineNumbers(),
				highlightActiveLineGutter(),
				highlightSpecialChars(),
				history(),
				foldGutter(),
				drawSelection(),
				dropCursor(),
				EditorState.allowMultipleSelections.of(true),
				indentOnInput(),
				bracketMatching(),
				closeBrackets(),
				rectangularSelection(),
				crosshairCursor(),
				highlightActiveLine(),
				highlightSelectionMatches(),
				keymap.of([
					...closeBracketsKeymap,
					...defaultKeymap,
					...searchKeymap,
					...historyKeymap,
					...foldKeymap,
					indentWithTab,
				]),
				langConf.of(getLanguageExtension(language)),
				themeConf.of(getThemeExtension(dark)),
				readOnlyConf.of([
					EditorView.editable.of(!readonly),
					EditorState.readOnly.of(readonly),
				]),
				EditorView.lineWrapping,
				EditorView.updateListener.of((update) => {
					if (update.docChanged) {
						syncing = false;
						lastExternal = update.state.doc.toString();
						onInput?.(lastExternal);
					}
				}),
				EditorView.theme({
					"&": {
						fontSize: getEditorFont(),
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
					},
					".cm-activeLineGutter": {
						backgroundColor: "transparent",
					},
					".cm-content": {
						padding: "12px 0",
						caretColor: "var(--brand)",
					},
					".cm-line": {
						padding: "0 8px",
					},
				}),
			],
		}),
		parent: container,
	});

	syncing = false;
});

onDestroy(() => {
	view?.destroy();
	view = undefined;
});
</script>

<!--
  data-drawer-swipe-ignore: prevents the mobile drawer gesture system
  from intercepting touches inside the editor (gutters, scroll areas, etc.).
  touch-action: pan-x pan-y: overrides the inherited pan-y from
  .mobile-drawer-gesture-surface so CodeMirror can handle horizontal
  scrolling for long lines on mobile.
-->
<div bind:this={container} class="cm-wrapper" data-drawer-swipe-ignore></div>

<style>
  .cm-wrapper {
    height: 100%;
    min-height: 0;
    overflow: hidden;
    touch-action: pan-x pan-y;
  }
  .cm-wrapper :global(.cm-editor) {
    height: 100%;
  }
  .cm-wrapper :global(.cm-scroller) {
    font-family: var(--font-mono, monospace);
  }
</style>
