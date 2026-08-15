import { isComposingKeyboardEvent } from "$lib/keyboard";

export type ComposerKeyAction = "none" | "newline" | "submit";

type ComposerKeyboardEvent = Pick<
	KeyboardEvent,
	"ctrlKey" | "isComposing" | "key" | "keyCode" | "metaKey" | "shiftKey"
>;

export function getComposerKeyAction(
	event: ComposerKeyboardEvent,
	options: { mobile: boolean },
): ComposerKeyAction {
	if (event.key !== "Enter" || isComposingKeyboardEvent(event)) return "none";
	if (event.metaKey || event.ctrlKey) return "submit";
	if (event.shiftKey || options.mobile) return "newline";
	return "submit";
}

export function isMobileComposerInput(): boolean {
	if (typeof window === "undefined") return false;
	return (
		"ontouchstart" in window ||
		window.matchMedia("(pointer: coarse)").matches ||
		navigator.maxTouchPoints > 0
	);
}
