import type { DesktopCommandRecord } from "@cohub/protocol/desktop-command";

export function canAppSessionSettleDesktopCommand(
  record: DesktopCommandRecord | null,
  input: { actorUserId: string; appId: string },
): record is DesktopCommandRecord {
  return Boolean(
    record &&
      record.actorUserId === input.actorUserId &&
      record.command.type === "desktop.open" &&
      record.command.target.kind === "app" &&
      record.command.target.appId === input.appId &&
      record.command.call !== undefined,
  );
}
