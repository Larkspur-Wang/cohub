import { GATEWAY_CHANNEL_COMMAND_SPECS, type GatewayChannelCommand } from "@cohub/protocol/gateway";

type ChannelCommandSpec = typeof GATEWAY_CHANNEL_COMMAND_SPECS[number];

const channelCommandBySlash = new Map<string, ChannelCommandSpec>(
  GATEWAY_CHANNEL_COMMAND_SPECS.map((spec) => [spec.slash.toLowerCase(), spec]),
);

const parseSlashCommand = (text: string): GatewayChannelCommand | null => {
  const trimmed = text.trim();
  if (!trimmed.startsWith("/")) return null;

  const [rawCommand = "", ...args] = trimmed.split(/\s+/);
  const spec = channelCommandBySlash.get(rawCommand.toLowerCase());
  if (!spec) return null;

  return {
    name: spec.name,
    rawText: trimmed,
    args: args.join(" "),
  };
};

const stripLeadingPrefixes = (text: string, prefixes: string[]) => {
  let remaining = text.trim();
  let changed = true;

  while (changed) {
    changed = false;
    for (const prefix of prefixes.map((value) => value.trim()).filter(Boolean)) {
      if (remaining === prefix) return "";
      if (remaining.startsWith(`${prefix} `)) {
        remaining = remaining.slice(prefix.length).trim();
        changed = true;
        break;
      }
    }
  }

  return remaining;
};

export const resolveChannelCommand = (
  text: string,
  options: { leadingPrefixes?: string[] } = {},
): GatewayChannelCommand | null => {
  const direct = parseSlashCommand(text);
  if (direct) return direct;

  const prefixes = options.leadingPrefixes ?? [];
  if (prefixes.length === 0) return null;
  return parseSlashCommand(stripLeadingPrefixes(text, prefixes));
};
