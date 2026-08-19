export type PromptTemplateContext = {
  sessionId?: string | null;
  spaceId?: string | null;
  userUuid?: string | null;
};

const SYSTEM_VARIABLE_PATTERN = /\{\{\s*(cohub\.(?:session|space)\.id|cohub\.user\.uuid)\s*\}\}/g;

function substituteSystemVariables(content: string, context: PromptTemplateContext): string {
  const values: Record<string, string | null | undefined> = {
    "cohub.session.id": context.sessionId,
    "cohub.space.id": context.spaceId,
    "cohub.user.uuid": context.userUuid,
  };

  return content.replace(SYSTEM_VARIABLE_PATTERN, (match, name: string) => values[name] || match);
}

function substituteArgs(content: string, args: string[]): string {
  let result = content.replace(/\$(\d+)/g, (_, num: string) => {
    const index = Number.parseInt(num, 10) - 1;
    return args[index] ?? "";
  });

  result = result.replace(/\$\{@:(\d+)(?::(\d+))?\}/g, (_, startText: string, lengthText?: string) => {
    const start = Math.max(Number.parseInt(startText, 10) - 1, 0);
    if (lengthText) {
      return args.slice(start, start + Number.parseInt(lengthText, 10)).join(" ");
    }
    return args.slice(start).join(" ");
  });

  const allArgs = args.join(" ");
  return result.replace(/\$ARGUMENTS/g, allArgs).replace(/\$@/g, allArgs);
}

export function renderPromptTemplate(content: string, args: string[], context: PromptTemplateContext = {}): string {
  return substituteArgs(substituteSystemVariables(content, context), args);
}
