import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { DesktopCommandRecord } from "@cohub/protocol/desktop-command";
import { canAppSessionSettleDesktopCommand } from "./desktop-command-auth.js";

const record = (overrides: Partial<DesktopCommandRecord> = {}): DesktopCommandRecord => ({
  version: 1,
  commandId: "command-1",
  status: "pending",
  command: {
    type: "desktop.open",
    target: {
      kind: "app",
      appId: "123e4567-e89b-42d3-a456-426614174000",
    },
    call: { method: "image.open" }
  },
  actorUserId: "user-1",
  targetClientId: "client-1",
  source: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  settledAt: null,
  ...overrides,
});

const input = {
  actorUserId: "user-1",
  appId: "123e4567-e89b-42d3-a456-426614174000",
};

describe("canAppSessionSettleDesktopCommand", () => {
  it("accepts only a command targeting the current app", () => {
    assert.equal(canAppSessionSettleDesktopCommand(record(), input), true);
  });

  it("rejects another user or app", () => {
    assert.equal(
      canAppSessionSettleDesktopCommand(record({ actorUserId: "user-2" }), input),
      false,
    );
    assert.equal(
      canAppSessionSettleDesktopCommand(record(), { ...input, appId: "other-work" }),
      false,
    );
  });
});
