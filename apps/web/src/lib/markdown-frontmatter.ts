export type MarkdownFrontmatterEntry = {
	key: string;
	value: string;
};

export type ParsedMarkdownFrontmatter = {
	raw: string;
	body: string;
	entries: MarkdownFrontmatterEntry[];
};

const FRONTMATTER_OPEN_RE = /^---[ \t]*(?:\r?\n|$)/;
const FRONTMATTER_CLOSE_RE = /^(---|\.\.\.)[ \t]*$/;
const KEY_VALUE_RE = /^([A-Za-z0-9_.-]+):(?:\s*(.*))?$/;
const ARRAY_ITEM_RE = /^\s*-\s+(.*)$/;

function splitLinesWithBreaks(source: string) {
	const matches = source.match(/.*(?:\r?\n|$)/g) ?? [];
	return matches.filter((line) => line.length > 0);
}

function stripLineBreak(line: string) {
	return line.replace(/\r?\n$/, "");
}

function unquoteScalar(value: string) {
	const trimmed = value.trim();
	if (trimmed.length < 2) return trimmed;
	const first = trimmed[0];
	const last = trimmed[trimmed.length - 1];
	if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
		return trimmed.slice(1, -1);
	}
	return trimmed;
}

function formatInlineArray(value: string) {
	const trimmed = value.trim();
	if (!trimmed.startsWith("[") || !trimmed.endsWith("]")) return null;
	return trimmed
		.slice(1, -1)
		.split(",")
		.map((item) => unquoteScalar(item))
		.filter(Boolean)
		.join(", ");
}

function parseFrontmatterEntries(raw: string) {
	const sourceLines = raw.split(/\r?\n/);
	const entries: MarkdownFrontmatterEntry[] = [];

	for (let index = 0; index < sourceLines.length; index += 1) {
		const line = sourceLines[index] ?? "";
		if (!line.trim() || line.trimStart().startsWith("#")) continue;

		const match = line.match(KEY_VALUE_RE);
		if (!match) continue;

		const key = match[1];
		const rawValue = match[2] ?? "";
		const inlineArray = formatInlineArray(rawValue);
		if (inlineArray !== null) {
			entries.push({ key, value: inlineArray });
			continue;
		}

		const scalar = unquoteScalar(rawValue);
		if (scalar) {
			entries.push({ key, value: scalar });
			continue;
		}

		const items: string[] = [];
		let cursor = index + 1;
		while (cursor < sourceLines.length) {
			const itemMatch = sourceLines[cursor]?.match(ARRAY_ITEM_RE);
			if (!itemMatch) break;
			items.push(unquoteScalar(itemMatch[1] ?? ""));
			cursor += 1;
		}

		if (items.length > 0) {
			entries.push({ key, value: items.filter(Boolean).join(", ") });
			index = cursor - 1;
		} else {
			entries.push({ key, value: "—" });
		}
	}

	return entries;
}

export function parseMarkdownFrontmatter(
	source: string,
): ParsedMarkdownFrontmatter | null {
	if (!FRONTMATTER_OPEN_RE.test(source)) return null;

	const lines = splitLinesWithBreaks(source);
	if (lines.length < 2 || stripLineBreak(lines[0] ?? "") !== "---") return null;

	let closingIndex = -1;
	for (let index = 1; index < lines.length; index += 1) {
		if (FRONTMATTER_CLOSE_RE.test(stripLineBreak(lines[index] ?? ""))) {
			closingIndex = index;
			break;
		}
	}

	if (closingIndex === -1) return null;

	const raw = lines
		.slice(1, closingIndex)
		.join("")
		.replace(/\r?\n$/, "");
	const body = lines
		.slice(closingIndex + 1)
		.join("")
		.trimStart();

	return {
		raw,
		body,
		entries: parseFrontmatterEntries(raw),
	};
}
