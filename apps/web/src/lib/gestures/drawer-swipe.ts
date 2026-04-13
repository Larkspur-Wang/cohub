export const MOBILE_DRAWER_WIDTH_PX = 280;
export const MOBILE_DRAWER_MAX_WIDTH_VW = 85;
export const MOBILE_DRAWER_DIRECTION_LOCK_DISTANCE_PX = 8;
export const MOBILE_DRAWER_DIRECTION_RATIO = 1.25;
export const MOBILE_DRAWER_OPEN_THRESHOLD_RATIO = 0.26;
export const MOBILE_DRAWER_CLOSE_THRESHOLD_RATIO = 0.74;
export const MOBILE_DRAWER_FLICK_VELOCITY_PX_PER_MS = 0.35;

export type DrawerGesturePhase =
  | "idle"
  | "tracking"
  | "dragging-open"
  | "dragging-close"
  | "settling";

export type DrawerGestureDirection = "horizontal" | "vertical" | null;

export function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

export function getDrawerOpenRatio(offsetPx: number) {
  return clamp(offsetPx / MOBILE_DRAWER_WIDTH_PX, 0, 1);
}

export function shouldStartDrawerGesture(options: {
  isOpen: boolean;
  target: EventTarget | null;
  viewportWidth: number;
}) {
  const { isOpen, target, viewportWidth } = options;
  if (viewportWidth >= 1024) return false;
  if (isOpen) return true;

  const element = target instanceof Element ? target : null;
  if (!element) return true;

  return !element.closest(
    [
      "input",
      "textarea",
      "select",
      "button",
      "a",
      "label",
      "summary",
      "[contenteditable='true']",
      "[data-drawer-swipe-ignore]",
    ].join(", "),
  );
}

export function resolveDrawerGestureDirection(options: {
  absDx: number;
  absDy: number;
}) {
  const { absDx, absDy } = options;
  if (
    absDx < MOBILE_DRAWER_DIRECTION_LOCK_DISTANCE_PX &&
    absDy < MOBILE_DRAWER_DIRECTION_LOCK_DISTANCE_PX
  ) {
    return null;
  }
  if (absDx > absDy * MOBILE_DRAWER_DIRECTION_RATIO) {
    return "horizontal" satisfies DrawerGestureDirection;
  }
  if (absDy > absDx * MOBILE_DRAWER_DIRECTION_RATIO) {
    return "vertical" satisfies DrawerGestureDirection;
  }
  return null;
}

export function getDrawerOffsetFromDrag(options: {
  isOpen: boolean;
  deltaX: number;
}) {
  const { isOpen, deltaX } = options;
  if (isOpen) {
    return clamp(MOBILE_DRAWER_WIDTH_PX + deltaX, 0, MOBILE_DRAWER_WIDTH_PX);
  }
  return clamp(deltaX, 0, MOBILE_DRAWER_WIDTH_PX);
}

export function shouldOpenDrawer(options: {
  offsetPx: number;
  velocityX: number;
}) {
  const { offsetPx, velocityX } = options;
  const ratio = getDrawerOpenRatio(offsetPx);
  return (
    velocityX >= MOBILE_DRAWER_FLICK_VELOCITY_PX_PER_MS ||
    ratio >= MOBILE_DRAWER_OPEN_THRESHOLD_RATIO
  );
}

export function shouldKeepDrawerOpen(options: {
  offsetPx: number;
  velocityX: number;
}) {
  const { offsetPx, velocityX } = options;
  const ratio = getDrawerOpenRatio(offsetPx);
  return (
    velocityX > -MOBILE_DRAWER_FLICK_VELOCITY_PX_PER_MS &&
    ratio > 1 - MOBILE_DRAWER_CLOSE_THRESHOLD_RATIO
  );
}

// ─── Right drawer helpers (mirrored from left) ───

/**
 * Calculate drag offset for a right-side drawer.
 * Mirrors the left-drawer logic: sliding left (negative deltaX) increases offset.
 */
export function getRightDrawerOffsetFromDrag(options: {
  isOpen: boolean;
  deltaX: number;
}) {
  const { isOpen, deltaX } = options;
  if (isOpen) {
    // Drawer is open, deltaX left (negative) reduces offset
    return clamp(MOBILE_DRAWER_WIDTH_PX + deltaX, 0, MOBILE_DRAWER_WIDTH_PX);
  }
  // Drawer is closed, deltaX left (negative) increases offset
  return clamp(-deltaX, 0, MOBILE_DRAWER_WIDTH_PX);
}

/**
 * Decide whether to open a right drawer based on drag offset and velocity.
 * For right drawers, positive velocityX means dragging right (away from edge),
 * so we check for negative velocity (flick left) to trigger open.
 */
export function shouldOpenRightDrawer(options: {
  offsetPx: number;
  velocityX: number;
}) {
  const { offsetPx, velocityX } = options;
  const ratio = getDrawerOpenRatio(offsetPx);
  return (
    velocityX <= -MOBILE_DRAWER_FLICK_VELOCITY_PX_PER_MS ||
    ratio >= MOBILE_DRAWER_OPEN_THRESHOLD_RATIO
  );
}

/**
 * Decide whether to keep a right drawer open after drag ends.
 */
export function shouldKeepRightDrawerOpen(options: {
  offsetPx: number;
  velocityX: number;
}) {
  const { offsetPx, velocityX } = options;
  const ratio = getDrawerOpenRatio(offsetPx);
  return (
    velocityX < MOBILE_DRAWER_FLICK_VELOCITY_PX_PER_MS &&
    ratio > 1 - MOBILE_DRAWER_CLOSE_THRESHOLD_RATIO
  );
}

/**
 * Decide whether a right-drawer gesture should start.
 * When closed: only from the right edge region (rightmost 30% of screen).
 * When open: anywhere.
 */
export function shouldStartRightDrawerGesture(options: {
  isOpen: boolean;
  target: EventTarget | null;
  viewportWidth: number;
  touchStartX: number;
}) {
  const { isOpen, target, viewportWidth, touchStartX } = options;
  if (viewportWidth >= 1024) return false;
  if (isOpen) return true;

  // When closed, only allow from the right edge zone (rightmost 30%)
  const edgeZoneStart = viewportWidth * 0.7;
  if (touchStartX < edgeZoneStart) return false;

  const element = target instanceof Element ? target : null;
  if (!element) return true;

  return !element.closest(
    [
      "input",
      "textarea",
      "select",
      "button",
      "a",
      "label",
      "summary",
      "[contenteditable='true']",
      "[data-drawer-swipe-ignore]",
    ].join(", "),
  );
}
