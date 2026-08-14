export function isTransientGenerationWatchError(error: unknown): boolean {
	if (error instanceof TypeError) return true;
	if (!error || typeof error !== "object") return false;
	const status = (error as { status?: unknown }).status;
	return (
		typeof status === "number" &&
		(status === 408 || status === 425 || status === 429 || status >= 500)
	);
}
