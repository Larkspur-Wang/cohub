/**
 * Resolve CSS color values (including Cohub oklch tokens) to Pixi-friendly
 * 0xRRGGBB numbers. Uses a live DOM probe so space theme.css / data-theme
 * overrides are honored without hardcoding hex.
 */

let probe: HTMLElement | null = null;

function getProbe(): HTMLElement | null {
	if (typeof document === "undefined") return null;
	if (probe) return probe;
	probe = document.createElement("span");
	probe.setAttribute("data-cohub-color-probe", "true");
	probe.style.cssText =
		"position:absolute;left:-9999px;top:0;width:1px;height:1px;pointer-events:none;opacity:0;";
	document.documentElement.append(probe);
	return probe;
}

function parseRgbChannel(value: string): number | null {
	const trimmed = value.trim();
	if (!trimmed) return null;
	if (trimmed.endsWith("%")) {
		const pct = Number.parseFloat(trimmed.slice(0, -1));
		return Number.isFinite(pct)
			? Math.max(0, Math.min(255, Math.round((pct / 100) * 255)))
			: null;
	}
	const n = Number.parseFloat(trimmed);
	return Number.isFinite(n) ? Math.max(0, Math.min(255, Math.round(n))) : null;
}

/** Parse `rgb()`, `rgba()`, `#rgb`, `#rrggbb` into 0xRRGGBB. */
export function parseCssColorToNumber(value: string): number | null {
	const raw = value.trim();
	if (!raw) return null;

	const hex6 = /^#([0-9a-f]{6})$/i.exec(raw);
	if (hex6) return Number.parseInt(hex6[1], 16);

	const hex3 = /^#([0-9a-f]{3})$/i.exec(raw);
	if (hex3) {
		const [r, g, b] = hex3[1].split("");
		return Number.parseInt(`${r}${r}${g}${g}${b}${b}`, 16);
	}

	const rgb =
		/^rgba?\(\s*([^\s,/]+)[\s,/]+([^\s,/]+)[\s,/]+([^\s,/]+)(?:[\s,/]+[^\s)]+)?\s*\)$/i.exec(
			raw,
		);
	if (rgb) {
		const r = parseRgbChannel(rgb[1]);
		const g = parseRgbChannel(rgb[2]);
		const b = parseRgbChannel(rgb[3]);
		if (r == null || g == null || b == null) return null;
		return (r << 16) | (g << 8) | b;
	}

	return null;
}

/**
 * Read a CSS custom property from `host` (or documentElement) and convert to
 * 0xRRGGBB. Falls back when the value is empty or unparsable.
 */
export function readCssColorNumber(
	host: Element | null | undefined,
	property: string,
	fallback: number,
): number {
	const el =
		host ?? (typeof document !== "undefined" ? document.documentElement : null);
	if (!el) return fallback;

	const declared = getComputedStyle(el).getPropertyValue(property).trim();
	if (!declared) return fallback;

	// Fast path: already #rrggbb / rgb().
	const direct = parseCssColorToNumber(declared);
	if (direct != null) return direct;

	// Resolve oklch / color-mix / var() through the browser.
	const node = getProbe();
	if (!node) return fallback;
	node.style.color = "";
	node.style.color = declared;
	const resolved = getComputedStyle(node).color;
	return parseCssColorToNumber(resolved) ?? fallback;
}

export function hexNumberToCss(value: number): string {
	return `#${value.toString(16).padStart(6, "0")}`;
}
