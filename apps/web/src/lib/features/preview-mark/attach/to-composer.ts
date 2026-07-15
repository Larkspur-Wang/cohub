export function attachComposerFiles(files: File | File[]) {
	if (typeof window === "undefined") return;
	const list = Array.isArray(files) ? files : [files];
	if (list.length === 0) return;
	window.dispatchEvent(
		new CustomEvent<{ files: File[] }>("cohub:composer-attach-files", {
			detail: { files: list },
		}),
	);
}
