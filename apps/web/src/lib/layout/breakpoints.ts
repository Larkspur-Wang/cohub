export const DESKTOP_SHELL_MIN_WIDTH_PX = 960;
export const COMPACT_SHELL_MAX_WIDTH_PX = DESKTOP_SHELL_MIN_WIDTH_PX - 1;

export function isCompactShellWidth(width: number) {
	return width <= COMPACT_SHELL_MAX_WIDTH_PX;
}

export function isDesktopShellWidth(width: number) {
	return width >= DESKTOP_SHELL_MIN_WIDTH_PX;
}
