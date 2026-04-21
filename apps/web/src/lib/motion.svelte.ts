// Motion timing tokens — shared across all components
// Follows the 100/300/500 rule; tuned toward the fast end for efficiency.

// ─── Durations ───────────────────────────────────────────────────────
export const DURATION_FAST = 150;   // micro-interactions, feedback
export const DURATION_MODAL_IN = 200;  // modal/drawer open
export const DURATION_MODAL_OUT = 100; // modal/drawer close — instant
export const DURATION_DRAWER_IN = 200;
export const DURATION_DRAWER_OUT = 100;

// ─── Easing curves (CSS cubic-bezier) ────────────────────────────────
// Expo out — snappy entrance, natural deceleration
export const EASE_OUT = "cubic-bezier(0.16, 1, 0.3, 1)";

// Ease-in — accelerating close, feels faster
export const EASE_IN = "cubic-bezier(0.7, 0, 0.84, 0)";

// ─── Svelte transition config helpers ───────────────────────────────
export function svelteEaseOut(t: number): number {
  // Convert CSS expo-out bezier to a JS easing function
  // Using a close approximation: t * t * t would be easeInCubic
  // For expo-out feel, we use a simple power curve
  return t === 0 || t === 1 ? t : 1 - (1 - t) * (1 - t) * (1 - t) * (1 - t);
}

export function svelteEaseIn(t: number): number {
  return t * t; // Quadratic ease-in for exits
}

// ─── CSS transition strings (for inline styles) ─────────────────────
export function transitionCss(prop: string, duration: number, direction: "in" | "out"): string {
  const easing = direction === "in" ? EASE_OUT : EASE_IN;
  return `${prop} ${duration}ms ${easing}`;
}
