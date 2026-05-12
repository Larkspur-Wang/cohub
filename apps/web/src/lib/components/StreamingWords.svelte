<script lang="ts">
type TokenKind = "word" | "space" | "linebreak";

type StreamToken = {
	key: string;
	text: string;
	kind: TokenKind;
	animated: boolean;
};

type Props = {
	text: string;
	active?: boolean;
	tone?: "default" | "muted";
};

const { text, active = true, tone = "default" }: Props = $props();

const wordSegmenter =
	typeof Intl !== "undefined" && "Segmenter" in Intl
		? new Intl.Segmenter(undefined, { granularity: "word" })
		: null;

let seenKeys = new Set<string>();
let previousText = "";
let tokens = $state<StreamToken[]>([]);

function splitSegment(
	segment: string,
): Array<{ text: string; kind: TokenKind }> {
	const parts: Array<{ text: string; kind: TokenKind }> = [];
	const pattern =
		/(\r\n|\n|\r)|([^\S\r\n]+)|([\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}])|([^\s]+)/gu;
	for (const match of segment.matchAll(pattern)) {
		const value = match[0];
		if (!value) continue;
		if (match[1]) parts.push({ text: value, kind: "linebreak" });
		else if (match[2]) parts.push({ text: value, kind: "space" });
		else parts.push({ text: value, kind: "word" });
	}
	return parts;
}

function tokenize(source: string) {
	if (!source) return [];
	const rawParts: Array<{ text: string; kind: TokenKind; index: number }> = [];

	if (wordSegmenter) {
		for (const segment of wordSegmenter.segment(source)) {
			const value = segment.segment;
			if (!value) continue;
			for (const part of splitSegment(value)) {
				rawParts.push({ ...part, index: segment.index });
			}
		}
	} else {
		let index = 0;
		for (const part of splitSegment(source)) {
			rawParts.push({ ...part, index });
			index += part.text.length;
		}
	}

	let cursor = 0;
	return rawParts.map((part, ordinal) => {
		const start = source.indexOf(part.text, cursor);
		const safeStart = start >= 0 ? start : part.index;
		cursor = safeStart + part.text.length;
		const key = `${safeStart}:${ordinal}:${part.text}`;
		const animated = part.kind === "word" && active && !seenKeys.has(key);
		return { ...part, key, animated } satisfies StreamToken;
	});
}

$effect(() => {
	const currentText = text;
	if (!currentText.startsWith(previousText)) {
		seenKeys = new Set();
	}
	const nextTokens = tokenize(currentText);
	tokens = nextTokens;
	const nextSeen = new Set(seenKeys);
	for (const token of nextTokens) {
		if (token.kind === "word") nextSeen.add(token.key);
	}
	seenKeys = nextSeen;
	previousText = currentText;
});
</script>

<span class="streaming-words" class:streaming-words-muted={tone === 'muted'} aria-live="off">
	{#each tokens as token (token.key)}
		{#if token.kind === 'linebreak'}
			<br />
		{:else if token.kind === 'space'}
			<span class="streaming-space">{token.text}</span>
		{:else}
			<span class:streaming-word={token.animated} class="streaming-token">{token.text}</span>
		{/if}
	{/each}
	{#if active}
		<span class="streaming-caret" aria-hidden="true"></span>
	{/if}
</span>
