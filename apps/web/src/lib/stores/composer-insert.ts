export function insertComposerSnippet(snippet: string) {
	if (typeof window === "undefined") return;
	window.dispatchEvent(
		new CustomEvent<{ snippet: string }>("cohub:composer-insert", {
			detail: { snippet },
		}),
	);
}
