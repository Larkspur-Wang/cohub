export type StreamingTextSnapshot = {
	stableText: string;
	tailText: string;
};

export function splitStreamingText(
	previousText: string,
	currentText: string,
	active: boolean,
): StreamingTextSnapshot {
	if (!currentText) return { stableText: "", tailText: "" };
	if (!active) return { stableText: currentText, tailText: "" };
	if (!previousText) return { stableText: "", tailText: currentText };
	if (!currentText.startsWith(previousText)) {
		return { stableText: "", tailText: currentText };
	}
	return {
		stableText: previousText,
		tailText: currentText.slice(previousText.length),
	};
}
