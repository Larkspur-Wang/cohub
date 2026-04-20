export type ThemeMode = "dark" | "light" | "system";
export type ResolvedTheme = "dark" | "light";

const STORAGE_KEY = "cohub-theme";

// --- Reactive state (Svelte 5 runes) ---
let _mode = $state<ThemeMode>("system");
let _resolved = $state<ResolvedTheme>("dark");

function getSystemTheme(): ResolvedTheme {
  if (typeof window === "undefined") return "dark";
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

/** Update reactive state + DOM attribute. Called on init, user action, and system change. */
function applyTheme(mode: ThemeMode, skipDom = false) {
  const resolved = mode === "system" ? getSystemTheme() : mode;
  _mode = mode;
  _resolved = resolved;
  if (!skipDom && typeof document !== "undefined") {
    document.documentElement.setAttribute("data-theme", resolved);
  }
}

// --- Public reactive getters ---
export function getTheme(): ThemeMode {
  return _mode;
}

export function getResolvedTheme(): ResolvedTheme {
  return _resolved;
}

// --- Theme mutation ---
export function setTheme(mode: ThemeMode) {
  if (typeof localStorage !== "undefined") {
    localStorage.setItem(STORAGE_KEY, mode);
  }
  applyTheme(mode);
}

// --- Initialization ---
if (typeof window !== "undefined") {
  const stored = localStorage.getItem(STORAGE_KEY);
  const initial: ThemeMode =
    stored === "dark" || stored === "light" || stored === "system" ? stored : "system";

  // app.html inline script already set data-theme before JS loads —
  // skip redundant DOM write here, only sync reactive state.
  applyTheme(initial, true);

  // React to system preference changes (only affects "system" mode).
  // applyTheme("system") resolves via getSystemTheme() and updates both
  // _resolved state and the DOM attribute.
  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
    if (_mode === "system") {
      applyTheme("system");
    }
  });
}
