import type {
	DesktopCommand,
	DesktopCommandDispatchedPayload,
} from "@neta-art/cohub";
import { getClientInstanceId } from "$lib/client-instance";

const loadSdk = async () => (await import("$lib/sdk")).sdk;

export type DesktopCommandOutcome =
	| { status: "pending" }
	| {
			status:
				| "applied"
				| "desktop_host_unavailable"
				| "rejected"
				| "unsupported";
			error?: { code: string; message: string };
	  };

export type DesktopCommandContext = {
	commandId: string;
	source: DesktopCommandDispatchedPayload["source"];
};

export type DesktopCommandHost = (
	command: DesktopCommand,
	context: DesktopCommandContext,
) => Promise<DesktopCommandOutcome>;

const HOST_UNAVAILABLE: DesktopCommandOutcome = {
	status: "desktop_host_unavailable",
	error: {
		code: "desktop_host_unavailable",
		message:
			"This Cohub tab is not showing a Space workspace that can host the preview.",
	},
};

let host: DesktopCommandHost | null = null;

/**
 * The entry exists before the command runs, so a redelivery does not execute it
 * twice, and the outcome is kept so a failed upload can be re-reported. In memory
 * by design: delivery is at-least-once, so callable methods should be repeatable.
 */
type TerminalDesktopCommandOutcome = Exclude<
	DesktopCommandOutcome,
	{ status: "pending" }
>;
type HandledEntry = {
	outcome: TerminalDesktopCommandOutcome | null;
	reported: boolean;
	accepted: boolean;
};
const handled = new Map<string, HandledEntry>();

const HANDLED_MAX = 200;
const HANDLED_KEEP = 100;
const UNREPORTED_MAX = 50;
const REPORT_ATTEMPTS = 3;
let reportRetryMs = 400;

/** A running command is never evicted, or a redelivery would run it again. */
function evictBounded() {
	let unreported = 0;
	for (const entry of handled.values()) {
		if (entry.outcome && !entry.reported) unreported += 1;
	}

	for (const [id, entry] of handled) {
		if (handled.size <= HANDLED_KEEP && unreported <= UNREPORTED_MAX) return;
		if (!entry.outcome && !entry.accepted) continue;
		if (entry.outcome && !entry.reported) {
			if (unreported <= UNREPORTED_MAX) continue;
			unreported -= 1;
		}
		handled.delete(id);
	}
}

function rememberBounded(commandId: string, entry: HandledEntry) {
	handled.set(commandId, entry);
	if (handled.size > HANDLED_MAX) evictBounded();
}

export function registerDesktopCommandHost(
	next: DesktopCommandHost,
): () => void {
	host = next;
	return () => {
		if (host === next) host = null;
	};
}

function isForThisClient(payload: DesktopCommandDispatchedPayload): boolean {
	const clientId = getClientInstanceId();
	return Boolean(clientId && payload.targetClientId === clientId);
}

export type DesktopCommandReporter = (
	commandId: string,
	body: {
		status: TerminalDesktopCommandOutcome["status"];
		error: { code: string; message: string } | null;
	},
) => Promise<unknown>;

let reporter: DesktopCommandReporter | null = null;

export function __setDesktopCommandReporterForTests(
	next: DesktopCommandReporter | null,
) {
	reporter = next;
}

export function getHandledSizeForTests(): number {
	return handled.size;
}

export function __resetDesktopCommandBusForTests(
	options: { retryMs?: number } = {},
) {
	handled.clear();
	reportRetryMs = options.retryMs ?? 400;
}

async function uploadResult(
	commandId: string,
	body: Parameters<DesktopCommandReporter>[1],
): Promise<unknown> {
	if (reporter) return reporter(commandId, body);
	const sdk = await loadSdk();
	return sdk.desktop.reportResult(commandId, body);
}

async function report(
	commandId: string,
	outcome: TerminalDesktopCommandOutcome,
): Promise<boolean> {
	for (let attempt = 1; attempt <= REPORT_ATTEMPTS; attempt += 1) {
		try {
			await uploadResult(commandId, {
				status: outcome.status,
				error: outcome.error ?? null,
			});
			return true;
		} catch (error) {
			if (attempt === REPORT_ATTEMPTS) {
				console.warn("[desktop-command] failed to report result", error);
				return false;
			}
			await new Promise((resolve) =>
				setTimeout(resolve, reportRetryMs * attempt),
			);
		}
	}
	return false;
}

export async function handleDesktopCommand(
	payload: DesktopCommandDispatchedPayload,
): Promise<void> {
	const seen = handled.get(payload.commandId);
	if (seen) {
		if (seen.outcome && !seen.reported) {
			seen.reported = await report(payload.commandId, seen.outcome);
		}
		return;
	}
	const entry: HandledEntry = {
		outcome: null,
		reported: false,
		accepted: false,
	};
	rememberBounded(payload.commandId, entry);

	let outcome: DesktopCommandOutcome;
	try {
		outcome = host
			? await host(payload.command, {
					commandId: payload.commandId,
					source: payload.source,
				})
			: HOST_UNAVAILABLE;
	} catch (error) {
		outcome = {
			status: "rejected",
			error: {
				code: "host_failed",
				message: error instanceof Error ? error.message : String(error),
			},
		};
	}

	if (outcome.status === "pending") {
		// The Work acknowledged delivery and will settle this command directly.
		entry.accepted = true;
		return;
	}
	entry.outcome = outcome;
	entry.reported = await report(payload.commandId, outcome);
}

function parsePayload(value: unknown): DesktopCommandDispatchedPayload | null {
	if (!value || typeof value !== "object") return null;
	const payload = value as Partial<DesktopCommandDispatchedPayload>;
	if (typeof payload.commandId !== "string" || !payload.commandId) return null;
	if (typeof payload.targetClientId !== "string" || !payload.targetClientId)
		return null;
	if (!payload.command || typeof payload.command !== "object") return null;
	return payload as DesktopCommandDispatchedPayload;
}

let stopListening: (() => void) | null = null;

export function startDesktopCommandListener(): () => void {
	if (stopListening) return stopListening;
	let off: (() => void) | null = null;
	let cancelled = false;
	void loadSdk().then((sdk) => {
		if (cancelled) return;
		off = sdk.onUserEvent((event) => {
			if (event.type !== "desktop.command.dispatched") return;
			const payload = parsePayload(event.payload);
			if (!payload || !isForThisClient(payload)) return;
			void handleDesktopCommand(payload);
		});
	});
	stopListening = () => {
		cancelled = true;
		off?.();
		stopListening = null;
	};
	return stopListening;
}
