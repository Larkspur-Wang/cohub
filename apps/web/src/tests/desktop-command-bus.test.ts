import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import {
	__resetDesktopCommandBusForTests,
	__setDesktopCommandReporterForTests,
	getHandledSizeForTests,
	handleDesktopCommand,
	registerDesktopCommandHost,
} from "../lib/features/desktop-command/bus.ts";

const payload = (commandId: string) => ({
	commandId,
	targetClientId: "client-a",
	command: {
		type: "desktop.open" as const,
		target: {
			kind: "app" as const,
			appId: "123e4567-e89b-42d3-a456-426614174000",
		},
	},
	source: null,
});

type Report = { commandId: string; status: string };

const SLOW_WORK = "123e4567-e89b-42d3-a456-426614174999";

/** Reporter that fails its first `failures` attempts, then records each report. */
function useReporter(reports: Report[], failures = 0) {
	let remaining = failures;
	__setDesktopCommandReporterForTests(async (commandId, body) => {
		if (remaining > 0) {
			remaining -= 1;
			throw new Error("network down");
		}
		reports.push({ commandId, status: body.status });
		return {};
	});
}

beforeEach(() => {
	__setDesktopCommandReporterForTests(null);
	__resetDesktopCommandBusForTests({ retryMs: 1 });
});

test("a Work call stays pending after delivery acknowledgement", async () => {
	const reports: Report[] = [];
	useReporter(reports);
	let receivedCommandId = "";
	let calls = 0;
	const off = registerDesktopCommandHost(async (_command, context) => {
		calls += 1;
		receivedCommandId = context.commandId;
		return { status: "pending" };
	});

	await handleDesktopCommand(payload("cmd-deferred"));
	await handleDesktopCommand(payload("cmd-deferred"));
	off();

	assert.equal(receivedCommandId, "cmd-deferred");
	assert.equal(calls, 1, "redelivery must not reopen an accepted command");
	assert.deepEqual(reports, []);
});

test("accepted commands stay memory-bounded", async () => {
	useReporter([]);
	const off = registerDesktopCommandHost(async () => ({ status: "pending" }));

	for (let i = 0; i < 400; i += 1) {
		await handleDesktopCommand(payload(`deferred-${i}`));
	}
	off();

	assert.ok(
		getHandledSizeForTests() <= 200,
		`grew to ${getHandledSizeForTests()}`,
	);
});

test("a missing or throwing host still reports instead of hanging", async () => {
	const reports: Report[] = [];
	useReporter(reports);
	await handleDesktopCommand(payload("cmd-none"));
	assert.equal(reports.at(-1)?.status, "desktop_host_unavailable");

	const off = registerDesktopCommandHost(async () => {
		throw new Error("boom");
	});
	await handleDesktopCommand(payload("cmd-boom"));
	off();
	assert.equal(reports.at(-1)?.status, "rejected");
});

test("accepted commands never evict a call that is still being delivered", async () => {
	useReporter([]);
	const releases: Array<() => void> = [];
	let slowCalls = 0;
	const off = registerDesktopCommandHost(async (command) => {
		if (command.target.kind !== "app" || command.target.appId !== SLOW_WORK)
			return { status: "pending" };
		slowCalls += 1;
		await new Promise<void>((resolve) => releases.push(resolve));
		return { status: "pending" };
	});

	const slow = {
		...payload("cmd-slow"),
		command: {
			type: "desktop.open" as const,
			target: { kind: "app" as const, appId: SLOW_WORK },
		},
	};
	const running = handleDesktopCommand(slow);
	await new Promise((resolve) => setTimeout(resolve, 0));

	for (let i = 0; i < 400; i += 1)
		await handleDesktopCommand(payload(`cmd-${i}`));
	const redelivered = handleDesktopCommand(slow);

	for (const release of releases) release();
	await Promise.all([running, redelivered]);
	off();

	assert.equal(
		slowCalls,
		1,
		"a running command must not be evicted and re-run",
	);
	assert.ok(
		getHandledSizeForTests() <= 200,
		`grew to ${getHandledSizeForTests()}`,
	);
});
