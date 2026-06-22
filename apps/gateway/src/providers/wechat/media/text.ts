const MAX_BLANK_LINES = 2;

function stripMarkdownImages(text: string) {
  return text.replace(/!\[[^\]]*]\([^)]*\)/g, "");
}

function simplifyMarkdownLine(line: string) {
  return line
    .replace(/^#{1,6}\s+/, "")
    .replace(/^>\s?/, "")
    .replace(/\[([^\]]+)]\((https?:\/\/[^\s)]+)\)/g, "$1 ($2)")
    .replace(/\*\*\*([^*]+)\*\*\*/g, "$1")
    .replace(/___([^_]+)___/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/__([^_]+)__/g, "$1")
    .replace(/~~([^~]+)~~/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .trimEnd();
}

export function renderWeChatText(value: string) {
  const text = stripMarkdownImages(value).replace(/\r\n/g, "\n");
  const lines = text.split("\n");
  const output: string[] = [];
  let inFence = false;
  let blankCount = 0;

  for (const rawLine of lines) {
    const fence = rawLine.trimStart().startsWith("```");
    if (fence) {
      inFence = !inFence;
      output.push(rawLine.trimEnd());
      blankCount = 0;
      continue;
    }

    const line = inFence ? rawLine.trimEnd() : simplifyMarkdownLine(rawLine);
    if (!line.trim()) {
      blankCount += 1;
      if (blankCount <= MAX_BLANK_LINES) output.push("");
      continue;
    }

    blankCount = 0;
    output.push(line);
  }

  return output.join("\n").trim();
}
