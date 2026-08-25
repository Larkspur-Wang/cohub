export function createSessionTaskController() {
	let pendingFollowupActionIds = $state<Set<string>>(new Set());

	function addPendingFollowupAction(turnId: string) {
		pendingFollowupActionIds = new Set([...pendingFollowupActionIds, turnId]);
	}

	function removePendingFollowupAction(turnId: string) {
		const next = new Set(pendingFollowupActionIds);
		next.delete(turnId);
		pendingFollowupActionIds = next;
	}

	function reset() {
		pendingFollowupActionIds = new Set();
	}

	return {
		get pendingFollowupActionIds() {
			return pendingFollowupActionIds;
		},
		addPendingFollowupAction,
		removePendingFollowupAction,
		reset,
	};
}
