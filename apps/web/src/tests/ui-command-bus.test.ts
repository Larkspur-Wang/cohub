import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import {
	__resetUiCommandBusForTests,
	__setUiCommandReporterForTests,
	getHandledSizeForTests,
	handleUiCommand,
	registerUiCommandHost,
	type UiCommandOutcome,
} from "../lib/features/ui-command/bus.ts";

const payload = (commandId: string) => ({
	commandId,
	targetClientId: "client-a",
	command: {
		type: "preview.show" as const,
		preview: {
			kind: "work" as const,
			workId: "123e4567-e89b-42d3-a456-426614174000",
		},
	},
	source: null,
});

type Report = { commandId: string; status: string; result?: unknown };

const SLOW_WORK = "123e4567-e89b-42d3-a456-426614174999";

/** Reporter that fails its first `failures` attempts, then records each report. */
function useReporter(reports: Report[], failures = 0) {
	let remaining = failures;
	__setUiCommandReporterForTests(async (commandId, body) => {
		if (remaining > 0) {
			remaining -= 1;
			throw new Error("network down");
		}
		reports.push({ commandId, status: body.status, result: body.result });
		return {};
	});
}

beforeEach(() => {
	__setUiCommandReporterForTests(null);
	__resetUiCommandBusForTests({ retryMs: 1 });
});

test("a command runs once and reports, and a redelivery does neither again", async () => {
	const reports: Report[] = [];
	useReporter(reports);
	let calls = 0;
	const off = registerUiCommandHost(async () => {
		calls += 1;
		return {
			status: "applied",
			result: { ok: true },
		} satisfies UiCommandOutcome;
	});

	await handleUiCommand(payload("cmd-1"));
	await handleUiCommand(payload("cmd-1"));
	off();

	assert.equal(calls, 1, "redelivery must not re-run the command");
	assert.deepEqual(reports, [
		{ commandId: "cmd-1", status: "applied", result: { ok: true } },
	]);
});

test("a transient report failure is retried rather than lost", async () => {
	// The caller would otherwise see a timeout for work that actually happened.
	const reports: Report[] = [];
	useReporter(reports, 2);
	const off = registerUiCommandHost(async () => ({ status: "applied" }));

	await handleUiCommand(payload("cmd-1"));
	off();

	assert.equal(reports.length, 1);
});

test("an outcome whose report never lands is re-reported on redelivery", async () => {
	const reports: Report[] = [];
	useReporter(reports, Number.POSITIVE_INFINITY);
	let calls = 0;
	const off = registerUiCommandHost(async () => {
		calls += 1;
		return { status: "applied", result: calls } satisfies UiCommandOutcome;
	});
	await handleUiCommand(payload("cmd-1"));
	assert.equal(reports.length, 0);

	useReporter(reports);
	await handleUiCommand(payload("cmd-1"));
	off();

	assert.equal(calls, 1, "the command must not run again");
	assert.deepEqual(reports, [
		{ commandId: "cmd-1", status: "applied", result: 1 },
	]);
});

test("a missing or throwing host still reports instead of hanging", async () => {
	const reports: Report[] = [];
	useReporter(reports);
	await handleUiCommand(payload("cmd-none"));
	assert.equal(reports.at(-1)?.status, "ui_host_unavailable");

	const off = registerUiCommandHost(async () => {
		throw new Error("boom");
	});
	await handleUiCommand(payload("cmd-boom"));
	off();
	assert.equal(reports.at(-1)?.status, "rejected");
});

test("a reporting outage stays bounded and never evicts a running command", async () => {
	// Every command finishes and fails to report, so the unreported backlog passes
	// its cap — the only path where eviction reaches a still-running entry.
	// Dropping that entry would let the redelivery run the method twice.
	useReporter([], Number.POSITIVE_INFINITY);
	const releases: Array<() => void> = [];
	let slowCalls = 0;
	const off = registerUiCommandHost(async (command) => {
		if (command.preview.workId !== SLOW_WORK) return { status: "applied" };
		slowCalls += 1;
		await new Promise<void>((resolve) => releases.push(resolve));
		return { status: "applied" };
	});

	const slow = {
		...payload("cmd-slow"),
		command: {
			type: "preview.show" as const,
			preview: { kind: "work" as const, workId: SLOW_WORK },
		},
	};
	const running = handleUiCommand(slow);
	await new Promise((resolve) => setTimeout(resolve, 0));

	for (let i = 0; i < 400; i += 1) await handleUiCommand(payload(`cmd-${i}`));
	const redelivered = handleUiCommand(slow);

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
