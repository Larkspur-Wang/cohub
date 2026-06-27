export type ComposerInsertOptions = {
	focus?: boolean;
	replacementKey?: string;
};

export function insertComposerSnippet(
	snippet: string,
	options: ComposerInsertOptions = {},
) {
	if (typeof window === "undefined") return;
	window.dispatchEvent(
		new CustomEvent<{ snippet: string } & ComposerInsertOptions>(
			"cohub:composer-insert",
			{
				detail: { snippet, ...options },
			},
		),
	);
}
