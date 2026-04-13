export const MOBILE_DRAWER_WIDTH_PX = 280;
export const MOBILE_DRAWER_MAX_WIDTH_VW = 85;
export const MOBILE_DRAWER_DIRECTION_LOCK_DISTANCE_PX = 8;
export const MOBILE_DRAWER_DIRECTION_RATIO = 1.25;
export const MOBILE_DRAWER_OPEN_THRESHOLD_RATIO = 0.26;
export const MOBILE_DRAWER_FLICK_VELOCITY_PX_PER_MS = 0.35;

export type DrawerGesturePhase =
  | "idle"
  | "tracking"
  | "dragging-open"
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
  if (viewportWidth >= 1024 || isOpen) return false;

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

export function getDrawerOffsetFromDrag(options: { deltaX: number }) {
  const { deltaX } = options;
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
