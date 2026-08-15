export function isComposingKeyboardEvent(
	event: Pick<KeyboardEvent, "isComposing" | "key" | "keyCode">,
): boolean {
	return event.isComposing || event.key === "Process" || event.keyCode === 229;
}

export function isEditableShortcutTarget(target: EventTarget | null): boolean {
	if (!(target instanceof HTMLElement)) return false;
	return Boolean(
		target.closest(
			'input, textarea, select, [contenteditable="true"], [contenteditable=""]',
		),
	);
}
