export type ThemeMode = "dark" | "light" | "system";

const STORAGE_KEY = "cohub-theme";

function getSystemTheme(): "dark" | "light" {
  if (typeof window === "undefined") return "dark";
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function applyTheme(mode: ThemeMode) {
  const resolved = mode === "system" ? getSystemTheme() : mode;
  if (typeof document !== "undefined") {
    document.documentElement.setAttribute("data-theme", resolved);
  }
}

export function getTheme(): ThemeMode {
  if (typeof localStorage === "undefined") return "system";
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored === "dark" || stored === "light" || stored === "system") return stored;
  return "system";
}

export function setTheme(mode: ThemeMode) {
  if (typeof localStorage !== "undefined") {
    localStorage.setItem(STORAGE_KEY, mode);
  }
  applyTheme(mode);
}

export function getResolvedTheme(): "dark" | "light" {
  const mode = getTheme();
  return mode === "system" ? getSystemTheme() : mode;
}

// Initialize on import (SSR-safe)
if (typeof window !== "undefined") {
  applyTheme(getTheme());

  // Listen for system theme changes
  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
    if (getTheme() === "system") {
      applyTheme("system");
    }
  });
}
