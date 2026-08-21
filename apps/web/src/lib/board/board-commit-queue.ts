import type { BoardSemanticCommand } from "@cohub/protocol";
import {
	type BoardDocument,
	boardDocumentToSemanticCommands,
} from "@neta-art/cohub/board";

export type CommitFn = (
	document: BoardDocument,
	before: BoardDocument,
	commands: BoardSemanticCommand[],
) => Promise<void>;

export type CommitOutcome =
	| { ok: true; commands: BoardSemanticCommand[] }
	| { ok: false; error: unknown };

/** Serializes semantic Board commits against the last confirmed baseline. */
export function createCommitQueue(onCommit: CommitFn) {
	let baseline: BoardDocument | null = null;
	let tail: Promise<void> = Promise.resolve();
	let generation = 0;
	const echoed = new Set<BoardDocument>();

	function reset(document: BoardDocument) {
		generation += 1;
		baseline = document;
		echoed.clear();
	}

	function isEcho(document: BoardDocument): boolean {
		if (!echoed.has(document)) return false;
		echoed.delete(document);
		return true;
	}

	function commit(snapshot: BoardDocument): Promise<CommitOutcome> {
		const gen = generation;
		const run = tail.then<CommitOutcome>(async () => {
			if (gen !== generation || !baseline) return { ok: true, commands: [] };
			const before = baseline;
			const commands = boardDocumentToSemanticCommands(before, snapshot);
			if (commands.length === 0) return { ok: true, commands: [] };
			echoed.add(snapshot);
			try {
				await onCommit(snapshot, before, commands);
				if (gen !== generation) return { ok: true, commands };
				baseline = snapshot;
				if (echoed.size > 32) {
					const oldest = echoed.values().next().value;
					if (oldest && oldest !== snapshot) echoed.delete(oldest);
				}
				return { ok: true, commands };
			} catch (error) {
				echoed.delete(snapshot);
				return { ok: false, error };
			}
		});
		tail = run.then(() => undefined);
		return run;
	}

	return { reset, commit, isEcho };
}

export type CommitQueue = ReturnType<typeof createCommitQueue>;
