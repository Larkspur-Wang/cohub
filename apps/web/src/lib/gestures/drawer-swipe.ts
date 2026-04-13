export const MOBILE_DRAWER_WIDTH_PX = 280;
export const MOBILE_DRAWER_MAX_WIDTH_VW = 85;
export const MOBILE_DRAWER_EDGE_SWIPE_WIDTH_PX = 96;
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
  startX: number;
  viewportWidth: number;
}) {
  const { isOpen, startX, viewportWidth } = options;
  if (viewportWidth >= 1024) return false;
  if (isOpen) return true;
  const activationWidth = Math.min(
    viewportWidth / 3,
    MOBILE_DRAWER_EDGE_SWIPE_WIDTH_PX,
  );
  return startX <= activationWidth;
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
