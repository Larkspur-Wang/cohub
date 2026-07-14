/**
 * Copy plain text to the system clipboard.
 *
 * Prefer the Async Clipboard API; fall back to a temporary textarea +
 * `document.execCommand("copy")` for non-secure contexts or when the modern
 * API is unavailable / blocked after an async gap.
 */
export async function copyTextToClipboard(text: string): Promise<void> {
	if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
		try {
			await navigator.clipboard.writeText(text);
			return;
		} catch {
			// Fall through to the legacy path. Common when transient user
			// activation is lost after an awaited network request.
		}
	}

	if (typeof document === "undefined") {
		throw new Error("Clipboard is not available in this environment");
	}

	const textarea = document.createElement("textarea");
	textarea.value = text;
	textarea.setAttribute("readonly", "true");
	textarea.setAttribute("aria-hidden", "true");
	textarea.style.position = "fixed";
	textarea.style.top = "0";
	textarea.style.left = "0";
	textarea.style.width = "1px";
	textarea.style.height = "1px";
	textarea.style.padding = "0";
	textarea.style.border = "none";
	textarea.style.outline = "none";
	textarea.style.boxShadow = "none";
	textarea.style.background = "transparent";
	textarea.style.opacity = "0";

	document.body.appendChild(textarea);
	textarea.focus();
	textarea.select();
	textarea.setSelectionRange(0, textarea.value.length);

	let copied = false;
	try {
		copied = document.execCommand("copy");
	} finally {
		textarea.remove();
	}

	if (!copied) {
		throw new Error("Failed to copy to clipboard");
	}
}
