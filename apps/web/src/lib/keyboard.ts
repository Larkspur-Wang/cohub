export function isComposingKeyboardEvent(event: KeyboardEvent): boolean {
	return event.isComposing || event.key === "Process" || event.keyCode === 229;
}
